import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const MAGIC = 'NOTES_BACKUP_V1\n';
const MAX_HEADER = 64 * 1024;

interface EntryHeader {
  path: string;
  size: number;
  sha256: string;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
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

export async function createArchive(sourceDirectory: string, destination: string): Promise<{ size: number; sha256: string }> {
  const raw = join(dirname(destination), `.${basename(destination)}.${process.pid}.tmp`);
  const compressed = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(raw, MAGIC);
    const files = await filesBelow(sourceDirectory);
    for (const path of files) {
      const file = await stat(path);
      const entryPath = relative(sourceDirectory, path).split(sep).join('/');
      const header: EntryHeader = { path: entryPath, size: file.size, sha256: await sha256(path) };
      await appendFile(raw, `${JSON.stringify(header)}\n`);
      if (file.size) await pipeline(createReadStream(path), createWriteStream(raw, { flags: 'a' }));
      await appendFile(raw, '\n');
    }
    await appendFile(raw, '{"end":true}\n');
    await pipeline(createReadStream(raw), createGzip({ level: 9 }), createWriteStream(compressed));
    await rm(destination, { force: true });
    const { rename } = await import('node:fs/promises');
    await rename(compressed, destination);
    const output = await stat(destination);
    return { size: output.size, sha256: await sha256(destination) };
  } finally {
    await rm(raw, { force: true }).catch(() => undefined);
    await rm(compressed, { force: true }).catch(() => undefined);
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

export async function extractArchive(archive: string, destination: string): Promise<void> {
  const raw = join(dirname(destination), `.notes-restore-${process.pid}.tmp`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  try {
    await pipeline(createReadStream(archive), createGunzip(), createWriteStream(raw));
    const handle = await open(raw, 'r');
    try {
      const magic = Buffer.alloc(Buffer.byteLength(MAGIC));
      const first = await handle.read(magic, 0, magic.length, 0);
      if (first.bytesRead !== magic.length || magic.toString('utf8') !== MAGIC) throw new Error('This is not a supported Noteleaf backup.');
      let offset = magic.length;
      let entries = 0;
      while (true) {
        const headerLine = await readLine(handle, offset);
        offset = headerLine.next;
        const header = JSON.parse(headerLine.line) as EntryHeader & { end?: boolean };
        if (header.end) break;
        if (typeof header.path !== 'string' || !Number.isSafeInteger(header.size) || header.size < 0 || typeof header.sha256 !== 'string') throw new Error('Backup archive metadata is invalid.');
        const target = safeTarget(destination, header.path);
        await mkdir(dirname(target), { recursive: true });
        if (header.size) await pipeline(createReadStream(raw, { start: offset, end: offset + header.size - 1 }), createWriteStream(target));
        else await writeFile(target, '');
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
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(raw, { force: true }).catch(() => undefined);
  }
}

export async function readBackupManifest(directory: string): Promise<{ formatVersion: number; createdAt: string; appVersion: string }> {
  const parsed = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { formatVersion?: unknown; createdAt?: unknown; appVersion?: unknown };
  if (parsed.formatVersion !== 1 || typeof parsed.createdAt !== 'string' || typeof parsed.appVersion !== 'string') throw new Error('Backup manifest is invalid.');
  return parsed as { formatVersion: number; createdAt: string; appVersion: string };
}
