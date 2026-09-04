import { contextBridge, ipcRenderer } from 'electron';
import type { NotesApi } from '../shared/types.js';

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args);
const api: NotesApi = {
  navigation: { list: () => invoke('navigation:list') },
  notebooks: {
    create: (name) => invoke('notebooks:create', name),
    rename: (id, name) => invoke('notebooks:rename', id, name),
    remove: (id) => invoke('notebooks:remove', id),
    move: (id, position) => invoke('notebooks:move', id, position),
  },
  sections: {
    create: (notebookId, name) => invoke('sections:create', notebookId, name),
    rename: (id, name) => invoke('sections:rename', id, name),
    remove: (id) => invoke('sections:remove', id),
    move: (id, notebookId, position) => invoke('sections:move', id, notebookId, position),
  },
  pages: {
    create: (sectionId, title, options) => invoke('pages:create', sectionId, title, options),
    get: (id) => invoke('pages:get', id),
    save: (id, input) => invoke('pages:save', id, input),
    rename: (id, title) => invoke('pages:rename', id, title),
    trash: (id) => invoke('pages:trash', id), restore: (id) => invoke('pages:restore', id),
    removePermanently: (id) => invoke('pages:remove', id),
    emptyTrash: () => invoke('pages:empty-trash'),
    toggleFavorite: (id) => invoke('pages:favorite', id),
    move: (id, sectionId, position) => invoke('pages:move', id, sectionId, position),
  },
  search: { full: (query) => invoke('search:full', query), quick: (query) => invoke('search:quick', query) },
  tasks: {
    list: (taskDate) => invoke('tasks:list', taskDate),
    create: (title, taskDate) => invoke('tasks:create', title, taskDate),
    update: (id, patch) => invoke('tasks:update', id, patch),
    remove: (id) => invoke('tasks:remove', id),
  },
  files: {
    openMarkdown: (path) => invoke('files:open', path),
    openLinkedMarkdown: (sourcePath, href) => invoke('files:open-linked', sourcePath, href),
    openMarkdownFolder: () => invoke('files:open-folder'),
    saveMarkdown: (path, content, mode) => invoke('files:save', path, content, mode),
    saveMarkdownAs: (content, name) => invoke('files:save-as', content, name),
    persistDraft: (path, content) => invoke('files:draft', path, content),
    clearDraft: (path) => invoke('files:clear-draft', path),
    importMarkdown: (sectionId) => invoke('files:import', sectionId),
    linkMarkdown: (sectionId, path) => invoke('files:link', sectionId, path),
    exportPage: (pageId) => invoke('files:export', pageId), recent: () => invoke('files:recent'),
    saveAttachment: (pageId, dataUrl) => invoke('files:attachment', pageId, dataUrl),
  },
  settings: { get: () => invoke('settings:get'), update: (patch) => invoke('settings:update', patch), openDataFolder: () => invoke('settings:open-data') },
  backup: {
    status: () => invoke('backup:status'),
    chooseFolder: () => invoke('backup:choose-folder'),
    create: () => invoke('backup:create'),
    setSchedule: (frequency, retention) => invoke('backup:set-schedule', frequency, retention),
    restore: () => invoke('backup:restore'),
    openFolder: () => invoke('backup:open-folder'),
  },
  mcp: {
    status: () => invoke('mcp:status'),
    regenerateAccessLink: () => invoke('mcp:regenerate-access-link'),
  },
  aiAccess: {
    status: () => invoke('ai-access:status'),
    enable: () => invoke('ai-access:enable'),
    disable: () => invoke('ai-access:disable'),
    openChatGptWebSetup: () => invoke('ai-access:open-chatgpt-web-setup'),
  },
  system: { openExternal: (url) => invoke('system:open-external', url), platform: () => process.platform },
  events: {
    onOpenExternal: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, document: Parameters<typeof callback>[0]) => callback(document);
      ipcRenderer.on('open-external-document', listener);
      return () => ipcRenderer.removeListener('open-external-document', listener);
    },
    onCommand: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
      ipcRenderer.on('app-command', listener);
      return () => ipcRenderer.removeListener('app-command', listener);
    },
    onLibraryChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('library-changed', listener);
      return () => ipcRenderer.removeListener('library-changed', listener);
    },
  },
};

contextBridge.exposeInMainWorld('notes', api);
