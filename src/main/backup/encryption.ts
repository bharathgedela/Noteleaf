import { safeStorage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBackupKeyMaterial, type BackupKeyMaterial } from './archive.js';

const MIN_PASSWORD_LENGTH = 16;
const MAX_PASSWORD_LENGTH = 1024;

export function validateBackupPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) throw new Error(`Backup password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`);
  return password;
}

export class BackupEncryptionStore {
  private readonly path: string;

  constructor(dataDirectory: string) { this.path = join(dataDirectory, 'backup-encryption-key.bin'); }

  async configured(): Promise<boolean> {
    try { await readFile(this.path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  async setPassword(password: unknown): Promise<void> {
    const valid = validateBackupPassword(password);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
    const material = await createBackupKeyMaterial(valid);
    try {
      const serialized = JSON.stringify({ rootKey: material.rootKey.toString('base64'), recoverySalt: material.recoverySalt.toString('base64') });
      await writeFile(this.path, safeStorage.encryptString(serialized), { mode: 0o600 });
    } finally { material.rootKey.fill(0); }
  }

  async material(): Promise<BackupKeyMaterial> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
    try {
      const value = JSON.parse(safeStorage.decryptString(await readFile(this.path))) as { rootKey?: unknown; recoverySalt?: unknown };
      if (typeof value.rootKey !== 'string' || typeof value.recoverySalt !== 'string') throw new Error('Stored backup encryption key is invalid.');
      const material = { rootKey: Buffer.from(value.rootKey, 'base64'), recoverySalt: Buffer.from(value.recoverySalt, 'base64') };
      if (material.rootKey.length !== 32 || material.recoverySalt.length !== 16 || material.rootKey.toString('base64') !== value.rootKey || material.recoverySalt.toString('base64') !== value.recoverySalt) throw new Error('Stored backup encryption key is invalid.');
      return material;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Set a backup password before creating or restoring encrypted backups.');
      throw error;
    }
  }
}
