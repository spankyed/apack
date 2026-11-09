import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  debugPortArgsFor, lastAttachedAt, publishSession, readDevToolsPort, readSession, sessionFile,
  startedByFromEnv,
  touchSession,
  STARTED_BY_ENV, type DevSession,
} from '../src/dev-session.ts';

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-session-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const session = (over: Partial<DevSession> = {}): DevSession => ({
  host: { kind: 'source', root: dataDir },
  env: 'development',
  debugPort: 51873,
  apiPort: 3001,
  logPath: path.join(dataDir, 'dev.log'),
  dataDir,
  supervisorPid: process.pid,
  startedBy: 'dev',
  ...over,
});

describe('publishing a session', () => {
  it('is read back whole', () => {
    publishSession(session());
    expect(readSession(dataDir)).toEqual(session());
  });

  /**
   * The port is unauthenticated control of the renderer, and the renderer holds the app's API token. So the
   * file is discoverable by the user and by nothing else — the posture the app's own `api-token` file has.
   */
  it('is readable only by its owner', () => {
    publishSession(session());
    expect(fs.statSync(sessionFile(dataDir)).mode & 0o777).toBe(0o600);
  });

  it('is removed by what publishing returns', () => {
    const unpublish = publishSession(session());
    unpublish();
    expect(fs.existsSync(sessionFile(dataDir))).toBe(false);
    // Twice, since a supervisor may tear down after something already removed it
    expect(() => unpublish()).not.toThrow();
  });
});

describe('reading a session', () => {
  it('is nothing at all when none was published', () => {
    expect(readSession(dataDir)).toBeUndefined();
  });

  /**
   * A session file outlives the process that wrote it whenever one is killed, so a record naming a dead
   * supervisor is a **miss** rather than an error: there is no app to attach to, and the next launcher is
   * free to take the dir. `recordIsStale` errs toward stale on purpose — it never misses a live holder,
   * because inventing a dead one is what would take a running app's data.
   */
  it('is nothing when the supervisor that wrote it has gone', () => {
    // A pid no process has. 2^22 is above every platform's default pid_max, so this cannot collide with a
    // process started between writing and reading
    publishSession(session({ supervisorPid: 4_194_303 }));
    expect(readSession(dataDir)).toBeUndefined();
  });

  it.each([0, -1, 1.5])('ignores unsafe supervisor pid %s before any liveness check', supervisorPid => {
    publishSession(session({ supervisorPid }));
    expect(readSession(dataDir)).toBeUndefined();
  });

  it.each([0, -1, 65_536, 1.5])('ignores invalid debug port %s', debugPort => {
    publishSession(session({ debugPort }));
    expect(readSession(dataDir)).toBeUndefined();
  });

  it.each([
    ['not JSON at all', 'what?'],
    ['JSON that is not an object', '"a string"'],
    ['null', 'null'],
    ['missing the debug port', JSON.stringify({ dataDir: '/x', supervisorPid: 1, startedBy: 'dev' })],
    ['missing the supervisor', JSON.stringify({ debugPort: 1, dataDir: '/x', startedBy: 'dev' })],
    ['a starter nothing declares', JSON.stringify({ debugPort: 1, dataDir: '/x', supervisorPid: 1, startedBy: 'someone' })],
  ])('is nothing for %s, rather than throwing', (_what, contents) => {
    fs.writeFileSync(sessionFile(dataDir), contents);
    // Nothing downstream can use half a record, and a throw would make every caller handle a case that
    // only ever means "there is no session"
    expect(readSession(dataDir)).toBeUndefined();
  });
});

/**
 * `dev` writes the file and cannot know who asked for it. Getting this wrong is the silent kind: `dev`
 * records `dev`, so nothing is ever reclaimable, and the developer's own `npm run dev` refuses with a message
 * blaming them — which is why the value is passed in rather than inferred.
 */
describe('who a launcher says started it', () => {
  it('is what it was told', () => {
    expect(startedByFromEnv({ [STARTED_BY_ENV]: 'drive' })).toBe('drive');
    expect(startedByFromEnv({ [STARTED_BY_ENV]: 'dev' })).toBe('dev');
  });

  it('is dev for a command nobody told', () => {
    expect(startedByFromEnv({})).toBe('dev');
  });

  // A person running `dev` is the case this must not get wrong, so an unrecognised value is not trusted
  // through: it reads as the person, which is the answer that refuses rather than the one that reclaims
  it('is dev for a value nothing declares', () => {
    expect(startedByFromEnv({ [STARTED_BY_ENV]: 'whatever' })).toBe('dev');
  });
});

/**
 * **The mtime is the record of when something last attached**, which is what a supervisor minding an
 * unattended app reads to decide it has idled out (`reapsWhenIdle`, `apack-cli/src/commands/dev.ts`).
 */
