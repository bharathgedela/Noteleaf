import { ipcMain, shell } from 'electron';
import type { AppSettings, BackupFrequency, MarkdownViewMode, TaskStatus } from '../shared/types.js';
import type { NotesRepository } from './database/repository.js';
import type { FileService } from './files.js';
import type { BackupService } from './backup/service.js';
import type { McpHttpService } from './mcp/service.js';

const CHANNELS = [
  'navigation:list', 'notebooks:create', 'notebooks:rename', 'notebooks:remove', 'notebooks:move',
  'sections:create', 'sections:rename', 'sections:remove', 'sections:move', 'pages:create', 'pages:get',
  'pages:save', 'pages:rename', 'pages:trash', 'pages:restore', 'pages:remove', 'pages:empty-trash',
  'pages:favorite', 'pages:move', 'search:full', 'search:quick', 'files:open',
  'tasks:list', 'tasks:create', 'tasks:update', 'tasks:remove',
  'files:open-linked', 'files:open-folder', 'files:save', 'files:save-as', 'files:draft', 'files:clear-draft', 'files:import', 'files:link', 'files:export', 'files:recent',
  'files:attachment', 'settings:get', 'settings:update', 'settings:open-data', 'system:open-external',
  'backup:status', 'backup:choose-folder', 'backup:create', 'backup:set-schedule', 'backup:restore', 'backup:open-folder',
  'mcp:status', 'mcp:regenerate-access-link',
] as const;

