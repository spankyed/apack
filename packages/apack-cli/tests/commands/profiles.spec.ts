// What `apack profiles` tells you, and what it does on the way.
//
// The environment rows come from an injected `resolve`, and the sizes from an injected `bytes`, because both
// questions are about the machine: asserting the real four dirs would make these cases say whatever this
// laptop happens to hold, and the one performance claim — that sizes are what cost, so they are opt-in —
// cannot be checked at all without watching whether the walk happens.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _appDirOf, type AppEnv } from '@apackdev/sdk/env';
import { create, environmentRows, list, pidHolding, remove, stop, trim } from '../../src/commands/profiles';
import { chromiumHolding, chromiumLockHeld, dataDirInUse, listProfiles, openProfile, REGENERABLE_DIRS } from '../../src/app/profiles';
import { publishSession } from '@apackdev/host/dev-session';
import { appLockFile } from '@apackdev/host/database';
import type { CliDirs } from '../../src/app/pack-host';

let tmp: string;
let dirs: CliDirs;

/** Each environment under a temp root, so a case can create and skip them by name */
const resolve = (env: AppEnv): string => path.join(tmp, 'envs', env);
const bytes = vi.fn((_dir: string) => 1_500_000_000);

const printed = (): string => vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-profiles-cmd-'));
  dirs = { cache: path.join(tmp, 'cache'), data: path.join(tmp, 'data') };
  bytes.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the environment rows', () => {
  /**
   * An absent dir is a row, not an omission: that nothing has ever run that channel here is half the answer,
   * and a missing line reads as a bug in the listing.
   */
  it('names every environment, present or not', () => {
    fs.mkdirSync(resolve('production'), { recursive: true });

    const rows = environmentRows(resolve);

    expect(rows.map((row) => row.env)).toEqual(['production', 'beta', 'preview', 'development', 'test']);
    expect(rows.find((row) => row.env === 'production')).toMatchObject({ exists: true });
    expect(rows.find((row) => row.env === 'beta')).toMatchObject({ exists: false, hasAppData: false });
  });

  /**
   * A data dir and a directory Electron left behind are not the same thing, and the difference is the app's
   * own folder inside it. Measured on the author's machine: `development` held 1.5GB of Chromium profile
   * and no app dir, which "exists, version unknown" describes badly.
   */
  it('tells a data dir from an Electron profile, and reads the version only from the former', () => {
    fs.mkdirSync(resolve('development'), { recursive: true });
    const withData = resolve('production');
    fs.mkdirSync(_appDirOf(withData), { recursive: true });
    fs.writeFileSync(path.join(_appDirOf(withData), 'host.json'), JSON.stringify({ version: '0.4.1' }));

    const rows = environmentRows(resolve);

    expect(rows.find((row) => row.env === 'production')).toMatchObject({ hasAppData: true, version: '0.4.1' });
    expect(rows.find((row) => row.env === 'development')).toMatchObject({ exists: true, hasAppData: false });
    // Absent rather than `undefined`: the row carries no version at all for a dir with no app data, and
    // `toMatchObject({ version: undefined })` would demand the key be there
    expect(rows.find((row) => row.env === 'development')).not.toHaveProperty('version');
  });
});

/**
 * **Which data dirs have a live app, on the rows that are not profiles.**
 *
 * The live evidence for this was one `development` row, and launching an app on each of the four is not
 * available: `production` is the user's real data. So the `resolve` seam answers for all four here, each
 * with a real session file and a real port file, and the live run covers the one row a person can safely
 * have an app on.
 *
 * It is the same two fields a profile row reads, so a reader learns one rule — which is why the assertion
 * is on the printed line rather than on the row object: the wording is the thing that scrolled away.
 */
