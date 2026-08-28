import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NotesRepository } from '../database/repository.js';
import type { FileService } from '../files.js';
import { createNoteleafMcpServer } from './server.js';

const unusedFiles = {
  openMarkdown: async () => null,
  saveMarkdown: async () => { throw new Error('Unexpected external Markdown write'); },
} as unknown as FileService;

describe('Noteleaf MCP server', () => {
  let directory: string;
  let repository: NotesRepository;

  beforeEach(() => {
    directory = join(process.cwd(), `.test-mcp-server-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    repository = new NotesRepository(join(directory, 'notes.db'));
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function connectedClient(allowWrites: boolean) {
    const server = createNoteleafMcpServer({ repository, files: unusedFiles, allowWrites });
    const client = new Client({ name: 'noteleaf-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  it('advertises only read tools in read-only mode', async () => {
    const { client, server } = await connectedClient(false);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['get_workspace_overview', 'search_notes', 'get_page', 'list_tasks']));
    expect(tools.tools.map((tool) => tool.name)).not.toContain('update_page');
    const result = await client.callTool({ name: 'get_workspace_overview', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('Welcome');
    await client.close();
    await server.close();
  });

  it('advertises write tools only after write access is enabled', async () => {
    const { client, server } = await connectedClient(true);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['create_page', 'update_page', 'create_task', 'update_task']));
    await client.close();
    await server.close();
  });
});
