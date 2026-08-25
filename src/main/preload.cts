import { contextBridge, ipcRenderer } from 'electron';
import type { NotesApi } from '../shared/types.js';

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args);
const api: NotesApi = {
  navigation: { list: () => invoke('navigation:list') },
  notebooks: {
    create: (name) => invoke('notebooks:create', name),
    rename: (id, name) => invoke('notebooks:rename', id, name),
    remove: (id) => invoke('notebooks:remove', id),
  },
  sections: {
    create: (notebookId, name) => invoke('sections:create', notebookId, name),
    rename: (id, name) => invoke('sections:rename', id, name),
    remove: (id) => invoke('sections:remove', id),
  },
  pages: {
    create: (sectionId, title, options) => invoke('pages:create', sectionId, title, options),
    get: (id) => invoke('pages:get', id),
    save: (id, input) => invoke('pages:save', id, input),
    rename: (id, title) => invoke('pages:rename', id, title),
    trash: (id) => invoke('pages:trash', id), restore: (id) => invoke('pages:restore', id),
    removePermanently: (id) => invoke('pages:remove', id),
    toggleFavorite: (id) => invoke('pages:favorite', id),
    move: (id, sectionId, position) => invoke('pages:move', id, sectionId, position),
  },
  search: { full: (query) => invoke('search:full', query), quick: (query) => invoke('search:quick', query) },
  files: {
    openMarkdown: (path) => invoke('files:open', path),
    saveMarkdown: (path, content, mode) => invoke('files:save', path, content, mode),
    saveMarkdownAs: (content, name) => invoke('files:save-as', content, name),
    persistDraft: (path, content) => invoke('files:draft', path, content),
    clearDraft: (path) => invoke('files:clear-draft', path),
    importMarkdown: (sectionId) => invoke('files:import', sectionId),
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
  },
};

contextBridge.exposeInMainWorld('notes', api);
