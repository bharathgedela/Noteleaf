import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

export function resolveMarkdownLink(sourcePath: string, rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href || href.startsWith('#')) return null;

  let linkedPath: string;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      const url = new URL(href);
      if (url.protocol !== 'file:') return null;
      linkedPath = fileURLToPath(url);
    } else {
      linkedPath = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    }
  } catch {
    return null;
  }

  if (!MARKDOWN_EXTENSIONS.has(extname(linkedPath).toLowerCase())) return null;
  return resolve(isAbsolute(linkedPath) ? linkedPath : resolve(dirname(sourcePath), linkedPath));
}
