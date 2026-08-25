import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createArchive, extractArchive, readBackupManifest } from './archive.js';

describe('Notes backup archive', () => {
  let root: string;
  let source: string;
  let archive: string;
  let restored: string;

  beforeEach(async () => {
    root = join(process.cwd(), `.test-backup-${randomUUID()}`);
    source = join(root, 'source');
    archive = join(root, 'library.notesbackup');
    restored = join(root, 'restored');
    await mkdir(join(source, 'attachments', 'page-1'), { recursive: true });
    await writeFile(join(source, 'notes.db'), Buffer.from('sqlite snapshot test'));
    await writeFile(join(source, 'attachments', 'page-1', 'image.bin'), Buffer.from([0, 1, 2, 3, 255]));
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ formatVersion: 1, createdAt: '2026-08-25T00:00:00.000Z', appVersion: '0.1.0' }));
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('round-trips the database, manifest, and nested attachments', async () => {
    const output = await createArchive(source, archive);
    expect(output.size).toBeGreaterThan(0);
    expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
    await extractArchive(archive, restored);
    expect(await readFile(join(restored, 'notes.db'), 'utf8')).toBe('sqlite snapshot test');
    expect(await readFile(join(restored, 'attachments', 'page-1', 'image.bin'))).toEqual(Buffer.from([0, 1, 2, 3, 255]));
    expect(await readBackupManifest(restored)).toMatchObject({ formatVersion: 1, appVersion: '0.1.0' });
  });

  it('rejects files that are not Notes backup archives', async () => {
    await writeFile(archive, 'not a backup');
    await expect(extractArchive(archive, restored)).rejects.toThrow();
  });
});
