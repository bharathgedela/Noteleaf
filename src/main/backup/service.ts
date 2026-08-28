import Database from 'better-sqlite3';
import { app, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { BackupFrequency, BackupInfo, BackupStatus } from '../../shared/types.js';
import type { NotesRepository } from '../database/repository.js';
import { createArchive, extractArchive, readBackupManifest } from './archive.js';

const BACKUP_PATTERN = /^(?:Noteleaf|Notes)-backup-(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})(?:-\d{3})?\.notesbackup$/;
const PENDING_FILE = 'restore-pending.json';

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function timestamp(date = new Date()): string {
  return date.toISOString().replace('T', '_').replaceAll(':', '-').replace('.', '-').replace('Z', '');
}

function providerFor(folder: string): BackupStatus['provider'] {
  if (!folder) return 'none';
  const normalized = resolve(folder).toLowerCase();
  const oneDriveRoots = [process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer].filter(Boolean).map((value) => resolve(value as string).toLowerCase());
  if (oneDriveRoots.some((root) => normalized === root || normalized.startsWith(`${root}${sep}`)) || normalized.includes(`${sep}onedrive`)) return 'onedrive';
  if (normalized.includes('google drive') || normalized.includes('googledrive') || normalized.includes(`${sep}my drive`)) return 'google-drive';
  return 'local';
}

