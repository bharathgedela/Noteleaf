import type { AiAccessStatus, AiProviderStatus, AppSettings, McpStatus } from '../../shared/types.js';
import type { NotesRepository } from '../database/repository.js';
import type { McpHttpService } from '../mcp/service.js';
import type { ClaudeDesktopConfigResult, ClaudeDesktopConfigService, ClaudeDesktopStatus } from './claude-desktop.js';
import type { ChatGptDesktopConfigResult, ChatGptDesktopConfigService, ChatGptDesktopStatus } from './chatgpt-desktop.js';

/** Official OpenAI guide for the optional ChatGPT web Secure MCP Tunnel workflow. */
export const CHATGPT_SECURE_MCP_TUNNEL_URL = 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels';

type SettingsStore = Pick<NotesRepository, 'getSettings' | 'updateSettings'>;
type McpService = Pick<McpHttpService, 'configure' | 'status' | 'regenerateAccessLink'>;
type ClaudeService = Pick<ClaudeDesktopConfigService, 'status' | 'enable' | 'disable'>;
type ChatGptService = Pick<ChatGptDesktopConfigService, 'status' | 'enable' | 'disable'>;
export type ExternalUrlOpener = (url: string) => void | Promise<void>;

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

function chatGptErrorStatus(error: unknown): ChatGptDesktopStatus {
  return {
    supported: true,
    platform: process.platform,
    configPath: null,
    configExists: false,
    configValid: false,
    configured: false,
    upToDate: false,
    error: error instanceof Error ? error.message : 'ChatGPT Desktop configuration could not be checked.',
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

function providerStatusForChatGpt(
  enabled: boolean,
  status: ChatGptDesktopStatus,
): AiProviderStatus {
  if (status.error) return { state: 'error', detail: status.error };
  if (!enabled) return { state: 'disabled', detail: null };
  if (!status.supported) {
    return { state: 'not-installed', detail: 'Automatic ChatGPT Desktop setup needs a local Codex configuration folder.' };
  }
  if (!status.configured || !status.upToDate) {
    return { state: 'setup-required', detail: 'Noteleaf could not find its ChatGPT Desktop connection. Switch AI access off and on to repair it.' };
  }
  return {
    state: 'connected',
    detail: 'Configured for ChatGPT Desktop and Codex CLI/IDE. Restart ChatGPT Desktop if it was open when AI access changed.',
  };
}

/** Coordinates the persisted master switch, local MCP server, and supported AI clients. */
export class AiAccessService {
  private operation = Promise.resolve();
  private claudeRestartRequired = false;
  private lastActionError: string | null = null;

  constructor(
    private readonly repository: SettingsStore,
    private readonly mcp: McpService,
    private readonly claude: ClaudeService,
    private readonly chatGpt: ChatGptService,
    private readonly openExternal: ExternalUrlOpener,
  ) {}

  async status(): Promise<AiAccessStatus> {
    const settings = this.repository.getSettings();
    const mcpStatus = this.mcp.status();
    const [claudeStatus, chatGptStatus] = await Promise.all([
      this.claude.status().catch(claudeErrorStatus),
      this.chatGpt.status().catch(chatGptErrorStatus),
    ]);
    return this.mapStatus(settings, mcpStatus, claudeStatus, chatGptStatus);
  }

  enable(): Promise<AiAccessStatus> {
    return this.enqueue(() => this.setEnabled(true));
  }

  disable(): Promise<AiAccessStatus> {
    return this.enqueue(() => this.setEnabled(false));
  }

  /** Rotates the private endpoint and immediately updates every managed client configuration. */
  regenerateAccessLink(): Promise<McpStatus> {
    return this.enqueue(async () => {
      await this.mcp.regenerateAccessLink();
      await this.applyDesiredState(this.repository.getSettings().mcpEnabled, false);
      return this.mcp.status();
    });
  }

  /** Reconciles the services with the canonical persisted toggle when Noteleaf starts. */
  syncAtStartup(): Promise<AiAccessStatus> {
    return this.enqueue(async () => {
      const enabled = this.repository.getSettings().mcpEnabled;
      return this.applyDesiredState(enabled, false);
    });
  }

  async openChatGptWebSetup(): Promise<AiAccessStatus> {
    if (!this.repository.getSettings().mcpEnabled) return this.status();
    this.lastActionError = null;
    try {
      await this.openExternal(CHATGPT_SECURE_MCP_TUNNEL_URL);
    } catch (error) {
      this.lastActionError = error instanceof Error ? error.message : 'The ChatGPT web setup guide could not be opened.';
    }
    return this.status();
  }

  private enqueue<Result>(action: () => Promise<Result>): Promise<Result> {
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

    let chatGptResult: ChatGptDesktopConfigResult | null = null;
    try {
      chatGptResult = enabled ? await this.chatGpt.enable() : await this.chatGpt.disable();
      if (chatGptResult.error) errors.push(chatGptResult.error);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'ChatGPT Desktop configuration could not be updated.');
    }

    this.lastActionError = uniqueErrors(this.lastActionError, ...errors);
    const [claudeStatus, chatGptStatus] = await Promise.all([
      claudeResult ? Promise.resolve(claudeResult) : this.claude.status().catch(claudeErrorStatus),
      chatGptResult ? Promise.resolve(chatGptResult) : this.chatGpt.status().catch(chatGptErrorStatus),
    ]);
    return this.mapStatus(settings, mcpStatus, claudeStatus, chatGptStatus);
  }

  private mapStatus(
    settings: AppSettings,
    mcpStatus: McpStatus,
    claudeStatus: ClaudeDesktopStatus,
    chatGptStatus: ChatGptDesktopStatus,
  ): AiAccessStatus {
    const enabled = settings.mcpEnabled;
    return {
      enabled,
      running: mcpStatus.running,
      allowWrites: mcpStatus.allowWrites,
      port: mcpStatus.port,
      endpoint: mcpStatus.endpoint,
      lastError: uniqueErrors(this.lastActionError, mcpStatus.lastError, claudeStatus.error, chatGptStatus.error),
      claude: providerStatusForClaude(enabled, claudeStatus, this.claudeRestartRequired),
      chatgpt: providerStatusForChatGpt(enabled, chatGptStatus),
    };
  }
}
