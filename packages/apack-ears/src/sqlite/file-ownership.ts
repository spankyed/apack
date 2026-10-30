import { lstatSync } from 'node:fs';
import { join } from 'node:path';

const databaseFiles = ['data.sqlite3', 'data.sqlite3-wal', 'data.sqlite3-shm', 'data.sqlite3-journal'];
const refuse = (file: string, reason: string): never => {
  throw Object.assign(new Error(`Refusing SQLite file ${file}: ${reason}`), { code: 'IO' });
};

/** Admission inside an owned directory; callers must exclude concurrent namespace replacement. */
export function inspectDatabaseFiles(directory: string, options: { empty?: boolean } = {}): boolean {
  let mainPresent = false;
  for (const name of databaseFiles) {
    const file = join(directory, name);
    let entry;
    try { entry = lstatSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (options.empty) refuse(file, 'backup destination is occupied');
    if (!entry.isFile() || entry.nlink !== 1) refuse(file, 'requires an ordinary file with exactly one link');
    if (name === 'data.sqlite3') mainPresent = true;
    else if (!mainPresent) refuse(file, 'sidecar has no main database');
  }
  return mainPresent;
}
