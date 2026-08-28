import { markdownToEditorHtml } from '../markdown.js';
import type { NotesRepository } from '../database/repository.js';
import type { MarkdownViewMode, TaskStatus } from '../../shared/types.js';

const MAX_CONTENT_LENGTH = 5 * 1024 * 1024;

export type PageUpdateMode = 'replace' | 'append' | 'prepend';

export interface McpFileAccess {
  openMarkdown(path: string): Promise<{ content: string; viewMode: MarkdownViewMode; modifiedAt?: string } | null>;
  saveMarkdown(path: string, content: string, viewMode: MarkdownViewMode): Promise<unknown>;
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

export class NoteleafMcpData {
  constructor(
    private readonly repository: NotesRepository,
    private readonly files: McpFileAccess,
    private readonly onMutation: (pageId?: string) => void = () => undefined,
  ) {}

  workspaceOverview() {
    const notebooks = this.repository.mcpNotebooks();
    const totals = notebooks.reduce((result, notebook) => ({
      notebooks: result.notebooks + 1,
      sections: result.sections + notebook.sectionCount,
      pages: result.pages + notebook.pageCount,
    }), { notebooks: 0, sections: 0, pages: 0 });
    return { application: 'Noteleaf', localFirst: true, totals, notebooks };
  }

  listSections(notebookId: string) {
    const notebook = this.repository.mcpNotebooks().find((item) => item.id === notebookId);
    if (!notebook) throw new Error('Notebook not found');
    return { notebook: { id: notebook.id, name: notebook.name }, sections: this.repository.mcpSections(notebookId) };
  }

  listPages(sectionId: string, includeChildPages = true, limit = 100, offset = 0) {
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
    const cleaned = cleanText(query, 'Search query', 300);
    return { query: cleaned, results: this.repository.fullSearch(cleaned).slice(0, Math.min(Math.max(limit, 1), 50)) };
  }

  async getPage(pageId: string) {
    const location = this.repository.mcpPageLocation(pageId);
    if (!location || location.isDeleted) throw new Error('Page not found');
    const page = this.repository.readPage(pageId);
    let contentMarkdown = page.contentMarkdown;
    let updatedAt = page.updatedAt;
    if (page.externalPath) {
      const document = await this.files.openMarkdown(page.externalPath);
      if (!document) throw new Error('Linked Markdown file could not be opened');
      contentMarkdown = document.content;
      updatedAt = document.modifiedAt ?? updatedAt;
    }
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
    };
  }

  async createPage(input: { sectionId: string; title: string; contentMarkdown?: string; sidebarVisible?: boolean }) {
    const section = this.repository.mcpSections().find((item) => item.id === input.sectionId);
    if (!section) throw new Error('Section not found');
    const title = cleanText(input.title, 'Title', 500);
    const markdown = cleanMarkdown(input.contentMarkdown ?? `# ${title}\n`);
    const html = await markdownToEditorHtml(markdown);
    const created = this.repository.createPage(input.sectionId, title, { sidebarVisible: input.sidebarVisible !== false });
    const page = this.repository.savePage(created.id, { title, contentHtml: html, contentMarkdown: markdown });
    this.onMutation(page.id);
    return { id: page.id, title: page.title, section: { id: section.id, name: section.name }, notebook: { id: section.notebookId, name: section.notebook }, updatedAt: page.updatedAt };
  }

  async updatePage(input: { pageId: string; expectedUpdatedAt: string; title?: string; contentMarkdown?: string; mode?: PageUpdateMode }) {
    const existing = await this.getPage(input.pageId);
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      throw new Error(`Page changed after it was read. Call get_page again before updating. Current updatedAt is ${existing.updatedAt}`);
    }
    if (input.title === undefined && input.contentMarkdown === undefined) throw new Error('Provide a title or content to update');
    const title = input.title === undefined ? existing.title : cleanText(input.title, 'Title', 500);
    const mode = input.mode ?? 'replace';
    const supplied = input.contentMarkdown === undefined ? undefined : cleanMarkdown(input.contentMarkdown);
    let markdown = existing.contentMarkdown;
    if (supplied !== undefined) {
      if (mode === 'append') markdown = [markdown.trimEnd(), supplied.trimStart()].filter(Boolean).join('\n\n');
      else if (mode === 'prepend') markdown = [supplied.trimEnd(), markdown.trimStart()].filter(Boolean).join('\n\n');
      else markdown = supplied;
    }

    if (existing.linkedFilePath) {
      if (supplied !== undefined) {
        const document = await this.files.openMarkdown(existing.linkedFilePath);
        if (!document) throw new Error('Linked Markdown file could not be opened');
        await this.files.saveMarkdown(existing.linkedFilePath, markdown, document.viewMode);
      }
      this.repository.renamePage(existing.id, title);
    } else {
      const html = await markdownToEditorHtml(markdown);
      this.repository.savePage(existing.id, { title, contentHtml: html, contentMarkdown: markdown });
    }
    this.onMutation(existing.id);
    return this.getPage(existing.id);
  }

  listTasks(taskDate: string) {
    return { taskDate, tasks: this.repository.tasksForDate(taskDate) };
  }

  createTask(title: string, taskDate: string) {
    const task = this.repository.createTask(cleanText(title, 'Task title', 500), taskDate);
    this.onMutation();
    return task;
  }

  updateTask(id: string, patch: { title?: string; taskDate?: string; status?: TaskStatus }) {
    const task = this.repository.updateTask(id, {
      ...patch,
      title: patch.title === undefined ? undefined : cleanText(patch.title, 'Task title', 500),
    });
    this.onMutation();
    return task;
  }
}
