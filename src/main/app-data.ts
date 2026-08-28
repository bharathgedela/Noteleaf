import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Copy a pre-rebrand Notes library into Noteleaf on first launch.
 * The old directory is intentionally left untouched as a recovery copy.
 */
export function migrateLegacyAppData(appDataRoot: string, currentDataDirectory: string): boolean {
  const legacyDirectory = join(appDataRoot, 'Notes');
  const legacyDatabase = join(legacyDirectory, 'notes.db');
  const currentDatabase = join(currentDataDirectory, 'notes.db');
  if (resolve(legacyDirectory).toLowerCase() === resolve(currentDataDirectory).toLowerCase()) return false;
  if (!existsSync(legacyDatabase) || existsSync(currentDatabase)) return false;
  mkdirSync(currentDataDirectory, { recursive: true });
  cpSync(legacyDirectory, currentDataDirectory, { recursive: true, force: false, errorOnExist: false });
  return existsSync(currentDatabase);
}
