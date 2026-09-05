import { markdownToEditorHtml } from '../markdown.js';
import type { NotesRepository } from '../database/repository.js';
import type { MarkdownViewMode, TaskStatus } from '../../shared/types.js';
import { mcpContentView } from './protected-content.js';

const MAX_CONTENT_LENGTH = 5 * 1024 * 1024;

export type PageUpdateMode = 'replace' | 'append' | 'prepend';

export interface McpFileAccess {
  openMarkdown(path: string): Promise<{ content: string; viewMode: MarkdownViewMode; modifiedAt?: string } | null>;
  saveMarkdown(path: string, content: string, viewMode: MarkdownViewMode, beforeCommit?: () => void): Promise<unknown>;
}

function cleanText(value: string, label: string, max: number): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} cannot be empty`);
  if (cleaned.length > max) throw new Error(`${label} is too long`);
  return cleaned;
}

function cleanMarkdown(value: string): string {
  if (value.length > MAX_CONTENT_LENGTH) throw new Error('Page content is too large');
  return value.replace(/\r\n/g, '\n');
}

function searchTokens(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).map((token) => token.replaceAll('"', '')).filter(Boolean);
}

function safeExcerpt(markdown: string, query: string): string {
  const compact = markdown.replace(/\s+/g, ' ').trim();
  if (!compact) return '[Protected content omitted]';
  const lower = compact.toLocaleLowerCase();
  const firstMatch = searchTokens(query).map((token) => lower.indexOf(token)).find((index) => index >= 0) ?? -1;
  const start = Math.max(0, firstMatch < 0 ? 0 : firstMatch - 55);
  const excerpt = compact.slice(start, start + 180);
  return `${start > 0 ? '… ' : ''}${excerpt}${start + excerpt.length < compact.length ? ' …' : ''}`;
}

export class NoteleafMcpData {
  constructor(
    private readonly repository: NotesRepository,
    private readonly files: McpFileAccess,
    private readonly onMutation: (pageId?: string) => void = () => undefined,
  ) {}

  private assertAccess(write = false) {
    const settings = this.repository.getSettings();
    if (!settings.mcpEnabled) throw new Error('AI access is disabled in Noteleaf.');
    if (write && !settings.mcpAllowWrites) throw new Error('AI write access is disabled in Noteleaf.');
  }

  workspaceOverview() {
    this.assertAccess();
    const notebooks = this.repository.mcpNotebooks();
    const totals = notebooks.reduce((result, notebook) => ({
      notebooks: result.notebooks + 1,
      sections: result.sections + notebook.sectionCount,
      pages: result.pages + notebook.pageCount,
    }), { notebooks: 0, sections: 0, pages: 0 });
    return { application: 'Noteleaf', localFirst: true, totals, notebooks };
  }

  listSections(notebookId: string) {
    this.assertAccess();
    const notebook = this.repository.mcpNotebooks().find((item) => item.id === notebookId);
    if (!notebook) throw new Error('Notebook not found');
    return { notebook: { id: notebook.id, name: notebook.name }, sections: this.repository.mcpSections(notebookId) };
  }

  listPages(sectionId: string, includeChildPages = true, limit = 100, offset = 0) {
    this.assertAccess();
    const section = this.repository.mcpSections().find((item) => item.id === sectionId);
    if (!section) throw new Error('Section not found');
    const pages = this.repository.mcpPages(sectionId, includeChildPages, limit, offset);
    return {
      section,
      pages,
      offset,
      limit,
      hasMore: offset + pages.length < section.pageCount,
    };
  }

  search(query: string, limit = 20) {
    this.assertAccess();
    const cleaned = cleanText(query, 'Search query', 300);
    const tokens = searchTokens(cleaned);
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    const results = this.repository.fullSearchForMcp(cleaned).flatMap((result) => {
      const page = this.repository.readPageForMcp(result.id);
      const view = mcpContentView(page.contentHtml, page.contentMarkdown);
      if (!view.protectedTextRedacted) return [result];

      const safeHaystack = `${result.title}\n${view.searchableMarkdown}`.toLocaleLowerCase();
      if (!tokens.every((token) => safeHaystack.includes(token))) return [];
      return [{
        ...result,
        excerpt: safeExcerpt(view.searchableMarkdown, cleaned),
        protectedTextRedacted: true,
      }];
    }).slice(0, cappedLimit);
    return { query: cleaned, results };
  }

  async getPage(pageId: string) {
    this.assertAccess();
    const location = this.repository.mcpPageLocation(pageId);
    if (!location || location.isDeleted) throw new Error('Page not found');
    const page = this.repository.readPageForMcp(pageId);
    let contentMarkdown = page.contentMarkdown;
    let updatedAt = page.updatedAt;
    let protectedTextRedacted = false;
    if (page.externalPath) {
      const document = await this.files.openMarkdown(page.externalPath);
      if (!document) throw new Error('Linked Markdown file could not be opened');
      contentMarkdown = document.content;
      updatedAt = document.modifiedAt ?? updatedAt;
    } else {
      const view = mcpContentView(page.contentHtml, page.contentMarkdown);
      contentMarkdown = view.contentMarkdown;
      protectedTextRedacted = view.protectedTextRedacted;
    }
    this.assertAccess();
    return {
      id: page.id,
      title: page.title,
      notebook: { id: location.notebookId, name: location.notebook },
      section: { id: page.sectionId, name: location.section },
      contentMarkdown,
      updatedAt,
      createdAt: page.createdAt,
      isChildPage: !page.isSidebarVisible,
      parentPageId: page.parentPageId,
      linkedFilePath: page.externalPath,
      protectedTextRedacted,
    };
  }

  async createPage(input: { sectionId: string; title: string; contentMarkdown?: string; sidebarVisible?: boolean }) {
    this.assertAccess(true);
    const section = this.repository.mcpSections().find((item) => item.id === input.sectionId);
    if (!section) throw new Error('Section not found');
    const title = cleanText(input.title, 'Title', 500);
    const markdown = cleanMarkdown(input.contentMarkdown ?? `# ${title}\n`);
    const html = await markdownToEditorHtml(markdown);
    this.assertAccess(true);
    const created = this.repository.createPage(input.sectionId, title, { sidebarVisible: input.sidebarVisible !== false });
    const page = this.repository.savePage(created.id, { title, contentHtml: html, contentMarkdown: markdown });
    this.onMutation(page.id);
    return { id: page.id, title: page.title, section: { id: section.id, name: section.name }, notebook: { id: section.notebookId, name: section.notebook }, updatedAt: page.updatedAt };
  }

  async updatePage(input: { pageId: string; expectedUpdatedAt: string; title?: string; contentMarkdown?: string; mode?: PageUpdateMode }) {
    this.assertAccess(true);
    const existing = await this.getPage(input.pageId);
    this.assertAccess(true);
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      throw new Error(`Page changed after it was read. Call get_page again before updating. Current updatedAt is ${existing.updatedAt}`);
    }
    if (input.title === undefined && input.contentMarkdown === undefined) throw new Error('Provide a title or content to update');
    const title = input.title === undefined ? existing.title : cleanText(input.title, 'Title', 500);
    const mode = input.mode ?? 'replace';
    const supplied = input.contentMarkdown === undefined ? undefined : cleanMarkdown(input.contentMarkdown);
    const storedPage = this.repository.readPageForMcp(existing.id);
    const protectedView = mcpContentView(storedPage.contentHtml, storedPage.contentMarkdown);
    if (!existing.linkedFilePath && protectedView.protectedTextRedacted && supplied !== undefined) {
      throw new Error('This page contains protected text. Unprotect it in Noteleaf before allowing AI content updates.');
    }
    let markdown = existing.linkedFilePath ? existing.contentMarkdown : storedPage.contentMarkdown;
    if (supplied !== undefined) {
      if (mode === 'append') markdown = [markdown.trimEnd(), supplied.trimStart()].filter(Boolean).join('\n\n');
      else if (mode === 'prepend') markdown = [supplied.trimEnd(), markdown.trimStart()].filter(Boolean).join('\n\n');
      else markdown = supplied;
    }

    if (existing.linkedFilePath) {
      if (supplied !== undefined) {
        const document = await this.files.openMarkdown(existing.linkedFilePath);
        if (!document) throw new Error('Linked Markdown file could not be opened');
        this.assertAccess(true);
        await this.files.saveMarkdown(existing.linkedFilePath, markdown, document.viewMode, () => this.assertAccess(true));
      }
      this.assertAccess(true);
      this.repository.renamePage(existing.id, title);
    } else if (supplied !== undefined) {
      const html = await markdownToEditorHtml(markdown);
      this.assertAccess(true);
      this.repository.savePage(existing.id, { title, contentHtml: html, contentMarkdown: markdown });
    } else {
      this.repository.renamePage(existing.id, title);
    }
    this.onMutation(existing.id);
    return this.getPage(existing.id);
  }

  listTasks(taskDate: string) {
    this.assertAccess();
    return { taskDate, tasks: this.repository.tasksForDate(taskDate) };
  }

  createTask(title: string, taskDate: string) {
    this.assertAccess(true);
    const task = this.repository.createTask(cleanText(title, 'Task title', 500), taskDate);
    this.onMutation();
    return task;
  }

  updateTask(id: string, patch: { title?: string; taskDate?: string; status?: TaskStatus }) {
    this.assertAccess(true);
    const task = this.repository.updateTask(id, {
      ...patch,
      title: patch.title === undefined ? undefined : cleanText(patch.title, 'Task title', 500),
    });
    this.onMutation();
    return task;
  }
}
