import Database from 'better-sqlite3';
import { app, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { BackupDestination, BackupFrequency, BackupInfo, BackupStatus, CloudBackupProvider } from '../../shared/types.js';
import type { NotesRepository } from '../database/repository.js';
import { createArchive, extractArchive, readBackupManifest } from './archive.js';
import { CloudBackupStore, cloudError } from './cloud.js';
import { BackupEncryptionStore } from './encryption.js';

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
  private readonly cloud: CloudBackupStore;
  private readonly encryption: BackupEncryptionStore;

  constructor(private readonly repository: NotesRepository, private readonly dataDirectory: string) {
    this.cloud = new CloudBackupStore(dataDirectory);
    this.encryption = new BackupEncryptionStore(dataDirectory);
  }

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
    const destination = settings.backupDestination || 'local';
    const cloudConnections = await this.cloud.connections();
    let backups: BackupInfo[] = [];
    let transientError: string | null = null;
    if (destination === 'local') backups = await this.list(settings.backupFolder);
    else {
      try { backups = await this.cloud.list(destination); }
      catch (error) { transientError = cloudError(error); }
    }
    return {
      folder: destination === 'local' ? settings.backupFolder : destination === 'google-drive' ? 'Google Drive / Noteleaf Backups' : 'OneDrive / Apps / Noteleaf',
      provider: destination === 'local' ? providerFor(settings.backupFolder) : destination,
      destination,
      cloudConnections,
      encryptionConfigured: await this.encryption.configured(),
      frequency: settings.backupFrequency,
      retention: settings.backupRetention,
      lastBackupAt: settings.lastBackupAt,
      lastBackupError: transientError || settings.lastBackupError,
      backups,
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
    this.repository.updateSettings({ backupFolder: folder, backupDestination: 'local', backupFrequency: 'hourly', lastBackupError: null });
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
      const material = await this.encryption.material();
      let result: Awaited<ReturnType<typeof createArchive>>;
      try { result = await createArchive(staging, destination, material); }
      finally { material.rootKey.fill(0); }
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
    const settings = this.repository.getSettings();
    if (settings.backupDestination === 'google-drive' || settings.backupDestination === 'onedrive') this.running = this.createCloud(settings.backupDestination);
    else {
      if (!settings.backupFolder) throw new Error('Choose a backup folder first.');
      this.running = this.createAt(settings.backupFolder, true);
    }
    try { return await this.running; } finally { this.running = null; }
  }

  private async createCloud(provider: CloudBackupProvider): Promise<BackupInfo> {
    const temporaryFolder = join(this.dataDirectory, `backup-upload-${randomUUID()}`);
    try {
      const local = await this.createAt(temporaryFolder, false);
      const uploaded = await this.cloud.upload(provider, local.path, local.filename);
      const createdAt = new Date().toISOString();
      this.repository.updateSettings({ lastBackupAt: createdAt, lastBackupError: null });
      await this.enforceCloudRetention(provider, this.repository.getSettings().backupRetention);
      return { ...uploaded, sha256: local.sha256, createdAt: uploaded.createdAt || createdAt };
    } catch (error) {
      this.repository.updateSettings({ lastBackupError: cloudError(error) });
      throw error;
    } finally { await rm(temporaryFolder, { recursive: true, force: true }).catch(() => undefined); }
  }

  private async enforceRetention(folder: string, retention: number): Promise<void> {
    const backups = await this.list(folder);
    for (const backup of backups.slice(Math.max(1, retention))) await rm(backup.path, { force: true });
  }

  private async enforceCloudRetention(provider: CloudBackupProvider, retention: number): Promise<void> {
    const backups = await this.cloud.list(provider);
    for (const backup of backups.slice(Math.max(1, retention))) await this.cloud.remove(backup.path);
  }

  async setSchedule(frequency: BackupFrequency, retention: number): Promise<BackupStatus> {
    const safeFrequency: BackupFrequency = frequency === 'hourly' || frequency === 'daily' || frequency === 'weekly' ? frequency : 'off';
    const safeRetention = Math.min(100, Math.max(1, Math.round(retention) || 10));
    this.repository.updateSettings({ backupFrequency: safeFrequency, backupRetention: safeRetention });
    const settings = this.repository.getSettings();
    if (settings.backupDestination === 'google-drive' || settings.backupDestination === 'onedrive') await this.enforceCloudRetention(settings.backupDestination, safeRetention);
    else if (settings.backupFolder) await this.enforceRetention(settings.backupFolder, safeRetention);
    return this.status();
  }

  async openFolder(): Promise<void> {
    const settings = this.repository.getSettings();
    if (settings.backupDestination === 'google-drive') { await shell.openExternal('https://drive.google.com/drive/my-drive'); return; }
    if (settings.backupDestination === 'onedrive') { await shell.openExternal('https://onedrive.live.com/'); return; }
    const folder = settings.backupFolder;
    if (!folder) throw new Error('Choose a backup folder first.');
    await mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  }

  async restore(password?: string): Promise<boolean> {
    const settings = this.repository.getSettings();
    const selected = await dialog.showOpenDialog({
      title: 'Restore Noteleaf backup',
      defaultPath: settings.backupFolder || app.getPath('documents'),
      filters: [{ name: 'Noteleaf backup', extensions: ['notesbackup'] }],
      properties: ['openFile'],
    });
    if (selected.canceled || !selected.filePaths[0]) return false;

    return this.restoreArchive(selected.filePaths[0], password);
  }

  async restoreCloud(reference: string, password?: string): Promise<boolean> {
    const download = join(this.dataDirectory, `cloud-restore-${randomUUID()}.notesbackup`);
    try {
      await this.cloud.download(reference, download);
      return await this.restoreArchive(download, password);
    } finally { await rm(download, { force: true }).catch(() => undefined); }
  }

  private async restoreArchive(archive: string, password?: string): Promise<boolean> {
    const settings = this.repository.getSettings();
    const staging = join(this.dataDirectory, `restore-pending-${randomUUID()}`);
    try {
      const material = await this.encryption.material().catch(() => undefined);
      let encrypted: boolean;
      try { ({ encrypted } = await extractArchive(archive, staging, { material, passphrase: password })); }
      finally { material?.rootKey.fill(0); }
      const manifest = await readBackupManifest(staging);
      await validateDatabase(join(staging, 'notes.db'));
      const response = await dialog.showMessageBox({
        type: 'warning',
        title: 'Restore this backup?',
        message: `Restore Noteleaf from ${new Date(manifest.createdAt).toLocaleString()}?`,
        detail: `${encrypted ? 'This backup is authenticated and encrypted.' : 'Warning: this is a legacy unencrypted backup.'}\n\nYour current notes will be encrypted and backed up first. Noteleaf will then restart and replace the current library with this backup.`,
        buttons: ['Cancel', 'Restore and restart'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) { await rm(staging, { recursive: true, force: true }); return false; }
      if (settings.backupDestination === 'google-drive' || settings.backupDestination === 'onedrive') await this.createCloud(settings.backupDestination);
      else {
        const safetyFolder = settings.backupFolder || join(this.dataDirectory, 'Backups');
        await this.createAt(safetyFolder, Boolean(settings.backupFolder));
      }
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

  async connectCloud(provider: CloudBackupProvider): Promise<BackupStatus> {
    await this.cloud.connect(provider);
    this.repository.updateSettings({ backupDestination: provider, backupFrequency: 'hourly', lastBackupError: null });
    return this.status();
  }

  async setEncryptionPassword(password: string): Promise<BackupStatus> {
    await this.encryption.setPassword(password);
    this.repository.updateSettings({ lastBackupError: null });
    return this.status();
  }

  async disconnectCloud(provider: CloudBackupProvider): Promise<BackupStatus> {
    await this.cloud.disconnect(provider);
    if (this.repository.getSettings().backupDestination === provider) this.repository.updateSettings({ backupDestination: 'local' });
    return this.status();
  }

  async useDestination(destination: BackupDestination): Promise<BackupStatus> {
    if (destination !== 'local' && destination !== 'google-drive' && destination !== 'onedrive') throw new Error('Unsupported backup destination.');
    if (destination !== 'local') {
      const connection = (await this.cloud.connections()).find((item) => item.provider === destination);
      if (!connection?.connected) throw new Error(`${destination === 'google-drive' ? 'Google Drive' : 'OneDrive'} is not connected.`);
    }
    this.repository.updateSettings({ backupDestination: destination, lastBackupError: null });
    return this.status();
  }

  startScheduler(): void {
    const check = async () => {
      const settings = this.repository.getSettings();
      const cloudDestination = settings.backupDestination === 'google-drive' || settings.backupDestination === 'onedrive';
      if ((!cloudDestination && !settings.backupFolder) || settings.backupFrequency === 'off' || this.running) return;
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
