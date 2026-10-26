// apack db, offline, against temp data dirs: each command's output and changes, the refusals while an app runs on the
// data dir, and the dry runs of the commands that replace or delete data
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EARS } from '@apackdev/ears';
import { _bindEars, boundEars, untypedCreate, untypedWrite } from '@apackdev/sdk/ears';
import { findDatabaseWriter, holdDatabaseWriteLock, openDatabaseStore, openRunHistoryStore, readInstalledSchema } from '@apackdev/host/database';
import { exportDatabase } from '@apackdev/host/backup';
import { openEnvironment, LMDB_FORMAT_VERSION } from '@apackdev/ears/lmdb';
import { createSecretsStore, memoryKeyVault } from '@apackdev/host/secrets';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { _appDirOf, appDataDirFor, resolveAppEnvironment } from '@apackdev/sdk/env';
import { db } from '../../src/commands/db';
import { parseDbArgs } from '../../src/commands/db/target';
import { dbRepl } from '../../src/commands/db/repl';
import { mintProfile, openProfile } from '../../src/app/profiles';
import type { CliDirs } from '../../src/app/pack-host';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { sealPackBuild, PACK_LAYOUT } from '@apackdev/host/packs';

// `--profile` resolves a name through the CLI's own data dir, which is the real one on this machine.
// Pointing it at a temp tree is the only way to test the lookup without reading whatever profiles the
// author happens to have.
let cliTree: CliDirs;
vi.mock('../../src/app/pack-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/pack-host')>()),
  cliDirs: () => cliTree,
}));

const DEFAULT_SETUP_DIST = path.resolve(import.meta.dirname, '..', '..', '..', 'default-setup', 'dist');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const id = (name: string) => name as EARS.EntityId;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function schemaContext(userDataDir: string) {
  return {
    userDataDir,
    packsDir: path.join(_appDirOf(userDataDir), 'packs'),
    installedPacksFile: path.join(_appDirOf(userDataDir), 'installed-packs.json'),
  };
}

/** Writes to the data dir's database as the app does, by the schema its installed packs declare */
async function write(userDataDir: string, change: () => void): Promise<void> {
  const paths = _appDataPaths(userDataDir);
  const { store, engine } = openDatabaseStore({
    path: paths.lmdb,
    schema: readInstalledSchema(schemaContext(userDataDir)),
  });
  _bindEars(engine);
  try {
    change();
  } finally {
    _bindEars(undefined);
    store.close();
  }
}

/** A data dir the app ran on: default-setup installed, its state, settings, and notes with a relation and a role */
async function appDataDir(): Promise<string> {
  const dir = tempDir('apack-db-');
  // Install the actual verified build, as the app does; settings discovery reads its sealed declarations.
  const packDir = path.join(_appDirOf(dir), 'packs', 'default-setup');
  fs.mkdirSync(path.dirname(packDir), { recursive: true });
  fs.cpSync(DEFAULT_SETUP_DIST, packDir, { recursive: true });
  await write(dir, () => {
    untypedCreate('AppState', { id: id('AppState-app') }).set('hasOnboarded', true);
    untypedCreate('Settings', { id: id('Settings-app') }).set('label', 'App').set('data', { app: { personal: { name: 'Developer' } } });
    const alpha = untypedCreate('Note', { id: id('Note-a') }).set('title', 'Alpha').grant('assistant_birth');
    untypedCreate('Note', { id: id('Note-b') }).set('title', 'Beta, "quoted"');
    alpha.link('parent_of', id('Note-b'));
  });
  // A run the app recorded, in the run history's own store: a session's root and the event it heard, as a run on
  // 2026-10-01 left them
  const store = openRunHistoryStore(_appDataPaths(dir).runHistory);
  store.put({ id: 'RunNode-1', rootId: 'RunNode-1', kind: 'flow', label: 'Root', status: 'completed', startedAt: Date.UTC(2026, 9, 1), flowId: 'Flow-root' });
  store.put({ id: 'RunNode-2', rootId: 'RunNode-1', kind: 'event', label: 'go', eventType: 'go', triggerType: 'listener', status: 'completed', startedAt: Date.UTC(2026, 9, 1, 0, 1), parentId: 'RunNode-1' });
  store.close();
  return dir;
}

/** A backup of a data dir, as the app exports it */
async function backupOf(userDataDir: string, { withMedia = false, databases }: { withMedia?: boolean; databases?: Array<'lmdb' | 'runHistory'> } = {}): Promise<string> {
  const paths = _appDataPaths(userDataDir);
  if (withMedia) {
    fs.mkdirSync(paths.media, { recursive: true });
    fs.writeFileSync(path.join(paths.media, 'image.png'), 'png');
  }
  const log = { info: () => {}, warn: () => {} };
  // Through an open store, as the app backs up: LMDB copies each database itself
  const { store } = openDatabaseStore({
    path: paths.lmdb,
    schema: readInstalledSchema(schemaContext(userDataDir)),
    // Read-only: LMDB copies a database whose files this user can't write just as well
    readOnly: true,
  });
  const runHistory = fs.existsSync(paths.runHistory) ? openRunHistoryStore(paths.runHistory, { readOnly: true }) : undefined;
  try {
    return await exportDatabase({ lmdb: store, ...(runHistory && { runHistory }) }, tempDir('backup-'), { name: 'backup', mediaPath: paths.media, appVersion: '0.3.14', log, ...(databases && { databases }) });
  } finally {
    store.close();
    runHistory?.close();
  }
}

/** Records another storage format in a database's own files, as a newer apack would have written them */
function writeStorageFormat(databaseDir: string, format: number): void {
  const { root } = openEnvironment(databaseDir);
  try {
    root.openDB({ name: 'meta', encoding: 'json' }).putSync('format', format);
  } finally {
    root.close();
  }
}

/** Runs `apack db <args>` and returns its stdout and stderr lines, and its error */
async function run(args: string[]): Promise<{ out: string; err: string; error?: Error }> {
  const out: string[] = [];
  const err: string[] = [];
  let error: Error | undefined;
  try {
    await db(args, { out: (line) => out.push(line), err: (line) => err.push(line) });
  } catch (caught) {
    error = caught as Error;
  }
  return { out: out.join('\n'), err: err.join('\n'), error };
}

async function ok(args: string[]) {
  const result = await run(args);
  if (result.error) throw result.error;
  return result;
}

/** What a running app publishes in its data dir, which `apack db` refuses to write under */
const holdLock = (dir: string) =>
  fs.writeFileSync(path.join(_appDirOf(dir), 'app.lock'), JSON.stringify({ pid: process.pid, machine: os.hostname(), since: new Date().toISOString() }));

/** What a running API publishes: its port and its process */
function publishApi(dir: string): void {
  fs.writeFileSync(path.join(_appDirOf(dir), 'api-port'), JSON.stringify({ port: 3001, pid: process.pid }));
}

