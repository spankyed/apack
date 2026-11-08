/**
 * Answering a question from the app something else is holding: read its session, attach, ask, let go.
 *
 * **`@apackdev/testing` is resolved at runtime, never imported.** It is a devDependency of this package, so a
 * static import would make `bundle-package.ts` refuse the bundle outright, and a real dependency would put
 * the whole Playwright harness in every install of someone who only runs `apack pack build`. The CLI already
 * reaches it this way for the Playwright binary (`resolvePlaywrightCli`), from the pack's own
 * `node_modules` — so a pack drives with the harness it tests with, rather than one this CLI carried.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { AttachedSession, AttachedSessionOptions } from '@apackdev/testing';
import { readSession, touchSession, waitForSession, STARTED_BY_ENV, type DevSession } from '@apackdev/host/dev-session';
import { processWork, type WorkReading } from '@apackdev/sdk/progress';
import { holdExclusiveLock, readLock, type ExclusiveLock } from '@apackdev/host/exclusive-lock';
import { dataDirInUse } from './profiles';
import { sourceTarget } from './pack-host';

/** Just the part of `@apackdev/testing` this needs, so a wrong resolve fails on the name rather than later. */
interface TestingModule {
  attachedSession: (options: AttachedSessionOptions) => Promise<AttachedSession>;
}

/**
 * The pack's own `@apackdev/testing`, as a module.
 *
 * The install hint rather than a module-not-found from inside a bundle: a pack that has never run
 * `init-tests` has no harness, and the fix is one command.
 */
async function testingModule(from: string): Promise<TestingModule> {
  const require = createRequire(path.join(from, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve('@apackdev/testing');
  } catch {
    throw new Error('@apackdev/testing is not installed here. Run: npm i -D @apackdev/testing @playwright/test');
  }
  const loaded = await import(pathToFileURL(entry).href) as Partial<TestingModule>;
  if (typeof loaded.attachedSession !== 'function') {
    throw new Error(
      `The @apackdev/testing at ${entry} has no \`attachedSession\`, so it is older than this CLI. Update it: npm i -D @apackdev/testing@latest`,
    );
  }
  return loaded as TestingModule;
}

export interface AttachableApp {
  readonly session: DevSession;
  /** Where this app's output went, for the verbs that read it */
  readonly logPath?: string;
}

/**
 * The attachable app on a data dir, or nothing.
 *
 * Nothing is the ordinary answer rather than a failure: no app is running, or the one running was not
 * started by something that meant it to be driven. `readSession` already treats a record whose supervisor
 * has gone as absent, so a session file a killed run left behind reads as no app at all.
 */
export function attachableApp(dataDir: string, expectedRoot?: string): AttachableApp | undefined {
  const session = readSession(dataDir);
  if (session === undefined) return undefined;
  verifySessionHost(session, expectedRoot);
  return { session, logPath: session.logPath };
}

/** A session can be located by profile, but only its recorded checkout establishes ownership. */
export function verifySessionHost(session: DevSession, expectedRoot?: string): void {
  const actualRoot = fs.realpathSync(session.host.root);
  if (expectedRoot && actualRoot !== fs.realpathSync(expectedRoot)) {
    throw new Error(`The profile is held by another checkout (${session.host.root}); requested ${expectedRoot}. Stop it or choose another profile.`);
  }
}

/**
 * Starts an app or pack session explicitly and waits for it to be attachable.
 *
 * **`dev` itself, and detached, are both load-bearing.** The fixture sets `PLAYWRIGHT_TEST`, which makes the
 * app resolve the `test` environment and so refuse the debug port — and the fixture is also the only thing
 * that installs the pack under test, which `dev` does too. So a launcher shaped *like* `dev` would pass every
 * check about the port and still hand a pack author an app without their pack. Detached because `dev` never
 * returns: it is a supervisor holding the app for as long as its terminal lives, and a one-shot has to answer
 * and exit while the app stays up.
 *
 * **Its output goes to a file, not to `/dev/null`.** A build that fails would otherwise reach the caller as
 * "no session appeared" with no cause, and the timeout message names this path.
 */
export async function spawnDevApp(
  from: string, dataDir: string, profileArgs: readonly string[], scope: 'app' | 'pack' = 'app',
): Promise<AttachableApp> {
  const checkout = scope === 'app' ? sourceTarget(from, 'source checkout').root : undefined;
  const command = checkout
    ? ['--conditions=@apackdev/source', path.join(checkout, 'scripts/app-dev.mjs'), 'open']
    : [cliBin(), 'pack', 'dev'];
  const logPath = path.join(dataDir, 'dev-spawn.log');
  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [...command, ...profileArgs], {
    cwd: from,
    detached: true,
    stdio: ['ignore', log, log],
    // The one thing `dev` cannot work out for itself: it writes the session file and cannot know who asked
    env: { ...process.env, [STARTED_BY_ENV]: 'drive' },
  });
  fs.closeSync(log);
  child.unref();
  let exited = false;
  child.once('exit', () => { exited = true; });
  try {
    // For as long as the launcher works: a cold start builds the pack before the app publishes anything. One with
    // no pid cannot be read, so its wait is bounded by silence alone, as every unreadable party's is
    const work: WorkReading = child.pid === undefined ? () => Promise.resolve(undefined) : processWork(child.pid);
    const session = await waitForSession(dataDir, { work, isAlive: () => !exited });
    return { session, logPath: session.logPath ?? logPath };
  } catch (error) {
    const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').trimEnd().split('\n').slice(-6).join('\n') : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${tail ? `\n${tail}` : ''}`);
  }
}

