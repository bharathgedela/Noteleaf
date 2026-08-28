import { dialog, shell } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { ExternalDocument, MarkdownViewMode, Page } from '../shared/types.js';
import type { NotesRepository } from './database/repository.js';
import { resolveMarkdownLink } from './markdown-links.js';
import { scanMarkdownFolder } from './markdown-folder.js';

const MAX_MARKDOWN_BYTES = 20 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

export class FileService {
  constructor(
    private readonly repository: NotesRepository,
    private readonly dataDirectory: string,
  ) {}

  async openMarkdown(path?: string): Promise<ExternalDocument | null> {
    let selected = path;
    if (!selected) {
      const result = await dialog.showOpenDialog({
        title: 'Open Markdown File',
        properties: ['openFile'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      selected = result.canceled ? undefined : result.filePaths[0];
    }
    if (!selected) return null;
    if (!['.md', '.markdown', '.mdown', '.mkd'].includes(extname(selected).toLowerCase())) throw new Error('Only Markdown files can be opened');
    const info = await stat(selected);
    if (!info.isFile() || info.size > MAX_MARKDOWN_BYTES) throw new Error('Markdown file is too large');
    const content = await readFile(selected, 'utf8');
    const previous = this.repository.recentFiles().find((item) => item.path.toLowerCase() === selected!.toLowerCase());
    const viewMode = previous?.viewMode ?? this.repository.getSettings().defaultMarkdownMode;
    this.repository.rememberFile(selected, basename(selected), viewMode);
    return {
      kind: 'external', path: selected, filename: basename(selected), content, viewMode,
      recoveryContent: this.repository.getDraft(selected), modifiedAt: info.mtime.toISOString(),
    };
  }

  async openLinkedMarkdown(sourcePath: string, href: string): Promise<ExternalDocument> {
    const target = resolveMarkdownLink(sourcePath, href);
    if (!target) throw new Error('The link does not point to a Markdown file');
    const document = await this.openMarkdown(target);
    if (!document) throw new Error('The linked Markdown file could not be opened');
    return document;
  }

  async openMarkdownFolder(): Promise<import('../shared/types.js').MarkdownFolderTree | null> {
    const result = await dialog.showOpenDialog({ title: 'Open Markdown Folder', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return scanMarkdownFolder(result.filePaths[0]);
  }

  async saveMarkdown(path: string, content: string, viewMode: MarkdownViewMode): Promise<ExternalDocument> {
    if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('Markdown file is too large');
    this.repository.saveDraft(path, content);
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    const backup = join(dirname(path), `.${basename(path)}.${randomUUID()}.bak`);
    try {
      await writeFile(temporary, content, 'utf8');
      await copyFile(path, backup).catch(() => undefined);
      await rename(temporary, path);
      await unlink(backup).catch(() => undefined);
      this.repository.clearDraft(path);
      this.repository.rememberFile(path, basename(path), viewMode);
      const info = await stat(path);
      return { kind: 'external', path, filename: basename(path), content, viewMode, modifiedAt: info.mtime.toISOString() };
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      const exists = await stat(path).then(() => true).catch(() => false);
      if (!exists) await rename(backup, path).catch(() => undefined);
      throw error;
    }
  }

  async saveMarkdownAs(content: string, suggestedName = 'Untitled.md'): Promise<ExternalDocument | null> {
    const result = await dialog.showSaveDialog({
      title: 'Save Markdown As', defaultPath: suggestedName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, 'utf8');
    return this.openMarkdown(result.filePath);
  }

  async importMarkdown(sectionId: string): Promise<Page | null> {
    const external = await this.openMarkdown();
    if (!external) return null;
    const title = basename(external.filename, extname(external.filename));
    const unsafe = await marked.parse(external.content, { async: false });
    const contentHtml = sanitizeHtml(String(unsafe), {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
      allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'], code: ['class'] },
      allowedSchemes: ['http', 'https', 'data'],
    });
    const created = this.repository.createPage(sectionId, title);
    return this.repository.savePage(created.id, { title, contentHtml, contentMarkdown: external.content });
  }

  async linkMarkdown(sectionId: string, path?: string): Promise<Page | null> {
    const external = await this.openMarkdown(path);
    if (!external) return null;
    const title = basename(external.filename, extname(external.filename));
    return this.repository.linkExternalPage(sectionId, title, external.path);
  }

  async exportPage(page: Page): Promise<string | null> {
    const result = await dialog.showSaveDialog({
      title: 'Export Note as Markdown', defaultPath: `${page.title.replace(/[<>:"/\\|?*]/g, '-') || 'Untitled'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, page.contentMarkdown, 'utf8');
    return result.filePath;
  }

  async saveAttachment(pageId: string, dataUrl: string): Promise<string> {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error('Unsupported image format');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 15 * 1024 * 1024) throw new Error('Image is too large');
    const folder = join(this.dataDirectory, 'attachments', pageId);
    await mkdir(folder, { recursive: true });
    const filename = `${randomUUID()}.${MIME_EXTENSIONS[match[1]]}`;
    await writeFile(join(folder, filename), bytes);
    return `notes-asset://${pageId}/${filename}`;
  }

  async openDataFolder(): Promise<void> { await shell.openPath(this.dataDirectory); }
}
