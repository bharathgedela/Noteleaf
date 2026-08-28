import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, GripVertical, MoreHorizontal, Plus, Search, Star, Trash2 } from 'lucide-react';
import type { NavigationData, NotebookTree, PageSummary, SectionTree } from '../../shared/types';
import { BrandLogo } from '../components/BrandLogo';
import { shortcut } from '../platform';

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
  onMoveNotebook: (notebookId: string, position: number) => void;
  onMoveSection: (sectionId: string, notebookId: string, position: number) => void;
  onMovePage: (pageId: string, sectionId: string, position: number) => void;
}

type DropIndicator = { kind: 'notebook' | 'section' | 'page'; id: string; edge: 'before' | 'after' | 'inside' };

const NOTEBOOK_COLORS = ['#087f5b', '#2563eb', '#7c3aed', '#d97706', '#0891b2', '#db2777', '#16a34a', '#dc5a34'];

function notebookStyle(id: string): CSSProperties {
  const hash = [...id].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 7);
  return { '--notebook-color': NOTEBOOK_COLORS[hash % NOTEBOOK_COLORS.length] } as CSSProperties;
}

function edgeFor(event: React.DragEvent): 'before' | 'after' { const bounds = event.currentTarget.getBoundingClientRect(); return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'; }
function insertionPosition(ids: string[], sourceId: string, targetIndex: number, edge: 'before' | 'after'): number {
  let position = targetIndex + (edge === 'after' ? 1 : 0);
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex >= 0 && sourceIndex < position) position -= 1;
  return Math.max(0, position);
}

function PageRow({ page, active, onOpen, onMenu, siblings, index, drop, onDropChange, onMove }: { page: PageSummary; active: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void; siblings?: PageSummary[]; index?: number; drop?: DropIndicator; onDropChange?: (drop?: DropIndicator) => void; onMove?: (pageId: string, sectionId: string, position: number) => void }) {
  const edge = drop?.kind === 'page' && drop.id === page.id ? drop.edge : undefined;
  return <button className={`page-row ${active ? 'active' : ''} ${edge ? `drop-${edge}` : ''}`} onClick={onOpen} onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }} onDragOver={(event) => { if (!siblings || !event.dataTransfer.types.includes('text/notes-page')) return; event.preventDefault(); event.stopPropagation(); onDropChange?.({ kind: 'page', id: page.id, edge: edgeFor(event) }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropChange?.(); }} onDrop={(event) => { const pageId = event.dataTransfer.getData('text/notes-page'); if (!pageId || !siblings || index === undefined) return; event.preventDefault(); event.stopPropagation(); const targetEdge = edgeFor(event); onDropChange?.(); onMove?.(pageId, page.sectionId, insertionPosition(siblings.map((item) => item.id), pageId, index, targetEdge)); }}>
    <span className="drag-handle" draggable title="Drag to reorder" onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/notes-page', page.id); }} onDragEnd={() => onDropChange?.()}><GripVertical size={12} /></span><FileText size={14} /><span>{page.title}</span>{page.isFavorite && <Star size={12} fill="currentColor" />}
  </button>;
}

