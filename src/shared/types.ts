export type Id = string;
export type ThemePreference = 'light' | 'dark' | 'system';
export type MarkdownViewMode = 'preview' | 'edit' | 'split';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export type BackupFrequency = 'off' | 'daily' | 'weekly';

export interface BackupInfo {
  path: string;
  filename: string;
  createdAt: string;
  size: number;
  sha256?: string;
}

export interface BackupStatus {
  folder: string;
  provider: 'onedrive' | 'google-drive' | 'local' | 'none';
  frequency: BackupFrequency;
  retention: number;
  lastBackupAt: string | null;
  lastBackupError: string | null;
  backups: BackupInfo[];
}

export interface PageSummary {
  id: Id;
  sectionId: Id;
  title: string;
  position: number;
  isFavorite: boolean;
  isDeleted: boolean;
  updatedAt: string;
  lastOpenedAt: string | null;
  isSidebarVisible: boolean;
  parentPageId: Id | null;
}

export interface SectionTree {
  id: Id;
  notebookId: Id;
  name: string;
  position: number;
  pages: PageSummary[];
}

export interface NotebookTree {
  id: Id;
  name: string;
  position: number;
  sections: SectionTree[];
}

export interface NavigationData {
  notebooks: NotebookTree[];
  favorites: PageSummary[];
  recent: PageSummary[];
  trash: PageSummary[];
}

export interface Page extends PageSummary {
  contentHtml: string;
  contentMarkdown: string;
  createdAt: string;
}

export interface ExternalDocument {
  kind: 'external';
  path: string;
  filename: string;
  content: string;
  viewMode: MarkdownViewMode;
  recoveryContent?: string;
  isDirty?: boolean;
  modifiedAt: string;
}

export interface SearchResult {
  id: Id;
  title: string;
  notebook: string;
  section: string;
  excerpt: string;
  updatedAt: string;
}

export interface AppSettings {
  theme: ThemePreference;
  editorFontSize: number;
  codeFontSize: number;
  lineWidth: number;
  spellcheck: boolean;
  defaultMarkdownMode: MarkdownViewMode;
  reopenPreviousSession: boolean;
  backupFolder: string;
  backupFrequency: BackupFrequency;
  backupRetention: number;
  lastBackupAt: string | null;
  lastBackupError: string | null;
}

export interface NotesApi {
  navigation: { list(): Promise<NavigationData> };
  notebooks: {
    create(name?: string): Promise<NotebookTree>;
    rename(id: Id, name: string): Promise<void>;
    remove(id: Id): Promise<Id[]>;
  };
  sections: {
    create(notebookId: Id, name?: string): Promise<SectionTree>;
    rename(id: Id, name: string): Promise<void>;
    remove(id: Id): Promise<Id[]>;
  };
  pages: {
    create(sectionId: Id, title?: string, options?: { sidebarVisible?: boolean; parentPageId?: Id }): Promise<Page>;
    get(id: Id): Promise<Page>;
    save(id: Id, input: { title: string; contentHtml: string; contentMarkdown: string }): Promise<Page>;
    rename(id: Id, title: string): Promise<void>;
    trash(id: Id): Promise<void>;
    restore(id: Id): Promise<void>;
    removePermanently(id: Id): Promise<void>;
    toggleFavorite(id: Id): Promise<void>;
    move(id: Id, sectionId: Id, position: number): Promise<void>;
  };
  search: {
    full(query: string): Promise<SearchResult[]>;
    quick(query: string): Promise<PageSummary[]>;
  };
  files: {
    openMarkdown(path?: string): Promise<ExternalDocument | null>;
    openLinkedMarkdown(sourcePath: string, href: string): Promise<ExternalDocument>;
    saveMarkdown(path: string, content: string, viewMode: MarkdownViewMode): Promise<ExternalDocument>;
    saveMarkdownAs(content: string, suggestedName?: string): Promise<ExternalDocument | null>;
    persistDraft(path: string, content: string): Promise<void>;
    clearDraft(path: string): Promise<void>;
    importMarkdown(sectionId: Id): Promise<Page | null>;
    exportPage(pageId: Id): Promise<string | null>;
    recent(): Promise<Array<{ path: string; filename: string; lastOpenedAt: string; viewMode: MarkdownViewMode }>>;
    saveAttachment(pageId: Id, dataUrl: string): Promise<string>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    openDataFolder(): Promise<void>;
  };
  backup: {
    status(): Promise<BackupStatus>;
    chooseFolder(): Promise<BackupStatus | null>;
    create(): Promise<BackupInfo>;
    setSchedule(frequency: BackupFrequency, retention: number): Promise<BackupStatus>;
    restore(): Promise<boolean>;
    openFolder(): Promise<void>;
  };
  system: {
    openExternal(url: string): Promise<void>;
    platform(): string;
  };
  events: {
    onOpenExternal(callback: (document: ExternalDocument) => void): () => void;
    onCommand(callback: (command: string) => void): () => void;
  };
}
