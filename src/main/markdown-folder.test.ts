import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { scanMarkdownFolder } from './markdown-folder.js';

describe('scanMarkdownFolder', () => {
  let root: string;

  beforeEach(async () => {
    root = join(process.cwd(), `.test-markdown-folder-${randomUUID()}`);
    await mkdir(join(root, 'architecture', 'nested'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true });
    await writeFile(join(root, 'README.md'), '# Root');
    await writeFile(join(root, 'architecture', 'AWS Platform.markdown'), '# AWS');
    await writeFile(join(root, 'architecture', 'nested', 'Hashing.mkd'), '# Hashing');
    await writeFile(join(root, 'architecture', 'diagram.png'), 'not markdown');
    await writeFile(join(root, 'node_modules', 'ignored', 'package.md'), 'ignored');
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('builds a nested tree containing only Markdown documents', async () => {
    const tree = await scanMarkdownFolder(root);
    expect(tree.fileCount).toBe(3);
    expect(tree.truncated).toBe(false);
    expect(tree.children.map((entry) => entry.name)).toEqual(['architecture', 'README.md']);
    expect(JSON.stringify(tree)).toContain('Hashing.mkd');
    expect(JSON.stringify(tree)).not.toContain('diagram.png');
    expect(JSON.stringify(tree)).not.toContain('node_modules');
  });

  it('reports when the file limit truncates a folder', async () => {
    const tree = await scanMarkdownFolder(root, 2);
    expect(tree.fileCount).toBe(2);
    expect(tree.truncated).toBe(true);
  });
});