describe('apack db query', () => {
  it('prints the result, after the data dir it targets', async () => {
    const dir = await appDataDir();
    const { out, err } = await ok(['query', "return query(EARS.Entity.Note).pickAll(['title']).map((n) => n.title).sort()", '--data-dir', dir, '-o', 'json']);
    expect(JSON.parse(out)).toEqual(['Alpha', 'Beta, "quoted"']);
    expect(err).toContain(`Database: ${dir} (offline)`);
    // The engine is closed and uninstalled
    expect(() => boundEars()).toThrow();
  });

  it('reads code from a file, and writes CSV to a file', async () => {
    const dir = await appDataDir();
    const code = path.join(dir, 'query.js');
    fs.writeFileSync(code, "return query(EARS.Entity.Note).pickAll().map(({ id, title }) => ({ id, title })).sort((a, b) => a.id.localeCompare(b.id))");
    const csv = path.join(dir, 'out', 'notes.csv');
    const { out, err } = await ok(['query', '--file', code, '--data-dir', dir, '--output', 'csv', '--out', csv]);
    expect(out).toBe('');
    expect(err).toContain(`Wrote ${csv}`);
    expect(fs.readFileSync(csv, 'utf-8')).toBe('id,title\nNote-a,Alpha\nNote-b,"Beta, ""quoted"""\n');
  });

  it("can't write, and changes nothing", async () => {
    const dir = await appDataDir();
    const { error } = await run(['query', "write('Note-a').set('title', 'changed')", '--data-dir', dir]);
    expect(error?.message).toBe('write is not defined');
    const { out } = await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir]);
    expect(out).toBe('Alpha');
  });

  it('reads data whose files it may not write', async () => {
    const dir = await appDataDir();
    const { lmdb } = _appDataPaths(dir);
    const files = [lmdb].flatMap((db) => fs.readdirSync(db).map((file) => path.join(db, file)));
    for (const file of files) fs.chmodSync(file, 0o444);
    try {
      const { out } = await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir]);
      expect(out).toBe('Alpha');
    } finally {
      for (const file of files) fs.chmodSync(file, 0o644);
    }
  });

  it('warns while an app runs on the data dir, and still reads', async () => {
    const dir = await appDataDir();
    holdLock(dir);
    const { out, err } = await ok(['query', 'return getSchemaStats().entities.Note', '--data-dir', dir]);
    expect(out).toBe('2');
    expect(err).toMatch(/Warning: apack is running on it/);
  });

  it('refuses bad arguments with its usage', async () => {
    const dir = await appDataDir();
    expect((await run(['query', '--data-dir', dir])).error?.message).toMatch(/^No code to run\n\nUsage: apack db query/);
    expect((await run(['query', 'return 1', '--nope'])).error?.message).toMatch(/Unknown option '--nope'[\s\S]*Usage: apack db query/);
    expect((await run(['query', 'return 1', '-o', 'xml', '--data-dir', dir])).error?.message).toBe('--output must be one of pretty, json, csv');
    expect((await run(['query', 'return 1', '--profile', 'development', '--profile', 'beta'])).error?.message).toMatch(/Specify --profile once/);
    expect((await run(['query', 'return 1', '--data-dir', tempDir('empty-')])).error?.message).toMatch(/^No apack database in /);
  });
});

describe('naming the data dir', () => {
  it('refuses an empty --data-dir rather than falling back to the default data dir', async () => {
    const dir = await appDataDir();
    process.env.APACK_USER_DATA_DIR = dir;
    try {
      for (const args of [['query', 'return 1', '--data-dir='], ['query', 'return 1', '--data-dir', '']]) {
        const { error, err } = await run(args);
        expect(error?.message).toMatch(/^--data-dir needs a path/);
        expect(err).toBe('');
      }
    } finally {
      delete process.env.APACK_USER_DATA_DIR;
    }
  });

  // Which app's data each flag means, without opening it: the flag that picks the data dir a change deletes is
  // worth pinning by itself. parseDbArgs resolves it, so no test has to touch a real data dir to check
  it('resolves each flag to that app\'s data dir, and --data-dir to the path given', () => {
    const wasSet = process.env.APACK_USER_DATA_DIR;
    delete process.env.APACK_USER_DATA_DIR;
    try {
      const targetOf = (args: string[]) => parseDbArgs(args, {}, 'usage').target;
      for (const [args, env] of [[[], 'production'], [['--profile', 'production'], 'production'], [['--profile', 'development'], 'development'], [['--profile', 'beta'], 'beta']] as const) {
        const target = targetOf([...args]);
        expect(target.env, args.join(' ') || '(no flag)').toBe(env);
        expect(target.userDataDir, args.join(' ') || '(no flag)').toBe(resolveAppEnvironment({ env }).userDataDir);
      }
      // Each names a different app's data, so a swap between them can't pass
      const dirs = [[], ['--profile', 'development'], ['--profile', 'beta']].map((args) => targetOf(args).userDataDir);
      expect(new Set(dirs).size).toBe(3);

      const given = path.join(os.tmpdir(), 'apack-db-target');
      expect(targetOf(['--data-dir', given])).toMatchObject({ userDataDir: given, named: true });
      expect(targetOf([]).named).toBe(false);
    } finally {
      if (wasSet !== undefined) process.env.APACK_USER_DATA_DIR = wasSet;
    }
  });

  // The variable is how the repo's db:* scripts and these tests point at a temp data dir, so it still applies when
  // nothing names an app; a flag that does name one means that app's data, not whatever the shell points at
  it('takes a named data dir over APACK_USER_DATA_DIR, and takes the variable when nothing is named', () => {
    const dir = tempDir('apack-db-env-');
    const fromEnv = path.join(os.tmpdir(), 'apack-db-from-env');
    process.env.APACK_USER_DATA_DIR = fromEnv;
    try {
      expect(parseDbArgs(['--data-dir', dir], {}, 'usage').target.userDataDir).toBe(dir);
      // The app's own data dir, which is what resolveAppEnvironment gives when the variable isn't set
      for (const [args, env] of [[['--profile', 'development'], 'development'], [['--profile', 'beta'], 'beta'], [['--profile', 'production'], 'production']] as const) {
        expect(parseDbArgs([...args], {}, 'usage').target.userDataDir, args.join(' ')).toBe(appDataDirFor(env));
      }
      expect(parseDbArgs([], {}, 'usage').target.userDataDir).toBe(fromEnv);
    } finally {
      delete process.env.APACK_USER_DATA_DIR;
    }
  });

  // A profile is a data dir `apack pack dev` made, so `apack db` reaches one the same way the user names it
  // everywhere else. Resolved through listProfiles rather than by joining the name to the profiles root,
  // which is what makes an ephemeral one — a level down, under .ephemeral/ — reachable by its printed name.
  it('resolves --profile to that profile\'s data dir, ephemeral ones included', () => {
    cliTree = { cache: tempDir('apack-db-cache-'), data: tempDir('apack-db-data-') };
    const named = openProfile(cliTree, 'probe');
    const ephemeral = mintProfile(cliTree, true);

    const targetOf = (args: string[]) => parseDbArgs(args, {}, 'usage').target;
    expect(targetOf(['--profile', 'probe'])).toMatchObject({ userDataDir: named.dir, named: true });
    expect(targetOf(['--profile', ephemeral.name]).userDataDir, 'the name run prints').toBe(ephemeral.dir);
  });

  // A name that matches nothing lists what there is: resolving it to a path and letting the open fail would
  // report a directory the user never typed
  it('names the profiles there are when --profile matches none', () => {
    cliTree = { cache: tempDir('apack-db-cache-'), data: tempDir('apack-db-data-') };
    openProfile(cliTree, 'probe');
    expect(() => parseDbArgs(['--profile', 'nope'], {}, 'usage')).toThrow(/No profile named "nope"\. There is: probe\./);

    cliTree = { ...cliTree, data: tempDir('apack-db-empty-') };
    expect(() => parseDbArgs(['--profile', 'nope'], {}, 'usage')).toThrow(/There are none/);
    expect(() => parseDbArgs(['--profile', ''], {}, 'usage')).toThrow(/--profile needs a name/);
  });

  it('refuses two data dirs', async () => {
    const dir = await appDataDir();
    expect((await run(['query', 'return 1', '--profile', 'development', '--data-dir', dir])).error?.message).toMatch(/^Name one data dir, not 2: --profile, --data-dir/);
    expect((await run(['query', 'return 1', '--profile', 'production', '--data-dir', dir])).error?.message).toMatch(/^Name one data dir, not 2: --profile, --data-dir/);
    expect((await run(['reset', '--profile', 'beta', '--profile', 'production'])).error?.message).toMatch(/Specify --profile once/);
    expect((await run(['query', 'return 1', '--profile', 'development', '--profile', 'probe'])).error?.message).toMatch(/Specify --profile once/);
  });

  it('makes a command that changes the database name its data dir, and opens none until it does', async () => {
    const dir = await appDataDir();
    const changes = [['exec', 'return 1'], ['reset', '--force'], ['clear-settings', '--force'], ['import', dir, '--force'], ['repl', '--write']];
    for (const args of changes) {
      const { error, err, out } = await run(args);
      expect(error?.message, args.join(' ')).toMatch(/--profile <name> or --data-dir <path>/);
      expect(`${err}${out}`).toBe('');
    }
  });

  it('lets a command that only reads take the production app\'s data without being told, dry runs included', async () => {
    const dir = await appDataDir();
    process.env.APACK_USER_DATA_DIR = dir;
    try {
      expect((await ok(['query', 'return 1'])).err).toContain(`Database: ${dir} (offline)`);
      // A dry run reads: it lists what --force would delete
      expect((await ok(['reset'])).out).toContain('Would delete the database');
      expect((await ok(['clear-settings'])).out).toContain('Would destroy 1 Settings row(s)');
    } finally {
      delete process.env.APACK_USER_DATA_DIR;
    }
  });

  // --production names the real production app's data, which no test may open, so the write goes to a named dir
  it('names a data dir for a change, and writes what the code returns to it', async () => {
    const dir = await appDataDir();
    process.env.APACK_USER_DATA_DIR = dir;
    try {
      expect(parseDbArgs(['--profile', 'production'], {}, 'usage').target.userDataDir).toBe(appDataDirFor('production'));

      const { out, err } = await ok(['exec', "write('Note-a').set('title', 'Named')", '--data-dir', dir]);
      expect(err).toContain(`Database: ${dir} (offline)`);
      expect(out).toBe('undefined');
      expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Named');
    } finally {
      delete process.env.APACK_USER_DATA_DIR;
    }
  });
});

