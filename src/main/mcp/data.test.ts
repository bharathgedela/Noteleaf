import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NotesRepository } from '../database/repository.js';
import type { FileService } from '../files.js';
import { NoteleafMcpData } from './data.js';

const unusedFiles = {
  openMarkdown: async () => null,
  saveMarkdown: async () => { throw new Error('Unexpected external Markdown write'); },
} as unknown as FileService;

describe('NoteleafMcpData', () => {
  let directory: string;
  let repository: NotesRepository;
  let data: NoteleafMcpData;
  const onMutation = vi.fn();

  beforeEach(() => {
    directory = join(process.cwd(), `.test-mcp-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    repository = new NotesRepository(join(directory, 'notes.db'));
    data = new NoteleafMcpData(repository, unusedFiles, onMutation);
    onMutation.mockClear();
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('browses notebooks, sections, sidebar pages, and inline child pages', () => {
    const notebook = repository.createNotebook('Delivery');
    const section = repository.createSection(notebook.id, 'Weekly status');
    repository.createPage(section.id, 'Visible update');
    const child = repository.createPage(section.id, 'Private detail', { sidebarVisible: false });

    expect(data.workspaceOverview().notebooks).toEqual(expect.arrayContaining([expect.objectContaining({ id: notebook.id, pageCount: 2 })]));
    expect(data.listSections(notebook.id).sections[0]).toMatchObject({ id: section.id, pageCount: 2 });
    expect(data.listPages(section.id).pages).toEqual(expect.arrayContaining([expect.objectContaining({ id: child.id, isSidebarVisible: false })]));
    expect(data.listPages(section.id, false).pages.some((page) => page.id === child.id)).toBe(false);
  });

  it('creates Markdown pages and safely appends updates', async () => {
    const section = repository.navigation().notebooks[0].sections[0];
    const created = await data.createPage({ sectionId: section.id, title: 'Project status', contentMarkdown: '# Project status\n\nInitial note.' });
    const firstRead = await data.getPage(created.id);
    const updated = await data.updatePage({
      pageId: created.id,
      expectedUpdatedAt: firstRead.updatedAt,
      contentMarkdown: '## 2026-08-28\n\nDeployment completed.',
      mode: 'append',
    });

    expect(updated.contentMarkdown).toContain('Initial note.\n\n## 2026-08-28');
    expect(repository.readPage(created.id).contentHtml).toContain('<h2>2026-08-28</h2>');
    expect(onMutation).toHaveBeenCalledWith(created.id);
  });

  it('rejects an update based on a stale page version', async () => {
    const page = repository.navigation().notebooks[0].sections[0].pages[0];
    const read = await data.getPage(page.id);
    repository.db.prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?')
      .run('Changed elsewhere', new Date(Date.now() + 1000).toISOString(), page.id);

    await expect(data.updatePage({
      pageId: page.id,
      expectedUpdatedAt: read.updatedAt,
      contentMarkdown: 'This must not overwrite the newer edit.',
    })).rejects.toThrow('Page changed after it was read');
  });

  it('hides protected text from reads and search without allowing AI to overwrite it', async () => {
    const page = repository.navigation().notebooks[0].sections[0].pages[0];
    repository.savePage(page.id, {
      title: 'ClickUp access',
      contentHtml: '<p>Public ClickUp instructions.</p><p>Token: <span data-protected-text="true"><code>vault-secret-123</code></span></p>',
      contentMarkdown: 'Public ClickUp instructions.\n\nToken: `vault-secret-123`',
    });

    const read = await data.getPage(page.id);
    expect(read.protectedTextRedacted).toBe(true);
    expect(read.contentMarkdown).toContain('Public ClickUp instructions');
    expect(read.contentMarkdown).not.toContain('vault-secret-123');
    expect(data.search('vault-secret-123').results).toEqual([]);
    expect(data.search('ClickUp').results[0]).toMatchObject({ id: page.id, protectedTextRedacted: true });
    expect(data.search('ClickUp').results[0].excerpt).not.toContain('vault-secret-123');

    await expect(data.updatePage({
      pageId: page.id,
      expectedUpdatedAt: read.updatedAt,
      contentMarkdown: 'Replace everything.',
    })).rejects.toThrow('contains protected text');

    const renamed = await data.updatePage({ pageId: page.id, expectedUpdatedAt: read.updatedAt, title: 'Renamed access page' });
    expect(renamed.title).toBe('Renamed access page');
    expect(repository.readPage(page.id).contentHtml).toContain('data-protected-text="true"');
  });

  it('reads and changes daily tasks', () => {
    const task = data.createTask('Publish MCP build', '2026-08-28');
    expect(data.listTasks('2026-08-28').tasks).toEqual([expect.objectContaining({ id: task.id, status: 'todo' })]);
    expect(data.updateTask(task.id, { status: 'done' })).toMatchObject({ status: 'done' });
  });
});