export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showTrash, setShowTrash] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(true);
  const [drop, setDrop] = useState<DropIndicator>();
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
    <div className="brand"><BrandLogo className="brand-mark" /><strong>Noteleaf</strong><button title="New notebook" onClick={props.onNewNotebook}><Plus size={16} /></button></div>
    <button className="search-button" onClick={props.onSearch}><Search size={15} /><span>Search notes…</span><kbd>{shortcut('F')}</kbd></button>
    <div className="sidebar-scroll">
      {props.data.favorites.length > 0 && <nav className="sidebar-group"><div className="group-label"><Star size={12} /> Favorites</div>{props.data.favorites.map((page) => <PageRow key={`fav-${page.id}`} page={page} active={props.activePageId === page.id} onOpen={() => props.onOpen(page)} onMenu={(x, y) => props.onPageMenu(page, x, y)} />)}</nav>}
      <nav className="tree" aria-label="Notebooks">
        {props.data.notebooks.map((notebook, notebookIndex) => {
          const notebookDrop = drop?.kind === 'notebook' && drop.id === notebook.id ? drop.edge : undefined;
          return <div className={`notebook ${notebookDrop ? `drop-${notebookDrop}` : ''}`} key={notebook.id} style={notebookStyle(notebook.id)}>
            <div className="notebook-row" onDragOver={(event) => { const notebookDrag = event.dataTransfer.types.includes('text/notes-notebook'); const sectionDrag = event.dataTransfer.types.includes('text/notes-section'); if (!notebookDrag && !sectionDrag) return; event.preventDefault(); event.stopPropagation(); setDrop({ kind: 'notebook', id: notebook.id, edge: notebookDrag ? edgeFor(event) : 'inside' }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(undefined); }} onDrop={(event) => { const notebookId = event.dataTransfer.getData('text/notes-notebook'); const sectionId = event.dataTransfer.getData('text/notes-section'); if (!notebookId && !sectionId) return; event.preventDefault(); event.stopPropagation(); if (notebookId) props.onMoveNotebook(notebookId, insertionPosition(props.data.notebooks.map((item) => item.id), notebookId, notebookIndex, edgeFor(event))); else props.onMoveSection(sectionId, notebook.id, notebook.sections.length); setDrop(undefined); }}>
              <span className="drag-handle" draggable title="Drag notebook to reorder" onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/notes-notebook', notebook.id); }} onDragEnd={() => setDrop(undefined)}><GripVertical size={12} /></span><button className="disclosure" onClick={() => toggle(notebook.id)}>{collapsed.has(notebook.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><button className="notebook-name" data-nav-id={notebook.id} onClick={() => toggle(notebook.id)}>{notebook.name}</button><button className="row-action" title={`New section in ${notebook.name}`} aria-label={`New section in ${notebook.name}`} onClick={() => { expand(notebook.id); props.onNewSection(notebook.id); }}><Plus size={14} /></button><button className="row-action" title={`More options for ${notebook.name}`} aria-label={`More options for ${notebook.name}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); props.onNotebookMenu(notebook, box.right, box.bottom); }}><MoreHorizontal size={14} /></button>
            </div>
            {!collapsed.has(notebook.id) && notebook.sections.map((section, sectionIndex) => {
              const sectionDrop = drop?.kind === 'section' && drop.id === section.id ? drop.edge : undefined;
              return <div className={`section ${sectionDrop ? `drop-${sectionDrop}` : ''}`} key={section.id}>
                <div className="section-row" onDragOver={(event) => { const sectionDrag = event.dataTransfer.types.includes('text/notes-section'); const pageDrag = event.dataTransfer.types.includes('text/notes-page'); if (!sectionDrag && !pageDrag) return; event.preventDefault(); event.stopPropagation(); setDrop({ kind: 'section', id: section.id, edge: sectionDrag ? edgeFor(event) : 'inside' }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(undefined); }} onDrop={(event) => { const sectionId = event.dataTransfer.getData('text/notes-section'); const pageId = event.dataTransfer.getData('text/notes-page'); if (!sectionId && !pageId) return; event.preventDefault(); event.stopPropagation(); if (sectionId) props.onMoveSection(sectionId, notebook.id, insertionPosition(notebook.sections.map((item) => item.id), sectionId, sectionIndex, edgeFor(event))); else props.onMovePage(pageId, section.id, 0); setDrop(undefined); }}>
                  <span className="drag-handle" draggable title="Drag section to reorder" onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/notes-section', section.id); }} onDragEnd={() => setDrop(undefined)}><GripVertical size={11} /></span><button className="disclosure" onClick={() => toggle(section.id)}>{collapsed.has(section.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button><button className="section-name" data-nav-id={section.id} onClick={() => toggle(section.id)}><Folder size={13} /><span>{section.name}</span></button><button className="row-action" title={`New page in ${section.name}`} aria-label={`New page in ${section.name}`} onClick={() => { expand(section.id); props.onNewPage(section.id); }}><Plus size={13} /></button><button className="row-action" title={`More options for ${section.name}`} aria-label={`More options for ${section.name}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); props.onSectionMenu(section, box.right, box.bottom); }}><MoreHorizontal size={13} /></button>
                </div>
                {!collapsed.has(section.id) && <div className="page-list" onDragOver={(event) => { if (!event.dataTransfer.types.includes('text/notes-page')) return; event.preventDefault(); event.stopPropagation(); setDrop({ kind: 'section', id: section.id, edge: 'inside' }); }} onDrop={(event) => { const pageId = event.dataTransfer.getData('text/notes-page'); if (!pageId) return; event.preventDefault(); event.stopPropagation(); props.onMovePage(pageId, section.id, section.pages.length); setDrop(undefined); }}>{section.pages.map((page, pageIndex) => <PageRow key={page.id} page={page} siblings={section.pages} index={pageIndex} drop={drop} onDropChange={setDrop} onMove={props.onMovePage} active={props.activePageId === page.id} onOpen={() => props.onOpen(page)} onMenu={(x, y) => props.onPageMenu(page, x, y)} />)}</div>}
              </div>;
            })}
          </div>;
        })}
      </nav>
      <div className="sidebar-spacer" />
      {props.data.recent.length > 0 && <nav className={`sidebar-group recent ${recentCollapsed ? 'collapsed' : ''}`}><button className="group-label collapsible" onClick={() => setRecentCollapsed((value) => !value)}>{recentCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>Recent</span><b>{props.data.recent.length}</b></button>{!recentCollapsed && props.data.recent.slice(0, 4).map((page) => <PageRow key={`recent-${page.id}`} page={page} active={props.activePageId === page.id} onOpen={() => props.onOpen(page)} onMenu={(x, y) => props.onPageMenu(page, x, y)} />)}</nav>}
    </div>
    <button className="trash-button" onClick={() => setShowTrash(!showTrash)}><Trash2 size={14} /><span>Trash</span>{props.data.trash.length > 0 && <b>{props.data.trash.length}</b>}</button>
    {showTrash && props.data.trash.length > 0 && <div className="trash-popover"><div className="trash-actions"><span>{props.data.trash.length} item{props.data.trash.length === 1 ? '' : 's'}</span><button className="empty-trash" onClick={props.onEmptyTrash}>Empty Trash</button></div>{props.data.trash.map((page) => <button key={page.id} onContextMenu={(e) => { e.preventDefault(); props.onPageMenu(page, e.clientX, e.clientY); }}><FileText size={13} />{page.title}<MoreHorizontal size={13} /></button>)}</div>}
  </aside>;
}