describe('the lock a change holds', () => {
  /** What holds the data dir's database while `command` runs, and what holds it after */
  async function writerDuring(args: string[], dir: string) {
    const running = ok(args);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const during = findDatabaseWriter(dir);
    await running;
    return { during, after: findDatabaseWriter(dir) };
  }

  const slowCode = 'return new Promise((resolve) => setTimeout(() => resolve(1), 60))';

  it('is held while a change runs and released after, so an app that starts meanwhile refuses to open the database', async () => {
    const dir = await appDataDir();
    // A script, since exec's transaction code is synchronous and so cannot keep the command running
    const script = path.join(dir, 'slow.mjs');
    fs.writeFileSync(script, `export default () => new Promise((resolve) => setTimeout(() => resolve(1), 60));`);
    expect(await writerDuring(['script', script, '--data-dir', dir], dir))
      .toEqual({ during: `apack db script (pid ${process.pid})`, after: null });
  });

  it('is not taken by a command that only reads', async () => {
    const dir = await appDataDir();
    expect(await writerDuring(['query', slowCode, '--data-dir', dir], dir)).toEqual({ during: null, after: null });
  });

  it('refuses a second command, and is released when one fails', async () => {
    const dir = await appDataDir();
    const held = holdDatabaseWriteLock(dir, 'apack db import');
    try {
      const { error } = await run(['reset', '--force', '--data-dir', dir]);
      expect(error?.message).toBe(
        `Another tool is changing the database in ${dir}: apack db import (pid ${process.pid}). ` +
        `If no tool is running, delete ${path.join(_appDirOf(dir), 'db-write.lock')} and try again.`,
      );
    } finally {
      held.release();
    }
    // A command whose code throws still releases it
    expect((await run(['exec', 'throw new Error("boom")', '--data-dir', dir])).error?.message).toMatch(/boom/);
    expect(findDatabaseWriter(dir)).toBeNull();
    // So does one refused because an app is running
    holdLock(dir);
    expect((await run(['exec', 'return 1', '--data-dir', dir])).error?.message).toMatch(/quit it first/);
    expect(findDatabaseWriter(dir)).toBeNull();
  });
});

describe('apack db runs', () => {
  it('lists the runs, newest first, and prints one run\'s tree', async () => {
    const dir = await appDataDir();
    const { out, err } = await ok(['runs', '--data-dir', dir]);
    expect(err).toContain(`Run history: ${_appDataPaths(dir).runHistory}`);
    expect(out).toBe('RunNode-1  completed  2026-10-01T00:00:00.000Z  Root  (Flow-root)');
    expect(JSON.parse((await ok(['runs', '--data-dir', dir, '--json'])).out)).toEqual([expect.objectContaining({ id: 'RunNode-1', label: 'Root' })]);
    expect((await ok(['runs', '--flow', 'Flow-other', '--data-dir', dir])).out).toBe('No runs');

    const tree = JSON.parse((await ok(['runs', '--run', 'RunNode-1', '--data-dir', dir])).out);
    expect(tree).toMatchObject({ id: 'RunNode-1', children: [{ id: 'RunNode-2', label: 'go', children: [] }] });
    expect((await run(['runs', '--run', 'RunNode-missing', '--data-dir', dir])).error?.message).toBe('No run node RunNode-missing in the run history');
  });

  it('says when a data dir has no run history, and leaves it without one', async () => {
    const dir = await appDataDir();
    fs.rmSync(_appDataPaths(dir).runHistory, { recursive: true });
    expect((await run(['runs', '--data-dir', dir])).error?.message).toMatch(/No run history in .*: apack hasn't run a flow on it/);
    expect(fs.existsSync(_appDataPaths(dir).runHistory)).toBe(false);
  });
});

describe('apack db exec', () => {
  it('writes with the transaction helpers', async () => {
    const dir = await appDataDir();
    const { out } = await ok(['exec', "write('Note-a').set('title', 'Changed'); return create(EARS.Entity.Note).set('title', 'New').id()", '--data-dir', dir]);
    expect(out).toMatch(/^Note-/);
    const titles = await ok(['query', "return query(EARS.Entity.Note).pickAll(['title']).map((n) => n.title).sort()", '--data-dir', dir, '-o', 'json']);
    expect(JSON.parse(titles.out)).toEqual(['Beta, "quoted"', 'Changed', 'New']);
  });

  it('refuses while an app holds the data dir or its API answers, changing nothing', async () => {
    const locked = await appDataDir();
    holdLock(locked);
    const byLock = await run(['exec', "write('Note-a').set('title', 'Changed')", '--data-dir', locked]);
    expect(byLock.error?.message).toMatch(/^apack is running on [\s\S]*quit it first/);
    // The marker outlives a crash and its pid can be one the OS has since reused, so the refusal has to
    // name the file: without it the data dir is one no tool could ever write to again
    expect(byLock.error?.message, 'the refusal gave no way out').toContain(`delete ${path.join(_appDirOf(locked), 'app.lock')}`);

    const served = await appDataDir();
    publishApi(served);
    const byPort = await run(['exec', "write('Note-a').set('title', 'Changed')", '--data-dir', served]);
    expect(byPort.error?.message).toMatch(new RegExp(`its API is running on port 3001 \\(pid ${process.pid}\\)`));
    const { out } = await ok(['query', "return getRow('Note-a')?.title", '--data-dir', served]);
    expect(out).toBe('Alpha');
  });

  it('keeps none of what the code wrote when it throws part way', async () => {
    const dir = await appDataDir();
    const { error } = await run(['exec', "write('Note-a').set('title', 'Written'); throw new Error('boom')", '--data-dir', dir]);
    expect(error?.message).toMatch(/^Transaction failed: boom[\s\S]*Nothing it wrote was kept/);
    const { out } = await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir]);
    expect(out).toBe('Alpha');
  });
});

