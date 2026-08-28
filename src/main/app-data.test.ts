import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateLegacyAppData } from './app-data.js';

describe('Noteleaf app-data migration', () => {
  let root: string;

  beforeEach(() => {
    root = join(process.cwd(), `.test-noteleaf-data-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('copies a legacy Notes library without removing the original', () => {
    const legacy = join(root, 'Notes');
    const current = join(root, 'Noteleaf');
    mkdirSync(join(legacy, 'attachments'), { recursive: true });
    writeFileSync(join(legacy, 'notes.db'), 'legacy database');
    writeFileSync(join(legacy, 'attachments', 'image.png'), 'attachment');

    expect(migrateLegacyAppData(root, current)).toBe(true);
    expect(readFileSync(join(current, 'notes.db'), 'utf8')).toBe('legacy database');
    expect(readFileSync(join(current, 'attachments', 'image.png'), 'utf8')).toBe('attachment');
    expect(readFileSync(join(legacy, 'notes.db'), 'utf8')).toBe('legacy database');
  });

  it('never overwrites an existing Noteleaf library', () => {
    const legacy = join(root, 'Notes');
    const current = join(root, 'Noteleaf');
    mkdirSync(legacy, { recursive: true });
    mkdirSync(current, { recursive: true });
    writeFileSync(join(legacy, 'notes.db'), 'legacy');
    writeFileSync(join(current, 'notes.db'), 'current');

    expect(migrateLegacyAppData(root, current)).toBe(false);
    expect(readFileSync(join(current, 'notes.db'), 'utf8')).toBe('current');
  });
});
