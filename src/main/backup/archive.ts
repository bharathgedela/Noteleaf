import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { BackupSizeError, limitBackupBytes, MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES, RESTORE_DISK_RESERVE } from './limits.js';

const PAYLOAD_MAGIC = 'NOTES_BACKUP_V1\n';
const ENCRYPTED_MAGIC = 'NOTELEAF_ENCRYPTED_BACKUP_V2\n';
const MAX_HEADER = 64 * 1024;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const HKDF_INFO = Buffer.from('Noteleaf backup archive key v2', 'utf8');

export interface BackupKeyMaterial { rootKey: Buffer; recoverySalt: Buffer }
export interface BackupUnlock { material?: BackupKeyMaterial; passphrase?: string }

interface EntryHeader { path: string; size: number; sha256: string }
interface EncryptionHeader {
  formatVersion: 2;
  cipher: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  recoverySalt: string;
  iv: string;
  n: number;
  r: number;
  p: number;
  tagLength: number;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function deriveRootKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (!passphrase) throw new Error('This backup is encrypted. Enter its backup password first.');
  return new Promise((resolveKey, reject) => scrypt(passphrase, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY }, (error, key) => {
    if (error) reject(error); else resolveKey(key as Buffer);
  }));
}

export async function createBackupKeyMaterial(passphrase: string, recoverySalt = randomBytes(SALT_LENGTH)): Promise<BackupKeyMaterial> {
  if (recoverySalt.length !== SALT_LENGTH) throw new Error('Backup recovery salt is invalid.');
  return { rootKey: await deriveRootKey(passphrase, recoverySalt), recoverySalt: Buffer.from(recoverySalt) };
}

function archiveKey(material: BackupKeyMaterial, salt: Buffer): Buffer {
  if (material.rootKey.length !== KEY_LENGTH || material.recoverySalt.length !== SALT_LENGTH || salt.length !== SALT_LENGTH) throw new Error('Backup encryption key material is invalid.');
  return Buffer.from(hkdfSync('sha256', material.rootKey, salt, HKDF_INFO, KEY_LENGTH));
}

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function safeTarget(root: string, entryPath: string): string {
  if (!entryPath || entryPath.includes('\0') || entryPath.startsWith('/') || /^[a-z]:/i.test(entryPath)) throw new Error('Backup contains an unsafe path.');
  const target = resolve(root, ...entryPath.split('/'));
  const fromRoot = relative(resolve(root), target);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || fromRoot.includes(':')) throw new Error('Backup contains an unsafe path.');
  return target;
}

function encryptionHeader(value: unknown): EncryptionHeader {
  const header = value as Partial<EncryptionHeader>;
  if (header.formatVersion !== 2 || header.cipher !== 'aes-256-gcm' || header.kdf !== 'scrypt' || header.n !== SCRYPT_N || header.r !== SCRYPT_R || header.p !== SCRYPT_P || header.tagLength !== TAG_LENGTH || typeof header.salt !== 'string' || typeof header.recoverySalt !== 'string' || typeof header.iv !== 'string') throw new Error('Backup encryption metadata is invalid.');
  const salt = Buffer.from(header.salt, 'base64');
  const recoverySalt = Buffer.from(header.recoverySalt, 'base64');
  const iv = Buffer.from(header.iv, 'base64');
  if (salt.length !== SALT_LENGTH || recoverySalt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || salt.toString('base64') !== header.salt || recoverySalt.toString('base64') !== header.recoverySalt || iv.toString('base64') !== header.iv) throw new Error('Backup encryption metadata is invalid.');
  return header as EncryptionHeader;
}

