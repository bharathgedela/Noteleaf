import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookPlus, CheckCircle2, ChevronDown, ChevronRight, ChevronsRight, ClipboardList, Clock3, CloudUpload, FilePlus2, FileText, Folder, FolderOpen, FolderTree, Home, Keyboard, Lightbulb, List, LoaderCircle, Maximize2, Minimize2, Plus, RefreshCw, Rocket, Settings as SettingsIcon, X } from 'lucide-react';
import type { AppSettings, BackupStatus, ExternalDocument, MarkdownFolderEntry, MarkdownFolderTree, McpStatus, NavigationData, NotebookTree, Page, PageSummary, SaveState, SearchResult, SectionTree } from '../../shared/types';
import { Sidebar } from '../sidebar/Sidebar';
import { RichEditor } from '../editor/RichEditor';
import { MarkdownPreview } from '../markdown/MarkdownPreview';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { BrandLogo } from '../components/BrandLogo';
import { hasPrimaryModifier, shortcut } from '../platform';

const EMPTY_NAV: NavigationData = { notebooks: [], favorites: [], recent: [], trash: [] };
const DEFAULT_SETTINGS: AppSettings = { theme: 'light', editorFontSize: 16, codeFontSize: 14, lineWidth: 880, spellcheck: true, defaultMarkdownMode: 'preview', reopenPreviousSession: true, backupFolder: '', backupFrequency: 'hourly', backupRetention: 10, lastBackupAt: null, lastBackupError: null, mcpEnabled: false, mcpAllowWrites: false, mcpPort: 37931, mcpAccessToken: '' };
type Tab = { kind: 'internal'; key: string; pageId: string; title: string; history: string[]; historyIndex: number } | { kind: 'external'; key: string; document: ExternalDocument };
type StructureMenu = { kind: 'notebook'; item: NotebookTree; x: number; y: number } | { kind: 'section'; item: SectionTree; x: number; y: number };
type RenameDialogState = { kind: 'notebook' | 'section'; id: string; name: string };
type ToastState = { id: number; message: string; tone: 'success' | 'info' | 'error' };

function storedWidth(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return 'just now'; if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function useReliableAutofocus(ref: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const focus = () => {
      input.focus({ preventScroll: true });
      if (!input.value || input.selectionStart === input.selectionEnd) input.select();
    };
    const frame = window.requestAnimationFrame(focus);
    const timer = window.setTimeout(() => { if (document.activeElement !== input) focus(); }, 100);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [ref]);
}

