import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createArchive, createBackupKeyMaterial, extractArchive, readBackupManifest, type BackupKeyMaterial } from './archive.js';

const PASSWORD = 'a long backup password only I know';

function legacyArchive(entries: Array<{ path: string; body: Buffer }>): Buffer {
  const pieces: Buffer[] = [Buffer.from('NOTES_BACKUP_V1\n')];
  for (const entry of entries) {
    pieces.push(Buffer.from(`${JSON.stringify({ path: entry.path, size: entry.body.length, sha256: createHash('sha256').update(entry.body).digest('hex') })}\n`));
    pieces.push(entry.body, Buffer.from('\n'));
  }
  pieces.push(Buffer.from('{"end":true}\n'));
  return gzipSync(Buffer.concat(pieces));
}

describe('Noteleaf backup archive', () => {
  let root: string;
  let source: string;
  let archive: string;
  let restored: string;
  let material: BackupKeyMaterial;

  beforeEach(async () => {
    root = join(process.cwd(), `.test-backup-${randomUUID()}`);
    source = join(root, 'source');
    archive = join(root, 'library.notesbackup');
    restored = join(root, 'restored');
    await mkdir(join(source, 'attachments', 'page-1'), { recursive: true });
    await writeFile(join(source, 'notes.db'), Buffer.from('sqlite snapshot test'));
    await writeFile(join(source, 'attachments', 'page-1', 'image.bin'), Buffer.from([0, 1, 2, 3, 255]));
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ formatVersion: 1, createdAt: '2026-08-25T00:00:00.000Z', appVersion: '0.1.0' }));
    material = await createBackupKeyMaterial(PASSWORD);
  });

  afterEach(async () => { material.rootKey.fill(0); await rm(root, { recursive: true, force: true }); });

  it('encrypts and round-trips the database, manifest, and nested attachments', async () => {
    const output = await createArchive(source, archive, material);
    expect(output.size).toBeGreaterThan(0);
    expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
    const encrypted = await readFile(archive);
    expect(encrypted.subarray(0, 29).toString('utf8')).toBe('NOTELEAF_ENCRYPTED_BACKUP_V2\n');
    expect(encrypted.includes(Buffer.from('sqlite snapshot test'))).toBe(false);
    expect(encrypted.includes(Buffer.from('NOTES_BACKUP_V1'))).toBe(false);
    await extractArchive(archive, restored, { material });
    expect(await readFile(join(restored, 'notes.db'), 'utf8')).toBe('sqlite snapshot test');
    expect(await readFile(join(restored, 'attachments', 'page-1', 'image.bin'))).toEqual(Buffer.from([0, 1, 2, 3, 255]));
    expect(await readBackupManifest(restored)).toMatchObject({ formatVersion: 1, appVersion: '0.1.0' });
  });

  it('restores on another computer using only the password and archive metadata', async () => {
    await createArchive(source, archive, material);
    await extractArchive(archive, restored, { passphrase: PASSWORD });
    expect(await readFile(join(restored, 'notes.db'), 'utf8')).toBe('sqlite snapshot test');
  });

  it('rejects a wrong password without leaving restored plaintext', async () => {
    await createArchive(source, archive, material);
    await expect(extractArchive(archive, restored, { passphrase: 'this password is definitely wrong' })).rejects.toThrow(/incorrect|damaged/i);
    await expect(readFile(join(restored, 'notes.db'))).rejects.toThrow();
  });

  it('rejects tampered and truncated ciphertext', async () => {
    await createArchive(source, archive, material);
    const original = await readFile(archive);
    const headerEnd = original.indexOf(10, Buffer.byteLength('NOTELEAF_ENCRYPTED_BACKUP_V2\n')) + 1;
    const tampered = Buffer.from(original);
    tampered[headerEnd + 4] ^= 0x80;
    await writeFile(archive, tampered);
    await expect(extractArchive(archive, restored, { material })).rejects.toThrow(/incorrect|damaged/i);
    await writeFile(archive, original.subarray(0, original.length - 20));
    await expect(extractArchive(archive, restored, { material })).rejects.toThrow();
  });

  it('rejects unsupported encryption metadata before decryption', async () => {
    await createArchive(source, archive, material);
    const original = await readFile(archive);
    const bad = Buffer.from(original.toString('binary').replace('"formatVersion":2', '"formatVersion":9'), 'binary');
    await writeFile(archive, bad);
    await expect(extractArchive(archive, restored, { material })).rejects.toThrow(/metadata/i);
  });

  it('creates different ciphertext for the same files and key', async () => {
    const second = join(root, 'second.notesbackup');
    await createArchive(source, archive, material);
    await createArchive(source, second, material);
    expect(await readFile(second)).not.toEqual(await readFile(archive));
  });

  it('still restores legacy unencrypted V1 backups', async () => {
    const manifest = Buffer.from(JSON.stringify({ formatVersion: 1, createdAt: '2026-08-25T00:00:00.000Z', appVersion: '0.1.0' }));
    await writeFile(archive, legacyArchive([{ path: 'notes.db', body: Buffer.from('legacy database') }, { path: 'manifest.json', body: manifest }]));
    await extractArchive(archive, restored);
    expect(await readFile(join(restored, 'notes.db'), 'utf8')).toBe('legacy database');
  });

  it('rejects files that are not Noteleaf backup archives', async () => {
    await writeFile(archive, 'not a backup');
    await expect(extractArchive(archive, restored)).rejects.toThrow();
  });
});
