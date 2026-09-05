import { Transform } from 'node:stream';

export const MAX_ARCHIVE_BYTES = 5 * 1024 ** 3;
export const MAX_EXPANDED_BYTES = 10 * 1024 ** 3;
export const RESTORE_DISK_RESERVE = 256 * 1024 ** 2;

export class BackupSizeError extends Error {
  constructor() { super('Backup exceeds the supported size or available restore disk space.'); }
}

export function limitBackupBytes(maximum: number): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) callback(new BackupSizeError());
      else callback(null, chunk);
    },
  });
}
