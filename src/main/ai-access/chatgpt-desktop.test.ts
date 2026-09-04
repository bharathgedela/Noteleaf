import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChatGptDesktopConfigService,
  detectChatGptDesktopConfigPath,
} from './chatgpt-desktop.js';

const START = '# >>> Noteleaf managed MCP server >>>';
const END = '# <<< Noteleaf managed MCP server <<<';
const PADDING = '# Noteleaf managed prefix newlines:';
const firstEndpoint = 'http://127.0.0.1:37931/mcp/0123456789abcdef';

function parsedNoteleaf(raw: string): Record<string, unknown> {
  const document = parse(raw) as Record<string, Record<string, Record<string, unknown>>>;
  return document.mcp_servers.noteleaf;
}

describe('ChatGptDesktopConfigService', () => {
  let directory: string;
  let configPath: string;
  let endpoint: string;
  let service: ChatGptDesktopConfigService;

  beforeEach(async () => {
    directory = join(process.cwd(), `.test-chatgpt-config-${randomUUID()}`);
    configPath = join(directory, '.codex', 'config.toml');
    await mkdir(join(directory, '.codex'), { recursive: true });
    endpoint = firstEndpoint;
    service = new ChatGptDesktopConfigService(() => endpoint, { configPath, platform: 'darwin' });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('detects CODEX_HOME and standard home configuration paths on every supported desktop platform', () => {
    expect(detectChatGptDesktopConfigPath({
      platform: 'darwin',
      environment: { CODEX_HOME: '/Volumes/Private/Codex' },
      homeDirectory: '/Users/bharath',
    })).toBe('/Volumes/Private/Codex/config.toml');
    expect(detectChatGptDesktopConfigPath({
      platform: 'win32',
      environment: {},
      homeDirectory: 'C:\\Users\\Bharath',
    })).toBe('C:\\Users\\Bharath\\.codex\\config.toml');
    expect(detectChatGptDesktopConfigPath({
      platform: 'linux',
      environment: { CODEX_HOME: '   ' },
      homeDirectory: '/home/bharath',
    })).toBe('/home/bharath/.codex/config.toml');
    expect(detectChatGptDesktopConfigPath({
      platform: 'darwin',
      environment: {},
      homeDirectory: '',
    })).toBeNull();
  });

  it('appends a parseable managed table without reformatting unrelated TOML', async () => {
    const original = [
      '# Keep this comment and spacing exactly.',
      'model = "gpt-5.6"',
      '',
      '[projects."/Users/bharath/Notes"]',
      'trust_level="trusted" # deliberate compact style',
      '',
    ].join('\n');
    await writeFile(configPath, original, 'utf8');

    const result = await service.enable();
    const updated = await readFile(configPath, 'utf8');

    expect(result).toMatchObject({
      changed: true,
      configured: true,
      upToDate: true,
      configValid: true,
      restartRequired: true,
      error: null,
    });
    expect(updated.startsWith(original)).toBe(true);
    expect(updated).toContain(`${START}\n${PADDING} 1\n[mcp_servers.noteleaf]\n`);
    expect(updated).toContain(`\n${END}\n`);
    expect(parsedNoteleaf(updated)).toEqual({
      url: firstEndpoint,
      enabled: true,
      default_tools_approval_mode: 'writes',
    });
  });

  it('creates a private configuration once and queues concurrent enables idempotently', async () => {
    expect(await service.status()).toMatchObject({ configExists: false, configured: false, configValid: true });

    const [first, second] = await Promise.all([service.enable(), service.enable()]);
    expect([first.changed, second.changed].sort()).toEqual([false, true]);
    expect(first.configured).toBe(true);
    expect(second.configured).toBe(true);
    const content = await readFile(configPath, 'utf8');
    expect(content.match(new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);

    expect(await service.enable()).toMatchObject({
      changed: false,
      configured: true,
      upToDate: true,
      restartRequired: false,
    });
    expect(await readFile(configPath, 'utf8')).toBe(content);
  });

  it('updates only its delimited block when the loopback endpoint changes', async () => {
    const prefix = 'model = "gpt-5.6"\r\n\r\n';
    const suffix = '\r\n\r\n[features]\r\nplugins = true\r\n';
    const staleBlock = [
      START,
      `${PADDING} 0`,
      '[mcp_servers.noteleaf]',
      'url = "http://127.0.0.1:37931/mcp/old"',
      'enabled = false',
      'default_tools_approval_mode = "prompt"',
      END,
    ].join('\r\n');
    await writeFile(configPath, prefix + staleBlock + suffix, 'utf8');

    expect(await service.status()).toMatchObject({ configured: true, upToDate: false, configValid: true });
    endpoint = 'http://localhost:49152/mcp/new-token';
    expect(await service.enable()).toMatchObject({ changed: true, configured: true, upToDate: true });

    const updated = await readFile(configPath, 'utf8');
    expect(updated.startsWith(prefix)).toBe(true);
    expect(updated.endsWith(suffix)).toBe(true);
    expect(updated).not.toContain('/mcp/old');
    expect(updated).toContain('url = "http://localhost:49152/mcp/new-token"');
    expect(updated).not.toMatch(/(?<!\r)\n/);
  });

  it('disables by removing only the managed block and restoring every original byte', async () => {
    const original = [
      'model = "gpt-5.6"',
      '',
      '[mcp_servers.github]',
      'command = "github-mcp"',
      '',
    ].join('\n');
    await writeFile(configPath, original, 'utf8');

    expect(await service.enable()).toMatchObject({ changed: true, configured: true });
    expect(await service.disable()).toMatchObject({
      changed: true,
      configured: false,
      restartRequired: true,
    });
    expect(await readFile(configPath, 'utf8')).toBe(original);
    expect(await service.disable()).toMatchObject({ changed: false, configured: false, restartRequired: false });
  });

  it.each([
    ['empty content', ''],
    ['no final newline', 'model = "gpt-5.6"'],
    ['one LF', 'model = "gpt-5.6"\n'],
    ['two LFs', 'model = "gpt-5.6"\n\n'],
    ['one CRLF', 'model = "gpt-5.6"\r\n'],
    ['two CRLFs', 'model = "gpt-5.6"\r\n\r\n'],
    ['a UTF-8 BOM', '\uFEFFmodel = "gpt-5.6"\n'],
  ])('round-trips %s across repeated enable/disable cycles', async (_description, original) => {
    await writeFile(configPath, original, 'utf8');

    for (let cycle = 0; cycle < 2; cycle += 1) {
      expect(await service.enable()).toMatchObject({ changed: true, configured: true });
      expect(await service.disable()).toMatchObject({ changed: true, configured: false });
      expect(await readFile(configPath, 'utf8')).toBe(original);
    }
  });

  it.each([
    ['invalid TOML', 'model = "unterminated'],
    ['an unmanaged table', `[mcp_servers.noteleaf]\nurl = "${firstEndpoint}"\n`],
    ['an unmanaged quoted table', `[mcp_servers."noteleaf"]\nurl = "${firstEndpoint}"\n`],
    ['an unmanaged dotted key', `mcp_servers.noteleaf.url = "${firstEndpoint}"\n`],
    ['an incomplete marker block', `${START}\n[mcp_servers.noteleaf]\nurl = "${firstEndpoint}"\n`],
    ['unexpected content in the managed block', `${START}\n[mcp_servers.noteleaf]\nurl = "${firstEndpoint}"\n[unrelated]\nkeep = true\n${END}\n`],
    ['an unmanaged Noteleaf extension outside the managed block', `${START}\n[mcp_servers.noteleaf]\nurl = "${firstEndpoint}"\nenabled = true\ndefault_tools_approval_mode = "writes"\n${END}\n[mcp_servers.noteleaf.auth]\nmode = "custom"\n`],
  ])('does not overwrite %s', async (_description, original) => {
    await writeFile(configPath, original, 'utf8');

    const enableResult = await service.enable();
    expect(enableResult).toMatchObject({ changed: false, configValid: false, configured: false });
    expect(enableResult.error).toContain('Noteleaf left the file unchanged');
    expect(await readFile(configPath, 'utf8')).toBe(original);

    const disableResult = await service.disable();
    expect(disableResult).toMatchObject({ changed: false, configValid: false, configured: false });
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it.each([
    'https://example.com/mcp/token',
    'file:///tmp/noteleaf.sock',
    'http://user:password@127.0.0.1:37931/mcp/token',
    'not a URL',
  ])('rejects a non-loopback or unsafe endpoint without touching the configuration: %s', async (unsafeEndpoint) => {
    const original = 'model = "gpt-5.6"\n';
    endpoint = unsafeEndpoint;
    await writeFile(configPath, original, 'utf8');

    const result = await service.enable();
    expect(result).toMatchObject({ changed: false, configValid: false, configured: false });
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it.skipIf(process.platform === 'win32')('preserves existing POSIX file permissions during an atomic update', async () => {
    await writeFile(configPath, 'model = "gpt-5.6"\n', 'utf8');
    await chmod(configPath, 0o640);

    expect(await service.enable()).toMatchObject({ changed: true });
    expect((await stat(configPath)).mode & 0o777).toBe(0o640);
  });

  it.skipIf(process.platform === 'win32')('updates a symlink target without replacing the symlink', async () => {
    const targetPath = join(directory, 'shared-config.toml');
    const original = 'model = "gpt-5.6"\n';
    await writeFile(targetPath, original, 'utf8');
    await symlink(targetPath, configPath);

    expect(await service.enable()).toMatchObject({ changed: true, configured: true });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(targetPath, 'utf8')).toContain('[mcp_servers.noteleaf]');

    expect(await service.disable()).toMatchObject({ changed: true, configured: false });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(targetPath, 'utf8')).toBe(original);
  });

  it('rejects invalid UTF-8 without changing any bytes', async () => {
    const original = Buffer.from([0x6d, 0x6f, 0x64, 0x65, 0x6c, 0x20, 0x3d, 0x20, 0xff]);
    await writeFile(configPath, original);

    const result = await service.enable();
    expect(result).toMatchObject({ changed: false, configValid: false, configured: false });
    expect(result.error).toContain('is not valid UTF-8');
    expect(await readFile(configPath)).toEqual(original);
  });
});
