import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeDesktopConfigService,
  detectClaudeDesktopConfigPath,
  type NoteleafStdioConfiguration,
} from './claude-desktop.js';

const desired: NoteleafStdioConfiguration = {
  command: 'C:\\Program Files\\Noteleaf\\Noteleaf.exe',
  args: ['C:\\Program Files\\Noteleaf\\resources\\app.asar\\dist\\main\\mcp\\cli.js', '--data-dir=C:\\Noteleaf Data'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};

describe('ClaudeDesktopConfigService', () => {
  let directory: string;
  let configPath: string;
  let service: ClaudeDesktopConfigService;

  beforeEach(async () => {
    directory = join(process.cwd(), `.test-claude-config-${randomUUID()}`);
    configPath = join(directory, 'Claude', 'claude_desktop_config.json');
    await mkdir(join(directory, 'Claude'), { recursive: true });
    service = new ClaudeDesktopConfigService(() => desired, { configPath, platform: 'win32' });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('detects the standard Windows and macOS configuration paths', () => {
    expect(detectClaudeDesktopConfigPath({
      platform: 'win32',
      environment: { APPDATA: 'C:\\Users\\Bharath\\AppData\\Roaming' },
      homeDirectory: 'unused',
    })).toBe('C:\\Users\\Bharath\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
    expect(detectClaudeDesktopConfigPath({
      platform: 'darwin',
      environment: {},
      homeDirectory: '/Users/bharath',
    })).toBe('/Users/bharath/Library/Application Support/Claude/claude_desktop_config.json');
    expect(detectClaudeDesktopConfigPath({ platform: 'linux', environment: {}, homeDirectory: '/home/user' })).toBeNull();
  });

  it('enables Noteleaf while preserving every unrelated Claude setting and MCP server', async () => {
    const original = {
      globalShortcut: 'Ctrl+Space',
      mcpServers: {
        filesystem: { command: 'filesystem-server', args: ['/notes'] },
        noteleaf: { command: 'old-noteleaf', args: [], env: {} },
      },
      preferences: { theme: 'dark' },
    };
    await writeFile(configPath, JSON.stringify(original, null, 4), 'utf8');

    const result = await service.enable();
    const updated = JSON.parse(await readFile(configPath, 'utf8')) as typeof original;

    expect(result).toMatchObject({ changed: true, configured: true, upToDate: true, configValid: true, restartRequired: true });
    expect(updated.globalShortcut).toBe(original.globalShortcut);
    expect(updated.preferences).toEqual(original.preferences);
    expect(updated.mcpServers.filesystem).toEqual(original.mcpServers.filesystem);
    expect(updated.mcpServers.noteleaf).toEqual(desired);
  });

  it('creates the configuration once and is idempotent on subsequent enables', async () => {
    expect(await service.status()).toMatchObject({ configExists: false, configured: false, configValid: true });
    expect(await service.enable()).toMatchObject({ changed: true, configured: true, upToDate: true });
    const firstContent = await readFile(configPath, 'utf8');

    expect(await service.enable()).toMatchObject({ changed: false, configured: true, upToDate: true, restartRequired: false });
    expect(await readFile(configPath, 'utf8')).toBe(firstContent);
  });

  it('disables only Noteleaf and leaves the rest of the configuration untouched', async () => {
    const original = {
      mcpServers: {
        noteleaf: desired,
        github: { command: 'github-mcp', args: ['stdio'] },
      },
      custom: ['keep', 'this'],
    };
    await writeFile(configPath, JSON.stringify(original), 'utf8');

    expect(await service.disable()).toMatchObject({ changed: true, configured: false, restartRequired: true });
    const updated = JSON.parse(await readFile(configPath, 'utf8')) as typeof original;
    expect(updated.custom).toEqual(original.custom);
    expect(updated.mcpServers.github).toEqual(original.mcpServers.github);
    expect(updated.mcpServers).not.toHaveProperty('noteleaf');
    expect(await service.disable()).toMatchObject({ changed: false, configured: false, restartRequired: false });
  });

  it.each([
    ['invalid JSON', '{ "mcpServers": { broken }'],
    ['a non-object root', '[]'],
    ['a non-object mcpServers value', '{ "mcpServers": true }'],
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
});
