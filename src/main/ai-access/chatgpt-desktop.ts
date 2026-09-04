import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';

const CONFIG_FILENAME = 'config.toml';
const MANAGED_BLOCK_START = '# >>> Noteleaf managed MCP server >>>';
const MANAGED_BLOCK_END = '# <<< Noteleaf managed MCP server <<<';
const MANAGED_PADDING_PREFIX = '# Noteleaf managed prefix newlines:';

type TomlObject = Record<string, unknown>;

export interface NoteleafChatGptConfiguration {
  url: string;
  enabled: true;
  default_tools_approval_mode: 'writes';
}

export interface ChatGptDesktopPathOptions {
  /** Explicit override, primarily for portable installations and tests. */
  configPath?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

export interface ChatGptDesktopStatus {
  supported: boolean;
  platform: NodeJS.Platform;
  configPath: string | null;
  configExists: boolean;
  configValid: boolean;
  configured: boolean;
  upToDate: boolean;
  error: string | null;
}

export interface ChatGptDesktopConfigResult extends ChatGptDesktopStatus {
  changed: boolean;
  restartRequired: boolean;
  message: string;
}

interface ManagedBlock {
  start: number;
  end: number;
  removalStart: number;
  removalEnd: number;
  prefixNewlines: number;
  raw: string;
}

interface ParsedConfiguration {
  exists: boolean;
  raw: string | null;
  document: TomlObject;
  managedBlock: ManagedBlock | null;
}

class ChatGptConfigurationError extends Error {}

function isTomlObject(value: unknown): value is TomlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configError(path: string, reason: string): ChatGptConfigurationError {
  return new ChatGptConfigurationError(
    `ChatGPT's configuration at "${path}" ${reason}. Noteleaf left the file unchanged. `
    + 'Correct the configuration, then try enabling AI access again.',
  );
}

function pathForPlatform(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === 'win32' ? win32 : posix;
}

export function detectChatGptDesktopConfigPath(options: ChatGptDesktopPathOptions = {}): string | null {
  if (options.configPath) return options.configPath;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const paths = pathForPlatform(platform);
  const codexHome = environment.CODEX_HOME?.trim();
  const directory = codexHome || (homeDirectory ? paths.join(homeDirectory, '.codex') : '');
  return directory ? paths.join(directory, CONFIG_FILENAME) : null;
}

function normalizedLoopbackUrl(source: string): string {
  const value = source.trim();
  if (!value) throw new Error('The Noteleaf MCP endpoint is missing.');
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('The Noteleaf MCP endpoint is not a valid URL.');
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!['http:', 'https:'].includes(endpoint.protocol) || !loopbackHosts.has(endpoint.hostname)) {
    throw new Error('The Noteleaf MCP endpoint must use HTTP on the local loopback interface.');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('The Noteleaf MCP endpoint must not contain URL credentials.');
  }
  return endpoint.toString();
}

function desiredConfiguration(endpoint: string): NoteleafChatGptConfiguration {
  return {
    url: normalizedLoopbackUrl(endpoint),
    enabled: true,
    default_tools_approval_mode: 'writes',
  };
}

function noteleafTable(document: TomlObject): unknown {
  const servers = document.mcp_servers;
  return isTomlObject(servers) ? servers.noteleaf : undefined;
}

function configurationsMatch(current: unknown, expected: NoteleafChatGptConfiguration): boolean {
  if (!isTomlObject(current)) return false;
  return Object.keys(current).length === 3
    && current.url === expected.url
    && current.enabled === true
    && current.default_tools_approval_mode === 'writes';
}

function parseToml(raw: string, path: string, context = ''): TomlObject {
  try {
    const parsed = parse(raw.replace(/^\uFEFF/, ''));
    if (!isTomlObject(parsed)) throw new Error('the TOML root is not a table');
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    throw configError(path, `contains invalid TOML${context} (${detail})`);
  }
}

function decodeUtf8(bytes: Buffer, path: string): string {
  try {
    // Buffer.toString() replaces malformed bytes. Validate first so unrelated config bytes are never rewritten.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes.toString('utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid byte sequence';
    throw configError(path, `is not valid UTF-8 (${detail})`);
  }
}

function markerMatches(raw: string, marker: string): Array<{ index: number; end: number }> {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...raw.matchAll(new RegExp(`^${escaped}(?=\\r?$)`, 'gm'))].map((match) => ({
    index: match.index,
    end: match.index + match[0].length,
  }));
}