function InternalDocument({ pageId, settings, libraryRevision, breadcrumb, onRevealBreadcrumb, onTitle, onSaved, onOpenPage, onStructureChange }: { pageId: string; settings: AppSettings; libraryRevision: number; breadcrumb?: { notebookId: string; notebook: string; sectionId: string; section: string }; onRevealBreadcrumb: (id: string) => void; onTitle: (title: string) => void; onSaved: () => void; onOpenPage: (pageId: string) => void; onStructureChange: () => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState({ html: '<p></p>', markdown: '' });
  const [status, setStatus] = useState<SaveState>('saved');
  const [reading, setReading] = useState(false);
  const dirty = useRef(false);
  const latest = useRef<{ page: Page | null; title: string; content: { html: string; markdown: string } }>({ page: null, title: '', content: { html: '<p></p>', markdown: '' } });
  latest.current = { page, title, content };
  useEffect(() => {
    if (dirty.current) return;
    let live = true;
    window.notes.pages.get(pageId).then((next) => { if (live) { setPage(next); setTitle(next.title); setContent({ html: next.contentHtml, markdown: next.contentMarkdown }); setStatus('saved'); dirty.current = false; } });
    return () => { live = false; };
  }, [pageId, libraryRevision]);
  useEffect(() => () => {
    const current = latest.current;
    if (dirty.current && current.page) void window.notes.pages.save(current.page.id, { title: current.title.trim() || 'Untitled', contentHtml: current.content.html, contentMarkdown: current.content.markdown });
  }, [pageId]);
  useEffect(() => {
    if (!page || !dirty.current) return;
    setStatus('unsaved');
    const timer = window.setTimeout(async () => {
      setStatus('saving');
      try {
        const saved = await window.notes.pages.save(page.id, { title: title.trim() || 'Untitled', contentHtml: content.html, contentMarkdown: content.markdown });
        setPage(saved); dirty.current = false; setStatus('saved'); onTitle(saved.title); onSaved();
      } catch { setStatus('error'); }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [page, title, content, onTitle, onSaved]);
  if (!page) return <div className="document-loading">Loading note…</div>;
  const changed = () => { dirty.current = true; };
  return <main className="document-view">
    <div className="document-column">
      <header className="document-header">
        {breadcrumb && <nav className="document-breadcrumb" aria-label="Page location"><button onClick={() => onRevealBreadcrumb(breadcrumb.notebookId)}>{breadcrumb.notebook}</button><ChevronRight size={12} /><button onClick={() => onRevealBreadcrumb(breadcrumb.sectionId)}>{breadcrumb.section}</button></nav>}
        <input className="title-input" value={title} aria-label="Note title" placeholder="Untitled" onChange={(e) => { setTitle(e.target.value); changed(); }} />
        <div className="document-meta"><span>Updated {relativeTime(page.updatedAt)}</span><span className={`save-state ${status}`}>{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Couldn’t save' : 'Unsaved'}</span></div>
        <div className="mode-switch compact"><button className={!reading ? 'active' : ''} onClick={() => setReading(false)}>Edit</button><button className={reading ? 'active' : ''} onClick={() => setReading(true)}>Read</button></div>
      </header>
      {reading ? <MarkdownPreview source={content.markdown} onOpenPage={onOpenPage} /> : <RichEditor pageId={page.id} initialHtml={page.contentHtml} spellcheck={settings.spellcheck} onChange={(html, markdown) => { setContent({ html, markdown }); changed(); }} onOpenPage={onOpenPage} onCreateLinkedPage={async (title) => { const created = await window.notes.pages.create(page.sectionId, title, { sidebarVisible: false, parentPageId: page.id }); onStructureChange(); return { id: created.id, title: created.title }; }} />}
    </div>
  </main>;
}

function ExternalDocumentView({ initial, linked, onDocumentChange, onOpenLinkedDocument, onLinkToNotebook, onRevealInNotebook }: { initial: ExternalDocument; linked: boolean; onDocumentChange: (doc: ExternalDocument) => void; onOpenLinkedDocument: (sourcePath: string, href: string) => void; onLinkToNotebook: () => void; onRevealInNotebook: () => void }) {
  const [document, setDocument] = useState(initial);
  const [source, setSource] = useState(initial.recoveryContent || initial.content);
  const [dirty, setDirty] = useState(Boolean(initial.recoveryContent && initial.recoveryContent !== initial.content));
  const [saving, setSaving] = useState(false);
  const [recoveryBannerOpen, setRecoveryBannerOpen] = useState(Boolean(initial.recoveryContent && initial.recoveryContent !== initial.content));
  // File identity controls reloading; same-file tab metadata updates must not overwrite edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const recovered = Boolean(initial.recoveryContent && initial.recoveryContent !== initial.content); setDocument(initial); setSource(initial.recoveryContent || initial.content); setDirty(recovered); setRecoveryBannerOpen(recovered); }, [initial.path]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void window.notes.files.persistDraft(document.path, source), 650);
    return () => window.clearTimeout(timer);
  }, [dirty, document.path, source]);
  const save = useCallback(async () => {
    setSaving(true);
    try { const saved = await window.notes.files.saveMarkdown(document.path, source, document.viewMode); setDocument(saved); setDirty(false); setRecoveryBannerOpen(false); onDocumentChange({ ...saved, isDirty: false }); }
    finally { setSaving(false); }
  }, [document, source, onDocumentChange]);
  const saveAs = useCallback(async () => {
    const saved = await window.notes.files.saveMarkdownAs(source, document.filename);
    if (saved) { setDocument(saved); setDirty(false); setRecoveryBannerOpen(false); onDocumentChange({ ...saved, isDirty: false }); }
  }, [source, document.filename, onDocumentChange]);
  useEffect(() => {
    const listener = (event: Event) => { const command = (event as CustomEvent<string>).detail; if (command === 'save') void save(); if (command === 'save-as') void saveAs(); };
    window.addEventListener('notes-command', listener); return () => window.removeEventListener('notes-command', listener);
  }, [save, saveAs]);
  const setMode = (viewMode: ExternalDocument['viewMode']) => { const next = { ...document, viewMode, isDirty: dirty }; setDocument(next); onDocumentChange(next); };
  const editSource = (value: string) => { setSource(value); setDirty(true); onDocumentChange({ ...document, isDirty: true }); };
  const discardRecovery = async () => {
    try {
      await window.notes.files.clearDraft(document.path);
      const next = { ...document, content: initial.content, recoveryContent: undefined, isDirty: false };
      setSource(initial.content); setDirty(false); setRecoveryBannerOpen(false); setDocument(next); onDocumentChange(next);
    } catch { window.alert('The recovered draft could not be discarded. Please try again.'); }
  };
  return <main className="document-view external-view">
    <header className="external-header"><div><h1>{document.filename}{dirty && <i> •</i>}</h1><p title={document.path}>{document.path}</p></div><div className="external-header-actions"><button className={`external-link-button${linked ? ' linked' : ''}`} onClick={linked ? onRevealInNotebook : onLinkToNotebook}>{linked ? <CheckCircle2 size={14} /> : <BookPlus size={14} />}{linked ? 'In notebook' : 'Add to notebook'}</button><div className="mode-switch"><button className={document.viewMode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button><button className={document.viewMode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit</button><button className={document.viewMode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>Split</button></div></div></header>
    {recoveryBannerOpen && <div className="recovery-banner"><span>Recovered unsaved changes from your last editing session.</span><div><button onClick={() => void discardRecovery()}>Discard recovery</button><button className="recovery-close" title="Keep recovery and close message" aria-label="Keep recovery and close message" onClick={() => setRecoveryBannerOpen(false)}><X size={14} /></button></div></div>}
    {document.viewMode === 'preview' && <div className="external-preview"><MarkdownPreview source={source} onOpenDocument={(href) => onOpenLinkedDocument(document.path, href)} /></div>}
    {document.viewMode === 'edit' && <textarea className="markdown-source single" aria-label="Markdown source" value={source} onChange={(e) => editSource(e.target.value)} spellCheck={false} />}
    {document.viewMode === 'split' && <div className="split-view"><textarea className="markdown-source" aria-label="Markdown source" value={source} onChange={(e) => editSource(e.target.value)} spellCheck={false} /><div className="split-preview"><MarkdownPreview source={source} onOpenDocument={(href) => onOpenLinkedDocument(document.path, href)} /></div></div>}
    {(dirty || saving) && <div className="external-save-status">{saving ? 'Saving…' : `Unsaved changes · ${shortcut('S')}`}</div>}
  </main>;
}

function MarkdownTreeItem({ entry, activePath, onOpen }: { entry: MarkdownFolderEntry; activePath?: string; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  if (entry.kind === 'file') return <button className={`markdown-tree-file${activePath?.toLowerCase() === entry.path.toLowerCase() ? ' active' : ''}`} title={entry.path} onClick={() => onOpen(entry.path)}><FileText size={14} /><span>{entry.name}</span></button>;
  return <div className="markdown-tree-folder">
    <button className="markdown-tree-folder-row" title={entry.path} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={14} /><span>{entry.name}</span></button>
    {expanded && <div className="markdown-tree-children">{entry.children.map((child) => <MarkdownTreeItem key={child.path} entry={child} activePath={activePath} onOpen={onOpen} />)}</div>}
  </div>;
}

function MarkdownFolderExplorer({ tree, activePath, width, onOpen, onChoose, onClose }: { tree: MarkdownFolderTree; activePath?: string; width: number; onOpen: (path: string) => void; onChoose: () => void; onClose: () => void }) {
  return <aside className="markdown-explorer" style={{ width, minWidth: width }} aria-label="Markdown folder explorer">
    <header><div><FolderTree size={16} /><strong>Markdown Explorer</strong></div><div><button title="Choose another folder" aria-label="Choose another folder" onClick={onChoose}><RefreshCw size={14} /></button><button title="Close explorer" aria-label="Close explorer" onClick={onClose}><X size={15} /></button></div></header>
    <div className="markdown-explorer-root" title={tree.path}><FolderOpen size={14} /><strong>{tree.name}</strong><small>{tree.fileCount}</small></div>
    <div className="markdown-explorer-tree">{tree.children.length ? tree.children.map((entry) => <MarkdownTreeItem key={entry.path} entry={entry} activePath={activePath} onOpen={onOpen} />) : <p>No Markdown files found in this folder.</p>}</div>
    {tree.truncated && <footer>Showing the first 5,000 Markdown files.</footer>}
  </aside>;
}

function ToastNotice({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return <div className={`toast-notice ${toast.tone}`} role="status"><span>{toast.tone === 'success' ? <CheckCircle2 size={16} /> : toast.tone === 'error' ? <X size={16} /> : <CloudUpload size={16} />}</span><p>{toast.message}</p><button aria-label="Dismiss notification" onClick={onClose}><X size={14} /></button></div>;
}

function SearchPalette({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => { if (query.trim()) void window.notes.search.full(query).then(setResults); else setResults([]); }, 120); return () => window.clearTimeout(timer); }, [query]);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="search-palette" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
    <div className="palette-input"><span>⌕</span><input autoFocus placeholder="Search notes…" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((v) => Math.min(results.length - 1, v + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((v) => Math.max(0, v - 1)); } if (e.key === 'Enter' && results[selected]) onOpen(results[selected].id); }} /><kbd>Esc</kbd></div>
    <div className="search-results">{!query && <p className="palette-hint">Type a title or phrase from any note.</p>}{query && results.length === 0 && <p className="palette-hint">No matching notes</p>}{results.map((result, index) => <button key={result.id} className={selected === index ? 'selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => onOpen(result.id)}><strong>{result.title}</strong><small>{result.notebook} / {result.section}</small><span dangerouslySetInnerHTML={{ __html: result.excerpt }} /></button>)}</div>
  </section></div>;
}

function SettingsDialog({ settings, onChange, onClose }: { settings: AppSettings; onChange: (settings: AppSettings) => void; onClose: () => void }) {
  const [backup, setBackup] = useState<BackupStatus>();
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [mcp, setMcp] = useState<McpStatus>();
  const [mcpMessage, setMcpMessage] = useState('');
  const update = async (patch: Partial<AppSettings>) => {
    onChange(await window.notes.settings.update(patch));
    if (Object.keys(patch).some((key) => key.startsWith('mcp'))) setMcp(await window.notes.mcp.status());
  };
  useEffect(() => { void Promise.all([window.notes.backup.status().then(setBackup), window.notes.mcp.status().then(setMcp)]); }, []);
  const runBackupAction = async (action: () => Promise<void>) => {
    if (backupBusy) return;
    setBackupBusy(true); setBackupMessage('');
    try { await action(); setBackup(await window.notes.backup.status()); }
    catch (error) { setBackupMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Backup operation failed.'); }
    finally { setBackupBusy(false); }
  };
  const copyMcp = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setMcpMessage(`${label} copied.`); }
    catch { setMcpMessage('Could not copy automatically. Select and copy the text manually.'); }
  };
  const providerName = backup?.provider === 'onedrive' ? 'OneDrive synced folder' : backup?.provider === 'google-drive' ? 'Google Drive synced folder' : backup?.provider === 'local' ? 'Local folder' : 'Not configured';
  const stdioConfig = mcp ? JSON.stringify({ mcpServers: { noteleaf: { command: mcp.executablePath, args: mcp.stdioArguments, env: mcp.stdioEnvironment } } }, null, 2) : '';
  const mcpState = mcp?.lastError ? 'error' : mcp?.running ? 'running' : 'off';
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="settings-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}><header><div><h2>Settings</h2><p>Keep Noteleaf comfortable for the way you read and write.</p></div><button onClick={onClose}><X size={17} /></button></header>
    <div className="settings-scroll">
      <div className="setting-row"><label>Appearance<small>Choose how Noteleaf looks.</small></label><select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as AppSettings['theme'] })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></div>
      <div className="setting-row"><label>Editor font size<small>{settings.editorFontSize}px</small></label><input type="range" min="14" max="22" value={settings.editorFontSize} onChange={(e) => void update({ editorFontSize: Number(e.target.value) })} /></div>
      <div className="setting-row"><label>Reading width<small>{settings.lineWidth}px</small></label><input type="range" min="680" max="1100" step="20" value={settings.lineWidth} onChange={(e) => void update({ lineWidth: Number(e.target.value) })} /></div>
      <div className="setting-row"><label>Default Markdown mode</label><select value={settings.defaultMarkdownMode} onChange={(e) => void update({ defaultMarkdownMode: e.target.value as AppSettings['defaultMarkdownMode'] })}><option value="preview">Preview</option><option value="edit">Edit</option><option value="split">Split</option></select></div>
      <div className="setting-row"><label>Spell check</label><input type="checkbox" checked={settings.spellcheck} onChange={(e) => void update({ spellcheck: e.target.checked })} /></div>
      <section className="mcp-settings">
        <div className="settings-section-title"><div><h3>AI &amp; MCP</h3><p>Let Claude, ChatGPT, and other MCP clients find and work with your Noteleaf library.</p></div><span className={`mcp-badge ${mcpState}`}>{mcp?.lastError ? 'Error' : mcp?.running ? 'Connected' : 'Local'}</span></div>
        <div className="setting-row"><label>Local HTTP endpoint<small>Enable this when connecting through an HTTPS tunnel for ChatGPT.</small></label><input type="checkbox" checked={settings.mcpEnabled} onChange={(event) => void update({ mcpEnabled: event.target.checked })} /></div>
        <div className="setting-row"><label>Allow AI changes<small>Off means clients can search and read, but cannot create or update anything.</small></label><input type="checkbox" checked={settings.mcpAllowWrites} onChange={(event) => void update({ mcpAllowWrites: event.target.checked })} /></div>
        {mcp?.lastError && <p className="mcp-error">Could not start MCP: {mcp.lastError}</p>}
        {mcp && <div className="mcp-connect-card">
          <div><strong>Private local endpoint</strong><small>Keep this secret link private. It grants access to your Noteleaf MCP tools.</small></div>
          <code title={mcp.endpoint}>{mcp.endpoint}</code>
          <div className="mcp-actions"><button disabled={!mcp.running} onClick={() => void copyMcp(mcp.endpoint, 'Endpoint')}>Copy endpoint</button><button onClick={() => void window.notes.mcp.regenerateAccessLink().then((status) => { setMcp(status); setMcpMessage('Created a new private access link.'); })}>New private link</button></div>
        </div>}
        {mcp && <div className="mcp-connect-card">
          <div><strong>Claude Desktop / local MCP configuration</strong><small>This starts a private stdio connection and does not require the HTTP switch above.</small></div>
          <pre>{stdioConfig}</pre>
          <div className="mcp-actions"><button onClick={() => void copyMcp(stdioConfig, 'Claude configuration')}>Copy configuration</button></div>
        </div>}
        <p className="mcp-note">For ChatGPT, enable the endpoint, expose port <strong>{mcp?.port ?? settings.mcpPort}</strong> through a temporary HTTPS tunnel, and replace the local host in the private endpoint with the tunnel host. Write tools are announced separately so the AI host can request approval.</p>
        {mcpMessage && <p className="mcp-message">{mcpMessage}</p>}
      </section>
      <section className="backup-settings">
        <div className="settings-section-title"><div><h3>Backup &amp; recovery</h3><p>Save the complete Noteleaf library and attachments to a synced or local folder.</p></div><span className={`provider-badge ${backup?.provider || 'none'}`}>{providerName}</span></div>
        <div className="backup-folder"><strong>{backup?.folder || 'Choose a OneDrive, Google Drive, or local folder'}</strong><div><button disabled={backupBusy} onClick={() => void runBackupAction(async () => { const selected = await window.notes.backup.chooseFolder(); if (selected) setBackup(selected); })}>{backup?.folder ? 'Change folder…' : 'Choose folder…'}</button>{backup?.folder && <button disabled={backupBusy} onClick={() => void runBackupAction(() => window.notes.backup.openFolder())}>Open folder</button>}</div></div>
        <div className="setting-row backup-row"><label>Automatic backup<small>Hourly by default while Noteleaf is open.</small></label><select disabled={!backup?.folder || backupBusy} value={backup?.frequency || 'hourly'} onChange={(e) => void runBackupAction(async () => { setBackup(await window.notes.backup.setSchedule(e.target.value as BackupStatus['frequency'], backup?.retention || 10)); })}><option value="hourly">Every hour</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="off">Off</option></select></div>
        <div className="setting-row backup-row"><label>Keep backups<small>Older automatic backups are removed from this folder.</small></label><select disabled={!backup?.folder || backupBusy} value={backup?.retention || 10} onChange={(e) => void runBackupAction(async () => { setBackup(await window.notes.backup.setSchedule(backup?.frequency || 'off', Number(e.target.value))); })}><option value="5">5 backups</option><option value="10">10 backups</option><option value="20">20 backups</option><option value="50">50 backups</option></select></div>
        <div className="backup-actions"><button className="primary" disabled={!backup?.folder || backupBusy} onClick={() => void runBackupAction(async () => { const created = await window.notes.backup.create(); setBackupMessage(`Backup created: ${created.filename}`); })}>{backupBusy ? 'Working…' : 'Back up now'}</button><button disabled={backupBusy} onClick={() => void runBackupAction(async () => { await window.notes.backup.restore(); })}>Restore backup…</button></div>
        {backupMessage && <p className="backup-message">{backupMessage}</p>}
        {backup?.lastBackupError && <p className="backup-error">Last backup failed: {backup.lastBackupError}</p>}
        {backup?.lastBackupAt && <p className="backup-last">Last successful backup: {new Date(backup.lastBackupAt).toLocaleString()}</p>}
        {!!backup?.backups.length && <div className="backup-history"><strong>Recent backups</strong>{backup.backups.slice(0, 3).map((item) => <div key={item.path}><span>{item.filename}</span><small>{(item.size / 1024 / 1024).toFixed(1)} MB</small></div>)}</div>}
        <p className="backup-note">For cloud protection, select a folder inside the OneDrive or Google Drive desktop app. Noteleaf never receives your cloud password.</p>
      </section>
    </div>
    <footer><button onClick={() => void window.notes.settings.openDataFolder()}>Open Noteleaf data folder</button></footer>
  </section></div>;
}

function CreateDialog({ title, label, initialValue, submitLabel = 'Create and open', busyLabel = 'Creating…', onCancel, onCreate }: { title: string; label: string; initialValue: string; submitLabel?: string; busyLabel?: string; onCancel: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initialValue);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useReliableAutofocus(inputRef);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try { await onCreate(name.trim()); } finally { setCreating(false); }
  };
  return <div className="modal-backdrop create-backdrop" onMouseDown={onCancel}><form className="create-dialog" role="dialog" aria-modal="true" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2><p>{label}</p>
    <input ref={inputRef} autoFocus autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.target.select()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onCancel(); }} />
    <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={!name.trim() || creating}>{creating ? busyLabel : submitLabel}</button></div>
  </form></div>;
}

function LinkMarkdownDialog({ document, navigation, onCancel, onLink }: { document: ExternalDocument; navigation: NavigationData; onCancel: () => void; onLink: (sectionId: string) => Promise<void> }) {
  const sections = navigation.notebooks.flatMap((notebook) => notebook.sections.map((section) => ({ notebook, section })));
  const [sectionId, setSectionId] = useState(sections[0]?.section.id || '');
  const [linking, setLinking] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sectionId || linking) return;
    setLinking(true);
    try { await onLink(sectionId); } finally { setLinking(false); }
  };
  return <div className="modal-backdrop create-backdrop" onMouseDown={onCancel}><form className="create-dialog link-markdown-dialog" role="dialog" aria-modal="true" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()}>
    <h2>Add Markdown to notebook</h2>
    <p><strong>{document.filename}</strong> will remain in its original folder. Noteleaf adds a sidebar shortcut, so relative links and neighboring files continue working.</p>
    <label htmlFor="markdown-section">Notebook section</label>
    <select id="markdown-section" autoFocus value={sectionId} onChange={(event) => setSectionId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
      {navigation.notebooks.map((notebook) => <optgroup key={notebook.id} label={notebook.name}>{notebook.sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</optgroup>)}
    </select>
    <small title={document.path}>{document.path}</small>
    <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={!sectionId || linking}>{linking ? 'Adding…' : 'Add to notebook'}</button></div>
  </form></div>;
}

export function App() {
  const [navigation, setNavigation] = useState(EMPTY_NAV);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string>();
  const [workspaceMode, setWorkspaceMode] = useState<'documents' | 'tasks'>('documents');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => storedWidth('notes.sidebarWidth', 260));
  const [explorerWidth, setExplorerWidth] = useState(() => storedWidth('notes.explorerWidth', 300));
  const [focusMode, setFocusMode] = useState(false);
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>();
  const [backupBusy, setBackupBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>();
  const [markdownFolder, setMarkdownFolder] = useState<MarkdownFolderTree>();
  const [markdownExplorerOpen, setMarkdownExplorerOpen] = useState(false);
  const [createDialog, setCreateDialog] = useState<{ kind: 'notebook' } | { kind: 'section'; notebookId: string }>();
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>();
  const [linkDialog, setLinkDialog] = useState<ExternalDocument>();
  const [menu, setMenu] = useState<{ page: PageSummary; x: number; y: number }>();
  const [structureMenu, setStructureMenu] = useState<StructureMenu>();
  const refresh = useCallback(async () => setNavigation(await window.notes.navigation.list()), []);
  const openExternal = useCallback((document: ExternalDocument) => {
    const key = `file:${document.path.toLowerCase()}`;
    setTabs((before) => { const found = before.findIndex((tab) => tab.key === key); if (found >= 0) { const current = before[found]; if (current.kind === 'external' && current.document.isDirty) return before; return before.map((tab) => tab.key === key ? { kind: 'external', key, document } : tab); } return [...before, { kind: 'external', key, document }]; });
    setActiveKey(key); setWorkspaceMode('documents');
  }, []);
  useEffect(() => { void Promise.all([refresh(), window.notes.settings.get().then(setSettings)]); }, [refresh]);
  useEffect(() => window.notes.events.onLibraryChanged(() => {
    setLibraryRevision((revision) => revision + 1);
    void refresh();
    const cleanExternalTabs = tabs.filter((tab): tab is Extract<Tab, { kind: 'external' }> => tab.kind === 'external' && !tab.document.isDirty);
    if (cleanExternalTabs.length) void Promise.all(cleanExternalTabs.map(async (tab) => ({ key: tab.key, document: await window.notes.files.openMarkdown(tab.document.path) }))).then((updates) => {
      setTabs((before) => before.map((tab) => {
        const update = updates.find((item) => item.key === tab.key)?.document;
        return update && tab.kind === 'external' && !tab.document.isDirty ? { ...tab, document: update } : tab;
      }));
    });
  }), [refresh, tabs]);
  useEffect(() => { window.localStorage.setItem('notes.sidebarWidth', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { window.localStorage.setItem('notes.explorerWidth', String(explorerWidth)); }, [explorerWidth]);
  useEffect(() => {
    const update = () => void window.notes.backup.status().then(setBackupStatus);
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? undefined : current), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const notify = useCallback((message: string, tone: ToastState['tone'] = 'info') => setToast({ id: Date.now(), message, tone }), []);
  const actualTheme = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
  useEffect(() => { document.documentElement.dataset.theme = actualTheme; document.documentElement.style.setProperty('--content-width', `${settings.lineWidth}px`); document.documentElement.style.setProperty('--editor-size', `${settings.editorFontSize}px`); document.documentElement.style.setProperty('--code-size', `${settings.codeFontSize}px`); }, [actualTheme, settings]);
  const openPageById = useCallback(async (pageId: string) => {
    const requested = await window.notes.pages.get(pageId);
    if (requested.externalPath) {
      try {
        const document = await window.notes.files.openMarkdown(requested.externalPath);
        if (document) openExternal(document);
        void refresh();
      } catch {
        window.alert('This linked Markdown file could not be opened. It may have been moved or deleted.');
      }
      return;
    }
    const existing = tabs.find((tab): tab is Extract<Tab, { kind: 'internal' }> => tab.kind === 'internal');
    if (existing) {
      if (existing.pageId !== pageId) {
        const page = await window.notes.pages.get(pageId);
        setTabs((before) => before.map((tab) => tab.key === existing.key && tab.kind === 'internal' ? { ...tab, pageId, title: page.title, history: [...tab.history.slice(0, tab.historyIndex + 1), pageId], historyIndex: tab.historyIndex + 1 } : tab));
      }
      setActiveKey(existing.key); setWorkspaceMode('documents'); setSearchOpen(false); return;
    }
    const page = requested; const tab: Tab = { kind: 'internal', key: 'notes-workspace', pageId: page.id, title: page.title, history: [page.id], historyIndex: 0 };
    setTabs((before) => [...before, tab]); setActiveKey(tab.key); setWorkspaceMode('documents'); setSearchOpen(false); void refresh();
  }, [tabs, refresh, openExternal]);
  const navigateInActiveTab = useCallback(async (pageId: string) => {
    const current = tabs.find((tab) => tab.key === activeKey);
    if (!current || current.kind !== 'internal') { await openPageById(pageId); return; }
    if (current.pageId === pageId) return;
    const page = await window.notes.pages.get(pageId);
    setTabs((before) => before.map((tab) => tab.key === current.key && tab.kind === 'internal' ? { ...tab, pageId, title: page.title, history: [...tab.history.slice(0, tab.historyIndex + 1), pageId], historyIndex: tab.historyIndex + 1 } : tab));
    void refresh();
  }, [activeKey, tabs, openPageById, refresh]);
  const movePageHistory = useCallback(async (direction: -1 | 1) => {
    const current = tabs.find((tab) => tab.key === activeKey);
    if (!current || current.kind !== 'internal') return;
    const nextIndex = current.historyIndex + direction;
    const pageId = current.history[nextIndex];
    if (!pageId) return;
    try {
      const page = await window.notes.pages.get(pageId);
      setTabs((before) => before.map((tab) => tab.key === current.key && tab.kind === 'internal' ? { ...tab, pageId, title: page.title, historyIndex: nextIndex } : tab));
      void refresh();
    } catch {
      const history = current.history.filter((id) => id !== pageId);
      setTabs((before) => before.map((tab) => tab.key === current.key && tab.kind === 'internal' ? { ...tab, history, historyIndex: Math.min(tab.historyIndex, history.length - 1) } : tab));
    }
  }, [activeKey, tabs, refresh]);
  const chooseMarkdownFolder = useCallback(async () => {
    const tree = await window.notes.files.openMarkdownFolder();
    if (tree) { setMarkdownFolder(tree); setMarkdownExplorerOpen(true); }
  }, []);
  const toggleMarkdownExplorer = useCallback(() => {
    if (!markdownFolder) void chooseMarkdownFolder(); else setMarkdownExplorerOpen((value) => !value);
  }, [markdownFolder, chooseMarkdownFolder]);
  const startPanelResize = (event: React.PointerEvent, panel: 'sidebar' | 'explorer') => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === 'sidebar' ? sidebarWidth : explorerWidth;
    document.body.classList.add('panel-resizing');
    const move = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * (panel === 'sidebar' ? 1 : -1);
      const next = Math.min(panel === 'sidebar' ? 420 : 520, Math.max(panel === 'sidebar' ? 210 : 240, startWidth + delta));
      if (panel === 'sidebar') setSidebarWidth(next); else setExplorerWidth(next);
    };
    const finish = () => {
      document.body.classList.remove('panel-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const quickBackup = useCallback(async () => {
    if (backupBusy) return;
    const status = backupStatus || await window.notes.backup.status();
    if (!status.folder) {
      setSettingsOpen(true);
      notify('Choose a OneDrive, Google Drive, or local backup folder first.');
      return;
    }
    setBackupBusy(true);
    try {
      const created = await window.notes.backup.create();
      setBackupStatus(await window.notes.backup.status());
      notify(`Backup saved: ${created.filename}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Backup failed.';
      notify(message, 'error');
    } finally { setBackupBusy(false); }
  }, [backupBusy, backupStatus, notify]);
  const openExplorerFile = useCallback(async (path: string) => {
    try { const document = await window.notes.files.openMarkdown(path); if (document) openExternal(document); }
    catch { window.alert('This Markdown file could not be opened. It may have been moved or deleted.'); }
  }, [openExternal]);
  const openLinkedMarkdown = useCallback(async (sourcePath: string, href: string) => {
    try {
      openExternal(await window.notes.files.openLinkedMarkdown(sourcePath, href));
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : 'The file may have been moved or renamed.';
      window.alert(`Could not open the linked Markdown file.\n\n${detail}`);
    }
  }, [openExternal]);
  useEffect(() => window.notes.events.onOpenExternal(openExternal), [openExternal]);
  const active = tabs.find((tab) => tab.key === activeKey);
  const externalTabs = tabs.filter((tab): tab is Extract<Tab, { kind: 'external' }> => tab.kind === 'external');
  const activeTabIndex = tabs.findIndex((tab) => tab.key === activeKey);
  const canGoBack = workspaceMode === 'documents' && ((active?.kind === 'internal' && active.historyIndex > 0) || activeTabIndex > 0);
  const canGoForward = workspaceMode === 'documents' && ((active?.kind === 'internal' && active.historyIndex < active.history.length - 1) || (activeTabIndex >= 0 && activeTabIndex < tabs.length - 1));
  const moveWorkspaceHistory = useCallback(async (direction: -1 | 1) => {
    const current = tabs.find((tab) => tab.key === activeKey);
    if (!current) return;
    if (current.kind === 'internal' && current.history[current.historyIndex + direction]) {
      await movePageHistory(direction);
      return;
    }
    const currentIndex = tabs.findIndex((tab) => tab.key === current.key);
    const adjacentTab = tabs[currentIndex + direction];
    if (adjacentTab) setActiveKey(adjacentTab.key);
  }, [activeKey, tabs, movePageHistory]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.tabs .tab.active')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey]);
  const firstSection = navigation.notebooks.flatMap((n) => n.sections)[0];
  const createPage = useCallback(async (sectionId?: string) => {
    let target = sectionId || firstSection?.id;
    if (!target) { const notebook = await window.notes.notebooks.create('My Notes'); const section = await window.notes.sections.create(notebook.id, 'Quick Notes'); target = section.id; }
    const page = await window.notes.pages.create(target); await refresh(); await openPageById(page.id);
  }, [firstSection?.id, refresh, openPageById]);
  const openMarkdown = useCallback(async () => { const document = await window.notes.files.openMarkdown(); if (document) openExternal(document); }, [openExternal]);
  const importMarkdown = useCallback(async () => {
    let target = firstSection?.id;
    if (!target) { const notebook = await window.notes.notebooks.create('My Notes'); target = (await window.notes.sections.create(notebook.id, 'Imported')).id; }
    const page = await window.notes.files.importMarkdown(target); if (page) { await refresh(); await openPageById(page.id); }
  }, [firstSection?.id, refresh, openPageById]);
  const addMarkdownToSection = useCallback(async (document: ExternalDocument, sectionId: string) => {
    const page = await window.notes.files.linkMarkdown(sectionId, document.path);
    if (!page) return;
    setLinkDialog(undefined);
    await refresh();
    notify(`Added ${document.filename} to the notebook. Relative links stay connected.`, 'success');
  }, [refresh, notify]);
  const requestAddMarkdown = useCallback(async (document: ExternalDocument) => {
    if (firstSection) { setLinkDialog(document); return; }
    const notebook = await window.notes.notebooks.create('My Notes');
    const section = await window.notes.sections.create(notebook.id, 'Linked Markdown');
    await addMarkdownToSection(document, section.id);
  }, [firstSection, addMarkdownToSection]);
  useEffect(() => window.notes.events.onCommand((command) => {
    if (command === 'new-note') void createPage(); else if (command === 'open-markdown') void openMarkdown(); else if (command === 'open-markdown-folder') void chooseMarkdownFolder(); else if (command === 'import-markdown') void importMarkdown(); else if (command === 'quick-open') setSearchOpen(true); else if (command === 'backup-settings') setSettingsOpen(true); else window.dispatchEvent(new CustomEvent('notes-command', { detail: command }));
  }), [createPage, openMarkdown, chooseMarkdownFolder, importMarkdown]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (hasPrimaryModifier(event) && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); }
      if (hasPrimaryModifier(event) && event.key.toLowerCase() === 't') { event.preventDefault(); setWorkspaceMode((mode) => mode === 'tasks' ? 'documents' : 'tasks'); }
      if (hasPrimaryModifier(event) && event.key === ',') { event.preventDefault(); setSettingsOpen(true); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const closeTab = useCallback((key: string) => setTabs((before) => { const index = before.findIndex((tab) => tab.key === key); const next = before.filter((tab) => tab.key !== key); if (activeKey === key) setActiveKey(next[Math.max(0, index - 1)]?.key); return next; }), [activeKey]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (hasPrimaryModifier(event) && event.key === 'Tab' && tabs.length > 1) {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.key === activeKey);
        const direction = event.shiftKey ? -1 : 1;
        setActiveKey(tabs[(index + direction + tabs.length) % tabs.length].key);
      }
      if (hasPrimaryModifier(event) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setFocusMode((value) => !value); }
      if (event.key === 'Escape' && focusMode) setFocusMode(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [activeKey, focusMode, tabs]);
  const updateTabTitle = (key: string, title: string) => setTabs((before) => before.map((tab) => tab.key === key && tab.kind === 'internal' ? { ...tab, title } : tab));
  const updateExternalTab = (key: string, document: ExternalDocument) => {
    const nextKey = `file:${document.path.toLowerCase()}`;
    setTabs((before) => before.map((tab) => tab.key === key && tab.kind === 'external' ? { ...tab, key: nextKey, document } : tab));
    setActiveKey((current) => current === key ? nextKey : current);
  };
  const handlePageMenu = async (action: string) => {
    if (!menu) return; const page = menu.page; setMenu(undefined);
    if (action === 'favorite') await window.notes.pages.toggleFavorite(page.id);
    if (action === 'export') await window.notes.files.exportPage(page.id);
    if (action === 'trash') await window.notes.pages.trash(page.id);
    if (action === 'restore') await window.notes.pages.restore(page.id);
    if (action === 'remove' && window.confirm(`Permanently delete “${page.title}”? This cannot be undone.`)) await window.notes.pages.removePermanently(page.id);
    if (action === 'unlink' && window.confirm(`Remove “${page.title}” from this notebook? The Markdown file remains unchanged in its original folder.`)) await window.notes.pages.removePermanently(page.id);
    await refresh();
  };
  const closeDeletedPages = (pageIds: string[]) => {
    const removed = new Set(pageIds);
    setTabs((before) => {
      const next = before.filter((tab) => tab.kind === 'external' || !removed.has(tab.pageId)).map((tab): Tab => {
        if (tab.kind === 'external') return tab;
        const history = tab.history.filter((id) => !removed.has(id));
        return { ...tab, history, historyIndex: Math.max(0, history.indexOf(tab.pageId)) };
      });
      if (activeKey && !next.some((tab) => tab.key === activeKey)) setActiveKey(next.at(-1)?.key);
      return next;
    });
  };
  const emptyTrash = async () => {
    const count = navigation.trash.length;
    if (!count || !window.confirm(`Permanently delete all ${count} item${count === 1 ? '' : 's'} in Trash? This cannot be undone.`)) return;
    closeDeletedPages(await window.notes.pages.emptyTrash());
    await refresh();
  };
  const handleStructureMenu = async (action: 'add' | 'link' | 'rename' | 'delete') => {
    if (!structureMenu) return;
    const target = structureMenu;
    setStructureMenu(undefined);
    if (action === 'add') {
      if (target.kind === 'notebook') setCreateDialog({ kind: 'section', notebookId: target.item.id });
      else await createPage(target.item.id);
      return;
    }
    if (action === 'link' && target.kind === 'section') {
      const page = await window.notes.files.linkMarkdown(target.item.id);
      if (page) { await refresh(); await openPageById(page.id); notify(`Added ${page.title} to ${target.item.name}.`, 'success'); }
      return;
    }
    if (action === 'rename') {
      setRenameDialog({ kind: target.kind, id: target.item.id, name: target.item.name });
      return;
    }
    if (target.kind === 'notebook') {
      const pageCount = target.item.sections.reduce((total, section) => total + section.pages.length, 0);
      if (!window.confirm(`Delete notebook “${target.item.name}” and its ${target.item.sections.length} section${target.item.sections.length === 1 ? '' : 's'}${pageCount ? ` and ${pageCount} sidebar page${pageCount === 1 ? '' : 's'}` : ''}? Inline child pages are also deleted. This cannot be undone.`)) return;
      closeDeletedPages(await window.notes.notebooks.remove(target.item.id));
    } else {
      if (!window.confirm(`Delete section “${target.item.name}” and all pages inside it? Inline child pages are also deleted. This cannot be undone.`)) return;
      closeDeletedPages(await window.notes.sections.remove(target.item.id));
    }
    await refresh();
  };
  const linkedActivePage = active?.kind === 'external' ? navigation.notebooks.flatMap((notebook) => notebook.sections.flatMap((section) => section.pages)).find((page) => page.externalPath?.toLowerCase() === active.document.path.toLowerCase()) : undefined;
  const activePageId = active?.kind === 'internal' ? active.pageId : linkedActivePage?.id;
  const activeLocation = (() => {
    if (!activePageId) return undefined;
    for (const notebook of navigation.notebooks) for (const section of notebook.sections) if (section.pages.some((page) => page.id === activePageId)) return { notebookId: notebook.id, notebook: notebook.name, sectionId: section.id, section: section.name };
    return undefined;
  })();
  const revealSidebarItem = (id: string) => {
    setFocusMode(false); setSidebarOpen(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const sidebarVisible = sidebarOpen && !focusMode;
  const explorerVisible = markdownExplorerOpen && markdownFolder && !focusMode;
  const goHome = () => { setActiveKey(undefined); setWorkspaceMode('documents'); setSearchOpen(false); setTabsMenuOpen(false); };
  return <div className={`app ${focusMode ? 'focus-mode' : ''}`} onClick={() => { setMenu(undefined); setStructureMenu(undefined); setTabsMenuOpen(false); }}>
    {sidebarVisible && <Sidebar width={sidebarWidth} data={navigation} activePageId={activePageId} onOpen={(p) => void openPageById(p.id)} onSearch={() => setSearchOpen(true)} onCollapse={() => setSidebarOpen(false)} onNewNotebook={() => setCreateDialog({ kind: 'notebook' })} onNewSection={(notebookId) => setCreateDialog({ kind: 'section', notebookId })} onNewPage={(id) => void createPage(id)} onNotebookMenu={(item, x, y) => { setMenu(undefined); setStructureMenu({ kind: 'notebook', item, x, y }); }} onSectionMenu={(item, x, y) => { setMenu(undefined); setStructureMenu({ kind: 'section', item, x, y }); }} onPageMenu={(page, x, y) => { setStructureMenu(undefined); setMenu({ page, x, y }); }} onEmptyTrash={() => void emptyTrash()} onMoveNotebook={async (notebookId, position) => { await window.notes.notebooks.move(notebookId, position); await refresh(); }} onMoveSection={async (sectionId, notebookId, position) => { await window.notes.sections.move(sectionId, notebookId, position); await refresh(); }} onMovePage={async (pageId, sectionId, position) => { await window.notes.pages.move(pageId, sectionId, position); await refresh(); }} />}
    {sidebarVisible && <div className="panel-resizer sidebar-resizer" role="separator" aria-label="Resize notebook sidebar" aria-orientation="vertical" onPointerDown={(event) => startPanelResize(event, 'sidebar')} />}
    <section className="workspace">
      <header className="topbar">
        {!sidebarVisible && <button className="sidebar-toggle" onClick={() => focusMode ? setFocusMode(false) : setSidebarOpen(true)} title="Show sidebar" aria-label="Show sidebar"><ChevronsRight size={17} /></button>}
        <button className="home-button" onClick={goHome} title="Home" aria-label="Home"><Home size={17} /></button>
        <div className="history-buttons"><button disabled={!canGoBack} title="Previous page or tab" aria-label="Previous page or tab" onClick={() => void moveWorkspaceHistory(-1)}><ArrowLeft size={16} /></button><button disabled={!canGoForward} title="Next page or tab" aria-label="Next page or tab" onClick={() => void moveWorkspaceHistory(1)}><ArrowRight size={16} /></button></div>
        <div className="tabs">{externalTabs.map((tab) => <button key={tab.key} className={`tab ${workspaceMode === 'documents' && tab.key === activeKey ? 'active' : ''}`} title={tab.document.path} onClick={() => { setActiveKey(tab.key); setWorkspaceMode('documents'); }}><FileText className="tab-icon" size={13} /><span>{tab.document.filename}</span>{tab.document.isDirty && <b className="dirty-dot" title="Unsaved changes" />}<i onClick={(e) => { e.stopPropagation(); closeTab(tab.key); }}><X size={13} /></i></button>)}</div>
        {!!externalTabs.length && <button className={tabsMenuOpen ? 'active' : ''} title="All open Markdown files" aria-label="All open Markdown files" onClick={(event) => { event.stopPropagation(); setTabsMenuOpen((value) => !value); }}><List size={16} /></button>}
        <button className="new-note-button" title="New note" onClick={() => void createPage()}><Plus size={17} /><span>New</span></button>
        <button className={`tasks-button ${workspaceMode === 'tasks' ? 'active' : ''}`} title={`Toggle daily tasks (${shortcut('T')})`} onClick={() => setWorkspaceMode((mode) => mode === 'tasks' ? 'documents' : 'tasks')}><ClipboardList size={16} /><span>Tasks</span></button>
        <button className={markdownExplorerOpen && !focusMode ? 'active' : ''} title="Markdown folder explorer" onClick={toggleMarkdownExplorer}><FolderTree size={16} /></button>
        <button className={`quick-backup ${backupStatus?.folder ? 'configured' : ''}`} disabled={backupBusy} title={backupStatus?.folder ? `Back up now · Automatic backup ${backupStatus.frequency === 'hourly' ? 'every hour' : backupStatus.frequency}` : 'Configure backup'} onClick={() => void quickBackup()}>{backupBusy ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}<span>{backupBusy ? 'Backing up' : 'Backup'}</span></button>
        <button className={focusMode ? 'active' : ''} title={focusMode ? `Exit focus mode (${shortcut('Shift+F')})` : `Focus mode (${shortcut('Shift+F')})`} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button title="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon size={16} /></button>
      </header>
      {tabsMenuOpen && <div className="tabs-menu" onClick={(event) => event.stopPropagation()}><header><strong>Open Markdown files</strong><span>{externalTabs.length}</span></header>{externalTabs.map((tab) => <button key={`menu-${tab.key}`} className={workspaceMode === 'documents' && tab.key === activeKey ? 'active' : ''} onClick={() => { setActiveKey(tab.key); setWorkspaceMode('documents'); setTabsMenuOpen(false); }}><FileText size={14} /><span>{tab.document.filename}</span>{tab.document.isDirty && <b className="dirty-dot" />}</button>)}</div>}
      {workspaceMode === 'tasks' && <TaskWorkspace />}
      {workspaceMode === 'documents' && !active && <main className="home-dashboard">
        <section className="home-hero">
          <div className="hero-orb orb-one" /><div className="hero-orb orb-two" /><div className="hero-orb orb-three" />
          <BrandLogo className="hero-mark" /><h1>Welcome to Noteleaf</h1><p>A colorful, quiet place for your ideas, technical notes,<br />and Markdown documents.</p>
          <div className="hero-actions"><button className="primary" onClick={() => void createPage()}><FilePlus2 size={17} />New note</button><button onClick={() => void openMarkdown()}><FolderOpen size={17} />Open Markdown</button></div>
        </section>
        <section className="home-cards">
          <article className="home-card recent-card"><header><span><Clock3 size={16} /></span><div><strong>Recent notes</strong><small>Your recently opened pages</small></div></header><div className="recent-card-list">{navigation.recent.length ? navigation.recent.slice(0, 4).map((page) => <button key={`home-${page.id}`} onClick={() => void openPageById(page.id)}><FileText size={13} /><span>{page.title}</span><small>{page.lastOpenedAt ? relativeTime(page.lastOpenedAt) : ''}</small></button>) : <p>Your recent notes will appear here.</p>}</div><button className="card-link" onClick={() => setSearchOpen(true)}>View all notes <ArrowRight size={13} /></button></article>
          <article className="home-card tips-card"><header><span><Lightbulb size={16} /></span><div><strong>Writing tips</strong><small>Make the most of Noteleaf</small></div></header><ul><li>Type <kbd>/</kbd> for blocks and child pages.</li><li>Paste images, then drag their edges.</li><li>Use Markdown links to connect files.</li></ul><button className="card-link" onClick={() => setSearchOpen(true)}>Search your notes <ArrowRight size={13} /></button></article>
          <article className="home-card quick-card"><header><span><Rocket size={16} /></span><div><strong>Quick start</strong><small>Jump straight into your workspace</small></div></header><div className="quick-card-actions"><button onClick={() => void createPage()}><FilePlus2 size={14} />Create a new note</button><button onClick={() => void chooseMarkdownFolder()}><FolderTree size={14} />Open a Markdown folder</button><button onClick={() => void quickBackup()}><CloudUpload size={14} />Back up your notes</button></div></article>
          <article className="home-card shortcuts-card"><header><span><Keyboard size={16} /></span><div><strong>Shortcuts</strong><small>Move faster around Noteleaf</small></div></header><dl><div><dt>Search</dt><dd>{shortcut('F')}</dd></div><div><dt>Tasks / notes</dt><dd>{shortcut('T')}</dd></div><div><dt>Switch tabs</dt><dd>{shortcut('Tab')}</dd></div><div><dt>Focus mode</dt><dd>{shortcut('Shift+F')}</dd></div></dl></article>
        </section>
      </main>}
      {workspaceMode === 'documents' && active?.kind === 'internal' && <InternalDocument key={active.pageId} pageId={active.pageId} settings={settings} libraryRevision={libraryRevision} breadcrumb={activeLocation} onRevealBreadcrumb={revealSidebarItem} onTitle={(title) => updateTabTitle(active.key, title)} onSaved={refresh} onOpenPage={(pageId) => void navigateInActiveTab(pageId)} onStructureChange={() => void refresh()} />}
      {workspaceMode === 'documents' && active?.kind === 'external' && <ExternalDocumentView key={active.document.path} initial={active.document} linked={Boolean(linkedActivePage)} onDocumentChange={(doc) => updateExternalTab(active.key, doc)} onOpenLinkedDocument={(sourcePath, href) => void openLinkedMarkdown(sourcePath, href)} onLinkToNotebook={() => void requestAddMarkdown(active.document)} onRevealInNotebook={() => linkedActivePage && revealSidebarItem(linkedActivePage.id)} />}
    </section>
    {explorerVisible && <div className="panel-resizer explorer-resizer" role="separator" aria-label="Resize Markdown Explorer" aria-orientation="vertical" onPointerDown={(event) => startPanelResize(event, 'explorer')} />}
    {explorerVisible && <MarkdownFolderExplorer tree={markdownFolder} width={explorerWidth} activePath={active?.kind === 'external' ? active.document.path : undefined} onOpen={(path) => void openExplorerFile(path)} onChoose={() => void chooseMarkdownFolder()} onClose={() => setMarkdownExplorerOpen(false)} />}
    {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} onOpen={(id) => void openPageById(id)} />}
    {settingsOpen && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => { setSettingsOpen(false); void window.notes.backup.status().then(setBackupStatus); }} />}
    {createDialog?.kind === 'notebook' && <CreateDialog title="New notebook" label="Give this notebook a name. A first section and page will be created automatically." initialValue="New notebook" onCancel={() => setCreateDialog(undefined)} onCreate={async (name) => { const notebook = await window.notes.notebooks.create(name); const section = await window.notes.sections.create(notebook.id, 'Quick Notes'); const page = await window.notes.pages.create(section.id, 'Untitled'); setCreateDialog(undefined); await refresh(); await openPageById(page.id); }} />}
    {createDialog?.kind === 'section' && <CreateDialog title="New section" label="Add a section to this notebook. Its first page will open immediately." initialValue="New section" onCancel={() => setCreateDialog(undefined)} onCreate={async (name) => { const section = await window.notes.sections.create(createDialog.notebookId, name); const page = await window.notes.pages.create(section.id, 'Untitled'); setCreateDialog(undefined); await refresh(); await openPageById(page.id); }} />}
    {renameDialog && <CreateDialog title={`Rename ${renameDialog.kind}`} label={`Choose a new name for “${renameDialog.name}”.`} initialValue={renameDialog.name} submitLabel="Rename" busyLabel="Renaming…" onCancel={() => setRenameDialog(undefined)} onCreate={async (name) => { if (renameDialog.kind === 'notebook') await window.notes.notebooks.rename(renameDialog.id, name); else await window.notes.sections.rename(renameDialog.id, name); setRenameDialog(undefined); await refresh(); }} />}
    {linkDialog && <LinkMarkdownDialog document={linkDialog} navigation={navigation} onCancel={() => setLinkDialog(undefined)} onLink={(sectionId) => addMarkdownToSection(linkDialog, sectionId)} />}
    {menu && <div className="context-menu" style={{ left: Math.min(menu.x, innerWidth - 190), top: Math.min(menu.y, innerHeight - 190) }} onClick={(e) => e.stopPropagation()}>{menu.page.isDeleted ? <><button onClick={() => void handlePageMenu('restore')}>Restore</button><button className="danger" onClick={() => void handlePageMenu('remove')}>Delete permanently</button></> : menu.page.externalPath ? <><button onClick={() => void openPageById(menu.page.id)}>Open linked file</button><button onClick={() => void handlePageMenu('favorite')}>{menu.page.isFavorite ? 'Remove from favorites' : 'Add to favorites'}</button><hr /><button className="danger" onClick={() => void handlePageMenu('unlink')}>Remove from notebook</button></> : <><button onClick={() => void openPageById(menu.page.id)}>Open</button><button onClick={() => void handlePageMenu('favorite')}>{menu.page.isFavorite ? 'Remove from favorites' : 'Add to favorites'}</button><button onClick={() => void handlePageMenu('export')}>Export Markdown…</button><hr /><button className="danger" onClick={() => void handlePageMenu('trash')}>Move to Trash</button></>}</div>}
    {structureMenu && <div className="context-menu structure-menu" style={{ left: Math.min(structureMenu.x, innerWidth - 210), top: Math.min(structureMenu.y, innerHeight - 190) }} onClick={(event) => event.stopPropagation()}><div className="context-title">{structureMenu.item.name}</div><button onClick={() => void handleStructureMenu('add')}>{structureMenu.kind === 'notebook' ? 'Add section' : 'Add sidebar page'}</button>{structureMenu.kind === 'section' && <button onClick={() => void handleStructureMenu('link')}>Add Markdown file…</button>}<button onClick={() => void handleStructureMenu('rename')}>Rename {structureMenu.kind}…</button><hr /><button className="danger" onClick={() => void handleStructureMenu('delete')}>Delete {structureMenu.kind}</button></div>}
    {toast && <ToastNotice toast={toast} onClose={() => setToast(undefined)} />}
  </div>;
}
