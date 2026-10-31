// Managed handles share directory-lifetime claims; physical replacement excludes them until close.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { writePrivateFile } from '../private-file.ts';
import type { EarsDatabase } from '@apackdev/ears';
import { findLockHolder, holdExclusiveLock, type ExclusiveLock, type LockFile } from '../exclusive-lock.ts';

const readers = (databasePath: string) => path.join(path.dirname(databasePath), 'db-readers');
const recovery = (databasePath: string) => path.join(path.dirname(databasePath), 'db-recovery.lock');

export function directoryIdentity(databasePath: string): string | undefined {
  try {
    const stat = fs.lstatSync(path.resolve(databasePath), { bigint: true });
    if (!stat.isDirectory()) throw new Error(`Managed opens require an ordinary database directory: ${databasePath}`);
    return stat.ino > 0n ? `${stat.dev}:${stat.ino}` : undefined;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function claimDirectory(file: string): { database: string; directory: string } | undefined {
  try {
    if (fs.statSync(file).size > 4096) return;
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { database?: unknown; directory?: unknown } | null;
    const name = value?.database, directory = value?.directory;
    if (typeof name === 'string' && name && name !== '.' && name !== '..' && name === path.basename(name)
      && !name.includes('\\') && typeof directory === 'string' && /^\d+:[1-9]\d*$/.test(directory)) {
      return { database: name, directory };
    }
  } catch { return; } // An unresolved claim never authorizes publication.
}

function activeReaders(databasePath: string, scope: 'profile' | 'store' = 'profile'): string[] {
  const dir = readers(databasePath);
  let entries: string[];
  try {
    if (!fs.lstatSync(dir).isDirectory()) throw new Error(`Recovery reader registry must be an ordinary directory: ${dir}`);
    entries = fs.readdirSync(dir);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const active: string[] = [], target = scope === 'store' ? directoryIdentity(databasePath) : undefined;
  for (const name of entries.filter(name => name.endsWith('.json'))) {
    const file = path.join(dir, name), holder = findLockHolder(file);
    if (holder) {
      const claim = scope === 'store' ? claimDirectory(file) : undefined;
      // A missing target is safe to remove only when every other claim still names its own sibling.
      // Stale or unresolved identities cannot authorize deleting a directory that might have moved.
      const unrelated = claim && claim.database !== path.basename(path.resolve(databasePath))
        && claim.directory !== target
        && directoryIdentity(path.join(path.dirname(databasePath), claim.database)) === claim.directory;
      if (!unrelated) active.push(holder);
    }
    else fs.rmSync(file, { force: true }); // Unique claim names are never reused, even after PID reuse.
  }
  return active;
}

/** Exclude new managed opens before checking existing claims; unknown claims always refuse. */
export function holdRecoveryExclusion(databasePath: string, scope: 'profile' | 'store' = 'profile'): ExclusiveLock {
  const lock = holdExclusiveLock({ file: recovery(databasePath), what: 'offline import recovery',
    refuse: holder => new Error(`Import recovery is already active: ${holder}`) });
  try {
    const held = activeReaders(databasePath, scope);
    if (held.length) throw new Error(`Close apps and tools using this profile before recovery: ${held.join(', ')}`);
    return lock;
  } catch (error) { lock.release(); throw error; }
}

/** Every managed open holds a shared claim until close; read-only opens write only private metadata. */
export function openProfileDatabase(databasePath: string, readOnly: boolean | undefined, open: () => EarsDatabase): EarsDatabase {
  let identity = directoryIdentity(databasePath);
  const dir = readers(databasePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  activeReaders(databasePath);
  const file = path.join(dir, `${process.pid}-${randomUUID()}.json`);
  const record: LockFile & { database: string; directory?: string } = { pid: process.pid, machine: os.hostname(),
    what: readOnly ? 'read-only database tool' : 'writable database handle', since: new Date().toISOString(),
    database: path.basename(path.resolve(databasePath)), ...(identity && { directory: identity }) };
  let released = false;
  const release = () => { if (!released) { fs.rmSync(file, { force: true }); released = true; } };
  try {
    writePrivateFile(file, JSON.stringify(record));
    const held = findLockHolder(recovery(databasePath));
    if (held) throw new Error(`Wait for import recovery to finish before opening this profile: ${held}`);
    if (!readOnly && !identity) {
      // Creation is permitted only after publishing the claim and checking exclusion.
      fs.mkdirSync(databasePath, { recursive: true, mode: 0o700 });
      identity = directoryIdentity(databasePath);
      if (identity) { record.directory = identity; writePrivateFile(file, JSON.stringify(record)); }
    }
    const database = open(), close = database.close.bind(database);
    database.close = () => { close(); if (!database.isOpen) release(); };
    return database;
  } catch (error) {
    // A constructor that could not close its connection still holds this directory until process exit.
    if (!(error as { databaseConnectionUnclosed?: boolean })?.databaseConnectionUnclosed) release();
    throw error;
  }
}
