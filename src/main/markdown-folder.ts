import { readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { MarkdownFolderEntry, MarkdownFolderTree } from '../shared/types.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', 'dist', 'release', 'coverage']);

export async function scanMarkdownFolder(folderPath: string, maximumFiles = 5000): Promise<MarkdownFolderTree> {
  const root = resolve(folderPath);
  let fileCount = 0;
  let truncated = false;

  const scan = async (directory: string, depth: number): Promise<MarkdownFolderEntry[]> => {
    if (depth > 30 || fileCount >= maximumFiles) { truncated = true; return []; }
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
    });
    const children: MarkdownFolderEntry[] = [];
    for (const entry of entries) {
      if (fileCount >= maximumFiles) { truncated = true; break; }
      if (entry.isDirectory()) {
        if (SKIPPED_FOLDERS.has(entry.name)) continue;
        const path = join(directory, entry.name);
        const nested = await scan(path, depth + 1);
        if (nested.length) children.push({ kind: 'folder', name: entry.name, path, children: nested });
      } else if (entry.isFile() && MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        children.push({ kind: 'file', name: entry.name, path: join(directory, entry.name) });
        fileCount += 1;
      }
    }
    return children;
  };

  return { name: basename(root) || root, path: root, children: await scan(root, 0), fileCount, truncated };
}