const spawnLockFile = (dataDir: string): string => path.join(dataDir, 'spawn.lock');

/**
 * The work of whoever holds the spawn lock: the caller that is starting the app a loser is waiting for. A lock
 * that names nobody readable gives no reading, so the wait is bounded by its silence alone.
 */
const spawnHolderWork = (dataDir: string): WorkReading => {
  const holder = readLock(spawnLockFile(dataDir))?.pid;
  return holder === undefined ? () => Promise.resolve(undefined) : processWork(holder);
};

/** A loser's wait: for the winner's session, for as long as the winner is working to publish it */
const waitForWinner = (dataDir: string): Promise<DevSession> => waitForSession(dataDir, { work: spawnHolderWork(dataDir) });

/** Thrown by the lock's own refusal and caught here; nothing outside sees it. */
const HELD = new Error('another spawn holds this data dir');

/**
 * **One app per data dir, however many questions arrive at once.**
 *
 * Two concurrent `--spawn`s both see no session and both spawn `dev`. The second `dev`'s Electron is
 * refused by the single-instance lock — which is scoped to the data dir — and exits, but by then its own
 * `waitForApi` can have seen the *first* app's port file appear and published a session carrying its own
 * pid and the other app's port. A later reclaim then signals a supervisor holding nothing while the real
 * app survives with its session deleted. The mtime bound on the debug port cannot separate two launches
 * that started together; only a lock can, which is why the plan asked for one here.
 *
 * So the spawn is serialised per data dir, and **the session is re-read after acquiring**: by the time the
 * loser has the lock the winner has usually published one, and attaching to it is what the caller wanted.
 * A loser that arrives before the winner has published waits for it (`waitForWinner`, for as long as the
 * winner works) rather than queueing to spawn a second app.
 *
 * The loser answers `attached`, because it is: it did not start what it is talking to.
 */
export async function spawnOrAttach(
  from: string, dataDir: string, profileArgs: readonly string[],
  // Seams, because which of the two branches a loser took is the claim and nothing else observes it
  { spawn, waitFor = waitForWinner, scope = 'app', expectedRoot, reuse = true }: {
    spawn?: (from: string, dataDir: string, profileArgs: readonly string[]) => Promise<AttachableApp>;
    waitFor?: (dataDir: string) => Promise<DevSession>;
    scope?: 'app' | 'pack';
    expectedRoot?: string;
    /** Cleanup/copy flags require a new session, including when another caller wins the spawn race. */
    reuse?: boolean;
  } = {},
): Promise<{ app: AttachableApp; state: 'spawned' | 'attached' }> {
  let lock: ExclusiveLock;
  try {
    lock = holdExclusiveLock({ file: spawnLockFile(dataDir), what: 'development session spawn', refuse: () => HELD });
  } catch (error) {
    if (error !== HELD) throw error;
    if (!reuse) throw new Error('--rm and --with-secrets require a new session; another caller is already starting one here.');
    // Another question is already starting an app here. What this one wants is an app, not a spawn
    const session = await waitFor(dataDir);
    verifySessionHost(session, expectedRoot);
    return { app: { session, logPath: session.logPath }, state: 'attached' };
  }
  try {
    const live = attachableApp(dataDir, expectedRoot);
    if (live) {
      if (!reuse) throw new Error('--rm and --with-secrets require a new session; this app is already running. Attach without those flags.');
      return { app: live, state: 'attached' };
    }
    if (dataDirInUse(dataDir)) throw new Error('An app occupies this profile without a verifiable development session. Close it before spawning.');
    const app = spawn ? await spawn(from, dataDir, profileArgs) : await spawnDevApp(from, dataDir, profileArgs, scope);
    verifySessionHost(app.session, expectedRoot);
    return { app, state: 'spawned' };
  } finally {
    lock.release();
  }
}

/** This CLI's own entry, so the spawned `dev` is this version rather than whatever is on PATH. */
function cliBin(): string {
  return fileURLToPath(new URL('../../bin/apack.mjs', import.meta.url));
}

export interface AttachAnswer {
  readonly value: unknown;
  readonly startedBy: DevSession['startedBy'];
  readonly supervisorPid: number;
}

/**
 * Attaches, asks one thing, and lets go.
 *
 * `detach` runs whatever the ask did, which is what makes this safe to use against a developer's app: the
 * connection is this command's, the app is not, and the only thing ending here is the connection.
 *
 * **It says it was here, twice.** A supervisor minding a drive-profile app closes it when nothing has
 * attached for a while (`reapsWhenIdle`, `commands/dev.ts`), and `touchSession` is the whole of what tells
 * it otherwise. Once on attaching, so a question that then fails still counts as someone being here; once
 * on the way out, so a verb that waits a minute for a state does not expire underneath itself.
 */
export async function askAttached<T>(
  app: AttachableApp,
  from: string,
  screenshotDir: string,
  ask: (session: AttachedSession['session']) => Promise<T>,
): Promise<AttachAnswer> {
  const { attachedSession } = await testingModule(from);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const attached = await attachedSession({
    debugPort: app.session.debugPort,
    screenshotDir,
    ...(app.logPath !== undefined ? { logPath: app.logPath } : {}),
  });
  touchSession(app.session.dataDir);
  try {
    return {
      value: await ask(attached.session),
      startedBy: app.session.startedBy,
      supervisorPid: app.session.supervisorPid,
    };
  } finally {
    touchSession(app.session.dataDir);
    await attached.detach();
  }
}