describe('a live app on an environment row', () => {
  /** What makes a dir look occupied: the API's port file, which is what `dataDirInUse` reads. */
  const occupy = (env: AppEnv, startedBy: 'dev' | 'drive', pid = process.pid) => {
    const dir = resolve(env);
    const appDir = _appDirOf(dir);
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'host.json'), JSON.stringify({ version: '0.3.14' }));
    fs.writeFileSync(path.join(appDir, 'api-runtime.json'), JSON.stringify({ pid }));
    publishSession({ host: { kind: 'source', root: process.cwd() }, env: 'development', debugPort: 51873, dataDir: dir, supervisorPid: pid, startedBy });
  };

  it.each(['production', 'beta', 'preview', 'development', 'test'] as const)('says so on the %s row', (env) => {
    occupy(env, 'dev');

    const row = environmentRows(resolve).find((candidate) => candidate.env === env);

    expect(row).toMatchObject({ exists: true, hasAppData: true, inUse: true, version: '0.3.14' });
    expect(row?.session).toMatchObject({ startedBy: 'dev', supervisorPid: process.pid });
  });

  /**
   * The wording is the point: *who* started it decides whether taking the dir back is yours to do, and the
   * pid is what ends it. A row that said only "(running)" is what sent someone looking for a window.
   */
  it('names who started it and the pid that ends it, for either starter', () => {
    occupy('development', 'dev');
    occupy('test', 'drive');

    list(dirs, { sizes: false, all: false, resolve, bytes });

    expect(printed()).toMatch(new RegExp(`development.*running, started by a development session — pid ${process.pid}`));
    expect(printed()).toMatch(new RegExp(`test.*running, started by a question — pid ${process.pid}`));
  });

  /**
   * A dir with an app but no session is attachable by nothing — a packaged build, or a `test` run — and the
   * row still has to say an app is there, since what it guards is `apack db` writing underneath one.
   */
  it('still says running for an app that published no session', () => {
    const dir = resolve('beta');
    const appDir = _appDirOf(dir);
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'host.json'), JSON.stringify({ version: '0.3.14' }));
    fs.writeFileSync(path.join(appDir, 'api-runtime.json'), JSON.stringify({ pid: process.pid }));

    list(dirs, { sizes: false, all: false, resolve, bytes });

    expect(environmentRows(resolve).find((row) => row.env === 'beta')).toMatchObject({ inUse: true, session: undefined });
    expect(printed()).toMatch(/beta.*\(running\)/);
  });

  /** A session whose process has gone is no app at all, which `readSession` already decides. */
  it('is not a row left by a killed run', () => {
    occupy('development', 'drive', 999_999);

    const row = environmentRows(resolve).find((candidate) => candidate.env === 'development');

    expect(row?.session).toBeUndefined();
  });
});

describe('new', () => {
  it('mints a name and says what to do with it', () => {
    create(dirs, undefined);

    const [made] = listProfiles(dirs);
    expect(made).toBeDefined();
    expect(printed()).toContain(made!.name);
    expect(printed()).toContain(`apack pack dev --profile ${made!.name}`);
  });

  /**
   * Refused rather than opened. `openProfile` exists for `run --profile x`, where reusing the dir you
   * named last time is the whole point; here it would hand you someone else's data under the impression you
   * had made something.
   */
  it('refuses a name that is taken, and leaves it alone', () => {
    const existing = openProfile(dirs, 'memo-work');
    fs.writeFileSync(path.join(existing.dir, 'proof'), 'x');

    expect(() => create(dirs, 'memo-work')).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(existing.dir, 'proof'), 'utf-8')).toBe('x');
  });

  it('refuses a name a filesystem would mangle', () => {
    expect(() => create(dirs, '../escape')).toThrow(/profile name/);
  });
});

describe('rm', () => {
  /** What `clean --profiles` did by default, which is the only thing anyone does to an ephemeral one */
  it('--leaked takes the ones a dead run left and nothing else', () => {
    openProfile(dirs, 'keep-me');
    const dead = path.join(dirs.data, 'profiles', '.ephemeral', '999999-gone');
    fs.mkdirSync(dead, { recursive: true });
    fs.writeFileSync(path.join(dead, '.apack-profile.json'), JSON.stringify({ created: '', pid: 999999 }));

    remove(dirs, [], true);

    expect(listProfiles(dirs).map((profile) => profile.name)).toEqual(['keep-me']);
  });

  it('says so when a name is not there, rather than removing nothing quietly', () => {
    expect(() => remove(dirs, ['absent'], false)).toThrow(/No profile named "absent"/);
  });

  it('removes a named one and reports what it reclaimed', () => {
    openProfile(dirs, 'memo-work');

    remove(dirs, ['memo-work'], false);

    expect(listProfiles(dirs)).toEqual([]);
    expect(printed()).toContain('reclaimed');
  });
});