function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const result = value.trim();
  if (!result || result.length > max) throw new Error(`${label} is invalid`);
  return result;
}
function id(value: unknown): string { return text(value, 'ID', 100); }
function source(value: unknown, max = 25 * 1024 * 1024): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Content is invalid');
  return value;
}
function viewMode(value: unknown): MarkdownViewMode {
  if (value !== 'preview' && value !== 'edit' && value !== 'split') throw new Error('Invalid view mode');
  return value;
}
function taskDate(value: unknown): string {
  const date = text(value, 'Task date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) throw new Error('Invalid task date');
  return date;
}
function taskStatus(value: unknown): TaskStatus {
  if (value !== 'todo' && value !== 'in_progress' && value !== 'done') throw new Error('Invalid task status');
  return value;
}

export function registerIpc(repository: NotesRepository, files: FileService, backups: BackupService, mcp: McpHttpService): () => void {
  ipcMain.handle('navigation:list', () => repository.navigation());
  ipcMain.handle('notebooks:create', (_event, name?: string) => repository.createNotebook(name ? text(name, 'Name') : undefined));
  ipcMain.handle('notebooks:rename', (_event, rawId, name) => repository.renameNotebook(id(rawId), text(name, 'Name')));
  ipcMain.handle('notebooks:remove', (_event, rawId) => repository.removeNotebook(id(rawId)));
  ipcMain.handle('notebooks:move', (_event, rawId, position) => repository.moveNotebook(id(rawId), Math.max(0, Number(position) || 0)));
  ipcMain.handle('sections:create', (_event, notebookId, name?: string) => repository.createSection(id(notebookId), name ? text(name, 'Name') : undefined));
  ipcMain.handle('sections:rename', (_event, rawId, name) => repository.renameSection(id(rawId), text(name, 'Name')));
  ipcMain.handle('sections:remove', (_event, rawId) => repository.removeSection(id(rawId)));
  ipcMain.handle('sections:move', (_event, rawId, notebookId, position) => repository.moveSection(id(rawId), id(notebookId), Math.max(0, Number(position) || 0)));
  ipcMain.handle('pages:create', (_event, sectionId, title?: string, options?: { sidebarVisible?: unknown; parentPageId?: unknown }) => repository.createPage(id(sectionId), title ? text(title, 'Title') : undefined, {
    sidebarVisible: options?.sidebarVisible !== false,
    parentPageId: options?.parentPageId ? id(options.parentPageId) : undefined,
  }));
  ipcMain.handle('pages:get', (_event, rawId) => repository.getPage(id(rawId)));
  ipcMain.handle('pages:save', (_event, rawId, input) => repository.savePage(id(rawId), {
    title: text(input?.title, 'Title'), contentHtml: source(input?.contentHtml), contentMarkdown: source(input?.contentMarkdown),
  }));
  ipcMain.handle('pages:rename', (_event, rawId, title) => repository.renamePage(id(rawId), text(title, 'Title')));
  ipcMain.handle('pages:trash', (_event, rawId) => repository.trashPage(id(rawId)));
  ipcMain.handle('pages:restore', (_event, rawId) => repository.restorePage(id(rawId)));
  ipcMain.handle('pages:remove', (_event, rawId) => repository.removePage(id(rawId)));
  ipcMain.handle('pages:empty-trash', () => repository.emptyTrash());
  ipcMain.handle('pages:favorite', (_event, rawId) => repository.toggleFavorite(id(rawId)));
  ipcMain.handle('pages:move', (_event, rawId, sectionId, position) => repository.movePage(id(rawId), id(sectionId), Math.max(0, Number(position) || 0)));
  ipcMain.handle('search:full', (_event, query) => repository.fullSearch(typeof query === 'string' ? query.slice(0, 300) : ''));
  ipcMain.handle('search:quick', (_event, query) => repository.quickSearch(typeof query === 'string' ? query.slice(0, 300) : ''));
  ipcMain.handle('tasks:list', (_event, date) => repository.tasksForDate(taskDate(date)));
  ipcMain.handle('tasks:create', (_event, title, date) => repository.createTask(text(title, 'Task title'), taskDate(date)));
  ipcMain.handle('tasks:update', (_event, rawId, patch) => repository.updateTask(id(rawId), {
    title: patch?.title === undefined ? undefined : text(patch.title, 'Task title'),
    taskDate: patch?.taskDate === undefined ? undefined : taskDate(patch.taskDate),
    status: patch?.status === undefined ? undefined : taskStatus(patch.status),
  }));
  ipcMain.handle('tasks:remove', (_event, rawId) => repository.removeTask(id(rawId)));
  ipcMain.handle('files:open', (_event, path?: string) => files.openMarkdown(path ? text(path, 'Path', 32767) : undefined));
  ipcMain.handle('files:open-linked', (_event, sourcePath, href) => files.openLinkedMarkdown(text(sourcePath, 'Source path', 32767), text(href, 'Link', 32767)));
  ipcMain.handle('files:open-folder', () => files.openMarkdownFolder());
  ipcMain.handle('files:save', (_event, path, content, mode) => files.saveMarkdown(text(path, 'Path', 32767), source(content), viewMode(mode)));
  ipcMain.handle('files:save-as', (_event, content, name?: string) => files.saveMarkdownAs(source(content), name ? text(name, 'Filename') : undefined));
  ipcMain.handle('files:draft', (_event, path, content) => repository.saveDraft(text(path, 'Path', 32767), source(content)));
  ipcMain.handle('files:clear-draft', (_event, path) => repository.clearDraft(text(path, 'Path', 32767)));
  ipcMain.handle('files:import', (_event, sectionId) => files.importMarkdown(id(sectionId)));
  ipcMain.handle('files:link', (_event, sectionId, path?: string) => files.linkMarkdown(id(sectionId), path ? text(path, 'Path', 32767) : undefined));
  ipcMain.handle('files:export', (_event, pageId) => files.exportPage(repository.getPage(id(pageId))));
  ipcMain.handle('files:recent', () => repository.recentFiles());
  ipcMain.handle('files:attachment', (_event, pageId, dataUrl) => files.saveAttachment(id(pageId), source(dataUrl)));
  ipcMain.handle('settings:get', () => repository.getSettings());
  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    const updated = repository.updateSettings(patch);
    await mcp.configure(updated);
    return repository.getSettings();
  });
  ipcMain.handle('settings:open-data', () => files.openDataFolder());
  ipcMain.handle('backup:status', () => backups.status());
  ipcMain.handle('backup:choose-folder', () => backups.chooseFolder());
  ipcMain.handle('backup:create', () => backups.create());
  ipcMain.handle('backup:set-schedule', (_event, frequency: BackupFrequency, retention: number) => backups.setSchedule(frequency, retention));
  ipcMain.handle('backup:restore', () => backups.restore());
  ipcMain.handle('backup:open-folder', () => backups.openFolder());
  ipcMain.handle('mcp:status', () => mcp.status());
  ipcMain.handle('mcp:regenerate-access-link', () => mcp.regenerateAccessLink());
  ipcMain.handle('system:open-external', async (_event, url) => {
    const target = new URL(text(url, 'URL', 4096));
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('Unsupported URL');
    await shell.openExternal(target.toString());
  });
  return () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); };
}