describe('apack db repl', () => {
  it('runs each line, reporting errors without stopping', async () => {
    const dir = await appDataDir();
    const out: string[] = [];
    const err: string[] = [];
    const input = Readable.from(["return getRow('Note-a')?.title\n", "write('Note-a')\n", '\n', 'return 2\n', '.exit\n', 'return 3\n']);
    await dbRepl(['--data-dir', dir], { out: (l) => out.push(l), err: (l) => err.push(l) }, input);
    expect(out).toEqual(['Alpha', '2']);
    expect(err).toContain('Error: write is not defined');
  });

  it('refuses a --write session while an app runs on the data dir, changing nothing', async () => {
    const dir = await appDataDir();
    holdLock(dir);
    const io = { out: () => {}, err: () => {} };
    const input = Readable.from(["write('Note-a').set('title', 'From the repl')\n"]);
    await expect(dbRepl(['--data-dir', dir, '--write'], io, input)).rejects
      .toThrow(/^apack is running on .* \(its process is running \(pid \d+\)\): quit it first/);
    const { out } = await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir]);
    expect(out).toBe('Alpha');
  });

  it('reads while an app runs, warning as the other commands do', async () => {
    const dir = await appDataDir();
    holdLock(dir);
    const out: string[] = [];
    const err: string[] = [];
    const input = Readable.from(["return getRow('Note-a')?.title\n"]);
    await dbRepl(['--data-dir', dir], { out: (l) => out.push(l), err: (l) => err.push(l) }, input);
    expect(out).toEqual(['Alpha']);
    expect(err.join('\n')).toMatch(/Warning: apack is running on it/);
  });

  it('saves the writes of a --write session', async () => {
    const dir = await appDataDir();
    const io = { out: () => {}, err: () => {} };
    await dbRepl(['--data-dir', dir, '--write'], io, Readable.from(["write('Note-a').set('title', 'From the repl')\n"]));
    const { out } = await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir]);
    expect(out).toBe('From the repl');
  });
});