describe('the listing', () => {
  it('puts the environments first and the profiles after', () => {
    openProfile(dirs, 'memo-work');

    list(dirs, { sizes: false, all: false, resolve, bytes });

    const output = printed();
    expect(output.indexOf('ENVIRONMENT')).toBeLessThan(output.indexOf('PROFILE'));
    expect(output).toContain('memo-work');
  });

  /**
   * The reason sizes are a flag: `dirBytes` over the real dirs measured 674ms for 1.4GB and 1255ms for
   * 1.5GB, so a default listing would spend about two seconds walking Chromium profiles to answer a
   * question about names and paths. This is the case that keeps that true.
   */
  it('walks nothing unless asked for sizes', () => {
    fs.mkdirSync(resolve('production'), { recursive: true });
    openProfile(dirs, 'memo-work');

    list(dirs, { sizes: false, all: false, resolve, bytes });
    expect(bytes, 'the default listing measured something').not.toHaveBeenCalled();
    expect(printed()).not.toContain('SIZE');

    list(dirs, { sizes: true, all: false, resolve, bytes });
    expect(bytes).toHaveBeenCalled();
    expect(printed()).toContain('1.5GB');
  });

  // Ephemeral profiles are the run's business, not a reader's: they are noise in a listing whose subject is
  // what persists, and `rm --leaked` is the only thing anyone does to them from outside
  it('leaves the ephemeral ones out until asked', () => {
    const ephemeralDir = path.join(dirs.data, 'profiles', '.ephemeral', '4242-throwaway');
    fs.mkdirSync(ephemeralDir, { recursive: true });
    fs.writeFileSync(path.join(ephemeralDir, '.apack-profile.json'), JSON.stringify({ created: '', pid: 4242 }));

    list(dirs, { sizes: false, all: false, resolve, bytes });
    // The full name: the command's own hint says "the throwaway ones", and the first version of this case
    // matched that instead of the profile
    expect(printed()).not.toContain('4242-throwaway');

    vi.mocked(console.log).mockClear();
    list(dirs, { sizes: false, all: true, resolve, bytes });
    expect(printed()).toContain('4242-throwaway');
  });
});

/**
 * **`trim` is the answer to "where did 1.6GB go", and the list is the whole of its correctness.**
 *
 * Measured 2026-10-10 on the author's development dir: `Cache` 1.0GB and `Code Cache` 312MB against 5MB in
 * `apack/`. So what matters is not that it frees bytes but that it frees *only* the ones Chromium will
 * make again — every excluded directory below is something a user would notice losing.
 */