function findManagedBlock(raw: string, path: string): ManagedBlock | null {
  const starts = markerMatches(raw, MANAGED_BLOCK_START);
  const ends = markerMatches(raw, MANAGED_BLOCK_END);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
    throw configError(path, 'contains an incomplete or duplicate Noteleaf-managed block');
  }
  const blockRaw = raw.slice(starts[0].index, ends[0].end);
  const escapedStart = MANAGED_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedPadding = MANAGED_PADDING_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const metadata = blockRaw.match(new RegExp(`^${escapedStart}(?:\\r\\n|\\n)${escapedPadding} ([0-2])(?:\\r\\n|\\n)`));
  if (!metadata) throw configError(path, 'contains invalid Noteleaf-managed block metadata');

  const prefixNewlines = Number(metadata[1]);
  const newline = blockRaw.includes('\r\n') ? '\r\n' : '\n';
  const prefix = newline.repeat(prefixNewlines);
  const removalStart = starts[0].index - prefix.length;
  if (removalStart < 0 || raw.slice(removalStart, starts[0].index) !== prefix) {
    throw configError(path, 'contains invalid spacing before the Noteleaf-managed block');
  }
  let removalEnd = ends[0].end;
  if (raw.startsWith('\r\n', removalEnd)) removalEnd += 2;
  else if (raw.startsWith('\n', removalEnd)) removalEnd += 1;

  return {
    start: starts[0].index,
    end: ends[0].end,
    removalStart,
    removalEnd,
    prefixNewlines,
    raw: blockRaw,
  };
}

function validateManagedBlock(block: ManagedBlock, path: string): TomlObject {
  const parsed = parseToml(block.raw, path, ' inside the Noteleaf-managed block');
  const rootKeys = Object.keys(parsed);
  const servers = parsed.mcp_servers;
  if (rootKeys.length !== 1 || rootKeys[0] !== 'mcp_servers' || !isTomlObject(servers)
    || Object.keys(servers).length !== 1 || !isTomlObject(servers.noteleaf)) {
    throw configError(path, 'contains unexpected content inside the Noteleaf-managed block');
  }
  return servers.noteleaf;
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch(() => false);
}

async function resolveConfigurationTarget(path: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return path;
    try {
      return await realpath(path);
    } catch {
      throw configError(path, 'is a broken symbolic link');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path;
    throw error;
  }
}

async function readConfiguration(path: string): Promise<ParsedConfiguration> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, raw: null, document: {}, managedBlock: null };
    }
    throw error;
  }
  const raw = decodeUtf8(bytes, path);

  const document = parseToml(raw, path);
  const managedBlock = findManagedBlock(raw, path);
  const managedTable = managedBlock ? validateManagedBlock(managedBlock, path) : undefined;
  const completeTable = noteleafTable(document);
  if (completeTable !== undefined && !managedBlock) {
    throw configError(path, 'already contains an unmanaged [mcp_servers.noteleaf] table');
  }
  if (managedTable && !isDeepStrictEqual(completeTable, managedTable)) {
    throw configError(path, 'contains Noteleaf MCP settings outside the Noteleaf-managed block');
  }
  return { exists: true, raw, document, managedBlock };
}

