import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, win32 } from 'node:path';

const NOTELEAF_SERVER_NAME = 'noteleaf';
const CONFIG_FILENAME = 'claude_desktop_config.json';

type JsonObject = Record<string, unknown>;

export interface NoteleafStdioConfiguration {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClaudeDesktopPathOptions {
  /** Explicit override, primarily for portable installations and tests. */
  configPath?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

export interface ClaudeDesktopStatus {
  supported: boolean;
  platform: NodeJS.Platform;
  configPath: string | null;
  configExists: boolean;
  configValid: boolean;
  configured: boolean;
  upToDate: boolean;
  error: string | null;
}

export interface ClaudeDesktopConfigResult extends ClaudeDesktopStatus {
  changed: boolean;
  restartRequired: boolean;
  message: string;
}

interface ParsedConfiguration {
  exists: boolean;
  raw: string | null;
  document: JsonObject;
  servers: JsonObject | null;
}

class ClaudeConfigurationError extends Error {}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configError(path: string, reason: string): ClaudeConfigurationError {
  return new ClaudeConfigurationError(
    `Claude Desktop's configuration at "${path}" ${reason}. Noteleaf left the file unchanged. `
    + 'Correct the configuration in Claude Desktop, then try enabling AI access again.',
  );
}

export function detectClaudeDesktopConfigPath(options: ClaudeDesktopPathOptions = {}): string | null {
  if (options.configPath) return options.configPath;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === 'win32') {
    const appData = environment.APPDATA?.trim()
      || (homeDirectory ? win32.join(homeDirectory, 'AppData', 'Roaming') : '');
    return appData ? win32.join(appData, 'Claude', CONFIG_FILENAME) : null;
  }
  if (platform === 'darwin') {
    return homeDirectory
      ? posix.join(homeDirectory, 'Library', 'Application Support', 'Claude', CONFIG_FILENAME)
      : null;
  }
  return null;
}

function normalizeLaunchConfiguration(source: NoteleafStdioConfiguration): NoteleafStdioConfiguration {
  if (!source.command.trim()) throw new Error('The Noteleaf MCP executable path is missing.');
  if (!source.args.every((argument) => typeof argument === 'string')) {
    throw new Error('The Noteleaf MCP arguments are invalid.');
  }
  if (!Object.values(source.env).every((value) => typeof value === 'string')) {
    throw new Error('The Noteleaf MCP environment is invalid.');
  }
  return {
    command: source.command,
    args: [...source.args],
    env: { ...source.env },
  };
}

function configurationsMatch(current: unknown, expected: NoteleafStdioConfiguration): boolean {
  if (!isJsonObject(current)) return false;
  if (current.command !== expected.command) return false;
  if (!Array.isArray(current.args) || current.args.length !== expected.args.length) return false;
  if (!current.args.every((item, index) => item === expected.args[index])) return false;
  const currentEnvironmentObject = current.env;
  if (!isJsonObject(currentEnvironmentObject)) return false;
  const currentEnvironment = Object.entries(currentEnvironmentObject);
  const expectedEnvironment = Object.entries(expected.env);
  return currentEnvironment.length === expectedEnvironment.length
    && expectedEnvironment.every(([key, value]) => currentEnvironmentObject[key] === value);
}

async function pathExists(path: string): Promise<boolean> {
  return access(path, constants.F_OK).then(() => true).catch(() => false);
}

async function readConfiguration(path: string): Promise<ParsedConfiguration> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, raw: null, document: {}, servers: null };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    const detail = error instanceof Error ? ` contains invalid JSON (${error.message})` : ' contains invalid JSON';
    throw configError(path, detail);
  }
  if (!isJsonObject(parsed)) throw configError(path, 'must contain a JSON object at its root');
  if (parsed.mcpServers !== undefined && !isJsonObject(parsed.mcpServers)) {
    throw configError(path, 'has an "mcpServers" value that is not a JSON object');
  }
  return {
    exists: true,
    raw,
    document: parsed,
    servers: isJsonObject(parsed.mcpServers) ? parsed.mcpServers : null,
  };
}

async function writeConfigurationAtomically(path: string, document: JsonObject, expectedRaw: string | null): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });

  // Refuse to silently erase changes made by Claude or the user while Noteleaf was preparing the update.
  const currentRaw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (currentRaw !== expectedRaw) {
    throw new ClaudeConfigurationError(
      `Claude Desktop's configuration at "${path}" changed while Noteleaf was updating it. `
      + 'Nothing was overwritten; try enabling AI access again.',
    );
  }

  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const existingMode = expectedRaw === null
    ? 0o600
    : await stat(path).then((info) => info.mode & 0o777).catch(() => 0o600);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, 'wx', existingMode);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function unsupportedStatus(platform: NodeJS.Platform, configPath: string | null): ClaudeDesktopStatus {
  return {
    supported: false,
    platform,
    configPath,
    configExists: false,
    configValid: false,
    configured: false,
    upToDate: false,
    error: 'Automatic Claude Desktop setup is currently available on Windows and macOS.',
  };
}

