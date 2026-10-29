// Import replaces multiple stores and media. A persisted preparation survives process death between them.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writePrivateFile } from '../private-file.ts';

export function syncRecoveryDirectory(dir: string): void {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function syncRecoveryTree(dir: string): void {
  if (!fs.lstatSync(dir).isDirectory()) throw new Error(`Recovery requires an ordinary directory: ${dir}`);
  fs.chmodSync(dir, 0o700);
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) syncRecoveryTree(file);
    else if (stat.isFile()) {
      fs.chmodSync(file, 0o600);
      const fd = fs.openSync(file, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } else throw new Error(`Recovery refuses links and special files: ${file}`);
  }
  syncRecoveryDirectory(dir);
}

const RECOVERY_FILE = 'recovery.json';
export function prepareImportRecovery(dir: string, stores: readonly { name: string; path: string; format: string }[], mediaPath?: string): void {
  const rollback = path.join(dir, 'rollback');
  fs.mkdirSync(rollback, { recursive: true, mode: 0o700 });
  syncRecoveryTree(rollback);
  writePrivateFile(path.join(dir, RECOVERY_FILE), JSON.stringify({ format: 'apack-import/1', state: 'prepared',
    stores: stores.map(store => ({ ...store, path: path.resolve(store.path) })),
    ...(mediaPath !== undefined && { mediaPath: path.resolve(mediaPath) }),
  }) + '\n');
  // The session's directory entry must survive before any live database commits.
  syncRecoveryDirectory(path.dirname(dir));
}

/** Gate writable opens; read-only tools may still inspect both the live and retained incumbent copies. */
export function assertNoImportRecovery(databasePath: string): void {
  const parent = path.dirname(databasePath);
  let entries: string[];
  try { entries = fs.readdirSync(parent); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries.sort()) {
    if (!entry.startsWith('.apack-import-')) continue;
    const session = path.join(parent, entry);
    try { fs.lstatSync(path.join(session, RECOVERY_FILE)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue; throw error; }
    throw Object.assign(new Error(`Database import requires recovery before writable startup; inspect the previous data retained at ${path.join(session, 'rollback')}`),
      { code: 'RECOVERY_REQUIRED', recoveryPath: path.join(session, 'rollback') });
  }
}