describe('apack db script', () => {
  /** A script file in the data dir, so it is cleaned up with it */
  function writeScript(dir: string, name: string, source: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  // A script that awaits anything must finish before the command reports success: it used to exit early
  // and say it worked, so an export wrote a truncated file and a prompt was never answered. Driven
  // through the binary on purpose — in-process the command is just awaited, and a premature
  // `process.exit` is exactly what an in-process call cannot catch.
  it('waits for a script that awaits, before the process exits', async () => {
    const dir = await appDataDir();
    const marker = path.join(dir, 'finished.txt');
    const file = writeScript(dir, 'slow.ts', [
      "import * as fs from 'node:fs';",
      'export default async ({ log }: any) => {',
      "  log('started');",
      '  await new Promise((resolve) => setTimeout(resolve, 400));',
      `  fs.writeFileSync(${JSON.stringify(marker)}, 'finished');`,
      "  return 'done';",
      '};',
    ].join('\n'));

    const run = await runCli([file, '--data-dir', dir]);
    expect(run.status, run.stderr).toBe(0);
    expect(fs.existsSync(marker), 'the script finished before the process exited').toBe(true);
    expect(run.stdout.trim().split('\n')).toEqual(['started', 'done']);
  });

  it('runs a file with the open database, its arguments and a printer, and prints what it returns', async () => {
    const dir = await appDataDir();
    const file = writeScript(dir, 'rename.ts', [
      "import * as os from 'node:os';",
      'export default async ({ db, EARS, args, log }: any) => {',
      "  log(`renaming on ${typeof os.hostname()}`);",
      "  db.ears.write('Note-a').set('title', args[0]);",
      '  return db.ears.query(EARS.Entity.Note).count();',
      '};',
    ].join('\n'));

    const { out } = await ok(['script', file, '--data-dir', dir, '--', 'From a script']);
    expect(out.split('\n')).toEqual(['renaming on string', '2']);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('From a script');
  });

  it('runs a plain module too, and writes what it returns to a file', async () => {
    const dir = await appDataDir();
    const file = writeScript(dir, 'titles.mjs', [
      'export default ({ db }) => db.ears.query("Note").ids().map((id) => ({ id, title: db.ears.getRow(id)?.title }));',
    ].join('\n'));
    const out = path.join(dir, 'titles.json');
    await ok(['script', file, '--data-dir', dir, '-o', 'json', '--out', out]);
    expect(JSON.parse(fs.readFileSync(out, 'utf-8')).map((row: { title: string }) => row.title).sort()).toEqual(['Alpha', 'Beta, "quoted"']);
  });

  it('runs a TypeScript script through the real CLI, with its own imports, as a user does', async () => {
    const dir = await appDataDir();
    writeScript(dir, 'helper.ts', "export const titleOf = (db: any, id: string): string => db.ears.getRow(id)?.title;");
    const file = writeScript(dir, 'report.ts', [
      "import { titleOf } from './helper';",
      'export default ({ db, args }: any) => ({ title: titleOf(db, args[0]), notes: db.ears.query("Note").count() });',
    ].join('\n'));

    // In this process vitest compiles the script; the CLI has to do it itself, so drive the binary
    const compiledDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('apack-db-script-'));
    const before = compiledDirs();
    const run = await runCli([file, '--data-dir', dir, '-o', 'json', '--', 'Note-a']);
    expect(run.stderr).toContain(`Database: ${dir} (offline)`);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ title: 'Alpha', notes: 2 });
    // Nothing is left behind: not beside the script, not in the temp dir it compiled to
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.mjs'))).toEqual([]);
    expect(compiledDirs()).toEqual(before);
  });

  it("runs a script in a directory it can't write, importing a package from beside it", async () => {
    const dir = await appDataDir();
    const scripts = path.join(dir, 'read-only-scripts');
    fs.mkdirSync(path.join(scripts, 'node_modules', 'greet'), { recursive: true });
    fs.writeFileSync(path.join(scripts, 'node_modules', 'greet', 'package.json'), JSON.stringify({ name: 'greet', version: '1.0.0', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(scripts, 'node_modules', 'greet', 'index.js'), 'export const greet = (name) => `hello ${name}`;');
    const file = path.join(scripts, 'report.ts');
    fs.writeFileSync(file, [
      "import { greet } from 'greet';",
      "import * as path from 'node:path';",
      'export default ({ db }: any) => ({ greeting: greet(db.ears.getRow("Note-a")?.title), here: path.basename(import.meta.dirname) });',
    ].join('\n'));
    fs.chmodSync(scripts, 0o555);

    try {
      const run = await runCli([file, '--data-dir', dir, '-o', 'json']);
      expect(run.status, run.stderr).toBe(0);
      // The package next to the script loaded, and import.meta still points at the script's own directory
      expect(JSON.parse(run.stdout)).toEqual({ greeting: 'hello Alpha', here: 'read-only-scripts' });
    } finally {
      fs.chmodSync(scripts, 0o755);
    }
  });

  const cliBin = () => path.resolve(import.meta.dirname, '..', '..', 'bin', 'apack.mjs');

  /**
   * The CLI as a user runs it: its own process, so a script's pending work and the exit code are the real ones.
   * Asynchronous, so the worker's event loop keeps turning while it runs.
   */
  function runCli(args: string[], input = ''): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliBin(), 'db', 'script', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf-8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf-8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  /**
   * The same, with nothing read from it until it exits (or a moment passes, since a run that waits for its output to
   * be taken can't exit first): a slow reader, where output the CLI hasn't flushed is lost.
   */
  function runCliSlowReader(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [cliBin(), 'db', 'script', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let reading = false;
      const read = () => {
        if (reading) return;
        reading = true;
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      };
      const waited = setTimeout(read, 1500);
      child.on('exit', read);
      child.on('close', (status) => { clearTimeout(waited); resolve({ status, stdout, stderr }); });
    });
  }

  it('waits for an async script, printing everything it logged and saving what it wrote', async () => {
    const dir = await appDataDir();
    const file = writeScript(dir, 'slow.mjs', [
      'export default async ({ db, log }) => {',
      "  log('first');",
      '  await new Promise((resolve) => setTimeout(resolve, 250));',
      "  db.ears.write('Note-a').set('title', 'Written late');",
      "  log('second');",
      '  await new Promise((resolve) => setTimeout(resolve, 250));',
      "  return 'finished';",
      '};',
    ].join('\n'));

    const run = await runCli([file, '--data-dir', dir]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual(['first', 'second', 'finished']);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Written late');
  });

  it('waits for a script that asks the user something', async () => {
    const dir = await appDataDir();
    const file = writeScript(dir, 'ask.mjs', [
      "import * as readline from 'node:readline/promises';",
      'export default async ({ db, log }) => {',
      '  const lines = readline.createInterface({ input: process.stdin, output: process.stdout });',
      "  const answer = await lines.question('Rename Note-a? (y/N) ');",
      '  lines.close();',
      "  if (answer.trim().toLowerCase() !== 'y') return 'cancelled';",
      "  db.ears.write('Note-a').set('title', 'Renamed');",
      "  log('renamed');",
      "  return 'done';",
      '};',
    ].join('\n'));

    const run = await runCli([file, '--data-dir', dir], 'y\n');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('renamed');
    expect(run.stdout.trim().endsWith('done')).toBe(true);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Renamed');
  });

  it('fails, naming the script, when it throws or rejects, keeping what it printed first', async () => {
    const dir = await appDataDir();
    const rejects = writeScript(dir, 'rejects.mjs', [
      'export default async ({ log }) => {',
      '  for (let i = 0; i < 20000; i++) log(`line ${i} ${"x".repeat(100)}`);',
      '  await new Promise((resolve) => setTimeout(resolve, 100));',
      "  throw new Error('boom from the script');",
      '};',
    ].join('\n'));

    const rejected = await runCliSlowReader([rejects, '--data-dir', dir]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain(`${rejects} failed: boom from the script`);
    // Everything it printed before it failed is there, rather than dropped by the exit
    expect(rejected.stdout.trim().split('\n').at(-1)).toBe(`line 19999 ${'x'.repeat(100)}`);

    const throws = writeScript(dir, 'throws.mjs', "export default () => { throw new Error('thrown at once'); };");
    const thrown = await run(['script', throws, '--data-dir', dir]);
    expect(thrown.error?.message).toBe(`${throws} failed: thrown at once`);
    // The database was closed whichever way it failed, so nothing holds the write lock
    expect(findDatabaseWriter(dir)).toBeNull();
  });

  it('refuses a file that is missing, or exports no function, changing nothing', async () => {
    const dir = await appDataDir();
    expect((await run(['script', path.join(dir, 'nope.ts'), '--data-dir', dir])).error?.message).toBe(`No script at ${path.join(dir, 'nope.ts')}`);
    expect((await run(['script', '--data-dir', dir])).error?.message).toMatch(/^Name the script to run/);

    const noExport = writeScript(dir, 'no-export.ts', 'export const notDefault = () => 1;');
    expect((await run(['script', noExport, '--data-dir', dir])).error?.message)
      .toBe(`${noExport} exports no function to run: export default ({ db, EARS, args, log }) => { ... }`);
    expect(findDatabaseWriter(dir)).toBeNull();
  });

  it('writes by default, and only reads with --read-only, which works while an app runs', async () => {
    const dir = await appDataDir();
    const write = writeScript(dir, 'write.ts', "export default ({ db }: any) => db.ears.write('Note-a').set('title', 'Changed');");
    publishApi(dir);
    expect((await run(['script', write, '--data-dir', dir])).error?.message).toMatch(/quit it first/);

    const read = writeScript(dir, 'read.ts', "export default ({ db }: any) => db.ears.getRow('Note-a')?.title;");
    const { out, err } = await ok(['script', read, '--data-dir', dir, '--read-only']);
    expect(out).toBe('Alpha');
    expect(err).toMatch(/Warning: apack is running on it/);
    // A read-only run can't write, and takes no lock
    const refused = await run(['script', write, '--data-dir', dir, '--read-only']);
    expect(refused.error?.message).toMatch(/open read-only/);
  });
});

describe('apack db inspect', () => {
  it("shows an entity's roles and relations, in the directions asked", async () => {
    const dir = await appDataDir();
    const both = await ok(['inspect', 'Note-b', '--data-dir', dir, '--depth', '2']);
    expect(both.out.split('\n')).toEqual([
      '[Note] Note-b "Beta, "quoted""',
      '  <- parent_of (1)',
      '    [Note] Note-a "Alpha"',
      '      roles: assistant_birth',
      '      -> parent_of (1)',
      '          [Note] Note-b',
    ]);
    const deeper = await ok(['inspect', 'Note-b', '--data-dir', dir, '--depth', '3']);
    expect(deeper.out.split('\n').at(-1)).toBe('        [Note] Note-b (shown above)');
    const outgoing = await ok(['inspect', 'Note-b', '--data-dir', dir, '--outgoing']);
    expect(outgoing.out).toBe('[Note] Note-b "Beta, "quoted""');
    expect((await ok(['inspect', 'Note-x', '--data-dir', dir])).out).toBe('Not found: Note-x');
  });

  it('shows only incoming relations with --incoming, and only the first five of a crowded type', async () => {
    const dir = await appDataDir();
    const incoming = await ok(['inspect', 'Note-a', '--data-dir', dir, '--incoming']);
    // Note-a has one outgoing relation (parent_of Note-b) and no incoming one, so only its own line is left
    expect(incoming.out).toBe('[Note] Note-a "Alpha"\n  roles: assistant_birth');

    await write(dir, () => {
      for (const n of [1, 2, 3, 4, 5, 6]) untypedCreate('Note', { id: id(`Note-many-${n}`) }).set('title', `Many ${n}`);
    });
    const many = await ok(['inspect', '--type', 'Note', '--data-dir', dir]);
    const lines = many.out.split('\n');
    expect(lines[0]).toBe('8 Note entities, the first 5:');
    expect(lines.filter((line) => line.startsWith('[Note] '))).toHaveLength(5);
  });

  it('counts relations per entity type, or shows the first entities of one', async () => {
    const dir = await appDataDir();
    const stats = await ok(['inspect', '--data-dir', dir]);
    expect(stats.out.split('\n')).toContainEqual(expect.stringMatching(/^Note\s+2\s+1\s+0\.5$/));
    const byType = await ok(['inspect', '--type', 'Settings', '--data-dir', dir]);
    expect(byType.out.split('\n').slice(0, 2)).toEqual(['1 Settings entities', '[Settings] Settings-app "App"']);
    expect((await run(['inspect', 'Note-a', '--type', 'Note', '--data-dir', dir])).error?.message).toMatch(/not both/);
    // A type no installed pack declares is a typo, not an empty result, as in export
    expect((await run(['inspect', '--type', 'Nope', '--data-dir', dir])).error?.message).toBe('Not an entity type of the installed packs: Nope');
    expect((await run(['inspect', '--depth', '0', '--data-dir', dir])).error?.message).toMatch(/--depth/);
  });
});

describe('apack db export', () => {
  it('writes a file per entity type with entities, the relations, and a summary', async () => {
    const dir = await appDataDir();
    const out = path.join(dir, 'export');
    await ok(['export', '--out', out, '--data-dir', dir]);
    const notes = JSON.parse(fs.readFileSync(path.join(out, 'Note.json'), 'utf-8'));
    expect(notes.map((n: { id: string }) => n.id).sort()).toEqual(['Note-a', 'Note-b']);
    expect(notes.find((n: { id: string }) => n.id === 'Note-a')).toMatchObject({ title: 'Alpha', role: ['assistant_birth'] });
    expect(JSON.parse(fs.readFileSync(path.join(out, 'Relation.json'), 'utf-8'))).toEqual([
      expect.objectContaining({ kind: 'parent_of', source: 'Note-a', target: 'Note-b' }),
    ]);
    expect(fs.existsSync(path.join(out, 'Flow.json'))).toBe(false);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'export.json'), 'utf-8'));
    expect(summary).toMatchObject({ userDataDir: dir, format: 'json', counts: { Note: 2, Settings: 1, AppState: 1 }, relations: 1 });
    expect(summary.counts).not.toHaveProperty('relations');
  });

  it('exports the types asked, as CSV, and refuses a type no pack declares', async () => {
    const dir = await appDataDir();
    const out = path.join(dir, 'export');
    await ok(['export', '--out', out, '--type', 'Settings', '-t', 'Flow', '--format', 'csv', '--data-dir', dir]);
    expect(fs.readdirSync(out).sort()).toEqual(['Flow.csv', 'Settings.csv', 'export.json']);
    const [header, row] = fs.readFileSync(path.join(out, 'Settings.csv'), 'utf-8').split('\n');
    expect(header.split(',')).toEqual(expect.arrayContaining(['id', 'entityType', 'label', 'data']));
    expect(row).toContain('"{""app"":{""personal"":{""name"":""Developer""}}}"');
    expect((await run(['export', '--out', out, '--type', 'Nope', '--data-dir', dir])).error?.message).toBe('Not an entity type of the installed packs: Nope');
    expect((await run(['export', '--data-dir', dir])).error?.message).toMatch(/^--out is required/);
  });
});

