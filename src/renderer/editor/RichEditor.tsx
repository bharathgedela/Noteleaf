import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Bold, CheckSquare, Code, FilePlus2, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote, Table2, Type } from 'lucide-react';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.use(gfm);
turndown.addRule('resizable-image', {
  filter: (node) => node.nodeName === 'IMG',
  replacement: (_content, node) => {
    const image = node as HTMLElement;
    const src = image.getAttribute('src') || '';
    const alt = (image.getAttribute('alt') || '').replaceAll('[', '\\[').replaceAll(']', '\\]');
    const width = Math.min(100, Math.max(20, Number(image.getAttribute('data-width')) || 100));
    return `![${alt}](${src}${src.includes('#') ? '&' : '#'}notes-width=${width})`;
  },
});

function ResizableImageView({ node, selected, editor, getPos, updateAttributes }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const widthPercent = Math.min(100, Math.max(20, Number(node.attrs.widthPercent) || 100));

  useEffect(() => () => cleanupRef.current?.(), []);

  const selectImage = () => {
    const position = getPos();
    if (typeof position === 'number') editor.commands.setNodeSelection(position);
  };

  const startResize = (event: React.PointerEvent, edge: 'left' | 'right') => {
    event.preventDefault();
    event.stopPropagation();
    selectImage();
    cleanupRef.current?.();

    const wrapper = wrapperRef.current;
    const editorElement = wrapper?.closest('.ProseMirror');
    if (!wrapper || !editorElement) return;
    const startX = event.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    const editorWidth = editorElement.getBoundingClientRect().width;
    if (!editorWidth) return;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * (edge === 'right' ? 1 : -1);
      const nextWidth = Math.min(100, Math.max(20, Math.round(((startWidth + delta) / editorWidth) * 100)));
      updateAttributes({ widthPercent: nextWidth });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      document.body.classList.remove('image-resizing');
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    document.body.classList.add('image-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  return <NodeViewWrapper
    ref={wrapperRef}
    className={`resizable-image-node${selected ? ' is-selected' : ''}`}
    style={{ width: `${widthPercent}%` }}
    data-width={widthPercent}
    contentEditable={false}
  >
    <img src={node.attrs.src} alt={node.attrs.alt || ''} title={node.attrs.title || undefined} draggable={false} onPointerDown={selectImage} />
    {selected && <div className="image-resize-frame" aria-label="Drag the image edges to resize">
      <span className="image-resize-handle top-left" onPointerDown={(event) => startResize(event, 'left')} />
      <span className="image-resize-handle middle-left" onPointerDown={(event) => startResize(event, 'left')} />
      <span className="image-resize-handle bottom-left" onPointerDown={(event) => startResize(event, 'left')} />
      <span className="image-resize-handle top-right" onPointerDown={(event) => startResize(event, 'right')} />
      <span className="image-resize-handle middle-right" onPointerDown={(event) => startResize(event, 'right')} />
      <span className="image-resize-handle bottom-right" onPointerDown={(event) => startResize(event, 'right')} />
    </div>}
  </NodeViewWrapper>;
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPercent: {
        default: 100,
        parseHTML: (element) => Math.min(100, Math.max(20, Number(element.getAttribute('data-width')) || 100)),
        renderHTML: (attributes) => {
          const width = Math.min(100, Math.max(20, Number(attributes.widthPercent) || 100));
          return { 'data-width': String(width), style: `width: ${width}%` };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

interface RichEditorProps {
  pageId: string;
  initialHtml: string;
  spellcheck: boolean;
  onChange: (html: string, markdown: string) => void;
  onCreateLinkedPage: (title: string) => Promise<{ id: string; title: string }>;
  onOpenPage: (pageId: string) => void;
}

export function RichEditor({ pageId, initialHtml, spellcheck, onChange, onCreateLinkedPage, onOpenPage }: RichEditorProps) {
  const [slashPosition, setSlashPosition] = useState<{ left: number; top: number } | null>(null);
  const [pageTitleOpen, setPageTitleOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageCreating, setPageCreating] = useState(false);
  const slashOpenRef = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const pageTitleInput = useRef<HTMLInputElement>(null);
  const extensions = useMemo(() => [
    StarterKit.configure({ link: false }),
    Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'notes'] }),
    ResizableImage.configure({ inline: false, allowBase64: false }), Placeholder.configure({ placeholder: "Write something, or type '/' for commands…" }),
    TaskList, TaskItem.configure({ nested: true }), Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
  ], []);
  const editor = useEditor({
    extensions, content: initialHtml || '<p></p>',
    editorProps: {
      attributes: { class: 'prose-editor', spellcheck: String(spellcheck) },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith('image/'));
        if (!file) return false;
        const reader = new FileReader();
        reader.onload = async () => {
          const src = await window.notes.files.saveAttachment(pageId, String(reader.result));
          editor?.chain().focus().setImage({ src, alt: file.name || 'Pasted image' }).run();
        };
        reader.readAsDataURL(file); return true;
      },
      handleDrop: (_view, event) => {
        const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith('image/'));
        if (!file) return false;
        const reader = new FileReader();
        reader.onload = async () => {
          const src = await window.notes.files.saveAttachment(pageId, String(reader.result));
          editor?.chain().focus().setImage({ src, alt: file.name }).run();
        };
        reader.readAsDataURL(file); return true;
      },
      handleClick: (_view, _position, event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const match = /^notes:\/\/page\/([\w-]+)$/i.exec(anchor?.getAttribute('href') || '');
        if (!match) return false;
        event.preventDefault(); onOpenPage(match[1]); return true;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && slashOpenRef.current) { slashOpenRef.current = false; setSlashPosition(null); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const html = activeEditor.getHTML(); onChange(html, turndown.turndown(html));
      const { $from } = activeEditor.state.selection;
      const open = $from.parent.type.name === 'paragraph' && $from.parent.textContent.endsWith('/');
      slashOpenRef.current = open;
      if (open) {
        const coords = activeEditor.view.coordsAtPos(activeEditor.state.selection.from);
        setSlashPosition({ left: Math.max(12, Math.min(coords.left, window.innerWidth - 330)), top: Math.max(12, Math.min(coords.bottom + 7, window.innerHeight - 500)) });
      } else setSlashPosition(null);
    },
  }, [pageId]);
  useEffect(() => { editor?.setOptions({ editorProps: { attributes: { class: 'prose-editor', spellcheck: String(spellcheck) } } }); }, [editor, spellcheck]);
  useEffect(() => {
    if (!pageTitleOpen) return;
    const input = pageTitleInput.current;
    if (!input) return;
    const focus = () => input.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(focus);
    const timer = window.setTimeout(() => { if (document.activeElement !== input) focus(); }, 100);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [pageTitleOpen]);
  if (!editor) return null;
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous || 'https://');
    if (url === null) return;
    if (!url) editor.chain().focus().unsetLink().run(); else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const removeSlash = () => {
    const { from } = editor.state.selection;
    if (from > 0 && editor.state.doc.textBetween(from - 1, from) === '/') editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();
    slashOpenRef.current = false; setSlashPosition(null);
  };
  const runSlash = (command: () => void) => { removeSlash(); command(); };
  const openPageTitle = () => {
    removeSlash();
    setPageTitle('');
    setPageTitleOpen(true);
  };
  const addLinkedPage = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = pageTitle.trim();
    if (!title || pageCreating) return;
    setPageCreating(true);
    try {
      const created = await onCreateLinkedPage(title);
      setPageTitleOpen(false);
      editor.chain().focus().insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: created.title, marks: [{ type: 'link', attrs: { href: `notes://page/${created.id}` } }] }],
      }).run();
    } finally { setPageCreating(false); }
  };
  const addImage = (file?: File) => {
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const src = await window.notes.files.saveAttachment(pageId, String(reader.result));
      editor.chain().focus().setImage({ src, alt: file.name }).run();
    };
    reader.readAsDataURL(file);
  };
  const action = (label: string, active: boolean, run: () => void, icon: React.ReactNode) => <button type="button" title={label} aria-label={label} className={active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); run(); }}>{icon}</button>;
  return <div className="editor-shell">
    <input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { addImage(event.target.files?.[0]); event.target.value = ''; }} />
    <div className="format-bar" aria-label="Text formatting">
      {action('Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />)}
      {action('Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />)}
      {action('Inline code', editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), <Code size={15} />)}
      {action('Link', editor.isActive('link'), setLink, <Link2 size={15} />)}
      <span />
      {action('Heading 1', editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 size={15} />)}
      {action('Heading 2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={15} />)}
      {action('Bullet list', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List size={15} />)}
      {action('Numbered list', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={15} />)}
      {action('Quote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={15} />)}
    </div>
    {slashPosition && <div className="slash-menu" role="menu" aria-label="Insert block" style={slashPosition}>
      <div className="slash-title">Add a block or page</div>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().setParagraph().run()); }}><Type size={16} /><span><b>Text</b><small>Plain paragraph</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleHeading({ level: 1 }).run()); }}><Heading1 size={16} /><span><b>Heading 1</b><small>Large section heading</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleHeading({ level: 2 }).run()); }}><Heading2 size={16} /><span><b>Heading 2</b><small>Medium section heading</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleHeading({ level: 3 }).run()); }}><Heading3 size={16} /><span><b>Heading 3</b><small>Small section heading</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleBulletList().run()); }}><List size={16} /><span><b>Bullet list</b><small>Simple unordered list</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleOrderedList().run()); }}><ListOrdered size={16} /><span><b>Numbered list</b><small>Ordered steps</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleTaskList().run()); }}><CheckSquare size={16} /><span><b>Checklist</b><small>Track work to do</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleBlockquote().run()); }}><Quote size={16} /><span><b>Quote</b><small>Emphasize a passage</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().toggleCodeBlock().run()); }}><Code size={16} /><span><b>Code</b><small>Fenced code block</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().setHorizontalRule().run()); }}><Minus size={16} /><span><b>Divider</b><small>Separate sections</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); runSlash(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()); }}><Table2 size={16} /><span><b>Table</b><small>Three by three table</small></span></button>
      <button onMouseDown={(e) => { e.preventDefault(); removeSlash(); imageInput.current?.click(); }}><ImagePlus size={16} /><span><b>Image</b><small>Choose an image</small></span></button>
      <button className="page-command" onMouseDown={(e) => { e.preventDefault(); openPageTitle(); }}><FilePlus2 size={16} /><span><b>Page</b><small>Create a named child page</small></span></button>
    </div>}
    <EditorContent editor={editor} />
    {pageTitleOpen && <div className="modal-backdrop page-title-backdrop" onMouseDown={() => { if (!pageCreating) { setPageTitleOpen(false); editor.commands.focus(); } }}><form className="create-dialog page-title-dialog" role="dialog" aria-modal="true" onSubmit={(event) => void addLinkedPage(event)} onMouseDown={(event) => event.stopPropagation()}>
      <h2>Name this page</h2><p>The name becomes the page heading and the inline link text.</p>
      <input ref={pageTitleInput} autoFocus autoComplete="off" placeholder="Page heading" value={pageTitle} onChange={(event) => setPageTitle(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !pageCreating) { setPageTitleOpen(false); editor.commands.focus(); } }} />
      <div><button type="button" disabled={pageCreating} onClick={() => { setPageTitleOpen(false); editor.commands.focus(); }}>Cancel</button><button type="submit" className="primary" disabled={!pageTitle.trim() || pageCreating}>{pageCreating ? 'Creating…' : 'Create page'}</button></div>
    </form></div>}
  </div>;
}