describe('saying a driver was here', () => {
  it('starts at the moment the session was published', () => {
    const before = Date.now();
    publishSession(session());
    const published = lastAttachedAt(dataDir);
    // An app nobody has asked anything has been idle since it came up, which is the honest start
    expect(published).toBeGreaterThanOrEqual(before - 1_000);
    expect(published).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('moves the mtime forward', () => {
    publishSession(session());
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(sessionFile(dataDir), past, past);
    expect(lastAttachedAt(dataDir)).toBeLessThan(Date.now() - 30_000);

    touchSession(dataDir);
    expect(lastAttachedAt(dataDir)).toBeGreaterThan(Date.now() - 5_000);
  });

  /**
   * It must not rewrite the file, and this is the case that says so: everything a driver reads to attach is
   * still there afterwards. A rewrite is an atomic rename — a new inode, and a race with the supervisor's
   * own unpublish — to carry what the mtime already carries.
   */
  it('leaves the record itself alone', () => {
    publishSession(session());
    touchSession(dataDir);
    expect(readSession(dataDir)).toEqual(session());
  });

  it('is nothing to say when there is no session, and no error either', () => {
    expect(() => touchSession(dataDir)).not.toThrow();
    expect(lastAttachedAt(dataDir)).toBeUndefined();
  });
});

/**
 * **The debug port has to be *this* launch's, and the file does not say so by itself.**
 *
 * Found by running `npm run dev`: Chromium's `DevToolsActivePort` outlived the browser that wrote it, so a
 * data dir that has ever held a development app has a port on disk for one that is gone. Reading whatever
 * was there published a session naming a port nothing answered, and `drive` then refused an app that was
 * running perfectly well — a failure that reads as a bug in the attach rather than in the publish.
 */
describe('the debug port for a launch', () => {
  const portFile = () => path.join(dataDir, 'DevToolsActivePort');
  const writePort = (port: number, ageMs = 0) => {
    fs.writeFileSync(portFile(), `${port}\n/devtools/browser/abc\n`);
    if (ageMs > 0) {
      const when = new Date(Date.now() - ageMs);
      fs.utimesSync(portFile(), when, when);
    }
  };

  /** A launcher whose tree does no work: the reading a stalled app gives, so a wait ends on its stall window */
  const idle = () => Promise.resolve(0);

  it('is the one written since the launch', async () => {
    writePort(51873);
    expect(await readDevToolsPort(dataDir, { after: Date.now() - 1_000, work: idle, idleMs: 500 })).toBe(51873);
  });

  /** The firing case: a file from a previous run of the same data dir is not an answer. */
  it('is not one a previous run left behind', async () => {
    writePort(58009, 10 * 60_000);
    await expect(readDevToolsPort(dataDir, { after: Date.now(), work: idle, idleMs: 300 }))
      .rejects.toThrow(/No debug port appeared/);
  });

  it('waits for one that is not there yet, rather than giving up', async () => {
    setTimeout(() => writePort(44444), 120);
    expect(await readDevToolsPort(dataDir, { after: Date.now(), work: idle, idleMs: 3_000 })).toBe(44444);
  });

  /** A first line still being written reads as NaN, which is "not yet" and not a failure. */
  it('does not read a half-written file as a port', async () => {
    fs.writeFileSync(portFile(), '');
    setTimeout(() => writePort(45455), 120);
    expect(await readDevToolsPort(dataDir, { after: Date.now() - 1_000, work: idle, idleMs: 3_000 })).toBe(45455);
  });
});

/**
 * **The one gate between this design and an open port on a user's app.**
 *
 * `--remote-debugging-port` is unauthenticated control of the renderer, which holds the app's API token, so
 * its subject is input and it needs cases that fire: `development` is the only answer that gets a port.
 *
 * It lives here because **two** launchers need it, which is the whole reason it is a function. `apack pack dev`
 * had this decision with six cases guarding it; the `npm run dev` watcher pushed the flag unconditionally,
 * behind a `NODE_ENV !== 'development'` check — the *bundle's* mode, which says nothing about the
 * environment the spawned app resolves. A source run takes that from `APACK_ENV`, so
 * `APACK_ENV=beta npm run dev` opened a port on a beta app. Both callers go through this now.
 */
describe('the debug port a launcher passes', () => {
  it('is given to a development app', () => {
    expect(debugPortArgsFor('development')).toEqual(['--remote-debugging-port=0']);
  });

  it.each(['production', 'beta', 'test'] as const)('is refused to a %s app', (build) => {
    expect(debugPortArgsFor(build)).toEqual([]);
  });

  /**
   * `0`, never a number. Chromium picks a free port and writes it where the launcher reads it; a fixed one
   * collides with whatever holds it and with a second app, and a port named here would be one somebody
   * could arrange to be listening on first.
   */
  it('asks Chromium to choose, rather than naming one', () => {
    expect(debugPortArgsFor('development')).toEqual([expect.stringMatching(/=0$/)]);
  });
});