describe('apack db clear-settings', () => {
  it('lists the Settings rows, and destroys them only with --force', async () => {
    const dir = await appDataDir();
    const dry = await ok(['clear-settings', '--data-dir', dir]);
    expect(dry.out).toMatch(/Would destroy 1 Settings row\(s\)/);
    expect(dry.out).toContain('Dry run: nothing was changed');
    expect((await ok(['query', 'return query.withTrashed("Settings").ids()', '--data-dir', dir, '-o', 'json'])).out).toContain('Settings-app');

    const forced = await ok(['clear-settings', '--force', '--data-dir', dir]);
    expect(forced.out).toContain('Destroyed 1 Settings row(s)');
    expect(JSON.parse((await ok(['query', 'return query.withTrashed("Settings").ids()', '--data-dir', dir, '-o', 'json'])).out)).toEqual([]);
    expect((await ok(['clear-settings', '--force', '--data-dir', dir])).out).toBe('No Settings rows: nothing to destroy.');
  });

  // Only the Settings rows: the command is for settings a user can't get past, not for their data
  it('leaves every other entity, its roles and its relations where they were', async () => {
    const dir = await appDataDir();
    const rows = () => ok(['query', 'return query.withTrashed.all().ids().sort()', '--data-dir', dir, '-o', 'json']);
    const before = JSON.parse((await rows()).out) as string[];

    await ok(['clear-settings', '--force', '--data-dir', dir]);

    expect(JSON.parse((await rows()).out)).toEqual(before.filter((entity) => entity !== 'Settings-app'));
    expect(JSON.parse((await ok(['query', 'return getRoles("Note-a")', '--data-dir', dir, '-o', 'json'])).out)).toEqual(['assistant_birth']);
    expect(JSON.parse((await ok(['query', 'return findRelations({ source: "Note-a" }).map((r) => r.target)', '--data-dir', dir, '-o', 'json'])).out))
      .toEqual(['Note-b']);
    expect((await ok(['query', 'return getRow("Note-a")?.title', '--data-dir', dir])).out).toBe('Alpha');
  });

  it('refuses while an app runs on the data dir', async () => {
    const dir = await appDataDir();
    holdLock(dir);
    expect((await run(['clear-settings', '--force', '--data-dir', dir])).error?.message).toMatch(/quit it first/);
  });
});

describe('a dry run of a command that changes data', () => {
  it('reads, so it works while an app runs on the data dir and against files it may not write', async () => {
    const running = await appDataDir();
    publishApi(running);
    const listed = await ok(['reset', '--data-dir', running]);
    expect(listed.out).toContain('Would delete the database');
    expect(listed.err).toMatch(/Warning: apack is running on it/);
    // Only the change itself is refused
    expect((await run(['reset', '--force', '--data-dir', running])).error?.message).toMatch(/quit it first/);

    const copy = await appDataDir();
    const { lmdb } = _appDataPaths(copy);
    const files = [lmdb].flatMap((db) => fs.readdirSync(db).map((file) => path.join(db, file)));
    for (const file of files) fs.chmodSync(file, 0o444);
    try {
      expect((await ok(['clear-settings', '--data-dir', copy])).out).toContain('Would destroy 1 Settings row(s)');
      const backup = await backupOf(copy);
      expect((await ok(['import', backup, '--data-dir', copy])).out).toContain('Would replace the current database');
    } finally {
      for (const file of files) fs.chmodSync(file, 0o644);
    }
  });

  it('takes no lock, so two dry runs can run at once', async () => {
    const dir = await appDataDir();
    const held = holdDatabaseWriteLock(dir, 'apack db import');
    try {
      expect((await ok(['reset', '--data-dir', dir])).out).toContain('Would delete the database');
    } finally {
      held.release();
    }
  });
});

