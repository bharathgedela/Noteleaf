import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { common, createLowlight } from 'lowlight';
import { AArrowDown, AArrowUp, Bold, CheckSquare, Code, FilePlus2, Heading1, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Palette, Quote, ShieldCheck, Table2, Type } from 'lucide-react';
import { ProtectedText } from './ProtectedText';

const lowlight = createLowlight(common);
const fontSizes = [12, 14, 16, 18, 20, 24, 28, 32];
const textColors = [
  { name: 'Default', value: '' },
  { name: 'Slate', value: '#475569' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Amber', value: '#ca8a04' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Teal', value: '#0d9488' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Pink', value: '#db2777' },
];

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

const StyledCodeBlock = CodeBlockLowlight.extend({
  marks: 'link textStyle protectedText',
}).configure({ lowlight, enableTabIndentation: true, tabSize: 2 });

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
  const [slashQuery, setSlashQuery] = useState('');
  const [slashSelected, setSlashSelected] = useState(0);
  const [pageTitleOpen, setPageTitleOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageCreating, setPageCreating] = useState(false);
  const [selectionActive, setSelectionActive] = useState(false);
  const [toolbarRevision, setToolbarRevision] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [protectedNotice, setProtectedNotice] = useState(false);
  const slashOpenRef = useRef(false);
  const slashQueryRef = useRef('');
  const slashSelectedRef = useRef(0);
  const runSelectedSlashRef = useRef<(() => void) | null>(null);
  const moveSlashSelectionRef = useRef<((direction: number) => void) | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pageTitleInput = useRef<HTMLInputElement>(null);
  const colorControl = useRef<HTMLDivElement>(null);
  const protectedNoticeTimer = useRef<number | null>(null);
  const showProtectedNotice = useCallback(() => {
    setProtectedNotice(true);
    if (protectedNoticeTimer.current !== null) window.clearTimeout(protectedNoticeTimer.current);
    protectedNoticeTimer.current = window.setTimeout(() => setProtectedNotice(false), 2600);
  }, []);
  const extensions = useMemo(() => [
    StarterKit.configure({ link: false, codeBlock: false }),
    StyledCodeBlock,
    Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'notes'] }),
    TextStyleKit.configure({ backgroundColor: false, fontFamily: false, lineHeight: false }),
    ProtectedText.configure({ onBlocked: showProtectedNotice }),
    ResizableImage.configure({ inline: false, allowBase64: false }), Placeholder.configure({ placeholder: "Write something, or type '/' for commands…" }),
    TaskList, TaskItem.configure({ nested: true }), Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
  ], [showProtectedNotice]);
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
        const href = anchor?.getAttribute('href') || '';
        const match = /^notes:\/\/page\/([\w-]+)$/i.exec(href);
        if (match) { event.preventDefault(); onOpenPage(match[1]); return true; }
        if (/^https?:\/\//i.test(href)) { event.preventDefault(); void window.notes.system.openExternal(href); return true; }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (!slashOpenRef.current) return false;
        if (event.key === 'Escape') { slashOpenRef.current = false; setSlashPosition(null); return true; }
        if (event.key === 'ArrowDown') { event.preventDefault(); moveSlashSelectionRef.current?.(1); return true; }
        if (event.key === 'ArrowUp') { event.preventDefault(); moveSlashSelectionRef.current?.(-1); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); runSelectedSlashRef.current?.(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const html = activeEditor.getHTML(); onChange(html, turndown.turndown(html));
      const { $from } = activeEditor.state.selection;
      const beforeCursor = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const slashMatch = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(beforeCursor);
      const open = $from.parent.type.name === 'paragraph' && Boolean(slashMatch);
      slashOpenRef.current = open;
      if (open) {
        const query = (slashMatch?.[1] || '').toLowerCase();
        if (query !== slashQueryRef.current) {
          slashQueryRef.current = query;
          slashSelectedRef.current = 0;
          setSlashQuery(query);
          setSlashSelected(0);
        }
        const coords = activeEditor.view.coordsAtPos(activeEditor.state.selection.from);
        setSlashPosition({ left: Math.max(12, Math.min(coords.left, window.innerWidth - 330)), top: Math.max(12, Math.min(coords.bottom + 7, window.innerHeight - 500)) });
      } else {
        slashQueryRef.current = '';
        slashSelectedRef.current = 0;
        setSlashPosition(null);
        setSlashQuery('');
        setSlashSelected(0);
      }
    },
  }, [pageId]);
  useEffect(() => { editor?.setOptions({ editorProps: { attributes: { class: 'prose-editor', spellcheck: String(spellcheck) } } }); }, [editor, spellcheck]);
  useEffect(() => () => {
    if (protectedNoticeTimer.current !== null) window.clearTimeout(protectedNoticeTimer.current);
  }, []);
  useEffect(() => {
    if (!editor) return;
    const updateToolbar = () => {
      const { from, to } = editor.state.selection;
      setSelectionActive(from !== to);
      setToolbarRevision((revision) => revision + 1);
    };
    updateToolbar();
    editor.on('selectionUpdate', updateToolbar);
    editor.on('transaction', updateToolbar);
    editor.on('focus', updateToolbar);
    editor.on('blur', updateToolbar);
    return () => {
      editor.off('selectionUpdate', updateToolbar);
      editor.off('transaction', updateToolbar);
      editor.off('focus', updateToolbar);
      editor.off('blur', updateToolbar);
    };
  }, [editor]);
  useEffect(() => {
    if (!colorOpen) return;
    const close = (event: PointerEvent) => {
      if (!colorControl.current?.contains(event.target as Node)) setColorOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setColorOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [colorOpen]);
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
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    const suggested = /^https?:\/\/\S+$/i.test(selectedText) ? selectedText : 'https://';
    const url = window.prompt('Link URL', previous || suggested);
    if (url === null) return;
    if (!url) editor.chain().focus().unsetLink().run(); else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const removeSlash = () => {
    const { from } = editor.state.selection;
    const { $from } = editor.state.selection;
    const beforeCursor = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
    const match = /\/[a-z0-9-]*$/i.exec(beforeCursor);
    if (match) editor.chain().focus().deleteRange({ from: from - match[0].length, to: from }).run();
    slashOpenRef.current = false;
    slashQueryRef.current = '';
    slashSelectedRef.current = 0;
    setSlashPosition(null);
    setSlashQuery('');
    setSlashSelected(0);
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
  const slashCommands = [
    { id: 'text', label: 'Text', detail: 'Plain paragraph', keywords: 'paragraph', icon: <Type size={16} />, run: () => runSlash(() => editor.chain().focus().setParagraph().run()) },
    { id: 'heading-1', label: 'Heading 1', detail: 'Large section heading', keywords: 'h1 title', icon: <Heading1 size={16} />, run: () => runSlash(() => editor.chain().focus().toggleHeading({ level: 1 }).run()) },
    { id: 'heading-2', label: 'Heading 2', detail: 'Medium section heading', keywords: 'h2 subtitle', icon: <Heading2 size={16} />, run: () => runSlash(() => editor.chain().focus().toggleHeading({ level: 2 }).run()) },
    { id: 'heading-3', label: 'Heading 3', detail: 'Small section heading', keywords: 'h3', icon: <Heading3 size={16} />, run: () => runSlash(() => editor.chain().focus().toggleHeading({ level: 3 }).run()) },
    { id: 'bullet-list', label: 'Bullet list', detail: 'Simple unordered list', keywords: 'bullets unordered ul', icon: <List size={16} />, run: () => runSlash(() => editor.chain().focus().toggleBulletList().run()) },
    { id: 'numbered-list', label: 'Numbered list', detail: 'Ordered steps', keywords: 'numbers ordered ol', icon: <ListOrdered size={16} />, run: () => runSlash(() => editor.chain().focus().toggleOrderedList().run()) },
    { id: 'checklist', label: 'Checklist', detail: 'Track work to do', keywords: 'todo task checkbox', icon: <CheckSquare size={16} />, run: () => runSlash(() => editor.chain().focus().toggleTaskList().run()) },
    { id: 'quote', label: 'Quote', detail: 'Emphasize a passage', keywords: 'blockquote', icon: <Quote size={16} />, run: () => runSlash(() => editor.chain().focus().toggleBlockquote().run()) },
    { id: 'code', label: 'Code', detail: 'Fenced code block', keywords: 'codeblock snippet', icon: <Code size={16} />, run: () => runSlash(() => editor.chain().focus().toggleCodeBlock().run()) },
    { id: 'divider', label: 'Divider', detail: 'Separate sections', keywords: 'line rule hr separator', icon: <Minus size={16} />, run: () => runSlash(() => editor.chain().focus().setHorizontalRule().run()) },
    { id: 'table', label: 'Table', detail: 'Three by three table', keywords: 'grid rows columns', icon: <Table2 size={16} />, run: () => runSlash(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()) },
    { id: 'image', label: 'Image', detail: 'Choose an image', keywords: 'photo picture upload', icon: <ImagePlus size={16} />, run: () => { removeSlash(); imageInput.current?.click(); } },
    { id: 'page', label: 'Page', detail: 'Create a named child page', keywords: 'new linked child', icon: <FilePlus2 size={16} />, run: openPageTitle },
  ];
  const filteredSlashCommands = slashCommands.filter((command) => {
    const search = `${command.id} ${command.label} ${command.keywords}`.toLowerCase();
    return !slashQuery || search.includes(slashQuery);
  });
  runSelectedSlashRef.current = () => filteredSlashCommands[slashSelectedRef.current]?.run();
  moveSlashSelectionRef.current = (direction) => {
    if (!filteredSlashCommands.length) return;
    const next = (slashSelectedRef.current + direction + filteredSlashCommands.length) % filteredSlashCommands.length;
    slashSelectedRef.current = next;
    setSlashSelected(next);
  };
  void toolbarRevision;
  const textStyle = editor.getAttributes('textStyle') as { color?: string; fontSize?: string };
  const parsedFontSize = Number.parseInt(textStyle.fontSize || '', 10);
  const currentFontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : 16;
  const protectedActive = editor.isActive('protectedText');
  const changeFontSize = (direction: -1 | 1) => {
    const currentIndex = fontSizes.reduce((closest, size, index) => Math.abs(size - currentFontSize) < Math.abs(fontSizes[closest] - currentFontSize) ? index : closest, 0);
    const nextIndex = Math.max(0, Math.min(fontSizes.length - 1, currentIndex + direction));
    editor.chain().focus().setFontSize(`${fontSizes[nextIndex]}px`).run();
  };
  const setTextColor = (color: string) => {
    const chain = editor.chain().focus();
    if (color) chain.setColor(color).run(); else chain.unsetColor().run();
    setColorOpen(false);
  };
  const action = (label: string, active: boolean, run: () => void, icon: React.ReactNode) => <button type="button" title={label} aria-label={label} className={active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); run(); }}>{icon}</button>;
  return <div className="editor-shell">
    <input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { addImage(event.target.files?.[0]); event.target.value = ''; }} />
    <div className={`format-bar${selectionActive || editor.isFocused || colorOpen ? ' is-active' : ''}`} aria-label="Text formatting">
      {action('Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />)}
      {action('Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />)}
      {action('Inline code', editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), <Code size={15} />)}
      {action('Link', editor.isActive('link'), setLink, <Link2 size={15} />)}
      <button
        type="button"
        title={selectionActive ? (protectedActive ? 'Unprotect selected text' : 'Protect selected text') : 'Select text to protect it'}
        aria-label={protectedActive ? 'Unprotect selected text' : 'Protect selected text'}
        className={protectedActive ? 'active protect-text-button' : 'protect-text-button'}
        disabled={!selectionActive}
        onMouseDown={(event) => {
          event.preventDefault();
          if (!selectionActive) return;
          if (protectedActive) editor.chain().focus().unprotectText().run();
          else editor.chain().focus().protectText().run();
        }}
      ><ShieldCheck size={15} /></button>
      <span />
      {action(`Decrease font size (currently ${currentFontSize}px)`, false, () => changeFontSize(-1), <AArrowDown size={15} />)}
      <button type="button" className="font-size-value" title="Reset font size" aria-label={`Reset font size, currently ${currentFontSize} pixels`} onMouseDown={(event) => { event.preventDefault(); editor.chain().focus().unsetFontSize().run(); }}>{currentFontSize}</button>
      {action(`Increase font size (currently ${currentFontSize}px)`, false, () => changeFontSize(1), <AArrowUp size={15} />)}
      <div className="color-control" ref={colorControl}>
        <button type="button" className={colorOpen ? 'active color-button' : 'color-button'} title="Text color" aria-label="Choose text color" aria-expanded={colorOpen} onMouseDown={(event) => { event.preventDefault(); setColorOpen((open) => !open); }}>
          <Palette size={15} /><i style={{ backgroundColor: textStyle.color || 'currentColor' }} />
        </button>
        {colorOpen && <div className="color-palette" role="menu" aria-label="Text colors">
          <strong>Text color</strong>
          <div>{textColors.map((color) => <button key={color.name} type="button" role="menuitem" title={color.name} aria-label={color.name} className={(textStyle.color || '') === color.value ? 'selected' : ''} onMouseDown={(event) => { event.preventDefault(); setTextColor(color.value); }}>
            {color.value ? <i style={{ backgroundColor: color.value }} /> : <i className="default-color">A</i>}
          </button>)}</div>
        </div>}
      </div>
      <span />
      {action('Heading 1', editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 size={15} />)}
      {action('Heading 2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={15} />)}
      {action('Bullet list', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List size={15} />)}
      {action('Numbered list', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={15} />)}
      {action('Quote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={15} />)}
    </div>
    {protectedNotice && <div className="protected-edit-notice" role="status" aria-live="polite"><ShieldCheck size={14} />Protected text cannot be changed. Select it and click the shield to unprotect it.</div>}
    {slashPosition && <div className="slash-menu" role="menu" aria-label="Insert block" style={slashPosition}>
      <div className="slash-title">{slashQuery ? `Commands matching /${slashQuery}` : 'Add a block or page'}<small>↑↓ navigate · Enter select</small></div>
      {filteredSlashCommands.map((command, index) => <button
        key={command.id}
        className={`${command.id === 'page' ? 'page-command ' : ''}${index === slashSelected ? 'selected' : ''}`}
        role="menuitem"
        aria-selected={index === slashSelected}
        onMouseEnter={() => { slashSelectedRef.current = index; setSlashSelected(index); }}
        onMouseDown={(event) => { event.preventDefault(); command.run(); }}
      >{command.icon}<span><b>{command.label}</b><small>{command.detail}</small></span></button>)}
      {!filteredSlashCommands.length && <div className="slash-empty">No command matches “/{slashQuery}”</div>}
    </div>}
    <EditorContent editor={editor} />
    {pageTitleOpen && <div className="modal-backdrop page-title-backdrop" onMouseDown={() => { if (!pageCreating) { setPageTitleOpen(false); editor.commands.focus(); } }}><form className="create-dialog page-title-dialog" role="dialog" aria-modal="true" onSubmit={(event) => void addLinkedPage(event)} onMouseDown={(event) => event.stopPropagation()}>
      <h2>Name this page</h2><p>The name becomes the page heading and the inline link text.</p>
      <input ref={pageTitleInput} autoFocus autoComplete="off" placeholder="Page heading" value={pageTitle} onChange={(event) => setPageTitle(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !pageCreating) { setPageTitleOpen(false); editor.commands.focus(); } }} />
      <div><button type="button" disabled={pageCreating} onClick={() => { setPageTitleOpen(false); editor.commands.focus(); }}>Cancel</button><button type="submit" className="primary" disabled={!pageTitle.trim() || pageCreating}>{pageCreating ? 'Creating…' : 'Create page'}</button></div>
    </form></div>}
  </div>;
}
