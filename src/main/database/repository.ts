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

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  editorFontSize: 16,
  codeFontSize: 14,
  lineWidth: 880,
  spellcheck: true,
  defaultMarkdownMode: 'preview',
  reopenPreviousSession: true,
  backupFolder: '',
  backupFrequency: 'hourly',
  backupRetention: 10,
  lastBackupAt: null,
  lastBackupError: null,
};

type Row = Record<string, unknown>;

function now(): string { return new Date().toISOString(); }
function summary(row: Row): PageSummary {
  return {
    id: String(row.id), sectionId: String(row.section_id), title: String(row.title),
    position: Number(row.position), isFavorite: Boolean(row.is_favorite),
    isDeleted: Boolean(row.is_deleted), updatedAt: String(row.updated_at),
    lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
    isSidebarVisible: Boolean(row.sidebar_visible),
    parentPageId: row.parent_page_id ? String(row.parent_page_id) : null,
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

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    runMigrations(this.db);
    this.seed();
  }

  close(): void { if (this.db.open) this.db.close(); }

  async backupTo(destination: string): Promise<void> {
    await this.db.backup(destination);
  }

  private seed(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM notebooks').get() as { count: number };
    if (count.count) return;
    const created = now();
    const notebookId = randomUUID();
    const sectionId = randomUUID();
    const pageId = randomUUID();
    const markdown = `A calm, local-first workspace for notes, Markdown documents, and daily tasks. Your writing stays on this computer and saves automatically.

> **Start here:** Rename this page, edit anything below, or create a new notebook from the **+** beside Notes.

## What you can do

| Feature | How it helps |
| --- | --- |
| Notebooks and sections | Keep projects and topics in a clear hierarchy. |
| Rich notes | Write headings, lists, tables, quotes, code blocks, links, and resizable images. |
| Linked pages | Type **/page**, name the page, and jump between related ideas without adding sidebar clutter. |
| Markdown workspace | Open individual Markdown files or browse a complete folder tree inside Notes. |
| Daily Tasks | Press **Ctrl+T** to plan work as To do, In progress, and Done. |
| Safe backups | Choose a OneDrive, Google Drive, or local folder and Notes backs up automatically every hour. |

## Your first five minutes

- ☐ Rename the **Welcome** notebook for your first project.
- ☐ Create a section and add a note with its **+** button.
- ☐ Type **/** in a note to explore blocks and linked pages.
- ☐ Press **Ctrl+T** and add today's first task.
- ☐ Select **Backup** in the top toolbar and choose a protected folder.

## Essential shortcuts

| Action | Shortcut |
| --- | --- |
| Search all notes | **Ctrl+F** |
| Toggle Tasks and notes | **Ctrl+T** |
| Move through open tabs | **Ctrl+Tab** |
| Focus mode | **Ctrl+Shift+F** |
| Open Settings | **Ctrl+,** |
| Save an external Markdown file | **Ctrl+S** |

## Helpful details

1. Drag the small grips in the sidebar to reorder notebooks, sections, and pages.
2. Paste an image into a note, select it, then drag an edge to resize it.
3. Relative links in Markdown files open the linked file directly inside Notes.
4. Deleted pages remain in Trash until you remove them permanently.
5. Backups include your notes, linked pages, attachments, settings, drafts, and Tasks.

## Local-first by design

Notes does not require an account or send your content to a server. For protection from computer failure, configure the built-in backup to a synced folder. You stay in control of both the working library and every backup file.

You are ready—turn this guide into your own first note, or keep it nearby as a reference.`;
    const html = `<p><strong>A calm, local-first workspace for notes, Markdown documents, and daily tasks.</strong> Your writing stays on this computer and saves automatically.</p>
<blockquote><p><strong>Start here:</strong> Rename this page, edit anything below, or create a new notebook from the <strong>+</strong> beside Notes.</p></blockquote>
<h2>What you can do</h2>
<table><thead><tr><th><p>Feature</p></th><th><p>How it helps</p></th></tr></thead><tbody>
<tr><td><p><strong>Notebooks and sections</strong></p></td><td><p>Keep projects and topics in a clear hierarchy.</p></td></tr>
<tr><td><p><strong>Rich notes</strong></p></td><td><p>Write headings, lists, tables, quotes, code blocks, links, and resizable images.</p></td></tr>
<tr><td><p><strong>Linked pages</strong></p></td><td><p>Type <strong>/page</strong>, name the page, and jump between related ideas without adding sidebar clutter.</p></td></tr>
<tr><td><p><strong>Markdown workspace</strong></p></td><td><p>Open individual Markdown files or browse a complete folder tree inside Notes.</p></td></tr>
<tr><td><p><strong>Daily Tasks</strong></p></td><td><p>Press <strong>Ctrl+T</strong> to plan work as To do, In progress, and Done.</p></td></tr>
<tr><td><p><strong>Safe backups</strong></p></td><td><p>Choose a OneDrive, Google Drive, or local folder and Notes backs up automatically every hour.</p></td></tr>
</tbody></table>
<h2>Your first five minutes</h2>
<ul><li><p>☐ Rename the <strong>Welcome</strong> notebook for your first project.</p></li><li><p>☐ Create a section and add a note with its <strong>+</strong> button.</p></li><li><p>☐ Type <strong>/</strong> in a note to explore blocks and linked pages.</p></li><li><p>☐ Press <strong>Ctrl+T</strong> and add today's first task.</p></li><li><p>☐ Select <strong>Backup</strong> in the top toolbar and choose a protected folder.</p></li></ul>
<h2>Essential shortcuts</h2>
<table><thead><tr><th><p>Action</p></th><th><p>Shortcut</p></th></tr></thead><tbody><tr><td><p>Search all notes</p></td><td><p><strong>Ctrl+F</strong></p></td></tr><tr><td><p>Toggle Tasks and notes</p></td><td><p><strong>Ctrl+T</strong></p></td></tr><tr><td><p>Move through open tabs</p></td><td><p><strong>Ctrl+Tab</strong></p></td></tr><tr><td><p>Focus mode</p></td><td><p><strong>Ctrl+Shift+F</strong></p></td></tr><tr><td><p>Open Settings</p></td><td><p><strong>Ctrl+,</strong></p></td></tr><tr><td><p>Save an external Markdown file</p></td><td><p><strong>Ctrl+S</strong></p></td></tr></tbody></table>
<h2>Helpful details</h2>
<ol><li><p>Drag the small grips in the sidebar to reorder notebooks, sections, and pages.</p></li><li><p>Paste an image into a note, select it, then drag an edge to resize it.</p></li><li><p>Relative links in Markdown files open the linked file directly inside Notes.</p></li><li><p>Deleted pages remain in Trash until you remove them permanently.</p></li><li><p>Backups include your notes, linked pages, attachments, settings, drafts, and Tasks.</p></li></ol>
<h2>Local-first by design</h2>
<p>Notes does not require an account or send your content to a server. For protection from computer failure, configure the built-in backup to a synced folder. You stay in control of both the working library and every backup file.</p>
<p><strong>You are ready—turn this guide into your own first note, or keep it nearby as a reference.</strong></p>`;
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO notebooks VALUES (?, ?, 0, ?, ?)').run(notebookId, 'Welcome', created, created);
      this.db.prepare('INSERT INTO sections VALUES (?, ?, ?, 0, ?, ?)').run(sectionId, notebookId, 'Getting Started', created, created);
      this.db.prepare(`INSERT INTO pages(id, section_id, title, content_html, content_markdown, position, is_favorite, is_deleted, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`).run(pageId, sectionId, 'Welcome to Notes', html, markdown, created, created, created);
    })();
  }

  navigation(): NavigationData {
    const notebooks = (this.db.prepare('SELECT * FROM notebooks ORDER BY position, name').all() as Row[]).map((n): NotebookTree => ({
      id: String(n.id), name: String(n.name), position: Number(n.position),
      sections: (this.db.prepare('SELECT * FROM sections WHERE notebook_id = ? ORDER BY position, name').all(n.id) as Row[]).map((s): SectionTree => ({
        id: String(s.id), notebookId: String(s.notebook_id), name: String(s.name), position: Number(s.position),
        pages: (this.db.prepare('SELECT * FROM pages WHERE section_id = ? AND is_deleted = 0 AND sidebar_visible = 1 ORDER BY position, title').all(s.id) as Row[]).map(summary),
      })),
    }));
    const favorites = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 0 AND sidebar_visible = 1 AND is_favorite = 1 ORDER BY updated_at DESC LIMIT 20').all() as Row[]).map(summary);
    const recent = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 0 AND sidebar_visible = 1 AND last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT 10').all() as Row[]).map(summary);
    const trash = (this.db.prepare('SELECT * FROM pages WHERE is_deleted = 1 AND sidebar_visible = 1 ORDER BY updated_at DESC').all() as Row[]).map(summary);
    return { notebooks, favorites, recent, trash };
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
    this.db.prepare(`INSERT INTO pages(id, section_id, title, position, created_at, updated_at, last_opened_at, sidebar_visible, parent_page_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sectionId, title, pos, timestamp, timestamp, timestamp, options.sidebarVisible === false ? 0 : 1, options.parentPageId || null);
    return this.getPage(id);
  }
  getPage(id: string): Page {
    this.db.prepare('UPDATE pages SET last_opened_at = ? WHERE id = ?').run(now(), id);
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Page not found');
    return page(row);
  }
  savePage(id: string, input: { title: string; contentHtml: string; contentMarkdown: string }): Page {
    this.db.prepare('UPDATE pages SET title = ?, content_html = ?, content_markdown = ?, updated_at = ? WHERE id = ?').run(input.title, input.contentHtml, input.contentMarkdown, now(), id);
    return this.getPage(id);
  }
  renamePage(id: string, title: string): void { this.db.prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id); }
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
  toggleFavorite(id: string): void { this.db.prepare('UPDATE pages SET is_favorite = CASE is_favorite WHEN 0 THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?').run(now(), id); }
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
      WHERE pages_fts MATCH ? AND p.is_deleted = 0 ORDER BY rank LIMIT 50`).all(terms) as Row[];
    return rows.map((r) => ({ id: String(r.id), title: String(r.title), notebook: String(r.notebook), section: String(r.section), excerpt: String(r.excerpt), updatedAt: String(r.updated_at) }));
  }
  quickSearch(query: string): PageSummary[] {
    const q = `%${query.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (this.db.prepare(`SELECT * FROM pages WHERE is_deleted = 0 AND title LIKE ? ESCAPE '\\' ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, last_opened_at DESC LIMIT 20`).all(q, `${query.trim()}%`) as Row[]).map(summary);
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
    return { ...DEFAULT_SETTINGS, ...values };
  }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const insert = this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    this.db.transaction(() => { for (const [key, value] of Object.entries(patch)) insert.run(key, JSON.stringify(value)); })();
    return this.getSettings();
  }
}
