// Directory replacement must exclude managed read-only tools too; logical writes may still share their snapshots.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { writePrivateFile } from '../private-file.ts';
import type { EarsDatabase } from '@apackdev/ears';
import { findLockHolder, holdExclusiveLock, type ExclusiveLock, type LockFile } from '../exclusive-lock.ts';

const readers = (databasePath: string) => path.join(path.dirname(databasePath), 'db-readers');
const recovery = (databasePath: string) => path.join(path.dirname(databasePath), 'db-recovery.lock');

function activeReaders(databasePath: string): string[] {
  const dir = readers(databasePath);
  let entries: string[];
  try {
    if (!fs.lstatSync(dir).isDirectory()) throw new Error(`Recovery reader registry must be an ordinary directory: ${dir}`);
    entries = fs.readdirSync(dir);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const active: string[] = [];
  for (const name of entries.filter(name => name.endsWith('.json'))) {
    const file = path.join(dir, name), holder = findLockHolder(file);
    if (holder) active.push(holder);
    else fs.rmSync(file, { force: true }); // Unique claim names are never reused, even after PID reuse.
  }
  return active;
}

/** Called after taking the profile write lock; new readers publish their claim before checking this exclusion. */
export function holdRecoveryExclusion(databasePath: string): ExclusiveLock {
  const lock = holdExclusiveLock({ file: recovery(databasePath), what: 'offline import recovery',
    refuse: holder => new Error(`Import recovery is already active: ${holder}`) });
  try {
    const held = activeReaders(databasePath);
    if (held.length) throw new Error(`Close tools reading this profile before recovery: ${held.join(', ')}`);
    return lock;
  } catch (error) { lock.release(); throw error; }
}

/** Managed read-only opens hold a metadata claim until the database actually closes. Data files remain read-only. */
export function openProfileDatabase(databasePath: string, readOnly: boolean | undefined, open: () => EarsDatabase): EarsDatabase {
  if (!readOnly) return open();
  const dir = readers(databasePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  activeReaders(databasePath);
  const file = path.join(dir, `${process.pid}-${randomUUID()}.json`);
  const record: LockFile = { pid: process.pid, machine: os.hostname(), what: 'read-only database tool', since: new Date().toISOString() };
  let released = false;
  const release = () => { if (!released) { fs.rmSync(file, { force: true }); released = true; } };
  try {
    writePrivateFile(file, JSON.stringify(record));
    const held = findLockHolder(recovery(databasePath));
    if (held) throw new Error(`Wait for import recovery to finish before opening this profile: ${held}`);
    const database = open(), close = database.close.bind(database);
    database.close = () => { close(); if (!database.isOpen) release(); };
    return database;
  } catch (error) { release(); throw error; }
}
