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
    const markdown = `## Questions\n\n2. How are table IDs selected?\n3. How is the control-table row read?\n4. How is Bulk versus Incremental selected?\n5. Which main function is called?\n6. What happens after failure?\n\nThe simplified logic is:\n\n\`\`\`text\nStart Glue\n   -> get table IDs\n   -> loop through IDs\n   -> read ctrl.ingestion_table\n   -> determine mode\n   -> create audit\n   -> run Bulk or Incremental\n   -> record failure and continue\n   -> commit Glue job\n\`\`\`\n\nIgnore the detailed SQL at this stage.`;
    const html = `<h2>Questions</h2><ol start="2"><li><p>How are table IDs selected?</p></li><li><p>How is the control-table row read?</p></li><li><p>How is Bulk versus Incremental selected?</p></li><li><p>Which main function is called?</p></li><li><p>What happens after failure?</p></li></ol><p>The simplified logic is:</p><pre><code>Start Glue\n   -&gt; get table IDs\n   -&gt; loop through IDs\n   -&gt; read ctrl.ingestion_table\n   -&gt; determine mode\n   -&gt; create audit\n   -&gt; run Bulk or Incremental\n   -&gt; record failure and continue\n   -&gt; commit Glue job</code></pre><p>Ignore the detailed SQL at this stage.</p>`;
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO notebooks VALUES (?, ?, 0, ?, ?)').run(notebookId, 'Work', created, created);
      this.db.prepare('INSERT INTO sections VALUES (?, ?, ?, 0, ?, ?)').run(sectionId, notebookId, 'AWS', created, created);
      this.db.prepare(`INSERT INTO pages(id, section_id, title, content_html, content_markdown, position, is_favorite, is_deleted, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`).run(pageId, sectionId, 'AWS Ingestion Control Table', html, markdown, created, created, created);
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
      this.db.prepare('UPDATE pages SET position = position + 1 WHERE section_id = ? AND position >= ? AND is_deleted = 0').run(sectionId, position);
      this.db.prepare('UPDATE pages SET section_id = ?, position = ?, updated_at = ? WHERE id = ?').run(sectionId, position, now(), id);
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