export async function createArchive(sourceDirectory: string, destination: string, material: BackupKeyMaterial): Promise<{ size: number; sha256: string }> {
  const raw = join(sourceDirectory, `.noteleaf-archive-${randomBytes(12).toString('hex')}.tmp`);
  const encrypted = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  const files = await filesBelow(sourceDirectory);
  let key: Buffer | undefined;
  try {
    await writeFile(raw, PAYLOAD_MAGIC, { mode: 0o600 });
    let payloadBytes = Buffer.byteLength(PAYLOAD_MAGIC) + Buffer.byteLength('{"end":true}\n');
    for (const path of files) {
      const file = await stat(path);
      const entryPath = relative(sourceDirectory, path).split(sep).join('/');
      const header: EntryHeader = { path: entryPath, size: file.size, sha256: await sha256(path) };
      payloadBytes += Buffer.byteLength(`${JSON.stringify(header)}\n`) + file.size + 1;
      if (payloadBytes > MAX_EXPANDED_BYTES) throw new BackupSizeError();
      await appendFile(raw, `${JSON.stringify(header)}\n`);
      if (file.size) await pipeline(createReadStream(path), limitBackupBytes(file.size), createWriteStream(raw, { flags: 'a' }));
      await appendFile(raw, '\n');
    }
    await appendFile(raw, '{"end":true}\n');

    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const header: EncryptionHeader = { formatVersion: 2, cipher: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('base64'), recoverySalt: material.recoverySalt.toString('base64'), iv: iv.toString('base64'), n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, tagLength: TAG_LENGTH };
    const prefix = Buffer.from(`${ENCRYPTED_MAGIC}${JSON.stringify(header)}\n`, 'utf8');
    key = archiveKey(material, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
    cipher.setAAD(prefix);
    await writeFile(encrypted, prefix, { mode: 0o600 });
    await pipeline(createReadStream(raw), createGzip({ level: 9 }), cipher, limitBackupBytes(MAX_ARCHIVE_BYTES - prefix.length - TAG_LENGTH), createWriteStream(encrypted, { flags: 'a' }));
    await appendFile(encrypted, cipher.getAuthTag());
    await rm(destination, { force: true });
    await rename(encrypted, destination);
    const output = await stat(destination);
    return { size: output.size, sha256: await sha256(destination) };
  } finally {
    key?.fill(0);
    await rm(raw, { force: true }).catch(() => undefined);
    await rm(encrypted, { force: true }).catch(() => undefined);
  }
}

async function readLine(handle: Awaited<ReturnType<typeof open>>, offset: number): Promise<{ line: string; next: number }> {
  const pieces: Buffer[] = [];
  let total = 0;
  while (total <= MAX_HEADER) {
    const chunk = Buffer.alloc(Math.min(4096, MAX_HEADER - total + 1));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset + total);
    if (!bytesRead) throw new Error('Backup archive ended unexpectedly.');
    const used = chunk.subarray(0, bytesRead);
    const newline = used.indexOf(10);
    if (newline >= 0) {
      pieces.push(used.subarray(0, newline));
      const consumed = total + newline + 1;
      return { line: Buffer.concat(pieces).toString('utf8'), next: offset + consumed };
    }
    pieces.push(used);
    total += bytesRead;
  }
  throw new Error('Backup archive header is too large.');
}

async function decryptArchive(archive: string, raw: string, unlock: BackupUnlock, maximum: number): Promise<boolean> {
  const handle = await open(archive, 'r');
  let key: Buffer | undefined;
  try {
    if ((await handle.stat()).size > MAX_ARCHIVE_BYTES) throw new BackupSizeError();
    const magic = Buffer.alloc(Buffer.byteLength(ENCRYPTED_MAGIC));
    const first = await handle.read(magic, 0, magic.length, 0);
    if (first.bytesRead !== magic.length || magic.toString('utf8') !== ENCRYPTED_MAGIC) {
      await pipeline(createReadStream(archive), limitBackupBytes(MAX_ARCHIVE_BYTES), createGunzip(), limitBackupBytes(maximum), createWriteStream(raw, { mode: 0o600 }));
      return false;
    }
    const headerLine = await readLine(handle, magic.length);
    const parsed = encryptionHeader(JSON.parse(headerLine.line));
    const metadata = await handle.stat();
    const cipherEnd = metadata.size - parsed.tagLength - 1;
    if (cipherEnd < headerLine.next) throw new Error('Encrypted backup is incomplete.');
    const tag = Buffer.alloc(parsed.tagLength);
    const tagRead = await handle.read(tag, 0, tag.length, metadata.size - tag.length);
    if (tagRead.bytesRead !== tag.length) throw new Error('Encrypted backup is incomplete.');
    const recoverySalt = Buffer.from(parsed.recoverySalt, 'base64');
    let root: Buffer | undefined;
    try {
      if (unlock.material && unlock.material.recoverySalt.equals(recoverySalt)) root = Buffer.from(unlock.material.rootKey);
      else root = (await createBackupKeyMaterial(unlock.passphrase || '', recoverySalt)).rootKey;
      key = archiveKey({ rootKey: root, recoverySalt }, Buffer.from(parsed.salt, 'base64'));
    } finally { root?.fill(0); }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'), { authTagLength: parsed.tagLength });
    decipher.setAAD(Buffer.from(`${ENCRYPTED_MAGIC}${headerLine.line}\n`, 'utf8'));
    decipher.setAuthTag(tag);
    try {
      await pipeline(createReadStream(archive, { start: headerLine.next, end: cipherEnd }), limitBackupBytes(MAX_ARCHIVE_BYTES), decipher, createGunzip(), limitBackupBytes(maximum), createWriteStream(raw, { mode: 0o600 }));
    } catch (error) {
      if (error instanceof BackupSizeError) throw error;
      throw new Error('The backup password is incorrect or the encrypted backup is damaged.');
    }
    return true;
  } finally {
    key?.fill(0);
    await handle.close();
  }
}