function lineEnding(raw: string): string {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function renderManagedBlock(expected: NoteleafChatGptConfiguration, newline: string, prefixNewlines: number): string {
  const table = stringify({ mcp_servers: { noteleaf: expected } }).trimEnd().replaceAll('\n', newline);
  return `${MANAGED_BLOCK_START}${newline}${MANAGED_PADDING_PREFIX} ${prefixNewlines}${newline}${table}${newline}${MANAGED_BLOCK_END}`;
}

function enableContent(parsed: ParsedConfiguration, expected: NoteleafChatGptConfiguration): string {
  const raw = parsed.raw ?? '';
  const newline = parsed.managedBlock ? lineEnding(parsed.managedBlock.raw) : lineEnding(raw);
  if (parsed.managedBlock) {
    const block = renderManagedBlock(expected, newline, parsed.managedBlock.prefixNewlines);
    return raw.slice(0, parsed.managedBlock.start) + block + raw.slice(parsed.managedBlock.end);
  }
  const prefixNewlines = !raw || raw.endsWith(`${newline}${newline}`) ? 0 : raw.endsWith(newline) ? 1 : 2;
  const block = renderManagedBlock(expected, newline, prefixNewlines);
  if (!raw) return `${block}${newline}`;
  return `${raw}${newline.repeat(prefixNewlines)}${block}${newline}`;
}

function disableContent(parsed: ParsedConfiguration): string {
  if (!parsed.raw || !parsed.managedBlock) return parsed.raw ?? '';
  return parsed.raw.slice(0, parsed.managedBlock.removalStart) + parsed.raw.slice(parsed.managedBlock.removalEnd);
}

async function readCurrentRaw(path: string): Promise<string | null> {
  try {
    return decodeUtf8(await readFile(path), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeConfigurationAtomically(path: string, content: string, expectedRaw: string | null): Promise<void> {
  // Validate the exact bytes that will be installed before touching the user's file.
  const final = parseToml(content, path);
  const finalBlock = findManagedBlock(content, path);
  const managedTable = finalBlock ? validateManagedBlock(finalBlock, path) : undefined;
  const completeTable = noteleafTable(final);
  if (completeTable !== undefined && !finalBlock) {
    throw configError(path, 'would contain an unmanaged [mcp_servers.noteleaf] table');
  }
  if (managedTable && !isDeepStrictEqual(completeTable, managedTable)) {
    throw configError(path, 'would contain Noteleaf MCP settings outside the Noteleaf-managed block');
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const currentRaw = await readCurrentRaw(path);
  if (currentRaw !== expectedRaw) {
    throw new ChatGptConfigurationError(
      `ChatGPT's configuration at "${path}" changed while Noteleaf was updating it. `
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
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.chmod(existingMode);
    const latestRaw = await readCurrentRaw(path);
    if (latestRaw !== expectedRaw) {
      throw new ChatGptConfigurationError(
        `ChatGPT's configuration at "${path}" changed while Noteleaf was updating it. `
        + 'Nothing was overwritten; try enabling AI access again.',
      );
    }
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function unsupportedStatus(platform: NodeJS.Platform): ChatGptDesktopStatus {
  return {
    supported: false,
    platform,
    configPath: null,
    configExists: false,
    configValid: false,
    configured: false,
    upToDate: false,
    error: 'Automatic ChatGPT setup could not locate the local configuration folder.',
  };
}

function errorStatus(platform: NodeJS.Platform, configPath: string, error: unknown): ChatGptDesktopStatus {
  return {
    supported: true,
    platform,
    configPath,
    configExists: false,
    configValid: false,
    configured: false,
    upToDate: false,
    error: error instanceof Error ? error.message : 'ChatGPT configuration could not be read.',
  };
}

/** Safely installs and removes only Noteleaf's managed table in ChatGPT's local MCP configuration. */
export class ChatGptDesktopConfigService {
  private operation = Promise.resolve();
  private readonly platform: NodeJS.Platform;
  private readonly configPath: string | null;

  constructor(
    private readonly endpoint: () => string,
    options: ChatGptDesktopPathOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.configPath = detectChatGptDesktopConfigPath({ ...options, platform: this.platform });
  }

  private desiredConfiguration(): NoteleafChatGptConfiguration {
    return desiredConfiguration(this.endpoint());
  }

  private statusFromParsed(parsed: ParsedConfiguration): ChatGptDesktopStatus {
    const expected = this.desiredConfiguration();
    const configured = Boolean(parsed.managedBlock && isTomlObject(noteleafTable(parsed.document)));
    return {
      supported: true,
      platform: this.platform,
      configPath: this.configPath,
      configExists: parsed.exists,
      configValid: true,
      configured,
      upToDate: configured && configurationsMatch(noteleafTable(parsed.document), expected),
      error: null,
    };
  }

  async status(): Promise<ChatGptDesktopStatus> {
    if (!this.configPath) return unsupportedStatus(this.platform);
    try {
      const target = await resolveConfigurationTarget(this.configPath);
      return this.statusFromParsed(await readConfiguration(target));
    } catch (error) {
      const result = errorStatus(this.platform, this.configPath, error);
      result.configExists = await pathExists(this.configPath);
      return result;
    }
  }

  setEnabled(enabled: boolean): Promise<ChatGptDesktopConfigResult> {
    const result = this.operation.then(() => this.updateConfiguration(enabled));
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  enable(): Promise<ChatGptDesktopConfigResult> {
    return this.setEnabled(true);
  }

  disable(): Promise<ChatGptDesktopConfigResult> {
    return this.setEnabled(false);
  }

  private async updateConfiguration(enabled: boolean): Promise<ChatGptDesktopConfigResult> {
    if (!this.configPath) {
      return {
        ...unsupportedStatus(this.platform),
        changed: false,
        restartRequired: false,
        message: 'ChatGPT configuration was not changed.',
      };
    }

    try {
      const target = await resolveConfigurationTarget(this.configPath);
      const parsed = await readConfiguration(target);
      const expected = this.desiredConfiguration();
      const currentlyConfigured = Boolean(parsed.managedBlock);
      const alreadyCurrent = currentlyConfigured && configurationsMatch(noteleafTable(parsed.document), expected);
      if ((enabled && alreadyCurrent) || (!enabled && !currentlyConfigured)) {
        return {
          ...this.statusFromParsed(parsed),
          changed: false,
          restartRequired: false,
          message: enabled ? 'AI access is already enabled for ChatGPT.' : 'AI access is already disabled for ChatGPT.',
        };
      }

      const content = enabled ? enableContent(parsed, expected) : disableContent(parsed);
      await writeConfigurationAtomically(target, content, parsed.raw);
      const updated = await readConfiguration(target);
      return {
        ...this.statusFromParsed(updated),
        changed: true,
        restartRequired: true,
        message: enabled
          ? 'AI access was enabled. Restart ChatGPT Desktop once to connect Noteleaf.'
          : 'AI access was disabled. Restart ChatGPT Desktop to finish disconnecting Noteleaf.',
      };
    } catch (error) {
      const status = errorStatus(this.platform, this.configPath, error);
      status.configExists = await pathExists(this.configPath);
      return {
        ...status,
        changed: false,
        restartRequired: false,
        message: 'ChatGPT configuration was not changed.',
      };
    }
  }
}
