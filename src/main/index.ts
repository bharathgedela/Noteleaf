import { app, BrowserWindow, Menu, protocol, net, dialog } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { NotesRepository } from './database/repository.js';
import { FileService } from './files.js';
import { registerIpc } from './ipc.js';
import { applyPendingRestore, BackupService } from './backup/service.js';

const APP_NAME = 'Notes';
const mainDirectory = fileURLToPath(new URL('.', import.meta.url));
let window: BrowserWindow | null = null;
let repository: NotesRepository | null = null;
let files: FileService | null = null;
let backups: BackupService | null = null;
let queuedPath: string | undefined;

function startupLog(message: string, error?: unknown): void {
  try {
    const detail = error instanceof Error ? `${error.stack || error.message}` : error ? String(error) : '';
    appendFileSync(join(app.getPath('userData'), 'startup.log'), `${new Date().toISOString()} ${message}${detail ? `\n${detail}` : ''}\n`, 'utf8');
  } catch { /* Startup logging must never prevent launch. */ }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'notes-asset', privileges: { secure: true, standard: true, supportFetchAPI: true } }]);
app.setName(APP_NAME);

function markdownArgument(args: string[]): string | undefined {
  return args.find((arg) => /\.(md|markdown|mdown|mkd)$/i.test(arg));
}

async function dispatchExternal(path: string): Promise<void> {
  if (!window || !files) { queuedPath = path; return; }
  try {
    const document = await files.openMarkdown(resolve(path));
    if (document) window.webContents.send('open-external-document', document);
  } catch (error) {
    console.error('Unable to open Markdown file', error);
  }
}

function sendCommand(command: string): void { window?.webContents.send('app-command', command); }

function createMenu(): void {
  const isMac = process.platform === 'darwin';
  const fileMenu: MenuItemConstructorOptions[] = [
    { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-note') },
    { label: 'Open Markdown File…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open-markdown') },
    { label: 'Open Markdown Folder…', click: () => sendCommand('open-markdown-folder') },
    { label: 'Import Markdown as Note…', click: () => sendCommand('import-markdown') },
    { type: 'separator' },
    { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
    { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save-as') },
    { type: 'separator' },
    { label: 'Backup & Recovery…', click: () => sendCommand('backup-settings') },
  ];
  if (!isMac) fileMenu.push({ type: 'separator' }, { role: 'quit' });

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: APP_NAME, submenu: [
      { role: 'about' as const },
      { type: 'separator' as const },
      { role: 'services' as const },
      { type: 'separator' as const },
      { role: 'hide' as const },
      { role: 'hideOthers' as const },
      { role: 'unhide' as const },
      { type: 'separator' as const },
      { role: 'quit' as const },
    ] }] : []),
    { label: 'File', submenu: fileMenu },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' }, { label: 'Quick Open', accelerator: 'CmdOrCtrl+P', click: () => sendCommand('quick-open') },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, ...(isMac ? [{ role: 'zoom' as const }] : []), { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1320, height: 850, minWidth: 900, minHeight: 600, show: true,
    backgroundColor: '#f8f8f7', title: APP_NAME,
    webPreferences: {
      preload: join(mainDirectory, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void import('electron').then(({ shell }) => shell.openExternal(url));
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const current = window?.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  startupLog('BrowserWindow created');
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(join(mainDirectory, '..', 'renderer', 'index.html'));
  startupLog('Renderer loaded');
  if (queuedPath) { const path = queuedPath; queuedPath = undefined; await dispatchExternal(path); }
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => {
    const path = markdownArgument(commandLine);
    if (path) void dispatchExternal(path);
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.on('open-file', (event, path) => { event.preventDefault(); void dispatchExternal(path); });
  app.whenReady().then(async () => {
    startupLog('Application ready');
    const dataDirectory = app.getPath('userData');
    mkdirSync(dataDirectory, { recursive: true });
    await applyPendingRestore(dataDirectory);
    repository = new NotesRepository(join(dataDirectory, 'notes.db'));
    startupLog('Database opened');
    files = new FileService(repository, dataDirectory);
    backups = new BackupService(repository, dataDirectory);
    registerIpc(repository, files, backups);
    backups.startScheduler();
    protocol.handle('notes-asset', (request) => {
      const parsed = new URL(request.url);
      const candidate = join(dataDirectory, 'attachments', parsed.hostname, ...parsed.pathname.split('/').filter(Boolean));
      const root = join(dataDirectory, 'attachments');
      const relativePath = relative(resolve(root), resolve(candidate));
      if (relativePath.startsWith('..') || relativePath.includes(':')) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(candidate).toString());
    });
    createMenu();
    const startupPath = markdownArgument(process.argv.slice(1));
    if (startupPath) queuedPath = startupPath;
    await createWindow();
    startupLog('Startup complete');
  }).catch((error: unknown) => {
    startupLog('Startup failed', error);
    dialog.showErrorBox('Notes could not start', error instanceof Error ? error.message : 'An unexpected startup error occurred.');
    app.quit();
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on('before-quit', () => { backups?.stop(); repository?.close(); });