async function validateDatabase(path: string): Promise<void> {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('quick_check') as Array<{ quick_check: string }>;
    if (integrity[0]?.quick_check !== 'ok') throw new Error('The database in this backup did not pass its integrity check.');
    const required = ['notebooks', 'sections', 'pages', 'settings'];
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${required.map(() => '?').join(',')})`).all(...required) as Array<{ name: string }>;
    if (rows.length !== required.length) throw new Error('The backup does not contain a complete Noteleaf database.');
  } finally { db.close(); }
}

async function preferredCloudFolder(): Promise<string | undefined> {
  const candidates = [process.env.OneDriveCommercial, process.env.OneDriveConsumer, process.env.OneDrive].filter(Boolean) as string[];
  const user = app.getPath('home');
  candidates.push(join(user, 'Google Drive'), join(user, 'My Drive'));
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return undefined;
}

export async function applyPendingRestore(dataDirectory: string): Promise<void> {
  const markerPath = join(dataDirectory, PENDING_FILE);
  if (!await exists(markerPath)) return;
  let staging = '';
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { staging?: unknown };
    if (typeof marker.staging !== 'string') throw new Error('Restore marker is invalid.');
    staging = resolve(marker.staging);
    const fromData = relative(resolve(dataDirectory), staging);
    if (!fromData.startsWith('restore-pending-') || fromData.includes(`..${sep}`) || fromData.includes(':')) throw new Error('Restore location is unsafe.');
    const restoredDatabase = join(staging, 'notes.db');
    await validateDatabase(restoredDatabase);

    const targetDatabase = join(dataDirectory, 'notes.db');
    const newDatabase = join(dataDirectory, '.notes-restore-new.db');
    const previousDatabase = join(dataDirectory, '.notes-restore-previous.db');
    const targetAttachments = join(dataDirectory, 'attachments');
    const previousAttachments = join(dataDirectory, '.attachments-restore-previous');
    await copyFile(restoredDatabase, newDatabase);
    await rm(previousDatabase, { force: true });
    await rm(previousAttachments, { recursive: true, force: true });
    try {
      if (await exists(targetDatabase)) await rename(targetDatabase, previousDatabase);
      await rename(newDatabase, targetDatabase);
      if (await exists(targetAttachments)) await rename(targetAttachments, previousAttachments);
      const restoredAttachments = join(staging, 'attachments');
      if (await exists(restoredAttachments)) await cp(restoredAttachments, targetAttachments, { recursive: true });
      await rm(`${targetDatabase}-wal`, { force: true });
      await rm(`${targetDatabase}-shm`, { force: true });
      await rm(previousDatabase, { force: true });
      await rm(previousAttachments, { recursive: true, force: true });
      await rm(join(dataDirectory, 'restore-error.txt'), { force: true });
    } catch (error) {
      await rm(targetDatabase, { force: true }).catch(() => undefined);
      if (await exists(previousDatabase)) await rename(previousDatabase, targetDatabase).catch(() => undefined);
      await rm(targetAttachments, { recursive: true, force: true }).catch(() => undefined);
      if (await exists(previousAttachments)) await rename(previousAttachments, targetAttachments).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await writeFile(join(dataDirectory, 'restore-error.txt'), `${new Date().toISOString()}\n${message}`, 'utf8').catch(() => undefined);
    throw error;
  } finally {
    await rm(markerPath, { force: true }).catch(() => undefined);
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class BackupService {
  private running: Promise<BackupInfo> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly repository: NotesRepository, private readonly dataDirectory: string) {}

  private async list(folder: string): Promise<BackupInfo[]> {
    if (!folder || !await exists(folder)) return [];
    const entries = await readdir(folder, { withFileTypes: true });
    const backups: BackupInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !BACKUP_PATTERN.test(entry.name)) continue;
      const path = join(folder, entry.name);
      const metadata = await stat(path);
      backups.push({ path, filename: entry.name, createdAt: metadata.mtime.toISOString(), size: metadata.size });
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async status(): Promise<BackupStatus> {
    const settings = this.repository.getSettings();
    return {
      folder: settings.backupFolder,
      provider: providerFor(settings.backupFolder),
      frequency: settings.backupFrequency,
      retention: settings.backupRetention,
      lastBackupAt: settings.lastBackupAt,
      lastBackupError: settings.lastBackupError,
      backups: await this.list(settings.backupFolder),
    };
  }

  async chooseFolder(): Promise<BackupStatus | null> {
    const settings = this.repository.getSettings();
    const selection = await dialog.showOpenDialog({
      title: 'Choose backup folder',
      defaultPath: settings.backupFolder || await preferredCloudFolder() || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Use this folder',
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const folder = resolve(selection.filePaths[0]);
    await mkdir(folder, { recursive: true });
    this.repository.updateSettings({ backupFolder: folder, backupFrequency: 'hourly', lastBackupError: null });
    return this.status();
  }

  private async createAt(folder: string, updateStatus: boolean): Promise<BackupInfo> {
    await mkdir(folder, { recursive: true });
    const staging = join(this.dataDirectory, `backup-staging-${randomUUID()}`);
    const filename = `Noteleaf-backup-${timestamp()}.notesbackup`;
    const destination = join(folder, filename);
    try {
      await mkdir(staging, { recursive: true });
      await this.repository.backupTo(join(staging, 'notes.db'));
      const attachments = join(this.dataDirectory, 'attachments');
      if (await exists(attachments)) await cp(attachments, join(staging, 'attachments'), { recursive: true });
      await writeFile(join(staging, 'manifest.json'), JSON.stringify({ formatVersion: 1, createdAt: new Date().toISOString(), appVersion: app.getVersion() }, null, 2), 'utf8');
      const result = await createArchive(staging, destination);
      const createdAt = new Date().toISOString();
      if (updateStatus) {
        this.repository.updateSettings({ lastBackupAt: createdAt, lastBackupError: null });
        await this.enforceRetention(folder, this.repository.getSettings().backupRetention);
      }
      return { path: destination, filename, createdAt, size: result.size, sha256: result.sha256 };
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined);
      if (updateStatus) this.repository.updateSettings({ lastBackupError: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { await rm(staging, { recursive: true, force: true }).catch(() => undefined); }
  }

  async create(): Promise<BackupInfo> {
    if (this.running) return this.running;
    const folder = this.repository.getSettings().backupFolder;
    if (!folder) throw new Error('Choose a backup folder first.');
    this.running = this.createAt(folder, true);
    try { return await this.running; } finally { this.running = null; }
  }

  private async enforceRetention(folder: string, retention: number): Promise<void> {
    const backups = await this.list(folder);
    for (const backup of backups.slice(Math.max(1, retention))) await rm(backup.path, { force: true });
  }

  async setSchedule(frequency: BackupFrequency, retention: number): Promise<BackupStatus> {
    const safeFrequency: BackupFrequency = frequency === 'hourly' || frequency === 'daily' || frequency === 'weekly' ? frequency : 'off';
    const safeRetention = Math.min(100, Math.max(1, Math.round(retention) || 10));
    this.repository.updateSettings({ backupFrequency: safeFrequency, backupRetention: safeRetention });
    const folder = this.repository.getSettings().backupFolder;
    if (folder) await this.enforceRetention(folder, safeRetention);
    return this.status();
  }

  async openFolder(): Promise<void> {
    const folder = this.repository.getSettings().backupFolder;
    if (!folder) throw new Error('Choose a backup folder first.');
    await mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  }

  async restore(): Promise<boolean> {
    const settings = this.repository.getSettings();
    const selected = await dialog.showOpenDialog({
      title: 'Restore Noteleaf backup',
      defaultPath: settings.backupFolder || app.getPath('documents'),
      filters: [{ name: 'Noteleaf backup', extensions: ['notesbackup'] }],
      properties: ['openFile'],
    });
    if (selected.canceled || !selected.filePaths[0]) return false;

    const staging = join(this.dataDirectory, `restore-pending-${randomUUID()}`);
    try {
      await extractArchive(selected.filePaths[0], staging);
      const manifest = await readBackupManifest(staging);
      await validateDatabase(join(staging, 'notes.db'));
      const response = await dialog.showMessageBox({
        type: 'warning',
        title: 'Restore this backup?',
        message: `Restore Noteleaf from ${new Date(manifest.createdAt).toLocaleString()}?`,
        detail: 'Your current notes will be backed up first. Noteleaf will then restart and replace the current library with this backup.',
        buttons: ['Cancel', 'Restore and restart'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) { await rm(staging, { recursive: true, force: true }); return false; }
      const safetyFolder = settings.backupFolder || join(this.dataDirectory, 'Backups');
      await this.createAt(safetyFolder, Boolean(settings.backupFolder));
      await writeFile(join(this.dataDirectory, PENDING_FILE), JSON.stringify({ staging, requestedAt: new Date().toISOString() }), 'utf8');
      this.stop();
      this.repository.close();
      app.relaunch();
      app.exit(0);
      return true;
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  startScheduler(): void {
    const check = async () => {
      const settings = this.repository.getSettings();
      if (!settings.backupFolder || settings.backupFrequency === 'off' || this.running) return;
      const interval = settings.backupFrequency === 'hourly' ? 60 * 60 * 1000 : settings.backupFrequency === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      const last = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
      if (!Number.isFinite(last) || Date.now() - last >= interval) await this.create().catch(() => undefined);
    };
    void check();
    this.timer = setInterval(() => void check(), 5 * 60 * 1000);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
