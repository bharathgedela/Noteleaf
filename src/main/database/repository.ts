import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AppSettings,
  MarkdownViewMode,
  NavigationData,
  NotebookTree,
  Page,
  PageSummary,
  SearchResult,
  SectionTree,
  TaskItem,
  TaskStatus,
} from '../../shared/types.js';
import { runMigrations } from './migrations.js';
import { createVaultSalt, decryptVaultPayload, deriveVaultKey, encryptVaultPayload, verifyVaultKey, vaultVerifier } from '../vault/crypto.js';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  editorFontSize: 16,
  codeFontSize: 14,
  lineWidth: 880,
  spellcheck: true,
  defaultMarkdownMode: 'preview',
  reopenPreviousSession: true,
  backupFolder: '',
  backupDestination: 'local',
  backupFrequency: 'hourly',
  backupRetention: 10,
  lastBackupAt: null,
  lastBackupError: null,
  mcpEnabled: false,
  mcpAllowWrites: false,
  mcpPort: 37931,
  mcpAccessToken: '',
};

type Row = Record<string, unknown>;

export interface McpNotebookSummary {
  id: string;
  name: string;
  position: number;
  sectionCount: number;
  pageCount: number;
  updatedAt: string;
}

export interface McpSectionSummary {
  id: string;
  notebookId: string;
  notebook: string;
  name: string;
  position: number;
  pageCount: number;
  updatedAt: string;
}

export interface McpPageSummary extends PageSummary {
  notebookId: string;
  notebook: string;
  section: string;
}

