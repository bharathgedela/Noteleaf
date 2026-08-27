import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, MoreHorizontal, Plus, Search, Star, Trash2 } from 'lucide-react';
import type { NavigationData, NotebookTree, PageSummary, SectionTree } from '../../shared/types';

interface SidebarProps {
  data: NavigationData;
  width: number;
  activePageId?: string;
  onOpen: (page: PageSummary) => void;
  onNewNotebook: () => void;
  onNewSection: (notebookId: string) => void;
  onNewPage: (sectionId: string) => void;
  onNotebookMenu: (notebook: NotebookTree, x: number, y: number) => void;
  onSectionMenu: (section: SectionTree, x: number, y: number) => void;
  onSearch: () => void;
  onPageMenu: (page: PageSummary, x: number, y: number) => void;
  onEmptyTrash: () => void;
  onDropPage: (pageId: string, sectionId: string) => void;
}

function PageRow({ page, active, onOpen, onMenu }: { page: PageSummary; active: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  return <button className={`page-row ${active ? 'active' : ''}`} onClick={onOpen} onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }} draggable onDragStart={(e) => e.dataTransfer.setData('text/notes-page', page.id)}>
    <FileText size={14} /><span>{page.title}</span>{page.isFavorite && <Star size={12} fill="currentColor" />}
  </button>;
}

export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showTrash, setShowTrash] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const toggle = (id: string) => setCollapsed((before) => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const expand = (id: string) => setCollapsed((before) => { const next = new Set(before); next.delete(id); return next; });
  useEffect(() => {
    if (!props.activePageId) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.sidebar-scroll .page-row.active')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.activePageId]);
  return <aside className="sidebar" style={{ width: props.width, minWidth: props.width }}>
    <div className="brand"><span className="brand-mark">N</span><strong>Notes</strong><button title="New notebook" onClick={props.onNewNotebook}><Plus size={16} /></button></div>
    <button className="search-button" onClick={props.onSearch}><Search size={15} /><span>Search notes…</span><kbd>Ctrl P</kbd></button>
    <div className="sidebar-scroll">
      {props.data.favorites.length > 0 && <nav className="sidebar-group"><div className="group-label"><Star size={12} /> Favorites</div>{props.data.favorites.map((page) => <PageRow key={`fav-${page.id}`} page={page} active={props.activePageId === page.id} onOpen={() => props.onOpen(page)} onMenu={(x, y) => props.onPageMenu(page, x, y)} />)}</nav>}
      <nav className="tree" aria-label="Notebooks">
        {props.data.notebooks.map((notebook) => <div className="notebook" key={notebook.id}>
          <div className="notebook-row"><button className="disclosure" onClick={() => toggle(notebook.id)}>{collapsed.has(notebook.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><button className="notebook-name" data-nav-id={notebook.id} onClick={() => toggle(notebook.id)}>{notebook.name}</button><button className="row-action" title={`New section in ${notebook.name}`} aria-label={`New section in ${notebook.name}`} onClick={() => { expand(notebook.id); props.onNewSection(notebook.id); }}><Plus size={14} /></button><button className="row-action" title={`More options for ${notebook.name}`} aria-label={`More options for ${notebook.name}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); props.onNotebookMenu(notebook, box.right, box.bottom); }}><MoreHorizontal size={14} /></button></div>
          {!collapsed.has(notebook.id) && notebook.sections.map((section) => <div className="section" key={section.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const pageId = e.dataTransfer.getData('text/notes-page'); if (pageId) props.onDropPage(pageId, section.id); }}>
            <div className="section-row"><button className="disclosure" onClick={() => toggle(section.id)}>{collapsed.has(section.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button><button className="section-name" data-nav-id={section.id} onClick={() => toggle(section.id)}>{section.name}</button><button className="row-action" title={`New page in ${section.name}`} aria-label={`New page in ${section.name}`} onClick={() => { expand(section.id); props.onNewPage(section.id); }}><Plus size={13} /></button><button className="row-action" title={`More options for ${section.name}`} aria-label={`More options for ${section.name}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); props.onSectionMenu(section, box.right, box.bottom); }}><MoreHorizontal size={13} /></button></div>
            {!collapsed.has(section.id) && <div className="page-list">{section.pages.map((page) => <PageRow key={page.id} page={page} active={props.activePageId === page.id} onOpen={() => props.onOpen(page)} onMenu={(x, y) => props.onPageMenu(page, x, y)} />)}</div>}
          </div>)}
        </div>)}
      </nav>
      <div className="sidebar-spacer" />
      {props.data.recent.length > 0 && <nav className={`sidebar-group recent ${recentCollapsed ? 'collapsed' : ''}`}><button className="group-label collapsible" onClick={() => setRecentCollapsed((value) => !value)}>{recentCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>Recent</span><b>{props.data.recent.length}</b></button>{!recentCollapsed && props.data.recent.slice(0, 4).map((page) => <PageRow key={`recent-${page.id}`} page={page} active={props.activePageId === page.id} onOpen={() => props.onOpen(page)} onMenu={(x, y) => props.onPageMenu(page, x, y)} />)}</nav>}
    </div>
    <button className="trash-button" onClick={() => setShowTrash(!showTrash)}><Trash2 size={14} /><span>Trash</span>{props.data.trash.length > 0 && <b>{props.data.trash.length}</b>}</button>
    {showTrash && props.data.trash.length > 0 && <div className="trash-popover"><div className="trash-actions"><span>{props.data.trash.length} item{props.data.trash.length === 1 ? '' : 's'}</span><button className="empty-trash" onClick={props.onEmptyTrash}>Empty Trash</button></div>{props.data.trash.map((page) => <button key={page.id} onContextMenu={(e) => { e.preventDefault(); props.onPageMenu(page, e.clientX, e.clientY); }}><FileText size={13} />{page.title}<MoreHorizontal size={13} /></button>)}</div>}
  </aside>;
}
