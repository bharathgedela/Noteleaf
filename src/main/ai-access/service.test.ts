import { describe, expect, it, vi } from 'vitest';
import type { AppSettings, McpStatus } from '../../shared/types.js';
import type { NotesRepository } from '../database/repository.js';
import type { McpHttpService } from '../mcp/service.js';
import type { ClaudeDesktopConfigResult, ClaudeDesktopConfigService, ClaudeDesktopStatus } from './claude-desktop.js';
import { AiAccessService, CHATGPT_SECURE_MCP_TUNNEL_URL } from './service.js';

function harness(options: { claudeError?: string; mcpError?: string; openerError?: string; initiallyEnabled?: boolean } = {}) {
  let settings = {
    mcpEnabled: options.initiallyEnabled ?? false,
    mcpAllowWrites: false,
    mcpPort: 37931,
    mcpAccessToken: 'a'.repeat(48),
  } as AppSettings;
  let mcpStatus: McpStatus = {
    enabled: settings.mcpEnabled,
    running: false,
    allowWrites: false,
    port: 37931,
    endpoint: 'http://127.0.0.1:37931/mcp/private',
    executablePath: 'Noteleaf.exe',
    stdioArguments: ['mcp.js', '--data-dir=Noteleaf'],
    stdioEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
    lastError: null,
  };
  let claudeStatus: ClaudeDesktopStatus = {
    supported: true,
    platform: 'win32',
    configPath: 'claude_desktop_config.json',
    configExists: false,
    configValid: true,
    configured: false,
    upToDate: false,
    error: null,
  };

  const updateSettings = vi.fn((patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  const configure = vi.fn(async (source: AppSettings) => {
    mcpStatus = {
      ...mcpStatus,
      enabled: source.mcpEnabled,
      running: source.mcpEnabled && !options.mcpError,
      lastError: options.mcpError ?? null,
    };
    return mcpStatus;
  });
  const claudeResult = (enabled: boolean): ClaudeDesktopConfigResult => {
    claudeStatus = {
      ...claudeStatus,
      configExists: enabled || claudeStatus.configExists,
      configured: enabled,
      upToDate: enabled,
      error: options.claudeError ?? null,
      configValid: !options.claudeError,
    };
    return {
      ...claudeStatus,
      changed: !options.claudeError,
      restartRequired: !options.claudeError,
      message: enabled ? 'enabled' : 'disabled',
    };
  };
  const enableClaude = vi.fn(async () => claudeResult(true));
  const disableClaude = vi.fn(async () => claudeResult(false));
  const opener = vi.fn(async (_url: string) => {
    if (options.openerError) throw new Error(options.openerError);
  });

  const repository = { getSettings: () => settings, updateSettings } as unknown as NotesRepository;
  const mcp = { configure, status: () => mcpStatus } as unknown as McpHttpService;
  const claude = {
    status: async () => claudeStatus,
    enable: enableClaude,
    disable: disableClaude,
  } as unknown as ClaudeDesktopConfigService;
  return {
    service: new AiAccessService(repository, mcp, claude, opener),
    updateSettings,
    configure,
    enableClaude,
    disableClaude,
    opener,
  };
}

describe('AiAccessService', () => {
  it('enables the persisted switch, local service, and Claude configuration together', async () => {
    const test = harness();
    const result = await test.service.enable();

    expect(test.updateSettings).toHaveBeenCalledWith({ mcpEnabled: true });
    expect(test.configure).toHaveBeenCalledOnce();
    expect(test.enableClaude).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      enabled: true,
      running: true,
      lastError: null,
      claude: { state: 'restart-required' },
      chatgpt: { state: 'setup-required' },
    });
    expect((await test.service.status()).claude.state).toBe('restart-required');
  });

  it('disables the local service and removes only the Noteleaf Claude connection', async () => {
    const test = harness({ initiallyEnabled: true });
    const result = await test.service.disable();

    expect(test.updateSettings).toHaveBeenCalledWith({ mcpEnabled: false });
    expect(test.disableClaude).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      enabled: false,
      running: false,
      claude: { state: 'disabled' },
      chatgpt: { state: 'disabled' },
    });
  });

  it('reconciles all services from the persisted toggle at startup', async () => {
    const test = harness({ initiallyEnabled: true });
    const result = await test.service.syncAtStartup();

    expect(test.updateSettings).not.toHaveBeenCalled();
    expect(test.configure).toHaveBeenCalledOnce();
    expect(test.enableClaude).toHaveBeenCalledOnce();
    expect(result.enabled).toBe(true);
  });

  it('keeps successful local setup active while making a Claude error visible', async () => {
    const test = harness({ claudeError: 'Claude config is invalid; file left unchanged.' });
    const result = await test.service.enable();

    expect(result.enabled).toBe(true);
    expect(result.running).toBe(true);
    expect(result.claude).toMatchObject({ state: 'error', detail: 'Claude config is invalid; file left unchanged.' });
    expect(result.lastError).toContain('Claude config is invalid');
    expect(result.chatgpt.state).toBe('setup-required');
  });

  it('opens the official ChatGPT Secure MCP Tunnel guide but keeps cloud status setup-required', async () => {
    const test = harness({ initiallyEnabled: true });
    const result = await test.service.openChatGptSetup();

    expect(test.opener).toHaveBeenCalledWith(CHATGPT_SECURE_MCP_TUNNEL_URL);
    expect(result.chatgpt.state).toBe('setup-required');
    expect(result.chatgpt.detail).toContain('guide is open');
  });

  it('reports a ChatGPT setup opener failure without throwing', async () => {
    const test = harness({ initiallyEnabled: true, openerError: 'Browser could not open' });
    const result = await test.service.openChatGptSetup();

    expect(result.lastError).toContain('Browser could not open');
    expect(result.enabled).toBe(true);
    expect(result.chatgpt.state).toBe('setup-required');
  });
});