function now(): string { return new Date().toISOString(); }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function summary(row: Row): PageSummary {
  const isEncrypted = Boolean(row.is_encrypted);
  return {
    id: String(row.id), sectionId: String(row.section_id), title: String(row.title),
    position: Number(row.position), isFavorite: Boolean(row.is_favorite),
    isDeleted: Boolean(row.is_deleted), updatedAt: String(row.updated_at),
    lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
    isSidebarVisible: Boolean(row.sidebar_visible),
    parentPageId: row.parent_page_id ? String(row.parent_page_id) : null,
    externalPath: row.external_path ? String(row.external_path) : null,
    isEncrypted,
    isLocked: isEncrypted,
  };
}
function page(row: Row): Page {
  return {
    ...summary(row), contentHtml: String(row.content_html),
    contentMarkdown: String(row.content_markdown), createdAt: String(row.created_at),
  };
}
function task(row: Row): TaskItem {
  return {
    id: String(row.id), title: String(row.title), taskDate: String(row.task_date),
    status: String(row.status) as TaskStatus, position: Number(row.position),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export class NotesRepository {
  readonly db: Database.Database;
  private vaultKey?: Buffer;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('secure_delete = ON');
    runMigrations(this.db);
    this.seed();
  }

  close(): void { this.lockVault(); if (this.db.open) this.db.close(); }

  async backupTo(destination: string): Promise<void> {
    await this.db.backup(destination);
  }

  vaultStatus(): import('../../shared/types.js').VaultStatus {
    const configured = Boolean(this.db.prepare('SELECT 1 FROM vault_metadata WHERE id = 1').get());
    const encryptedPageCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM pages WHERE is_encrypted = 1').get() as { count: number }).count);
    return { configured, unlocked: configured && Boolean(this.vaultKey), encryptedPageCount };
  }

  async setupVault(password: string): Promise<void> {
    if (this.vaultStatus().configured) throw new Error('The private-page vault is already configured');
    if (password.length < 10) throw new Error('Use at least 10 characters for the vault password');
    const salt = createVaultSalt();
    const key = await deriveVaultKey(password, salt);
    this.db.prepare('INSERT INTO vault_metadata(id, salt, verifier, kdf_version, created_at) VALUES (1, ?, ?, 1, ?)').run(salt, vaultVerifier(key), now());
    this.replaceVaultKey(key);
  }

  async unlockVault(password: string): Promise<void> {
    const metadata = this.db.prepare('SELECT salt, verifier, kdf_version FROM vault_metadata WHERE id = 1').get() as { salt: string; verifier: string; kdf_version: number } | undefined;
    if (!metadata) throw new Error('The private-page vault has not been configured');
    if (metadata.kdf_version !== 1) throw new Error('This vault uses an unsupported encryption version');
    const key = await deriveVaultKey(password, metadata.salt);
    if (!verifyVaultKey(key, metadata.verifier)) { key.fill(0); throw new Error('Incorrect vault password'); }
    this.replaceVaultKey(key);
  }

  lockVault(): void {
    this.vaultKey?.fill(0);
    this.vaultKey = undefined;
  }

  private replaceVaultKey(key: Buffer): void {
    this.vaultKey?.fill(0);
    this.vaultKey = key;
  }

  private requireVaultKey(): Buffer {
    if (!this.vaultKey) throw new Error('Unlock private pages first');
    return this.vaultKey;
  }

  private decryptedPayload(row: Row): { title: string; contentHtml: string; contentMarkdown: string } {
    const key = this.requireVaultKey();
    const encrypted = row.encrypted_payload;
    if (typeof encrypted !== 'string' || !encrypted) throw new Error('Encrypted page data is missing');
    const parsed = JSON.parse(decryptVaultPayload(encrypted, key, String(row.id))) as Partial<{ title: string; contentHtml: string; contentMarkdown: string }>;
    if (typeof parsed.title !== 'string' || typeof parsed.contentHtml !== 'string' || typeof parsed.contentMarkdown !== 'string') throw new Error('Encrypted page data is invalid');
    return { title: parsed.title, contentHtml: parsed.contentHtml, contentMarkdown: parsed.contentMarkdown };
  }

  private revealSummary(row: Row): PageSummary {
    const result = summary(row);
    if (!result.isEncrypted || !this.vaultKey) return result;
    return { ...result, title: this.decryptedPayload(row).title, isLocked: false };
  }

  private revealPage(row: Row): Page {
    const result = page(row);
    if (!result.isEncrypted || !this.vaultKey) return result;
    const payload = this.decryptedPayload(row);
    return { ...result, title: payload.title, contentHtml: payload.contentHtml, contentMarkdown: payload.contentMarkdown, isLocked: false };
  }

  isPageEncrypted(id: string): boolean {
    return Boolean((this.db.prepare('SELECT is_encrypted FROM pages WHERE id = ?').get(id) as { is_encrypted?: number } | undefined)?.is_encrypted);
  }

  assertPageTreeEncryptable(id: string): void {
    const rows = this.db.prepare(`WITH RECURSIVE page_tree(id) AS (
      SELECT id FROM pages WHERE id = ?
      UNION ALL SELECT p.id FROM pages p JOIN page_tree parent ON p.parent_page_id = parent.id
    ) SELECT p.* FROM pages p JOIN page_tree tree ON tree.id = p.id`).all(id) as Row[];
    if (!rows.length) throw new Error('Page not found');
    if (rows.some((row) => row.external_path)) throw new Error('Linked Markdown files cannot be encrypted because their original files live outside Noteleaf');
    if (rows.some((row) => String(row.content_html).includes('notes-asset://'))) throw new Error('Pages with embedded images cannot be encrypted yet. Remove the images and try again.');
  }

  encryptPageTree(id: string): string[] {
    const key = this.requireVaultKey();
    this.assertPageTreeEncryptable(id);
    const rows = this.db.prepare(`WITH RECURSIVE page_tree(id) AS (
      SELECT id FROM pages WHERE id = ?
      UNION ALL SELECT p.id FROM pages p JOIN page_tree parent ON p.parent_page_id = parent.id
    ) SELECT p.* FROM pages p JOIN page_tree tree ON tree.id = p.id`).all(id) as Row[];
    if (!rows.length) throw new Error('Page not found');
    const update = this.db.prepare(`UPDATE pages SET title = 'Locked page', content_html = '<p></p>', content_markdown = '',
      encrypted_payload = ?, is_encrypted = 1, is_favorite = 0, updated_at = ? WHERE id = ?`);
    this.db.transaction(() => {
      for (const row of rows) {
        if (row.is_encrypted) continue;
        const payload = JSON.stringify({ title: String(row.title), contentHtml: String(row.content_html), contentMarkdown: String(row.content_markdown) });
        update.run(encryptVaultPayload(payload, key, String(row.id)), now(), row.id);
      }
    })();
    this.secureDatabaseAfterEncryption();
    return rows.map((row) => String(row.id));
  }

  decryptPageTree(id: string): string[] {
    this.requireVaultKey();
    const rows = this.db.prepare(`WITH RECURSIVE page_tree(id) AS (
      SELECT id FROM pages WHERE id = ?
      UNION ALL SELECT p.id FROM pages p JOIN page_tree parent ON p.parent_page_id = parent.id
    ) SELECT p.* FROM pages p JOIN page_tree tree ON tree.id = p.id`).all(id) as Row[];
    if (!rows.length) throw new Error('Page not found');
    const update = this.db.prepare(`UPDATE pages SET title = ?, content_html = ?, content_markdown = ?,
      encrypted_payload = NULL, is_encrypted = 0, updated_at = ? WHERE id = ?`);
    this.db.transaction(() => {
      for (const row of rows) {
        if (!row.is_encrypted) continue;
        const payload = this.decryptedPayload(row);
        update.run(payload.title, payload.contentHtml, payload.contentMarkdown, now(), row.id);
      }
    })();
    return rows.map((row) => String(row.id));
  }

  private secureDatabaseAfterEncryption(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.exec('VACUUM');
  }

  private seed(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM notebooks').get() as { count: number };
    if (count.count) return;
    const created = now();
    const notebookId = randomUUID();
    const sectionId = randomUUID();
    const pageId = randomUUID();
    const markdown = `# Welcome to Noteleaf

A calm, local-first workspace for notes, Markdown documents, and daily tasks. Your writing stays on this computer and saves automatically.

> **Start here:** Rename this page, edit anything below, or create a new notebook from the **+** beside Noteleaf.

## What you can do

| Feature | How it helps |
| --- | --- |
| Notebooks and sections | Keep projects and topics in a clear hierarchy. |
| Rich notes | Write headings, lists, tables, quotes, code blocks, links, and resizable images. |
| Linked pages | Type **/page**, name the page, and jump between related ideas without adding sidebar clutter. |
| Markdown workspace | Open individual Markdown files or browse a complete folder tree inside Noteleaf. |
| Daily Tasks | Press **Ctrl+T** on Windows or **Command+T** on macOS to plan work as To do, In progress, and Done. |
| Safe backups | Choose any folder—including a locally synced Google Drive or OneDrive folder—and Noteleaf backs up automatically every hour. |

## Your first five minutes

- ☐ Rename the **Welcome** notebook for your first project.
- ☐ Create a section and add a note with its **+** button.
- ☐ Type **/** in a note to explore blocks and linked pages.
- ☐ Press **Ctrl+T** on Windows or **Command+T** on macOS and add today's first task.
- ☐ Select **Backup** in the top toolbar and choose a protected folder.

## Essential shortcuts

| Action | Shortcut |
| --- | --- |
| Search all notes | **Ctrl+F** / **Command+F** |
| Toggle Tasks and notes | **Ctrl+T** / **Command+T** |
| Move through open tabs | **Ctrl+Tab** / **Command+Tab** |
| Focus mode | **Ctrl+Shift+F** / **Command+Shift+F** |
| Open Settings | **Ctrl+,** / **Command+,** |
| Save an external Markdown file | **Ctrl+S** / **Command+S** |

## Helpful details

1. Drag the small grips in the sidebar to reorder notebooks, sections, and pages.
2. Paste an image into a note, select it, then drag an edge to resize it.
3. Relative links in Markdown files open the linked file directly inside Noteleaf.
4. Deleted pages remain in Trash until you remove them permanently.
5. Backups include your notes, linked pages, attachments, settings, drafts, and Tasks.

## Local-first by design

Noteleaf does not require an account and keeps the working library on this computer. For protection from computer failure, choose a backup folder. If Google Drive or OneDrive is installed, you can choose one of its locally synced folders without granting Noteleaf account access.

You are ready—turn this guide into your own first note, or keep it nearby as a reference.`;
    const html = `<h1>Welcome to Noteleaf</h1>
<p><strong>A calm, local-first workspace for notes, Markdown documents, and daily tasks.</strong> Your writing stays on this computer and saves automatically.</p>
<blockquote><p><strong>Start here:</strong> Rename this page, edit anything below, or create a new notebook from the <strong>+</strong> beside Noteleaf.</p></blockquote>
<h2>What you can do</h2>
<table><thead><tr><th><p>Feature</p></th><th><p>How it helps</p></th></tr></thead><tbody>
<tr><td><p><strong>Notebooks and sections</strong></p></td><td><p>Keep projects and topics in a clear hierarchy.</p></td></tr>
<tr><td><p><strong>Rich notes</strong></p></td><td><p>Write headings, lists, tables, quotes, code blocks, links, and resizable images.</p></td></tr>
<tr><td><p><strong>Linked pages</strong></p></td><td><p>Type <strong>/page</strong>, name the page, and jump between related ideas without adding sidebar clutter.</p></td></tr>
<tr><td><p><strong>Markdown workspace</strong></p></td><td><p>Open individual Markdown files or browse a complete folder tree inside Noteleaf.</p></td></tr>
<tr><td><p><strong>Daily Tasks</strong></p></td><td><p>Press <strong>Ctrl+T</strong> on Windows or <strong>Command+T</strong> on macOS to plan work as To do, In progress, and Done.</p></td></tr>
<tr><td><p><strong>Safe backups</strong></p></td><td><p>Choose any folder—including a locally synced Google Drive or OneDrive folder—and Noteleaf backs up automatically every hour.</p></td></tr>
</tbody></table>
<h2>Your first five minutes</h2>
<ul><li><p>☐ Rename the <strong>Welcome</strong> notebook for your first project.</p></li><li><p>☐ Create a section and add a note with its <strong>+</strong> button.</p></li><li><p>☐ Type <strong>/</strong> in a note to explore blocks and linked pages.</p></li><li><p>☐ Press <strong>Ctrl+T</strong> on Windows or <strong>Command+T</strong> on macOS and add today's first task.</p></li><li><p>☐ Select <strong>Backup</strong> in the top toolbar and choose a protected folder.</p></li></ul>
<h2>Essential shortcuts</h2>
<table><thead><tr><th><p>Action</p></th><th><p>Windows / macOS</p></th></tr></thead><tbody><tr><td><p>Search all notes</p></td><td><p><strong>Ctrl+F / Command+F</strong></p></td></tr><tr><td><p>Toggle Tasks and notes</p></td><td><p><strong>Ctrl+T / Command+T</strong></p></td></tr><tr><td><p>Move through open tabs</p></td><td><p><strong>Ctrl+Tab / Command+Tab</strong></p></td></tr><tr><td><p>Focus mode</p></td><td><p><strong>Ctrl+Shift+F / Command+Shift+F</strong></p></td></tr><tr><td><p>Open Settings</p></td><td><p><strong>Ctrl+, / Command+,</strong></p></td></tr><tr><td><p>Save an external Markdown file</p></td><td><p><strong>Ctrl+S / Command+S</strong></p></td></tr></tbody></table>
<h2>Helpful details</h2>
<ol><li><p>Drag the small grips in the sidebar to reorder notebooks, sections, and pages.</p></li><li><p>Paste an image into a note, select it, then drag an edge to resize it.</p></li><li><p>Relative links in Markdown files open the linked file directly inside Noteleaf.</p></li><li><p>Deleted pages remain in Trash until you remove them permanently.</p></li><li><p>Backups include your notes, linked pages, attachments, settings, drafts, and Tasks.</p></li></ol>
<h2>Local-first by design</h2>
<p>Noteleaf does not require an account and keeps the working library on this computer. For protection from computer failure, choose a backup folder. If Google Drive or OneDrive is installed, you can choose one of its locally synced folders without granting Noteleaf account access.</p>
<p><strong>You are ready—turn this guide into your own first note, or keep it nearby as a reference.</strong></p>`;
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO notebooks VALUES (?, ?, 0, ?, ?)').run(notebookId, 'Welcome', created, created);
      this.db.prepare('INSERT INTO sections VALUES (?, ?, ?, 0, ?, ?)').run(sectionId, notebookId, 'Getting Started', created, created);
      this.db.prepare(`INSERT INTO pages(id, section_id, title, content_html, content_markdown, position, is_favorite, is_deleted, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`).run(pageId, sectionId, 'Welcome to Noteleaf', html, markdown, created, created, created);
    })();
  }

  navigation(): NavigationData {
    const notebooks = (this.db.prepare('SELECT * FROM notebooks ORDER BY position, name').all() as Row[]).map((n): NotebookTree => ({
      id: String(n.id), name: String(n.name), position: Number(n.position),
      sections: (this.db.prepare('SELECT * FROM sections WHERE notebook_id = ? ORDER BY position, name').all(n.id) as Row[]).map((s): SectionTree => ({
        id: String(s.id), notebookId: String(s.notebook_id), name: String(s.name), position: Number(s.position),
        pages: (this.db.prepare('SELECT * FROM pages WHERE section_id = ? AND is_deleted = 0 AND sidebar_visible = 1 ORDER BY position, title').all(s.id) as Row[]).map((row) => this.revealSummary(row)),
      })),
    }));
    const favorites = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 0 AND is_encrypted = 0 AND sidebar_visible = 1 AND is_favorite = 1 ORDER BY updated_at DESC LIMIT 20').all() as Row[]).map(summary);
    const recent = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 0 AND is_encrypted = 0 AND sidebar_visible = 1 AND last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT 10').all() as Row[]).map(summary);
    const trash = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 1 AND sidebar_visible = 1 ORDER BY updated_at DESC').all() as Row[]).map((row) => this.revealSummary(row));
    return { notebooks, favorites, recent, trash };
  }

  mcpNotebooks(): McpNotebookSummary[] {
    return (this.db.prepare(`SELECT n.id, n.name, n.position, n.updated_at,
      COUNT(DISTINCT s.id) AS section_count,
      COUNT(DISTINCT CASE WHEN p.is_deleted = 0 AND p.is_encrypted = 0 THEN p.id END) AS page_count
      FROM notebooks n
      LEFT JOIN sections s ON s.notebook_id = n.id
      LEFT JOIN pages p ON p.section_id = s.id
      GROUP BY n.id
      ORDER BY n.position, n.name`).all() as Row[]).map((row) => ({
      id: String(row.id), name: String(row.name), position: Number(row.position),
      sectionCount: Number(row.section_count), pageCount: Number(row.page_count), updatedAt: String(row.updated_at),
    }));
  }

  mcpSections(notebookId?: string): McpSectionSummary[] {
    const sql = `SELECT s.id, s.notebook_id, n.name AS notebook, s.name, s.position, s.updated_at,
      COUNT(CASE WHEN p.is_deleted = 0 AND p.is_encrypted = 0 THEN p.id END) AS page_count
      FROM sections s JOIN notebooks n ON n.id = s.notebook_id
      LEFT JOIN pages p ON p.section_id = s.id
      ${notebookId ? 'WHERE s.notebook_id = ?' : ''}
      GROUP BY s.id
      ORDER BY n.position, s.position, s.name`;
    const rows = notebookId ? this.db.prepare(sql).all(notebookId) : this.db.prepare(sql).all();
    return (rows as Row[]).map((row) => ({
      id: String(row.id), notebookId: String(row.notebook_id), notebook: String(row.notebook),
      name: String(row.name), position: Number(row.position), pageCount: Number(row.page_count), updatedAt: String(row.updated_at),
    }));
  }

  mcpPages(sectionId: string, includeChildPages = true, limit = 100, offset = 0): McpPageSummary[] {
    const rows = this.db.prepare(`SELECT p.*, s.notebook_id, s.name AS section, n.name AS notebook
      FROM pages p JOIN sections s ON s.id = p.section_id JOIN notebooks n ON n.id = s.notebook_id
      WHERE p.section_id = ? AND p.is_deleted = 0 AND p.is_encrypted = 0 ${includeChildPages ? '' : 'AND p.sidebar_visible = 1'}
      ORDER BY p.position, p.title LIMIT ? OFFSET ?`).all(sectionId, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0)) as Row[];
    return rows.map((row) => ({
      ...summary(row), notebookId: String(row.notebook_id), notebook: String(row.notebook), section: String(row.section),
    }));
  }

  mcpPageLocation(id: string): McpPageSummary | undefined {
    const row = this.db.prepare(`SELECT p.*, s.notebook_id, s.name AS section, n.name AS notebook
      FROM pages p JOIN sections s ON s.id = p.section_id JOIN notebooks n ON n.id = s.notebook_id
      WHERE p.id = ? AND p.is_encrypted = 0`).get(id) as Row | undefined;
    return row ? { ...summary(row), notebookId: String(row.notebook_id), notebook: String(row.notebook), section: String(row.section) } : undefined;
  }

  createNotebook(name = 'New notebook'): NotebookTree {
    const id = randomUUID(); const timestamp = now();
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM notebooks').get() as { p: number }).p;
    this.db.prepare('INSERT INTO notebooks VALUES (?, ?, ?, ?, ?)').run(id, name, pos, timestamp, timestamp);
    return { id, name, position: pos, sections: [] };
  }
  renameNotebook(id: string, name: string): void { this.db.prepare('UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id); }
  removeNotebook(id: string): string[] {
    const pages = (this.db.prepare('SELECT p.id FROM pages p JOIN sections s ON s.id = p.section_id WHERE s.notebook_id = ?').all(id) as Array<{ id: string }>).map((row) => row.id);
    this.db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
    return pages;
  }
  moveNotebook(id: string, position: number): void {
    this.db.transaction(() => {
      const ids = (this.db.prepare('SELECT id FROM notebooks WHERE id <> ? ORDER BY position, name').all(id) as Array<{ id: string }>).map((row) => row.id);
      ids.splice(Math.min(position, ids.length), 0, id);
      const update = this.db.prepare('UPDATE notebooks SET position = ?, updated_at = ? WHERE id = ?');
      const timestamp = now();
      ids.forEach((notebookId, index) => update.run(index, timestamp, notebookId));
    })();
  }

  createSection(notebookId: string, name = 'New section'): SectionTree {
    const id = randomUUID(); const timestamp = now();
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sections WHERE notebook_id = ?').get(notebookId) as { p: number }).p;
    this.db.prepare('INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?)').run(id, notebookId, name, pos, timestamp, timestamp);
    return { id, notebookId, name, position: pos, pages: [] };
  }
  renameSection(id: string, name: string): void { this.db.prepare('UPDATE sections SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id); }
  removeSection(id: string): string[] {
    const pages = (this.db.prepare('SELECT id FROM pages WHERE section_id = ?').all(id) as Array<{ id: string }>).map((row) => row.id);
    this.db.prepare('DELETE FROM sections WHERE id = ?').run(id);
    return pages;
  }
  moveSection(id: string, notebookId: string, position: number): void {
    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT notebook_id FROM sections WHERE id = ?').get(id) as { notebook_id: string } | undefined;
      if (!existing) throw new Error('Section not found');
      const sourceNotebookId = existing.notebook_id;
      this.db.prepare('UPDATE sections SET notebook_id = ?, updated_at = ? WHERE id = ?').run(notebookId, now(), id);
      const resequence = (parentId: string, movedId?: string, targetPosition?: number) => {
        const ids = (this.db.prepare('SELECT id FROM sections WHERE notebook_id = ? AND id <> ? ORDER BY position, name').all(parentId, movedId || '') as Array<{ id: string }>).map((row) => row.id);
        if (movedId !== undefined && targetPosition !== undefined) ids.splice(Math.min(targetPosition, ids.length), 0, movedId);
        const update = this.db.prepare('UPDATE sections SET position = ? WHERE id = ?');
        ids.forEach((sectionId, index) => update.run(index, sectionId));
      };
      if (sourceNotebookId !== notebookId) resequence(sourceNotebookId);
      resequence(notebookId, id, position);
    })();
  }

  createPage(sectionId: string, title = 'Untitled', options: { sidebarVisible?: boolean; parentPageId?: string } = {}): Page {
    const id = randomUUID(); const timestamp = now();
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pages WHERE section_id = ?').get(sectionId) as { p: number }).p;
    const parent = options.parentPageId
      ? this.db.prepare('SELECT section_id, is_encrypted FROM pages WHERE id = ? AND is_deleted = 0').get(options.parentPageId) as { section_id: string; is_encrypted: number } | undefined
      : undefined;
    if (options.parentPageId && !parent) throw new Error('Parent page not found');
    if (parent && String(parent.section_id) !== sectionId) throw new Error('Child pages must stay in the same section as their parent');
    if (parent?.is_encrypted) {
      const payload = encryptVaultPayload(JSON.stringify({ title, contentHtml: '<p></p>', contentMarkdown: '' }), this.requireVaultKey(), id);
      this.db.prepare(`INSERT INTO pages(id, section_id, title, position, created_at, updated_at, last_opened_at, sidebar_visible, parent_page_id, is_encrypted, encrypted_payload)
        VALUES (?, ?, 'Locked page', ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, sectionId, pos, timestamp, timestamp, timestamp, options.sidebarVisible === false ? 0 : 1, options.parentPageId, payload);
    } else {
      this.db.prepare(`INSERT INTO pages(id, section_id, title, position, created_at, updated_at, last_opened_at, sidebar_visible, parent_page_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sectionId, title, pos, timestamp, timestamp, timestamp, options.sidebarVisible === false ? 0 : 1, options.parentPageId || null);
    }
    return this.getPage(id);
  }
  linkExternalPage(sectionId: string, title: string, externalPath: string): Page {
    const existing = this.db.prepare('SELECT id, section_id FROM pages WHERE external_path = ? COLLATE NOCASE LIMIT 1').get(externalPath) as { id: string; section_id: string } | undefined;
    if (existing) {
      const position = existing.section_id === sectionId
        ? undefined
        : (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pages WHERE section_id = ?').get(sectionId) as { p: number }).p;
      this.db.prepare(`UPDATE pages
        SET section_id = ?, title = ?, position = COALESCE(?, position), sidebar_visible = 1,
            is_deleted = 0, updated_at = ?, last_opened_at = ?
        WHERE id = ?`).run(sectionId, title, position ?? null, now(), now(), existing.id);
      return this.getPage(existing.id);
    }
    const id = randomUUID(); const timestamp = now();
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pages WHERE section_id = ?').get(sectionId) as { p: number }).p;
    this.db.prepare(`INSERT INTO pages(
      id, section_id, title, content_html, content_markdown, position, is_favorite, is_deleted,
      created_at, updated_at, last_opened_at, sidebar_visible, parent_page_id, external_path
    ) VALUES (?, ?, ?, '<p></p>', '', ?, 0, 0, ?, ?, ?, 1, NULL, ?)`)
      .run(id, sectionId, title, position, timestamp, timestamp, timestamp, externalPath);
    return this.getPage(id);
  }
  getPage(id: string): Page {
    this.db.prepare('UPDATE pages SET last_opened_at = ? WHERE id = ?').run(now(), id);
    return this.readPage(id);
  }
  readPage(id: string): Page {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Page not found');
    return this.revealPage(row);
  }
  readPageForMcp(id: string): Page {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ? AND is_encrypted = 0').get(id) as Row | undefined;
    if (!row) throw new Error('Page not found');
    return page(row);
  }
  savePage(id: string, input: { title: string; contentHtml: string; contentMarkdown: string }): Page {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Page not found');
    if (row.is_encrypted) {
      const encrypted = encryptVaultPayload(JSON.stringify(input), this.requireVaultKey(), id);
      this.db.prepare(`UPDATE pages SET title = 'Locked page', content_html = '<p></p>', content_markdown = '', encrypted_payload = ?, updated_at = ? WHERE id = ?`).run(encrypted, now(), id);
    } else {
      this.db.prepare('UPDATE pages SET title = ?, content_html = ?, content_markdown = ?, updated_at = ? WHERE id = ?').run(input.title, input.contentHtml, input.contentMarkdown, now(), id);
    }
    return this.readPage(id);
  }
  renamePage(id: string, title: string): void {
    const current = this.readPage(id);
    this.savePage(id, { title, contentHtml: current.contentHtml, contentMarkdown: current.contentMarkdown });
  }
  trashPage(id: string): void { this.db.prepare('UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), id); }
  restorePage(id: string): void { this.db.prepare('UPDATE pages SET is_deleted = 0, updated_at = ? WHERE id = ?').run(now(), id); }
  removePage(id: string): void { this.db.prepare('DELETE FROM pages WHERE id = ?').run(id); }
  emptyTrash(): string[] {
    return this.db.transaction(() => {
      const pageIds = (this.db.prepare('SELECT id FROM pages WHERE is_deleted = 1').all() as Array<{ id: string }>).map((row) => row.id);
      this.db.prepare('DELETE FROM pages WHERE is_deleted = 1').run();
      return pageIds;
    })();
  }
  toggleFavorite(id: string): void {
    if ((this.db.prepare('SELECT is_encrypted FROM pages WHERE id = ?').get(id) as { is_encrypted?: number } | undefined)?.is_encrypted) throw new Error('Private pages are not shown in Favorites');
    this.db.prepare('UPDATE pages SET is_favorite = CASE is_favorite WHEN 0 THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?').run(now(), id);
  }
  movePage(id: string, sectionId: string, position: number): void {
    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT section_id FROM pages WHERE id = ?').get(id) as { section_id: string } | undefined;
      if (!existing) throw new Error('Page not found');
      const sourceSectionId = existing.section_id;
      this.db.prepare('UPDATE pages SET section_id = ?, position = ?, updated_at = ? WHERE id = ?').run(sectionId, position, now(), id);
      const resequence = (parentId: string, movedId?: string, targetPosition?: number) => {
        const ids = (this.db.prepare(`SELECT id FROM pages WHERE section_id = ? AND id <> ? AND is_deleted = 0 AND sidebar_visible = 1 ORDER BY position, title`).all(parentId, movedId || '') as Array<{ id: string }>).map((row) => row.id);
        if (movedId !== undefined && targetPosition !== undefined) ids.splice(Math.min(targetPosition, ids.length), 0, movedId);
        const update = this.db.prepare('UPDATE pages SET position = ? WHERE id = ?');
        ids.forEach((pageId, index) => update.run(index, pageId));
      };
      if (sourceSectionId !== sectionId) resequence(sourceSectionId);
      resequence(sectionId, id, position);
    })();
  }

  tasksForDate(taskDate: string): TaskItem[] {
    return (this.db.prepare(`SELECT * FROM tasks WHERE task_date = ?
      ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, position, created_at`).all(taskDate) as Row[]).map(task);
  }
  createTask(title: string, taskDate: string): TaskItem {
    const id = randomUUID(); const timestamp = now();
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE task_date = ?').get(taskDate) as { position: number }).position;
    this.db.prepare(`INSERT INTO tasks(id, title, task_date, status, position, created_at, updated_at)
      VALUES (?, ?, ?, 'todo', ?, ?, ?)`).run(id, title, taskDate, position, timestamp, timestamp);
    return task(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row);
  }
  updateTask(id: string, patch: { title?: string; taskDate?: string; status?: TaskStatus }): TaskItem {
    const existing = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    if (!existing) throw new Error('Task not found');
    const title = patch.title ?? String(existing.title);
    const taskDate = patch.taskDate ?? String(existing.task_date);
    const status = patch.status ?? String(existing.status) as TaskStatus;
    const completedAt = status === 'done' ? (existing.completed_at || now()) : null;
    this.db.prepare('UPDATE tasks SET title = ?, task_date = ?, status = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(title, taskDate, status, now(), completedAt, id);
    return task(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row);
  }
  removeTask(id: string): void { this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id); }

  fullSearch(query: string): SearchResult[] {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8).map((t) => `"${t.replaceAll('"', '""')}"*`).join(' AND ');
    if (!terms) return [];
    const rows = this.db.prepare(`SELECT p.id, p.title, n.name notebook, s.name section,
      snippet(pages_fts, 2, '<mark>', '</mark>', ' … ', 18) excerpt, p.updated_at
      FROM pages_fts JOIN pages p ON p.id = pages_fts.page_id
      JOIN sections s ON s.id = p.section_id JOIN notebooks n ON n.id = s.notebook_id
      WHERE pages_fts MATCH ? AND p.is_deleted = 0 AND p.is_encrypted = 0 ORDER BY rank LIMIT 50`).all(terms) as Row[];
    const visible = rows.map((r) => ({ id: String(r.id), title: String(r.title), notebook: String(r.notebook), section: String(r.section), excerpt: String(r.excerpt), updatedAt: String(r.updated_at) }));
    if (!this.vaultKey) return visible;
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const privateRows = this.db.prepare(`SELECT p.*, n.name AS notebook, s.name AS section
      FROM pages p JOIN sections s ON s.id = p.section_id JOIN notebooks n ON n.id = s.notebook_id
      WHERE p.is_deleted = 0 AND p.is_encrypted = 1 ORDER BY p.updated_at DESC`).all() as Row[];
    const privateResults = privateRows.flatMap((row): SearchResult[] => {
      const decrypted = this.revealPage(row);
      const haystack = `${decrypted.title}\n${decrypted.contentMarkdown}`.toLocaleLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return [];
      const compact = decrypted.contentMarkdown.replace(/\s+/g, ' ').trim();
      return [{ id: decrypted.id, title: decrypted.title, notebook: String(row.notebook), section: String(row.section), excerpt: escapeHtml(compact.slice(0, 180)), updatedAt: decrypted.updatedAt }];
    });
    return [...privateResults, ...visible].slice(0, 50);
  }
  fullSearchForMcp(query: string): SearchResult[] {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8).map((t) => `"${t.replaceAll('"', '""')}"*`).join(' AND ');
    if (!terms) return [];
    const rows = this.db.prepare(`SELECT p.id, p.title, n.name notebook, s.name section,
      snippet(pages_fts, 2, '<mark>', '</mark>', ' … ', 18) excerpt, p.updated_at
      FROM pages_fts JOIN pages p ON p.id = pages_fts.page_id
      JOIN sections s ON s.id = p.section_id JOIN notebooks n ON n.id = s.notebook_id
      WHERE pages_fts MATCH ? AND p.is_deleted = 0 AND p.is_encrypted = 0 ORDER BY rank LIMIT 50`).all(terms) as Row[];
    return rows.map((r) => ({ id: String(r.id), title: String(r.title), notebook: String(r.notebook), section: String(r.section), excerpt: String(r.excerpt), updatedAt: String(r.updated_at) }));
  }
  quickSearch(query: string): PageSummary[] {
    const q = `%${query.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const visible = (this.db.prepare(`SELECT * FROM pages WHERE is_deleted = 0 AND is_encrypted = 0 AND title LIKE ? ESCAPE '\\' ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, last_opened_at DESC LIMIT 20`).all(q, `${query.trim()}%`) as Row[]).map(summary);
    if (!this.vaultKey) return visible;
    const needle = query.trim().toLocaleLowerCase();
    const privateMatches = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 0 AND is_encrypted = 1 ORDER BY last_opened_at DESC').all() as Row[])
      .map((row) => this.revealSummary(row)).filter((item) => item.title.toLocaleLowerCase().includes(needle));
    return [...privateMatches, ...visible].slice(0, 20);
  }

  rememberFile(path: string, filename: string, viewMode: MarkdownViewMode): void {
    this.db.prepare(`INSERT INTO recent_files(path, filename, last_opened_at, view_mode) VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET filename=excluded.filename, last_opened_at=excluded.last_opened_at, view_mode=excluded.view_mode`).run(path, filename, now(), viewMode);
  }
  recentFiles(): Array<{ path: string; filename: string; lastOpenedAt: string; viewMode: MarkdownViewMode }> {
    return (this.db.prepare('SELECT * FROM recent_files ORDER BY last_opened_at DESC LIMIT 20').all() as Row[]).map((r) => ({ path: String(r.path), filename: String(r.filename), lastOpenedAt: String(r.last_opened_at), viewMode: String(r.view_mode) as MarkdownViewMode }));
  }
  saveDraft(path: string, content: string): void { this.db.prepare(`INSERT INTO external_drafts VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at`).run(path, content, now()); }
  getDraft(path: string): string | undefined { return (this.db.prepare('SELECT content FROM external_drafts WHERE path = ?').get(path) as { content: string } | undefined)?.content; }
  clearDraft(path: string): void { this.db.prepare('DELETE FROM external_drafts WHERE path = ?').run(path); }

  getSettings(): AppSettings {
    const values = Object.fromEntries((this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>).map((r) => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...values, backupDestination: 'local' };
  }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const insert = this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    this.db.transaction(() => { for (const [key, value] of Object.entries(patch)) insert.run(key, JSON.stringify(value)); })();
    return this.getSettings();
  }
}
