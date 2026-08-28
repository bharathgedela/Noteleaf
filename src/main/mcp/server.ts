import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { NotesRepository } from '../database/repository.js';
import { NoteleafMcpData, type McpFileAccess } from './data.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

function textResult(value: unknown, message?: string) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: 'text' as const, text: message ? `${message}\n\n${text}` : text }] };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Noteleaf operation failed' }],
  };
}

async function runTool(operation: () => unknown | Promise<unknown>, message?: string) {
  try { return textResult(await operation(), message); }
  catch (error) { return errorResult(error); }
}

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function createNoteleafMcpServer(options: {
  repository: NotesRepository;
  files: McpFileAccess;
  allowWrites: boolean;
  onMutation?: (pageId?: string) => void;
}): McpServer {
  const data = new NoteleafMcpData(options.repository, options.files, options.onMutation);
  const server = new McpServer({ name: 'noteleaf', title: 'Noteleaf', version: '1.1.0' });

  server.registerTool('get_workspace_overview', {
    title: 'Get Noteleaf workspace overview',
    description: 'Lists every notebook with stable IDs and page/section counts. Start here before looking for a particular section or page.',
    inputSchema: {},
    annotations: readAnnotations,
  }, async () => runTool(() => data.workspaceOverview()));

  server.registerTool('list_sections', {
    title: 'List notebook sections',
    description: 'Lists the sections in one Noteleaf notebook. Use the notebook_id returned by get_workspace_overview.',
    inputSchema: { notebook_id: z.string().min(1).describe('Stable Noteleaf notebook ID') },
    annotations: readAnnotations,
  }, async ({ notebook_id }) => runTool(() => data.listSections(notebook_id)));

  server.registerTool('list_pages', {
    title: 'List section pages',
    description: 'Lists pages in one section, including inline child pages by default. Use the returned page IDs with get_page.',
    inputSchema: {
      section_id: z.string().min(1).describe('Stable Noteleaf section ID'),
      include_child_pages: z.boolean().optional().default(true),
      limit: z.number().int().min(1).max(200).optional().default(100),
      offset: z.number().int().min(0).optional().default(0),
    },
    annotations: readAnnotations,
  }, async ({ section_id, include_child_pages, limit, offset }) => runTool(() => data.listPages(section_id, include_child_pages, limit, offset)));

  server.registerTool('search_notes', {
    title: 'Search Noteleaf',
    description: 'Full-text searches titles and Markdown content across all active Noteleaf pages. Returns page IDs, locations, and short matching excerpts.',
    inputSchema: {
      query: z.string().min(1).max(300),
      limit: z.number().int().min(1).max(50).optional().default(20),
    },
    annotations: readAnnotations,
  }, async ({ query, limit }) => runTool(() => data.search(query, limit)));

  server.registerTool('get_page', {
    title: 'Read a Noteleaf page',
    description: 'Reads the complete Markdown content and location of one page. For safe updates, retain the exact updatedAt value.',
    inputSchema: { page_id: z.string().min(1).describe('Stable Noteleaf page ID') },
    annotations: readAnnotations,
  }, async ({ page_id }) => runTool(() => data.getPage(page_id)));

  server.registerTool('list_tasks', {
    title: 'List Noteleaf daily tasks',
    description: 'Lists the To do, In progress, and Done tasks for one calendar date.',
    inputSchema: { task_date: dateSchema.describe('Calendar date in YYYY-MM-DD format') },
    annotations: readAnnotations,
  }, async ({ task_date }) => runTool(() => data.listTasks(task_date)));

  if (options.allowWrites) {
    server.registerTool('create_page', {
      title: 'Create a Noteleaf page',
      description: 'Creates a page in an existing Noteleaf section. Call list_sections first and use its stable section ID.',
      inputSchema: {
        section_id: z.string().min(1),
        title: z.string().min(1).max(500),
        content_markdown: z.string().max(5 * 1024 * 1024).optional(),
        show_in_sidebar: z.boolean().optional().default(true),
      },
      annotations: writeAnnotations,
    }, async ({ section_id, title, content_markdown, show_in_sidebar }) => runTool(
      () => data.createPage({ sectionId: section_id, title, contentMarkdown: content_markdown, sidebarVisible: show_in_sidebar }),
      `Created “${title}” in Noteleaf.`,
    ));

    server.registerTool('update_page', {
      title: 'Update a Noteleaf page',
      description: 'Renames or changes a page. Always call get_page immediately first and pass its exact updatedAt value to prevent overwriting newer edits. Append mode is best for adding a new status update.',
      inputSchema: {
        page_id: z.string().min(1),
        expected_updated_at: z.string().min(1).describe('Exact updatedAt returned by the latest get_page call'),
        title: z.string().min(1).max(500).optional(),
        content_markdown: z.string().max(5 * 1024 * 1024).optional(),
        mode: z.enum(['replace', 'append', 'prepend']).optional().default('replace'),
      },
      annotations: writeAnnotations,
    }, async ({ page_id, expected_updated_at, title, content_markdown, mode }) => runTool(
      () => data.updatePage({ pageId: page_id, expectedUpdatedAt: expected_updated_at, title, contentMarkdown: content_markdown, mode }),
      'Updated the Noteleaf page.',
    ));

    server.registerTool('create_task', {
      title: 'Create a Noteleaf task',
      description: 'Adds a To do task to a particular calendar date in Noteleaf.',
      inputSchema: { title: z.string().min(1).max(500), task_date: dateSchema },
      annotations: writeAnnotations,
    }, async ({ title, task_date }) => runTool(() => data.createTask(title, task_date), `Added “${title}” to Noteleaf Tasks.`));

    server.registerTool('update_task', {
      title: 'Update a Noteleaf task',
      description: 'Changes a task title, date, or workflow status.',
      inputSchema: {
        task_id: z.string().min(1),
        title: z.string().min(1).max(500).optional(),
        task_date: dateSchema.optional(),
        status: z.enum(['todo', 'in_progress', 'done']).optional(),
      },
      annotations: writeAnnotations,
    }, async ({ task_id, title, task_date, status }) => runTool(
      () => data.updateTask(task_id, { title, taskDate: task_date, status }),
      'Updated the Noteleaf task.',
    ));
  }

  return server;
}
