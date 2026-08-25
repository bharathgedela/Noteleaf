import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Check, Copy } from 'lucide-react';
import { codeToHtml } from 'shiki';

function splitFrontmatter(source: string): { frontmatter?: string; body: string } {
  const match = /^(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n|$)/.exec(source);
  return match ? { frontmatter: match[1], body: source.slice(match[0].length) } : { body: source };
}

function linkifyCodeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest('a')) continue;
    const value = textNode.nodeValue || '';
    const matches = [...value.matchAll(/https?:\/\/[^\s<>"']+/gi)];
    if (!matches.length) continue;
    const fragment = parsed.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const index = match.index || 0;
      if (index > offset) fragment.append(value.slice(offset, index));
      const anchor = parsed.createElement('a');
      anchor.href = match[0];
      anchor.textContent = match[0];
      fragment.append(anchor);
      offset = index + match[0].length;
    }
    if (offset < value.length) fragment.append(value.slice(offset));
    textNode.replaceWith(fragment);
  }
  return parsed.body.innerHTML;
}

function CodeBlock({ code, language, dark }: { code: string; language: string; dark: boolean }) {
  const [html, setHtml] = useState('');
  const [copied, setCopied] = useState(false);
  const normalized = language || 'text';
  useEffect(() => {
    let live = true;
    codeToHtml(code.replace(/\n$/, ''), {
      lang: normalized,
      theme: dark ? 'github-dark-default' : 'github-light-default',
    }).catch(() => codeToHtml(code.replace(/\n$/, ''), { lang: 'text', theme: dark ? 'github-dark-default' : 'github-light-default' }))
      .then((value) => { if (live) setHtml(linkifyCodeHtml(value)); });
    return () => { live = false; };
  }, [code, normalized, dark]);
  const copy = async () => {
    await navigator.clipboard.writeText(code.replace(/\n$/, ''));
    setCopied(true); window.setTimeout(() => setCopied(false), 1400);
  };
  return <div className="code-block" onClick={(event) => {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) { event.preventDefault(); void window.notes.system.openExternal(href); }
  }}>
    <div className="code-header"><span>{normalized === 'text' ? 'Plain text' : normalized}</span><button onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button></div>
    {html ? <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} /> : <pre><code>{code}</code></pre>}
  </div>;
}

export function MarkdownPreview({ source, className = '', onOpenPage }: { source: string; className?: string; onOpenPage?: (pageId: string) => void }) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(source), [source]);
  const dark = document.documentElement.dataset.theme === 'dark';
  return <article className={`markdown-body ${className}`}>
    {frontmatter && <details className="frontmatter"><summary>Document metadata</summary><pre>{frontmatter}</pre></details>}
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className: codeClass, children }) => {
          const match = /language-([\w+-]+)/.exec(codeClass || '');
          const code = String(children);
          if (match || code.includes('\n')) return <CodeBlock code={code} language={match?.[1] || 'text'} dark={dark} />;
          return <code className="inline-code">{children}</code>;
        },
        a: ({ href = '', children }) => <a href={href} onClick={(event) => {
          event.preventDefault();
          const pageMatch = /^notes:\/\/page\/([\w-]+)$/i.exec(href);
          if (pageMatch && onOpenPage) onOpenPage(pageMatch[1]);
          else if (/^https?:\/\//i.test(href)) void window.notes.system.openExternal(href);
        }}>{children}</a>,
        img: ({ src = '', alt = '' }) => {
          const value = String(src);
          const widthMatch = /(?:#|&)notes-width=(\d{1,3})/i.exec(value);
          const width = Math.min(100, Math.max(20, Number(widthMatch?.[1]) || 100));
          const cleanSrc = value.replace(/([#&])notes-width=\d{1,3}/i, '').replace(/[?&]$/, '');
          return <img src={cleanSrc} alt={alt} data-width={width} style={{ width: `${width}%` }} />;
        },
      }}
    >{body}</ReactMarkdown>
  </article>;
}
