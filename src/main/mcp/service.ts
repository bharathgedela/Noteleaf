import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppSettings, McpStatus } from '../../shared/types.js';
import type { NotesRepository } from '../database/repository.js';
import type { FileService } from '../files.js';
import { createNoteleafMcpServer } from './server.js';

const DEFAULT_PORT = 37931;

function validPort(value: number): number {
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : DEFAULT_PORT;
}

export class McpHttpService {
  private httpServer: HttpServer | null = null;
  private activeKey = '';
  private lastError: string | null = null;

  constructor(
    private readonly repository: NotesRepository,
    private readonly files: FileService,
    private readonly onMutation: (pageId?: string) => void = () => undefined,
  ) {}

  private ensureAccessToken(settings: AppSettings): AppSettings {
    if (/^[a-f0-9]{32,128}$/i.test(settings.mcpAccessToken)) return settings;
    return this.repository.updateSettings({ mcpAccessToken: randomBytes(24).toString('hex') });
  }

  async configure(source = this.repository.getSettings()): Promise<McpStatus> {
    const settings = this.ensureAccessToken(source);
    const port = validPort(settings.mcpPort);
    const key = `${settings.mcpEnabled}:${settings.mcpAllowWrites}:${port}:${settings.mcpAccessToken}`;
    if (!settings.mcpEnabled) {
      await this.stop();
      this.activeKey = key;
      return this.status();
    }
    if (this.httpServer?.listening && this.activeKey === key) return this.status();
    await this.stop();
    this.activeKey = key;
    this.lastError = null;
    const endpointPath = `/mcp/${settings.mcpAccessToken}`;

    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${port}`}`);
        if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/health')) {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify({ name: 'Noteleaf MCP', status: 'ok', writeAccess: settings.mcpAllowWrites }));
          return;
        }
        if (request.method === 'OPTIONS' && requestUrl.pathname === endpointPath) {
          response.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
          });
          response.end();
          return;
        }
        if (requestUrl.pathname !== endpointPath || !request.method || !['POST', 'GET', 'DELETE'].includes(request.method)) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
        response.setHeader('Cache-Control', 'no-store');
        const mcp = createNoteleafMcpServer({
          repository: this.repository,
          files: this.files,
          allowWrites: settings.mcpAllowWrites,
          onMutation: this.onMutation,
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        response.on('close', () => { void transport.close(); void mcp.close(); });
        await mcp.connect(transport);
        await transport.handleRequest(request, response);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'MCP request failed';
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        if (!response.writableEnded) response.end('Internal server error');
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      this.httpServer = server;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Could not start the MCP server';
      server.close();
      this.httpServer = null;
    }
    return this.status();
  }

  async regenerateAccessLink(): Promise<McpStatus> {
    const settings = this.repository.updateSettings({ mcpAccessToken: randomBytes(24).toString('hex') });
    return this.configure(settings);
  }

  status(): McpStatus {
    const settings = this.ensureAccessToken(this.repository.getSettings());
    const port = validPort(settings.mcpPort);
    const executablePath = process.execPath;
    return {
      enabled: settings.mcpEnabled,
      running: Boolean(this.httpServer?.listening),
      allowWrites: settings.mcpAllowWrites,
      port,
      endpoint: `http://127.0.0.1:${port}/mcp/${settings.mcpAccessToken}`,
      executablePath,
      stdioArguments: [join(app.getAppPath(), 'dist', 'main', 'mcp', 'cli.js'), `--data-dir=${app.getPath('userData')}`],
      stdioEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
      lastError: this.lastError,
    };
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = null;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
