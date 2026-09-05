import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import electronPath from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dataDirectory = await mkdtemp(join(tmpdir(), 'noteleaf-mcp-smoke-'));
const client = new Client({ name: 'noteleaf-smoke-test', version: '1.0.0' });
const executable = process.env.NOTELEAF_MCP_EXECUTABLE || electronPath;
const cliEntry = process.env.NOTELEAF_MCP_CLI || join(process.cwd(), 'dist', 'main', 'mcp', 'cli.js');
const transport = new StdioClientTransport({
  command: executable,
  args: [cliEntry, `--data-dir=${dataDirectory}`],
  env: { ...Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === 'string')), ELECTRON_RUN_AS_NODE: '1' },
  cwd: process.cwd(),
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', (chunk) => { stderr += String(chunk); });

try {
  // Opt in only the disposable smoke-test library, using Electron's SQLite ABI.
  execFileSync(executable, ['--input-type=module', '-e',
    'const { NotesRepository } = await import(process.argv[1]); const repository = new NotesRepository(process.argv[2]); repository.updateSettings({ mcpEnabled: true, mcpAllowWrites: false }); repository.close();',
    pathToFileURL(join(dirname(cliEntry), '..', 'database', 'repository.js')).href,
    join(dataDirectory, 'notes.db'),
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  for (const required of ['get_workspace_overview', 'list_sections', 'list_pages', 'search_notes', 'get_page', 'list_tasks']) {
    if (!names.includes(required)) throw new Error(`Missing MCP tool: ${required}`);
  }
  if (names.includes('update_page')) throw new Error('Write tool was advertised while write access was disabled');
  const overview = await client.callTool({ name: 'get_workspace_overview', arguments: {} });
  if (overview.isError || !JSON.stringify(overview.content).includes('Welcome')) throw new Error('Workspace overview did not return the seeded Noteleaf notebook');
  console.log(`Noteleaf MCP smoke test passed (${names.length} read-only tools).`);
} catch (error) {
  if (stderr) console.error(stderr.trim());
  throw error;
} finally {
  await client.close().catch(() => undefined);
  await rm(dataDirectory, { recursive: true, force: true });
}
