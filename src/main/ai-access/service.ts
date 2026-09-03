import type { AiAccessStatus, AiProviderStatus, AppSettings, McpStatus } from '../../shared/types.js';
import type { NotesRepository } from '../database/repository.js';
import type { McpHttpService } from '../mcp/service.js';
import type { ClaudeDesktopConfigResult, ClaudeDesktopConfigService, ClaudeDesktopStatus } from './claude-desktop.js';

/** Official OpenAI guide used for the one-time ChatGPT Secure MCP Tunnel setup. */
export const CHATGPT_SECURE_MCP_TUNNEL_URL = 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels';

type SettingsStore = Pick<NotesRepository, 'getSettings' | 'updateSettings'>;
type McpService = Pick<McpHttpService, 'configure' | 'status'>;
type ClaudeService = Pick<ClaudeDesktopConfigService, 'status' | 'enable' | 'disable'>;
export type ChatGptSetupOpener = (url: string) => void | Promise<void>;

function uniqueErrors(...values: Array<string | null | undefined>): string | null {
  const messages = [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  return messages.length ? messages.join(' ') : null;
}

function claudeErrorStatus(error: unknown): ClaudeDesktopStatus {
  return {
    supported: true,
    platform: process.platform,
    configPath: null,
    configExists: false,
    configValid: false,
    configured: false,
    upToDate: false,
    error: error instanceof Error ? error.message : 'Claude Desktop configuration could not be checked.',
  };
}

function providerStatusForClaude(
  enabled: boolean,
  status: ClaudeDesktopStatus,
  restartRequired: boolean,
): AiProviderStatus {
  if (status.error) return { state: 'error', detail: status.error };
  if (!enabled) return { state: 'disabled', detail: null };
  if (!status.supported) {
    return { state: 'not-installed', detail: 'Automatic Claude Desktop setup is available on Windows and macOS.' };
  }
  if (!status.configured) {
    return { state: 'setup-required', detail: 'Noteleaf could not find its Claude Desktop connection. Switch AI access off and on to repair it.' };
  }
  if (restartRequired || !status.upToDate) {
    return { state: 'restart-required', detail: 'Configuration is complete. Restart Claude Desktop once to finish connecting.' };
  }
  return { state: 'connected', detail: 'Claude Desktop is configured to connect to Noteleaf automatically.' };
}

function providerStatusForChatGpt(enabled: boolean, setupOpened: boolean): AiProviderStatus {
  if (!enabled) return { state: 'disabled', detail: null };
  return {
    state: 'setup-required',
    detail: setupOpened
      ? 'The Secure MCP Tunnel guide is open. Complete the one-time connection in your ChatGPT account.'
      : 'ChatGPT needs a one-time Secure MCP Tunnel connection; Noteleaf cannot authorize or verify your cloud account locally.',
  };
}

/** Coordinates the persisted master switch, local MCP server, and supported AI clients. */
export class AiAccessService {
  private operation = Promise.resolve();
  private claudeRestartRequired = false;
  private chatGptSetupOpened = false;
  private lastActionError: string | null = null;

  constructor(
    private readonly repository: SettingsStore,
    private readonly mcp: McpService,
    private readonly claude: ClaudeService,
    private readonly openChatGptSetupCallback: ChatGptSetupOpener,
  ) {}

  async status(): Promise<AiAccessStatus> {
    const settings = this.repository.getSettings();
    const mcpStatus = this.mcp.status();
    const claudeStatus = await this.claude.status().catch(claudeErrorStatus);
    return this.mapStatus(settings, mcpStatus, claudeStatus);
  }

  enable(): Promise<AiAccessStatus> {
    return this.enqueue(() => this.setEnabled(true));
  }

  disable(): Promise<AiAccessStatus> {
    return this.enqueue(() => this.setEnabled(false));
  }

  /** Reconciles the services with the canonical persisted toggle when Noteleaf starts. */
  syncAtStartup(): Promise<AiAccessStatus> {
    return this.enqueue(async () => {
      const enabled = this.repository.getSettings().mcpEnabled;
      return this.applyDesiredState(enabled, false);
    });
  }

  async openChatGptSetup(): Promise<AiAccessStatus> {
    if (!this.repository.getSettings().mcpEnabled) return this.status();
    this.lastActionError = null;
    try {
      await this.openChatGptSetupCallback(CHATGPT_SECURE_MCP_TUNNEL_URL);
      this.chatGptSetupOpened = true;
    } catch (error) {
      this.lastActionError = error instanceof Error ? error.message : 'The ChatGPT setup guide could not be opened.';
    }
    return this.status();
  }

  private enqueue(action: () => Promise<AiAccessStatus>): Promise<AiAccessStatus> {
    const result = this.operation.then(action);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async setEnabled(enabled: boolean): Promise<AiAccessStatus> {
    this.repository.updateSettings({ mcpEnabled: enabled });
    return this.applyDesiredState(enabled, true);
  }

  private async applyDesiredState(enabled: boolean, clearTransientState: boolean): Promise<AiAccessStatus> {
    if (clearTransientState) {
      this.lastActionError = null;
      this.chatGptSetupOpened = false;
    }

    const errors: string[] = [];
    const settings = this.repository.getSettings();
    let mcpStatus: McpStatus;
    try {
      mcpStatus = await this.mcp.configure(settings);
      if (mcpStatus.lastError) errors.push(mcpStatus.lastError);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'The local MCP service could not be updated.');
      mcpStatus = this.mcp.status();
    }

    let claudeResult: ClaudeDesktopConfigResult | null = null;
    try {
      claudeResult = enabled ? await this.claude.enable() : await this.claude.disable();
      if (claudeResult.error) errors.push(claudeResult.error);
      if (claudeResult.changed) this.claudeRestartRequired = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Claude Desktop configuration could not be updated.');
    }

    this.lastActionError = uniqueErrors(this.lastActionError, ...errors);
    const claudeStatus = claudeResult ?? await this.claude.status().catch(claudeErrorStatus);
    return this.mapStatus(settings, mcpStatus, claudeStatus);
  }

  private mapStatus(settings: AppSettings, mcpStatus: McpStatus, claudeStatus: ClaudeDesktopStatus): AiAccessStatus {
    const enabled = settings.mcpEnabled;
    return {
      enabled,
      running: mcpStatus.running,
      allowWrites: mcpStatus.allowWrites,
      port: mcpStatus.port,
      endpoint: mcpStatus.endpoint,
      lastError: uniqueErrors(this.lastActionError, mcpStatus.lastError, claudeStatus.error),
      claude: providerStatusForClaude(enabled, claudeStatus, this.claudeRestartRequired),
      chatgpt: providerStatusForChatGpt(enabled, this.chatGptSetupOpened),
    };
  }
}