describe('apack db reset', () => {
  async function withKey(dir: string): Promise<string> {
    const file = _appDataPaths(dir).secretsFile;
    const vault = memoryKeyVault('unprotected');
    createSecretsStore({ filePath: file, osVault: () => vault, fileVault: () => vault, useFileVault: true }).add('anthropic', 'Work', 'sk-ant-api03-test');
    return file;
  }

  it('lists what it would delete, and deletes the data and stored keys only with --force', async () => {
    const dir = await appDataDir();
    const secretsFile = await withKey(dir);
    const dry = await ok(['reset', '--data-dir', dir]);
    expect(dry.out).toContain('Would delete the database');
    expect(dry.out).toContain('  Note: 2');
    expect(dry.out).toMatch(/Would delete 1 stored API key\(s\)[\s\S]*Anthropic — Work/);
    expect(dry.out).toContain(`Would delete the run history (${_appDataPaths(dir).runHistory})`);
    expect(dry.out).toContain('Dry run: nothing was changed');
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf-8')).secrets).toHaveLength(1);

    const forced = await ok(['reset', '--force', '--data-dir', dir]);
    expect(forced.out).toContain('Reset.');
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf-8')).secrets).toEqual([]);
    expect(fs.existsSync(_appDataPaths(dir).runHistory)).toBe(false);
    const after = await ok(['query', 'return query.withTrashed.all().ids()', '--data-dir', dir, '-o', 'json']);
    expect(JSON.parse(after.out)).toEqual([]);
    expect((await ok(['reset', '--data-dir', dir])).out).toContain('Would delete 0 stored API key(s)');
  });

  // The keys are the half no backup holds, so wiping the data doesn't have to take them
  it('keeps the stored keys with --keep-keys, and says so', async () => {
    const dir = await appDataDir();
    const secretsFile = await withKey(dir);

    const dry = await ok(['reset', '--keep-keys', '--data-dir', dir]);
    expect(dry.out).toContain('Keeping 1 stored API key(s) (--keep-keys)');
    expect(dry.out).not.toContain('Would delete 1 stored API key');

    await ok(['reset', '--keep-keys', '--force', '--data-dir', dir]);
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf-8')).secrets).toHaveLength(1);
    expect(JSON.parse((await ok(['query', 'return query.withTrashed.all().ids()', '--data-dir', dir, '-o', 'json'])).out)).toEqual([]);
  });

  it('refuses while an app runs on the data dir', async () => {
    const dir = await appDataDir();
    publishApi(dir);
    expect((await run(['reset', '--force', '--data-dir', dir])).error?.message).toMatch(/quit it first/);
    expect((await ok(['query', 'return query.withTrashed("Note").count()', '--data-dir', dir])).out).toBe('2');
  });
});

describe('apack db import', () => {
  const backupWith = async (title: string, options: { databases?: Array<'lmdb' | 'runHistory'> } = {}) => {
    const source = await appDataDir();
    await write(source, () => { untypedWrite(id('Note-a')).set('title', title); untypedWrite(id('Note-b')).destroy(); });
    return backupOf(source, { withMedia: true, ...options });
  };

  it('lists the backup and what it replaces, and replaces the database and media only with --force', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup');
    const dry = await ok(['import', backup, '--data-dir', dir]);
    expect(dry.out).toContain(`Backup: ${backup}`);
    expect(dry.out).toContain('  databases: lmdb, with media');
    expect(dry.out).toMatch(/Would replace the current database, which holds:\n(.*\n)*  Note: 2/);
    expect(dry.out).toContain('Dry run: nothing was changed');
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Alpha');

    await ok(['import', backup, '--force', '--data-dir', dir]);
    expect((await ok(['query', "return [getRow('Note-a')?.title, query.withTrashed('Note').count()]", '--data-dir', dir, '-o', 'json'])).out)
      .toBe(JSON.stringify(['From the backup', 1], null, 2));
    expect(fs.readFileSync(path.join(_appDataPaths(dir).media, 'image.png'), 'utf-8')).toBe('png');
  });

  it('says what made the backup, and names it when the files are in a format it cannot read', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup');
    const metadata = JSON.parse(fs.readFileSync(path.join(backup, 'metadata.json'), 'utf-8'));
    expect(metadata).toMatchObject({ appVersion: '0.3.14', storageFormats: { lmdb: LMDB_FORMAT_VERSION } });
    expect(Object.keys(metadata).sort()).toEqual(['appVersion', 'databases', 'includesMedia', 'storageFormats', 'timestamp']);

    const listed = await ok(['import', backup, '--data-dir', dir]);
    expect(listed.out).toMatch(/made .* by apack 0\.3\.14/);

    // The databases themselves are what a newer apack would have written
    writeStorageFormat(path.join(backup, 'lmdb'), 99);
    const refused = await run(['import', backup, '--force', '--data-dir', dir]);
    expect(refused.error?.message).toMatch(new RegExp(`is in storage format 99, but this version reads format ${LMDB_FORMAT_VERSION}`));
    expect(refused.error?.message).toContain('(backup made by apack 0.3.14)');
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Alpha');
  });

  // Every database the import would put in place, not only the main one: finding it afterwards would leave the
  // rollback to put the user's data back
  it('refuses a backup whose run history this version cannot read, before replacing anything', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup', { databases: ['lmdb', 'runHistory'] });
    expect(fs.existsSync(path.join(backup, 'runHistory'))).toBe(true);
    // Files that aren't a run history at all: an EARS database where the record store should be
    fs.rmSync(path.join(backup, 'runHistory'), { recursive: true });
    fs.cpSync(path.join(backup, 'lmdb'), path.join(backup, 'runHistory'), { recursive: true });

    const refused = await run(['import', backup, '--force', '--data-dir', dir]);

    expect(refused.error?.message).toMatch(/are an EARS database, not a record store/);
    // Nothing was put in place: the import says so for each database it replaces
    expect(refused.err).not.toContain('Imported ');
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Alpha');
  });

  it('brings back the run history the backup holds', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup', { databases: ['lmdb', 'runHistory'] });
    const history = () => openRunHistoryStore(_appDataPaths(dir).runHistory);
    const before = history();
    before.delete('RunNode-1');
    before.close();

    await ok(['import', backup, '--force', '--data-dir', dir]);

    const after = history();
    try { expect(after.get('RunNode-1')).toMatchObject({ status: 'completed' }); } finally { after.close(); }
  });

  it("restores a backup whose metadata claims a format its databases aren't in", async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup');
    const metadataFile = path.join(backup, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
    // The files are what says whether a backup restores: a metadata.json claiming otherwise doesn't cost the
    // user a backup that opens and reads
    fs.writeFileSync(metadataFile, JSON.stringify({ ...metadata, storageFormats: { lmdb: 99 } }));

    await ok(['import', backup, '--force', '--data-dir', dir]);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('From the backup');
  });

  it('restores a backup made before what wrote it was recorded', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the old backup');
    const metadataFile = path.join(backup, 'metadata.json');
    const { appVersion: _appVersion, storageFormats: _storageFormats, ...older } = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
    fs.writeFileSync(metadataFile, JSON.stringify(older));

    const listed = await ok(['import', backup, '--data-dir', dir]);
    expect(listed.out).not.toContain('by apack');
    // The files' own stamp still answers for it
    await ok(['import', backup, '--force', '--data-dir', dir]);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('From the old backup');
  });

  it("keeps the backup's own progress lines off stdout, so only the command's output is there", async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup');
    const { out, err } = await ok(['import', backup, '--force', '--data-dir', dir]);
    expect(err).toContain('Imported lmdb');
    expect(err).toContain('Import completed');
    expect(out).not.toMatch(/Imported lmdb|Restored media|Import completed/);
    expect(out.trim().split('\n').at(-1)).toBe('Imported.');
  });

  it('refuses a backup that is not one or lacks a database, changing nothing', async () => {
    const dir = await appDataDir();
    const notBackup = tempDir('not-backup-');
    expect((await run(['import', notBackup, '--force', '--data-dir', dir])).error?.message).toMatch(/isn't a backup: it has no metadata\.json/);


    const missing = await backupWith('x');
    fs.rmSync(path.join(missing, 'lmdb'), { recursive: true });
    expect((await run(['import', missing, '--force', '--data-dir', dir])).error?.message).toMatch(/lmdb folder is missing/);

    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Alpha');
  });

  it('says when the backup lists a store it holds nothing for, rather than dropping it quietly', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup');
    const metadata = JSON.parse(fs.readFileSync(path.join(backup, 'metadata.json'), 'utf-8'));
    // Listed, but the folder isn't there: empty when the backup was made, or lost since
    fs.writeFileSync(path.join(backup, 'metadata.json'), JSON.stringify({ ...metadata, databases: ['lmdb', 'runHistory'] }));

    const listed = await ok(['import', backup, '--data-dir', dir]);
    expect(listed.out).toContain('lists runHistory but holds nothing for it, so it comes back empty');

    await ok(['import', backup, '--force', '--data-dir', dir]);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('From the backup');
  });

  it('says when the backup holds rows of a type no installed pack declares, and keeps them', async () => {
    const dir = await appDataDir();
    const source = await appDataDir();
    // A pack was installed when the backup was made and declared Bookmark, which the target dir's packs don't
    const packDir = path.join(_appDirOf(source), 'packs', 'bookmarks');
    const manifest = { id: 'bookmarks', name: 'Bookmarks', version: '1.0.0', data: { entities: { Bookmark: {} } } };
    fs.mkdirSync(path.join(packDir, PACK_LAYOUT.typesDir), { recursive: true });
    fs.mkdirSync(path.join(packDir, PACK_LAYOUT.runtimeDir), { recursive: true });
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT,
      declarationRevision: _declarationRevision(manifest), manifest, types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.runtimeEntry), 'throw new Error("Offline discovery must not activate");');
    sealPackBuild(packDir, manifest);
    await write(source, () => {
      untypedCreate('Bookmark', { id: id('Bookmark-1') }).set('url', 'https://example.com');
      untypedCreate('Bookmark', { id: id('Bookmark-2') }).set('url', 'https://example.org');
    });
    const backup = await backupOf(source);

    const dry = await ok(['import', backup, '--data-dir', dir]);
    expect(dry.out).toContain('holds 2 Bookmark that no installed pack declares');

    await ok(['import', backup, '--force', '--data-dir', dir]);
    // Kept, not dropped: installing that pack again brings them back into use
    const kept = await ok(['query', "return getRow('Bookmark-1')?.url", '--data-dir', dir]);
    expect(kept.out).toBe('https://example.com');
  });

  it("refuses a backup from a newer apack, saying how to import it without what this one can't hold", async () => {
    const dir = await appDataDir();
    const backup = await backupWith('From the backup');
    const metadata = JSON.parse(fs.readFileSync(path.join(backup, 'metadata.json'), 'utf-8'));
    fs.writeFileSync(path.join(backup, 'metadata.json'), JSON.stringify({ ...metadata, databases: [...metadata.databases, 'searchIndex'] }));

    const refused = await run(['import', backup, '--force', '--data-dir', dir]);
    expect(refused.error?.message).toBe(
      "The backup also holds searchIndex, which this apack doesn't have: it was made by a newer one, and importing it " +
      'would replace your data with an incomplete copy. Run again with --skip-unknown to import it without those.',
    );
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('Alpha');

    // The dry run says what it would leave out
    expect((await ok(['import', backup, '--skip-unknown', '--data-dir', dir])).out)
      .toContain("leaving out searchIndex, which this apack doesn't have");

    await ok(['import', backup, '--force', '--skip-unknown', '--data-dir', dir]);
    expect((await ok(['query', "return getRow('Note-a')?.title", '--data-dir', dir])).out).toBe('From the backup');
  });

  it('refuses while an app runs on the data dir', async () => {
    const dir = await appDataDir();
    const backup = await backupWith('x');
    holdLock(dir);
    expect((await run(['import', backup, '--force', '--data-dir', dir])).error?.message).toMatch(/quit it first/);
  });
});

