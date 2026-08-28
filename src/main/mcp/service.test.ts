import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NotesRepository } from '../database/repository.js';
import type { FileService } from '../files.js';
import { McpHttpService } from './service.js';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

const unusedFiles = {
  openMarkdown: async () => null,
  saveMarkdown: async () => { throw new Error('Unexpected external Markdown write'); },
} as unknown as FileService;

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe('McpHttpService', () => {
  let directory: string;
  let repository: NotesRepository;
  let service: McpHttpService;

  beforeEach(() => {
    directory = join(process.cwd(), `.test-mcp-http-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    repository = new NotesRepository(join(directory, 'notes.db'));
    service = new McpHttpService(repository, unusedFiles);
  });

  afterEach(async () => {
    await service.stop();
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('serves a tokenized Streamable HTTP MCP endpoint only when enabled', async () => {
    const port = await unusedPort();
    repository.updateSettings({ mcpEnabled: true, mcpPort: port, mcpAccessToken: 'a'.repeat(48) });
    const status = await service.configure();
    expect(status).toMatchObject({ enabled: true, running: true, allowWrites: false, port });
    expect(status.endpoint).toBe(`http://127.0.0.1:${port}/mcp/${'a'.repeat(48)}`);

    const client = new Client({ name: 'noteleaf-http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(status.endpoint)));
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('search_notes');
    expect(tools.tools.map((tool) => tool.name)).not.toContain('update_page');
    await client.close();

    repository.updateSettings({ mcpEnabled: false });
    expect(await service.configure()).toMatchObject({ enabled: false, running: false });
  });
});