export async function extractArchive(archive: string, destination: string, unlock: BackupUnlock = {}): Promise<{ encrypted: boolean }> {
  const raw = join(dirname(destination), `.notes-restore-${randomBytes(12).toString('hex')}.tmp`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  try {
    const disk = await statfs(dirname(destination));
    // Raw payload and extracted files coexist until validation completes.
    const maximum = Math.min(MAX_EXPANDED_BYTES, Math.floor((disk.bavail * disk.bsize - RESTORE_DISK_RESERVE) / 2));
    if (maximum <= 0) throw new BackupSizeError();
    const encrypted = await decryptArchive(archive, raw, unlock, maximum);
    const handle = await open(raw, 'r');
    try {
      const magic = Buffer.alloc(Buffer.byteLength(PAYLOAD_MAGIC));
      const first = await handle.read(magic, 0, magic.length, 0);
      if (first.bytesRead !== magic.length || magic.toString('utf8') !== PAYLOAD_MAGIC) throw new Error('This is not a supported Noteleaf backup.');
      let offset = magic.length;
      const rawSize = (await handle.stat()).size;
      let entries = 0;
      while (true) {
        const headerLine = await readLine(handle, offset);
        offset = headerLine.next;
        const header = JSON.parse(headerLine.line) as EntryHeader & { end?: boolean };
        if (header.end) break;
        if (typeof header.path !== 'string' || !Number.isSafeInteger(header.size) || header.size < 0 || typeof header.sha256 !== 'string') throw new Error('Backup archive metadata is invalid.');
        if (header.size > maximum || header.size > rawSize - offset - 1) throw new BackupSizeError();
        const target = safeTarget(destination, header.path);
        await mkdir(dirname(target), { recursive: true });
        if (header.size) await pipeline(createReadStream(raw, { start: offset, end: offset + header.size - 1 }), createWriteStream(target, { mode: 0o600 }));
        else await writeFile(target, '', { mode: 0o600 });
        offset += header.size;
        const separator = Buffer.alloc(1);
        const separatorRead = await handle.read(separator, 0, 1, offset);
        if (separatorRead.bytesRead !== 1 || separator[0] !== 10) throw new Error('Backup archive is damaged.');
        offset += 1;
        if (await sha256(target) !== header.sha256) throw new Error(`Backup integrity check failed for ${header.path}.`);
        entries += 1;
        if (entries > 100_000) throw new Error('Backup contains too many files.');
      }
      if (!entries) throw new Error('Backup is empty.');
    } finally { await handle.close(); }
    return { encrypted };
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally { await rm(raw, { force: true }).catch(() => undefined); }
}

export async function readBackupManifest(directory: string): Promise<{ formatVersion: number; createdAt: string; appVersion: string }> {
  const parsed = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { formatVersion?: unknown; createdAt?: unknown; appVersion?: unknown };
  if (parsed.formatVersion !== 1 || typeof parsed.createdAt !== 'string' || typeof parsed.appVersion !== 'string') throw new Error('Backup manifest is invalid.');
  return parsed as { formatVersion: number; createdAt: string; appVersion: string };
}