function errorStatus(platform: NodeJS.Platform, configPath: string, error: unknown): ClaudeDesktopStatus {
  return {
    supported: true,
    platform,
    configPath,
    configExists: false,
    configValid: false,
    configured: false,
    upToDate: false,
    error: error instanceof Error ? error.message : 'Claude Desktop configuration could not be read.',
  };
}

/** Safely installs and removes only Noteleaf's entry in Claude Desktop's MCP configuration. */
export class ClaudeDesktopConfigService {
  private operation = Promise.resolve();
  private readonly platform: NodeJS.Platform;
  private readonly configPath: string | null;

  constructor(
    private readonly launchConfiguration: () => NoteleafStdioConfiguration,
    options: ClaudeDesktopPathOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.configPath = detectClaudeDesktopConfigPath({ ...options, platform: this.platform });
  }

  private desiredConfiguration(): NoteleafStdioConfiguration {
    return normalizeLaunchConfiguration(this.launchConfiguration());
  }

  private statusFromParsed(parsed: ParsedConfiguration): ClaudeDesktopStatus {
    const expected = this.desiredConfiguration();
    const configured = Boolean(parsed.servers && Object.hasOwn(parsed.servers, NOTELEAF_SERVER_NAME));
    return {
      supported: true,
      platform: this.platform,
      configPath: this.configPath,
      configExists: parsed.exists,
      configValid: true,
      configured,
      upToDate: configured && configurationsMatch(parsed.servers?.[NOTELEAF_SERVER_NAME], expected),
      error: null,
    };
  }

  async status(): Promise<ClaudeDesktopStatus> {
    if (!this.configPath) return unsupportedStatus(this.platform, null);
    try {
      return this.statusFromParsed(await readConfiguration(this.configPath));
    } catch (error) {
      const result = errorStatus(this.platform, this.configPath, error);
      result.configExists = await pathExists(this.configPath);
      return result;
    }
  }

  setEnabled(enabled: boolean): Promise<ClaudeDesktopConfigResult> {
    const result = this.operation.then(() => this.updateConfiguration(enabled));
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  enable(): Promise<ClaudeDesktopConfigResult> {
    return this.setEnabled(true);
  }

  disable(): Promise<ClaudeDesktopConfigResult> {
    return this.setEnabled(false);
  }

  private async updateConfiguration(enabled: boolean): Promise<ClaudeDesktopConfigResult> {
    if (!this.configPath) {
      return {
        ...unsupportedStatus(this.platform, null),
        changed: false,
        restartRequired: false,
        message: 'Claude Desktop configuration was not changed.',
      };
    }

    try {
      const parsed = await readConfiguration(this.configPath);
      const servers = parsed.servers ?? {};
      const expected = this.desiredConfiguration();
      const currentlyConfigured = Object.hasOwn(servers, NOTELEAF_SERVER_NAME);
      const alreadyCurrent = currentlyConfigured && configurationsMatch(servers[NOTELEAF_SERVER_NAME], expected);

      if ((enabled && alreadyCurrent) || (!enabled && !currentlyConfigured)) {
        return {
          ...this.statusFromParsed(parsed),
          changed: false,
          restartRequired: false,
          message: enabled ? 'AI access is already enabled for Claude Desktop.' : 'AI access is already disabled for Claude Desktop.',
        };
      }

      if (enabled) servers[NOTELEAF_SERVER_NAME] = expected;
      else delete servers[NOTELEAF_SERVER_NAME];
      parsed.document.mcpServers = servers;
      await writeConfigurationAtomically(this.configPath, parsed.document, parsed.raw);

      const updated = await readConfiguration(this.configPath);
      return {
        ...this.statusFromParsed(updated),
        changed: true,
        restartRequired: true,
        message: enabled
          ? 'AI access was enabled. Restart Claude Desktop to connect Noteleaf.'
          : 'AI access was disabled. Restart Claude Desktop to finish disconnecting Noteleaf.',
      };
    } catch (error) {
      const status = errorStatus(this.platform, this.configPath, error);
      status.configExists = await pathExists(this.configPath);
      return {
        ...status,
        changed: false,
        restartRequired: false,
        message: 'Claude Desktop configuration was not changed.',
      };
    }
  }
}
