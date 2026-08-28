#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { MarkdownViewMode } from '../../shared/types.js';
import { NotesRepository } from '../database/repository.js';
import { createNoteleafMcpServer } from './server.js';
import type { McpFileAccess } from './data.js';

const MAX_MARKDOWN_BYTES = 20 * 1024 * 1024;

class LocalMarkdownAccess implements McpFileAccess {
  async openMarkdown(path: string): Promise<{ content: string; viewMode: MarkdownViewMode; modifiedAt: string } | null> {
    if (!['.md', '.markdown', '.mdown', '.mkd'].includes(extname(path).toLowerCase())) throw new Error('Linked file is not Markdown');
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_MARKDOWN_BYTES) throw new Error('Linked Markdown file is too large');
    return { content: await readFile(path, 'utf8'), viewMode: 'preview', modifiedAt: info.mtime.toISOString() };
  }

  async saveMarkdown(path: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('Linked Markdown file is too large');
    const temporary = join(dirname(path), `.${randomUUID()}.noteleaf.tmp`);
    const backup = join(dirname(path), `.${randomUUID()}.noteleaf.bak`);
    try {
      await writeFile(temporary, content, 'utf8');
      await copyFile(path, backup);
      await rename(temporary, path);
      await unlink(backup).catch(() => undefined);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      const exists = await stat(path).then(() => true).catch(() => false);
      if (!exists) await rename(backup, path).catch(() => undefined);
      throw error;
    }
  }
}

function dataDirectoryArgument(): string {
  const raw = process.argv.slice(2).find((argument) => argument.startsWith('--data-dir='))?.slice('--data-dir='.length);
  if (!raw) throw new Error('Noteleaf MCP requires --data-dir=<Noteleaf data folder>');
  if (!isAbsolute(raw)) throw new Error('Noteleaf MCP data directory must be absolute');
  return resolve(raw);
}

async function main(): Promise<void> {
  const dataDirectory = dataDirectoryArgument();
  await mkdir(dataDirectory, { recursive: true });
  const repository = new NotesRepository(join(dataDirectory, 'notes.db'));
  const settings = repository.getSettings();
  const server = createNoteleafMcpServer({ repository, files: new LocalMarkdownAccess(), allowWrites: settings.mcpAllowWrites });
  const transport = new StdioServerTransport();
  const close = async () => {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    repository.close();
  };
  process.once('SIGINT', () => { void close().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void close().finally(() => process.exit(0)); });
  await server.connect(transport);
  console.error(`Noteleaf MCP is connected over stdio (${settings.mcpAllowWrites ? 'read/write' : 'read-only'}).`);
}

main().catch((error) => {
  console.error('Noteleaf MCP could not start:', error);
  process.exitCode = 1;
});
