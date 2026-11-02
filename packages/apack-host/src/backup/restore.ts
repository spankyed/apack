// Offline restoration of retained import incumbents. A durable plan makes directory publication resumable.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { backupStorage, databaseStorage } from '../database/storage.ts';
import { findRunningApp } from '../database/running.ts';
import { holdDatabaseWriteLock } from '../database/write-lock.ts';
import { holdRecoveryExclusion } from '../database/recovery-lock.ts';
import type { ExclusiveLock } from '../exclusive-lock.ts';
import { syncRecoveryDirectory, syncRecoveryTree } from './recovery.ts';
import { writePrivateFile } from '../private-file.ts';

interface RecoveryStore { name: 'lmdb' | 'runHistory'; path: string; format: string }
interface Preparation { format: 'apack-import/1'; state: 'prepared'; stores: RecoveryStore[]; mediaPath?: string }
interface RestoreEntry { name: string; present: boolean; digest?: string }
interface RestorePlan { format: 'apack-import-restore/1'; entries: RestoreEntry[] }
export interface ImportRecovery {
  session: string;
  status: 'pending' | 'restoring' | 'recovered';
  recoveryPath: string;
}

function exists(file: string): boolean {
  try { fs.lstatSync(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function directory(dir: string): void {
  if (!fs.lstatSync(dir).isDirectory()) throw new Error(`Recovery requires an ordinary directory: ${dir}`);
}
function readJson(file: string): unknown {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error(`Invalid import recovery record: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function sessionPath(userDataDir: string, session: string): string {
  if (!session.startsWith('.apack-import-') || session !== path.basename(session) || session.includes('\\')) {
    throw new Error('Name one .apack-import-* session reported by apack db recover');
  }
  const parent = path.dirname(_appDataPaths(userDataDir).lmdb), dir = path.join(parent, session);
  directory(parent); directory(dir); return dir;
}
// Backend paths may canonicalize ancestor aliases, while the selected profile retains the caller's spelling.
// Match the physical parent and fixed leaf separately: an arbitrary database-leaf symlink is not a destination.
function sameDestination(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || !path.isAbsolute(actual)) return false;
  const source = path.resolve(actual), destination = path.resolve(expected);
  return path.basename(source) === path.basename(destination)
    && fs.realpathSync(path.dirname(source)) === fs.realpathSync(path.dirname(destination));
}
function preparation(userDataDir: string, dir: string, completed = false): Preparation {
  const file = path.join(dir, completed ? 'recovered.json' : 'recovery.json');
  const value = readJson(file) as Partial<Preparation> | null, paths = _appDataPaths(userDataDir);
  if (!value || value.format !== 'apack-import/1' || value.state !== 'prepared' || !Array.isArray(value.stores)
    || !value.stores.length || value.stores.length > 2) throw new Error(`Invalid import preparation: ${file}`);
  const seen = new Set<string>();
  for (const store of value.stores) {
    if (!store || !['lmdb', 'runHistory'].includes(store.name) || seen.has(store.name)
      || !sameDestination(store.path, paths[store.name]) || typeof store.format !== 'string') throw new Error(`Import preparation does not match this profile: ${file}`);
    databaseStorage(store.format); seen.add(store.name);
  }
  if (value.mediaPath !== undefined && !sameDestination(value.mediaPath, paths.media)) throw new Error(`Import media does not match this profile: ${file}`);
  return value as Preparation;
}

/** Inspect only; recovery never silently chooses a session or changes live data. */
export function listImportRecoveries(userDataDir: string): ImportRecovery[] {
  const parent = path.dirname(_appDataPaths(userDataDir).lmdb);
  if (!exists(parent)) return [];
  directory(parent);
  return fs.readdirSync(parent).sort().filter(name => name.startsWith('.apack-import-')).flatMap(session => {
    const dir = sessionPath(userDataDir, session), pending = exists(path.join(dir, 'recovery.json'));
    const completed = exists(path.join(dir, 'recovered.json'));
    if (!pending && !completed) return [];
    preparation(userDataDir, dir, !pending);
    const status: ImportRecovery['status'] = pending ? exists(path.join(dir, 'restore.json')) ? 'restoring' : 'pending' : 'recovered';
    return [{ session, status,
      recoveryPath: path.join(dir, 'rollback') }];
  });
}

function digest(file: string): string {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
  const visit = (entry: string, relative: string): void => {
    const stat = fs.lstatSync(entry);
    if (stat.isDirectory()) {
      hash.update(JSON.stringify(['directory', relative]));
      for (const name of fs.readdirSync(entry).sort()) visit(path.join(entry, name), path.posix.join(relative, name));
    } else if (stat.isFile()) {
      hash.update(JSON.stringify(['file', relative, stat.size]));
      const fd = fs.openSync(entry, 'r');
      try { for (;;) { const size = fs.readSync(fd, buffer); if (!size) break; hash.update(buffer.subarray(0, size)); } }
      finally { fs.closeSync(fd); }
    } else throw new Error(`Recovery refuses links and special files: ${entry}`);
  };
  visit(file, ''); return hash.digest('hex');
}

/** Holds the existing profile write lock and refuses a running app before inspecting or publishing files. */
export function restoreImportRecovery(target: { userDataDir: string; apiPortFile: string; storageFormat: string }, session: string): ImportRecovery {
  const lock = holdDatabaseWriteLock(target.userDataDir, 'apack db recover');
  let exclusion: ExclusiveLock | undefined;
  try {
    if (findRunningApp(target)) throw new Error('Quit the app before recovering an interrupted import.');
    exclusion = holdRecoveryExclusion(_appDataPaths(target.userDataDir).lmdb);
    const dir = sessionPath(target.userDataDir, session), marker = path.join(dir, 'recovery.json');
    const completed = path.join(dir, 'recovered.json');
    if (!exists(marker)) {
      preparation(target.userDataDir, dir, true);
      return { session, status: 'recovered', recoveryPath: path.join(dir, 'rollback') };
    }
    if (exists(completed)) throw new Error(`Conflicting import recovery records: ${dir}`);
    const record = preparation(target.userDataDir, dir), paths = _appDataPaths(target.userDataDir);
    if (record.stores.some(store => store.format !== target.storageFormat)) throw new Error('Select the retained databases’ storage format before recovery');
    directory(path.join(dir, 'rollback'));
    const entries = [...record.stores.map(store => ({ name: store.name as string, destination: paths[store.name],
      dataFile: databaseStorage(store.format).dataFile, format: store.format })),
    ...(record.mediaPath ? [{ name: 'media', destination: paths.media, dataFile: '', format: '' }] : [])];
    const stage = path.join(dir, 'restore-stage'), interrupted = path.join(dir, 'interrupted'), planFile = path.join(dir, 'restore.json');
    let plan: RestorePlan;
    if (!exists(planFile)) {
      if (exists(interrupted)) throw new Error(`Recovery files moved without a restore plan: ${dir}`);
      if (exists(stage)) { directory(stage); fs.rmSync(stage, { recursive: true }); }
      fs.mkdirSync(stage, { mode: 0o700 });
      const planned: RestoreEntry[] = [];
      for (const entry of entries) {
        const source = path.join(dir, 'rollback', entry.name), dest = path.join(stage, entry.name);
        if (entry.name === 'media' && !exists(source)) { planned.push({ name: entry.name, present: false }); continue; }
        directory(source); digest(source);
        if (entry.dataFile) {
          const storage = backupStorage(source);
          if (storage?.format !== entry.format) throw new Error(`Retained database format mismatch: ${source}`);
          const db = storage.open({ path: source, readOnly: true });
          try {
            if (entry.name === 'runHistory' && !Object.hasOwn((db.schema as { types?: object } | null)?.types ?? {}, 'RunNode')) throw new Error(`Retained run history declares no RunNode: ${source}`);
            db.stats(); db.backup(dest);
          } finally { db.close(); }
          const copy = storage.open({ path: dest, readOnly: true });
          try { copy.stats(); } finally { copy.close(); }
        } else { digest(source); fs.cpSync(source, dest, { recursive: true, errorOnExist: true, force: false }); }
        syncRecoveryTree(dest);
        planned.push({ name: entry.name, present: true, digest: digest(entry.dataFile ? path.join(dest, entry.dataFile) : dest) });
      }
      syncRecoveryDirectory(stage);
      plan = { format: 'apack-import-restore/1', entries: planned };
      writePrivateFile(planFile, JSON.stringify(plan) + '\n');
    } else plan = readJson(planFile) as RestorePlan;
    if (!plan || plan.format !== 'apack-import-restore/1' || !Array.isArray(plan.entries) || plan.entries.length !== entries.length
      || plan.entries.some((entry, i) => !entry || entry.name !== entries[i]!.name || typeof entry.present !== 'boolean'
        || (!entry.present && entry.name !== 'media') || (entry.present && (typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest))))) {
      throw new Error(`Invalid import restore plan: ${planFile}`);
    }
    directory(path.join(dir, 'rollback'));
    if (!exists(interrupted)) fs.mkdirSync(interrupted, { mode: 0o700 });
    directory(interrupted); syncRecoveryDirectory(dir);
    // Validate every remaining candidate before the first rename. Missing stages must already be installed.
    for (const [i, entry] of entries.entries()) {
      const expected = plan.entries[i]!, staged = path.join(stage, entry.name);
      const file = exists(staged) ? staged : entry.destination;
      if (expected.present) {
        directory(file);
        if (digest(entry.dataFile ? path.join(file, entry.dataFile) : file) !== expected.digest) throw new Error(`Recovery copy changed: ${file}`);
      }
    }
    for (const [i, entry] of entries.entries()) {
      const staged = path.join(stage, entry.name), previous = path.join(interrupted, entry.name), expected = plan.entries[i]!;
      if (!expected.present || exists(staged)) {
        if (exists(entry.destination)) {
          directory(entry.destination);
          if (exists(previous)) throw new Error(`Both live and interrupted paths exist before publication: ${entry.name}`);
          fs.renameSync(entry.destination, previous); syncRecoveryDirectory(path.dirname(entry.destination)); syncRecoveryDirectory(interrupted);
        }
        if (expected.present) { fs.renameSync(staged, entry.destination); syncRecoveryDirectory(path.dirname(entry.destination)); syncRecoveryDirectory(stage); }
      }
    }
    // The preparation stays visible until every entry is installed, verified and its parent synced.
    for (const [i, entry] of entries.entries()) {
      const expected = plan.entries[i]!;
      if (expected.present ? digest(entry.dataFile ? path.join(entry.destination, entry.dataFile) : entry.destination) !== expected.digest : exists(entry.destination)) {
        throw new Error(`Import recovery did not settle ${entry.name}`);
      }
    }
    fs.renameSync(marker, completed); syncRecoveryDirectory(dir);
    return { session, status: 'recovered', recoveryPath: path.join(dir, 'rollback') };
  } finally { try { exclusion?.release(); } finally { lock.release(); } }
}