describe('trim', () => {
  /** A data dir with a cache, the user's data, and the two state dirs that are not cache. */
  const dataDir = (env: AppEnv, cacheBytes = 3) => {
    const dir = resolve(env);
    for (const name of REGENERABLE_DIRS) {
      fs.mkdirSync(path.join(dir, name), { recursive: true });
      fs.writeFileSync(path.join(dir, name, 'blob'), 'x'.repeat(cacheBytes));
    }
    fs.mkdirSync(_appDirOf(dir), { recursive: true });
    fs.writeFileSync(path.join(_appDirOf(dir), 'ears-db'), 'the user\'s notes');
    for (const keep of ['Local Storage', 'Partitions', 'Preferences']) {
      fs.mkdirSync(path.join(dir, keep), { recursive: true });
      fs.writeFileSync(path.join(dir, keep, 'state'), 'keep me');
    }
    return dir;
  };

  it('removes every cache it names and nothing else', () => {
    const dir = dataDir('development');

    trim(dirs, ['development'], { resolve, bytes: () => 1024 });

    for (const name of REGENERABLE_DIRS) expect(fs.existsSync(path.join(dir, name)), name).toBe(false);
    // The three a user would notice, and the data itself
    expect(fs.readFileSync(path.join(_appDirOf(dir), 'ears-db'), 'utf-8')).toBe("the user's notes");
    for (const keep of ['Local Storage', 'Partitions', 'Preferences']) {
      expect(fs.existsSync(path.join(dir, keep, 'state')), keep).toBe(true);
    }
  });

  /**
   * The firing case for the refusal: those files are open under a live browser, so the sweep would be
   * deleting beneath it and what it freed would partly come back.
   */
  it('skips a dir an app is running on, and says so', () => {
    const dir = dataDir('development');
    fs.writeFileSync(path.join(_appDirOf(dir), 'api-runtime.json'), JSON.stringify({ pid: process.pid }));

    trim(dirs, ['development'], { resolve, bytes: () => 1024 });

    expect(printed()).toMatch(/development.*an app is running on it/);
    expect(fs.existsSync(path.join(dir, 'Cache'))).toBe(true);
  });

  it('takes every dir there is when nothing is named', () => {
    dataDir('development');
    dataDir('beta');
    const probe = openProfile(dirs, 'probe');
    fs.mkdirSync(path.join(probe.dir, 'Cache'), { recursive: true });

    trim(dirs, [], { resolve, bytes: () => 1024 });

    expect(fs.existsSync(path.join(resolve('development'), 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(resolve('beta'), 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(probe.dir, 'Cache'))).toBe(false);
    // A build nobody has run has no dir, which is an answer rather than an error
    expect(printed()).toMatch(/production.*no data dir yet/);
  });

  /**
   * One lookup for builds and profiles, which only works because a profile may not be named after a build.
   * A name that is neither lists what there is rather than resolving to a path nobody typed.
   */
  it('takes a profile by name, and refuses a name that is neither', () => {
    const probe = openProfile(dirs, 'probe');
    fs.mkdirSync(path.join(probe.dir, 'Code Cache'), { recursive: true });

    trim(dirs, ['probe'], { resolve, bytes: () => 1024 });
    expect(fs.existsSync(path.join(probe.dir, 'Code Cache'))).toBe(false);

    expect(() => trim(dirs, ['nope'], { resolve, bytes: () => 1024 }))
      .toThrow(/not a built-in or custom profile.*production.*probe/s);
  });

  it('totals what it freed', () => {
    dataDir('development', 1024);

    trim(dirs, ['development'], { resolve, bytes: () => 2048 });

    // Seven caches at the stubbed size
    expect(printed()).toMatch(/reclaimed 14kB/);
  });
});

/**
 * **`stop` exists because the listing already names the pid.** A command that tells you which process to
 * signal and leaves you to `kill` it has stopped one step short, and the step it leaves out is where a
 * mistyped pid reaches something else.
 *
 * What these cases hold is the pid's **source**, not the signalling: a record names it or nothing does.
 * The process this spec signals is itself — `process.pid` with a signal it survives — so the subject is
 * which record was read, which is the half that could be wrong.
 */
describe('stop', () => {
  const occupy = (env: AppEnv, { session, lock }: { session?: number; lock?: number }) => {
    const dir = resolve(env);
    fs.mkdirSync(_appDirOf(dir), { recursive: true });
    if (session !== undefined) publishSession({ host: { kind: 'source', root: process.cwd() }, env: 'development', debugPort: 1, dataDir: dir, supervisorPid: session, startedBy: 'dev' });
    // Through `appLockFile` rather than a join: it is under the app dir, and a spec that joined its own
    // path would be the second opinion `dataDirInUse`'s header records the cost of
    if (lock !== undefined) fs.writeFileSync(appLockFile(dir), JSON.stringify({ pid: lock, machine: os.hostname() }));
    return dir;
  };

  /**
   * The session's pid wins, and the reason is in `@apackdev/host/dev-session`: it names the *holder*, whose
   * teardown closes the app and cleans up after it, where the lock names the Electron alone. Ending the app
   * would free the dir and leave a watcher and a dev server running with nothing to serve.
   *
   * **Two live pids, because both records have to be readable for the preference to mean anything** — a
   * record naming a dead process is read as absent by design, so a dead pid in either slot would make this
   * pass for the wrong reason. `process.kill` is deliberately **not** mocked: `lockIsHeld` signals 0 through
   * it to ask whether a process exists, so a mock makes every pid look alive and the waiter spin for 20s.
   */
  it('takes the session holder rather than the app, when a session names one', () => {
    const dir = occupy('development', { session: process.pid, lock: process.ppid });

    expect(pidHolding(dir)).toBe(process.pid);
  });

  it('falls back to the app lock for an app that published no session', () => {
    const dir = occupy('beta', { lock: process.ppid });

    expect(pidHolding(dir)).toBe(process.ppid);
  });

  it('takes nothing from a record naming a process that has gone', () => {
    expect(pidHolding(occupy('test', { lock: 999_999 }))).toBeUndefined();
  });

  /**
   * Nothing to stop is said rather than shown as silence: "it was already closed" and "I misspelled it"
   * read the same from an empty answer, and only one of them is fine.
   */
  it('says so when nothing is running, naming what it looked at', async () => {
    await stop(dirs, ['development'], false, { resolve });

    expect(printed()).toMatch(/no app is running on development/);
  });

  it('reports a dir whose record names a dead process as having no app', async () => {
    occupy('development', { lock: 999_999 });

    await stop(dirs, ['development'], false, { resolve });

    expect(printed()).toMatch(/no app is running/);
  });

  /**
   * A dir held by another machine's Chromium is the one case where something is running and this is not the
   * machine that can end it, so "no app is running" would be false. It is reported whether or not anything
   * else was closed — a run that signalled one dir and could not reach another has given a partial answer,
   * and one naming only the half it managed reads as a whole one.
   *
   */
  it('reports a dir held by another machine rather than calling it free', async () => {
    const dir = resolve('development');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(`some-other-machine-${process.pid}`, path.join(dir, 'SingletonLock'));

    await stop(dirs, ['development'], false, { resolve });

    expect(printed()).toMatch(/held by an app on another machine/);
    expect(printed(), 'and not the opposite').not.toMatch(/no app is running/);
  });

  /**
   * The mixed case, which is the one a partial answer hides: one dir closed and one unreachable.
   *
   * It signals **a child of its own** rather than a pid to hand, because the only others here are this
   * process's and its parent's — `write-lock.spec.ts` spawns one for the same reason. The child dies on
   * the SIGTERM `endAppHolding` sends, which is also what lets that call's wait return rather than spend
   * its 20s.
   */
  it('closes what it can and still names what it cannot', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      occupy('development', { lock: child.pid });
      const foreign = resolve('beta');
      fs.mkdirSync(foreign, { recursive: true });
      fs.symlinkSync(`some-other-machine-${process.pid}`, path.join(foreign, 'SingletonLock'));

      await stop(dirs, ['development', 'beta'], false, { resolve });

      expect(printed()).toMatch(/closing the app on development/);
      expect(printed(), 'the half it could not reach is named too')
        .toMatch(/held by an app on another machine/);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('refuses a name that is not a built-in or custom profile', async () => {
    await expect(stop(dirs, ['nope'], false, { resolve })).rejects.toThrow(/not a built-in or custom profile/);
  });
});

/**
 * **An app the records lost is still an app**, and the API's port file is not enough to find one.
 *
 * Observed 2026-10-10: a development app alive with its port file, app lock and session all gone, so every
 * verb here reported no app — `trim` would have swept the caches under a running browser and `stop` had
 * nothing to signal. Chromium's own `SingletonLock` is a second signal, and only ever an addition: it is
 * another product's private format, POSIX-only, and fails open, which is why `findRunningApp` refuses it
 * for the database question where a wrong "no app" lets a tool write under a running one.
 */
describe('a browser holding a data dir', () => {
  const singletonLock = (dir: string, target: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(target, path.join(dir, 'SingletonLock'));
  };

  it('is found from the lock Chromium writes, when nothing else says so', () => {
    const dir = resolve('development');
    singletonLock(dir, `${os.hostname()}-${process.pid}`);

    expect(chromiumHolding(dir)).toBe(process.pid);
    expect(dataDirInUse(dir), 'and the dir reads as in use with no port file at all').toBe(true);
  });

  /** A lock whose process has gone is a crash's leftover, not an app. */
  it('is not a lock left by a process that has gone', () => {
    const dir = resolve('development');
    singletonLock(dir, `${os.hostname()}-999999`);

    expect(chromiumHolding(dir)).toBeUndefined();
    expect(dataDirInUse(dir)).toBe(false);
  });

  /**
   * **A lock another machine wrote names no pid here, and the dir is still held.**
   *
   * The two directions of the same fact, and they are what the pid is read for: `chromiumHolding` feeds
   * `endAppHolding`, which signals, so a foreign pid there would end whatever local process holds that
   * number — pids are small integers and collide. `chromiumLockHeld` feeds `trim`, which deletes, so a
   * dir on a synced volume with a live app on the machine that locked it must read as in use.
   *
   * It also covers the parse: a hostname may hold dashes, so the pid is what follows the *last* one.
   */
  it('names no pid for another machine, and still counts as held', () => {
    const dir = resolve('beta');
    singletonLock(dir, `my-laptop-at-home-${process.pid}`);

    expect(chromiumHolding(dir), 'nothing here to signal').toBeUndefined();
    expect(chromiumLockHeld(dir), 'but something has it open').toBe(true);
    expect(dataDirInUse(dir), 'so trim must refuse it').toBe(true);
  });

  /** And this machine's own lock does name its pid, which is the half that must keep working. */
  it('names the pid for a lock this machine wrote, dashes and all', () => {
    const dir = resolve('production');
    singletonLock(dir, `${os.hostname()}-${process.pid}`);

    expect(chromiumHolding(dir)).toBe(process.pid);
    expect(chromiumLockHeld(dir)).toBe(true);
  });

  /** A link with no dash at all is not this format, and reading the whole string as a pid is not a pid. */
  it('is nothing for a link that is not <host>-<pid>', () => {
    const dir = resolve('test');
    singletonLock(dir, 'something-else-entirely');

    expect(chromiumHolding(dir)).toBeUndefined();
    expect(chromiumLockHeld(dir)).toBe(false);
  });

  it('is nothing at all for a dir with no lock, and never throws', () => {
    expect(chromiumHolding(resolve('test'))).toBeUndefined();
    expect(dataDirInUse(resolve('test'))).toBe(false);
  });

  /** The firing case for the refusal this exists to strengthen. */
  it('stops trim sweeping the caches under it', () => {
    const dir = resolve('development');
    fs.mkdirSync(path.join(dir, 'Cache'), { recursive: true });
    singletonLock(dir, `${os.hostname()}-${process.pid}`);

    trim(dirs, ["development"], { resolve, bytes: () => 1024 });

    expect(fs.existsSync(path.join(dir, 'Cache'))).toBe(true);
    expect(printed()).toMatch(/development.*an app is running on it/);
  });
});

it('emits one JSON profile listing and measures bytes only on request', () => {
  openProfile(dirs, 'sample');
  list(dirs, { sizes: false, all: false, json: true, resolve, bytes });
  const result = JSON.parse(vi.mocked(console.log).mock.calls[0]![0]);
  expect(result.profiles).toMatchObject([{ name: 'sample', inUse: false }]);
  expect(result.profiles[0]).not.toHaveProperty('bytes');
  expect(bytes).not.toHaveBeenCalled();
  vi.mocked(console.log).mockClear();
  list(dirs, { sizes: true, all: false, json: true, resolve, bytes });
  expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0]).profiles[0].bytes).toBe(1_500_000_000);
});