describe('apack db', () => {
  it('prints its usage, and each command its own', async () => {
    expect((await ok([])).out).toMatch(/^Usage: apack db <command>/);
    expect((await ok(['reset', '--help'])).out).toMatch(/^Usage: apack db reset \[--force\]/);
    expect((await run(['nope'])).error?.message).toMatch(/^Unknown db command: nope/);
  });
});

// A data dir whose rows outlived the pack that declared their types: the rows are there and nothing accounts for
// the names. This is the measured case — a query naming an entity type answered with the whole database.
describe('a data dir whose packs are gone', () => {
  /** An app's data dir with the pack uninstalled, which is what deleting a pack's directory leaves behind */
  async function withoutItsPack(): Promise<{ dir: string; packDir: string }> {
    const dir = await appDataDir();
    const packDir = path.join(_appDirOf(dir), 'packs', 'default-setup');
    const kept = tempDir('apack-pack-');
    fs.cpSync(packDir, kept, { recursive: true });
    fs.rmSync(packDir, { recursive: true });
    return { dir, packDir: kept };
  }

  it('answers a query that names an undeclared type with that type, not with everything', async () => {
    const { dir } = await withoutItsPack();
    const everything = await ok(['query', 'return query.all().ids().length', '--data-dir', dir]);
    const notes = await ok(['query', 'return query(EARS.Entity.Note).ids().sort()', '--data-dir', dir, '-o', 'json']);

    expect(JSON.parse(notes.out)).toEqual(['Note-a', 'Note-b']);
    // The assertion only means something while the two differ: the bug answered a query for Notes with this
    expect(Number(everything.out)).toBeGreaterThan(2);
  });

  it('says which types nothing declares, and how many rows each has', async () => {
    const { dir } = await withoutItsPack();
    const { err } = await ok(['query', 'return 1', '--data-dir', dir]);

    expect(err).toContain('Note (2)');
    expect(err).toContain('no installed pack declares these entity types, which the data holds anyway');
    expect(err).toContain('name their pack with --schema-from before changing them');
  });

  // An alias is not in the data, only its value, so this is the half observation cannot supply
  it('does not invent a relation kind, whose alias no row holds', async () => {
    const { dir, packDir } = await withoutItsPack();
    // A kind default-setup declares rather than the SDK, so it goes with the pack
    const observed = await ok(['query', "return 'RELATES_TO' in EARS.RelKind", '--data-dir', dir]);
    expect(observed.out).toBe('false');

    const named = await ok(['query', 'return EARS.RelKind.RELATES_TO', '--data-dir', dir, '--schema-from', packDir]);
    expect(named.out).toBe('relates_to');
  });

  it('declares them again when --schema-from names the pack, and stops warning', async () => {
    const { dir, packDir } = await withoutItsPack();
    const { out, err } = await ok(['query', 'return query(EARS.Entity.Note).ids().length', '--data-dir', dir, '--schema-from', packDir]);

    expect(out).toBe('2');
    expect(err).not.toContain('no installed pack declares');
    expect(err).not.toContain('has no packs installed');
  });

  // Declared wins, so a pack's name keeps the value it declared rather than the type it happens to be stored as
  it('lets a declared name keep its declared value', async () => {
    const { dir, packDir } = await withoutItsPack();
    const { out } = await ok(['query', 'return EARS.Entity.Note', '--data-dir', dir, '--schema-from', packDir]);
    expect(out).toBe('Note');
  });
});
