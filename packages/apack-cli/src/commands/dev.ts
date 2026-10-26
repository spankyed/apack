import { readSettingsOverrides } from '@apackdev/host/database';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createPackBuilder } from '../build/build-process.ts';
import { findPackRoot, readManifest } from '../utils';
import {
  debugPortArgsFor, lastAttachedAt, publishSession, readDevToolsPort, readSession, startedByFromEnv,
  type DevSession,
} from '@apackdev/host/dev-session';
import { installPackInApp, type AppPlace, type DevDelivery } from '../build/dev-reload.ts';
import { startPackBuildWatcher } from '../build/watch.ts';
import { cliDirs, parseHostFlags, resolvePackHost, resolveRepositoryHost, packagedHostChannel, hostLabel, setHostHandoff, type PackHost } from '../app/pack-host';
import { endAppHolding, profileFor, parseProfileFlags, removeProfile, PROFILE_USAGE } from '../app/profiles';
import { verifySessionHost } from '../app/drive-attach';
import { copySecretsInto } from '../app/profile-secrets.ts';
import { createDevHold, exited } from '../app/dev-hold.ts';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { AppEnv } from '@apackdev/sdk/env';
import { readApiEndpoint } from '@apackdev/host/process-liveness';
import { withoutSourceCondition } from '@apackdev/host/build/source-resolution';
import { installPackFromLocal, readHostCompatibility, recordUserInstall } from '@apackdev/host/packs';
import { removeDevServerMarker, writeDevServerMarker } from '@apackdev/host/packs/dev-server';

const HELP = `
Usage: apack pack dev [--host <path|beta>]

Build and install this pack, then watch its authored inputs. Vite serves frontend changes;
successful staged builds reinstall and reload the verified pack. Requires a pack directory.

A development app is launched with a debug port and publishes <dataDir>/session.json, which is
what lets \`apack pack drive\` ask it questions instead of launching one of its own.

An app already running on the same data dir is used as it is; otherwise one is launched, and
closing this command closes the app it started.

Options:
  --host <path|beta> an explicit checkout or .app bundle; --host beta selects a cached/downloaded host
${PROFILE_USAGE}
  --help, -h          Show this help

With no app named: the apack checkout this pack is built against, if there is one, else the newest
Beta build its hostVersion accepts. A packaged host requires --profile or --fresh.
Production bundles are refused. Other packaged hosts never enable development debugging. Nothing is remembered and nothing is asked.
Named profiles must be custom. A source host also accepts --profile development for its shared data.
For a checkout with no profile named, the shared development data dir is used.

A checkout installs each build through its running app. A packaged app cannot be asked to, so
its builds are copied in while it is stopped: a backend rebuild restarts the app this command
started. Frontend changes use Vite HMR on either.
`.trim();

/**
 * Which environment an app target runs as. A packaged build stamps its own channel at build time
 * (`_inferElectronAppEnv`), so this reports what the app will decide rather than deciding it: passing
 * APACK_ENV to a beta binary would change nothing.
 */
export function hostEnvironment(app: PackHost): AppEnv {
  return app.kind === 'source' ? 'development' : packagedHostChannel(app.executable);
}

/** Live pack development never touches production; packaged non-production hosts need isolated data. */
export function developmentHostEnv(app: PackHost, isolated: boolean): AppEnv {
  const env = hostEnvironment(app);
  if (env === 'production') throw new Error('This bundle is production, regardless of its release tag. Use a checkout for development, or apack pack test for isolated release verification.');
  if (app.kind === 'packaged' && !isolated) throw new Error('Pack development on a packaged app requires --profile <name> or --fresh to isolate release data.');
  return env;
}

/**
 * Copies the build into the app's data dir, checking hostVersion and the build format against the app that last
 * used it. Only while no app runs on that dir: a running app may load a pack while its files are being replaced,
 * so a running checkout is asked to install instead (`installPackInApp`).
 */
export function installToApp(root: string, place: AppPlace = { env: 'development' }) {
  const { packsDir, userDataDir, installedPacksFile } = resolveAppEnvironment(place);
  const { version: hostVersion, packFormat } = readHostCompatibility(userDataDir);
  return installPackFromLocal(root, packsDir, { hostVersion, packFormat, installedPacksFile,
    settingsOverrides: () => readSettingsOverrides(userDataDir),
    accept: candidate => { recordUserInstall(installedPacksFile, candidate.id); },
  });
}

/**
 * What a build hands the app's backend: everything in its receipt but the frontend bundle and the build-only
 * records. Vite serves the frontend during development, so a build that moves only that needs no restart.
 */
export function backendRevision(root: string): string {
  const { files } = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'integrity.json'), 'utf-8')) as { files: Record<string, string> };
  const backend = Object.entries(files).filter(([file]) => file === 'apack.json' || file === 'runtime/index.cjs'
    || file.startsWith('runtime/content/') || file.startsWith('build/') || file.startsWith('types/'));
  return createHash('sha256').update(JSON.stringify(backend.sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}

/**
 * The app's environment, minus this process's own. Two things have to go: ELECTRON_RUN_AS_NODE, which the
 * app-bundled `apack` sets and which would start Electron as plain Node, and the `@apackdev/source`
 * condition, since a checkout's app declares its own and a packaged one must not resolve source at all.
 */
function appLaunchEnv(place: AppPlace): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') out[key] = value;
  }
  const nodeOptions = withoutSourceCondition(out.NODE_OPTIONS);
  if (nodeOptions) out.NODE_OPTIONS = nodeOptions;
  else delete out.NODE_OPTIONS;
  // Only a source run reads this; a packaged build stamps its channel (see `hostEnvironment`)
  out.APACK_ENV = place.env;
  delete out.PLAYWRIGHT_TEST;
  if (place.userDataDir !== undefined) {
    // Set only for a profile, and deliberately: it is also what tells Electron the run was pointed at
    // its own dir, which moves the logs inside it (`main/src/app-context.ts`). A plain `apack pack dev` should
    // keep writing to the platform log dir, and should keep honouring an APACK_USER_DATA_DIR the caller
    // exported, which naming one here would override.
    out.APACK_USER_DATA_DIR = place.userDataDir;
    // A profile holds its own keys, so the data key goes beside them rather than into the OS keychain,
    // where every profile of one channel would share a service name. The app reads this in any
    // environment but production.
    out.APACK_SECRETS_VAULT = 'file';
  }
  return out;
}

/**
 * The debug port, or nothing — the one gate between this design and an open port on a user's app.
 *
 * **It is computed from the resolved environment and from nothing else.** Not an argv flag anyone can pass,
 * not a session file's contents, not a variable: `development` only, so a `test` context (every `apack
 * test` run) and a packaged build a user installed never get one. `--remote-debugging-port` is
 * unauthenticated control of the renderer, and the renderer holds the app's API token, so the gate is the
 * load-bearing part rather than a precaution. Chromium binds it to loopback by default and nothing here
 * widens that.
 *
 * `0` means Chromium picks a free port, which is the only safe way to ask: a fixed one collides with
 * whatever else holds it and with a second app. It then writes the number it picked into the data dir,
 * which `readDevToolsPort` reads.
 */
export function debugPortArgs(place: AppPlace): string[] {
  return debugPortArgsFor(resolveAppEnvironment(place).env);
}

/** Starts the app. A checkout runs its own sources with its own electron, so a pack needs none installed. */
function launchApp(app: PackHost, place: AppPlace): ChildProcess {
  const options = { env: appLaunchEnv(place), stdio: 'ignore' as const, detached: false };
  const debug = debugPortArgs(place);
  if (app.kind === 'source') {
    const electron = createRequire(path.join(app.root, 'package.json'))('electron') as string;
    return spawn(electron, [app.root, ...debug], { ...options, cwd: app.root });
  }
  return spawn(app.executable, debug, options);
}

/**
 * Whether this command may take the data dir from the app that holds it.
 *
 * **Only what a tool started for itself.** `startedBy` is the whole of the rule: a person's app is not a
 * tool's to take, and an absent or unreadable session is not an app at all (`readSession` already treats a
 * record whose supervisor has gone as absent). It is a function so the rule has a firing case on both
 * sides — reclaiming unconditionally takes an app somebody opened, which is the mutation that must fail.
 */
export function mayReclaim(session: DevSession | undefined): boolean {
  return session?.startedBy === 'drive';
}

/**
 * How long a drive-profile app waits with nothing attached before it closes itself.
 *
 * Long enough to keep the app across a person reading an answer and asking the next thing, which is the
 * 0.9s question rather than the 3.3s one. Short enough that an interrupted loop costs minutes of a held
 * data dir rather than a session.
 */
export const IDLE_REAP_MS = 10 * 60_000;

/**
 * Whether this supervisor closes its app when nothing attaches, and the profile is the half that decides it.
 *
 * **Both clauses matter.** `startedBy: 'drive'` alone would reap the development dir, where a `--spawn`
 * with no profile flags lands — and that one is `mayReclaim`'s: the developer's own `apack pack dev` takes the
 * directory back and says so, where a timer would close an app somebody may be watching. A profile is the
 * case nothing else reclaims, `apack pack dev --profile <name>` not being a command anyone happens to run, so
 * without this it holds a data dir until the machine is rebooted.
 */
export function reapsWhenIdle(session: Pick<DevSession, 'startedBy'>, place: AppPlace): boolean {
  return session.startedBy === 'drive' && place.userDataDir !== undefined;
}

/** Close the app now, or ask again in this many milliseconds. */
export interface IdleVerdict {
  readonly reap: boolean;
  readonly againInMs: number;
}

/**
 * Whether an app whose session was last attached at `lastAttachedMs` has idled out.
 *
 * **The wait is a deadline, re-derived, rather than an interval.** Each wakeup is the earliest moment the
 * answer could have changed: either the window has passed, or something attached since and the next wakeup
 * is its deadline. So nothing polls — a session that is asked a question every minute wakes this once per
 * question, and an idle one wakes it exactly once.
 */
export function idleVerdict(lastAttachedMs: number, nowMs: number, idleMs: number): IdleVerdict {
  const remaining = idleMs - (nowMs - lastAttachedMs);
  return remaining > 0 ? { reap: false, againInMs: remaining } : { reap: true, againInMs: 0 };
}

/**
 * Waits for the app to publish its port file, which is what says the API is up and so what says the pack
 * can be installed and reloaded. One waiter, bounded: a crashed launch must report that rather than hang.
 */
/**
 * Waits for an API on the data dir, and says **whose** — which is the half that matters.
 *
 * The child is checked first, and that order is the point: a port file appearing says an API is up, not
 * that it is ours. Another app can take the data dir between the check above and this launch, and Electron's
 * single-instance lock — scoped to the data dir — then refuses ours and exits. Reading the port file first
 * made that look like a successful start, and what followed published a session carrying this process's pid
 * and the other app's port.
 *
 * `other` is not a failure: one app per data dir, so the app that got there first is the one to use. Only
 * both — no child and no API — is.
 */
async function waitForApi(apiPortFile: string, child: ChildProcess, timeoutMs = 60_000): Promise<'ours' | 'other'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (readApiEndpoint(apiPortFile)) return 'other';
      throw new Error(`The app exited (${child.exitCode ?? child.signalCode}) before its API came up`);
    }
    if (readApiEndpoint(apiPortFile)) return 'ours';
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`The app did not publish ${apiPortFile} within ${timeoutMs / 1000}s`);
}

/** What a session hands back so `dev` can tear it down on the way out of a throw. */
interface SessionHooks {
  teardown?: () => Promise<void>;
}

export async function dev(args: string[]) {
  return holdSession(args, 'pack');
}

export async function holdSession(args: string[], target: 'app' | 'pack') {
  const hooks: SessionHooks = {};
  try {
    await session(args, hooks, target);
  } catch (error) {
    // The signals have their own handlers; this is every other way a session ends, and it is the one
    // that happens while developing — a pack that fails to build used to exit through the CLI's error
    // handler and leave an ephemeral profile behind
    await hooks.teardown?.();
    throw error;
  }
}

async function session(args: string[], hooks: SessionHooks, target: 'app' | 'pack') {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }

  // The command path selects the subject; the current directory never turns an app session into a pack session.
  const root = target === 'pack' ? findPackRoot(process.cwd()) : undefined;
  const pack = root === undefined ? undefined : {
    root,
    manifest: readManifest(root),
  };

  const { mode, withSecrets, rest } = parseProfileFlags(args);
  const flags = parseHostFlags(rest);
  if (flags.release || flags.prebuilt) throw new Error('--release and --prebuilt belong to apack pack test.');
  // `dev` forwards nothing, so a leftover flag is a typo rather than an argument for something else —
  // where `drive` hands its own leftovers to Playwright and must not refuse them. Ignoring one silently
  // is how a removed or misspelled flag reads as having been obeyed.
  const unknown = flags.args;
  if (unknown.length > 0) {
    throw new Error(`Unknown option${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. See ${target === 'pack' ? 'apack pack dev' : 'npm run dev:open --'} --help.`);
  }
  if (target === 'app' && flags.host) throw new Error('Repository launch uses its own checkout; host selection belongs to pack commands.');
  const app = target === 'app' ? resolveRepositoryHost(process.cwd())
    : await resolvePackHost({ policy: 'development', flags, hostVersion: pack!.manifest.hostVersion ?? '*', from: pack!.root });
  const sharedDevelopment = mode.kind === 'named' && mode.name === 'development';
  if (sharedDevelopment && (app.kind !== 'source' || mode.rm || withSecrets)) throw new Error('The development profile requires a source host and cannot use --rm or --with-secrets.');
  if (sharedDevelopment) delete process.env.APACK_USER_DATA_DIR;
  const env = developmentHostEnv(app, mode.kind !== 'shared' && !sharedDevelopment);
  setHostHandoff(app, process.env);
  const profile = sharedDevelopment ? undefined : profileFor(mode, cliDirs());
  const place: AppPlace = { env, ...(profile ? { userDataDir: profile.dir } : {}) };
  const { userDataDir, apiPortFile } = resolveAppEnvironment(place);

  /**
   * What this session holds, and what letting go of it means (`app/dev-hold.ts` owns the order).
   *
   * Taken here rather than once the dev server is up, because the ten seconds before that — the build, the
   * launch, the install — are exactly when someone presses Ctrl-C, and an ephemeral profile interrupted
   * there used to be left on disk. Each resource is handed over as it arrives.
   */
  const hold = createDevHold({
    removeMarker: packId => removeDevServerMarker(userDataDir, packId),
    ...(profile?.ephemeral ? {
      removeProfile: () => {
        removeProfile(cliDirs(), profile.dir);
        console.log(`\nRemoved the ephemeral profile ${profile.name}.`);
      },
    } : {}),
  });
  const buildLifetime = new AbortController();
  const builder = pack ? createPackBuilder(pack.root) : undefined;
  let building: Promise<void> | undefined;
  let watching: ReturnType<typeof startPackBuildWatcher> | undefined;
  // Startup failures are reported by the session; release must still drain their cleanup.
  hold.holdsWatcher(async () => {
    await building?.catch(() => {});
    await watching?.then(watcher => watcher.close(), () => {});
    await builder?.close();
  });
  const releaseNow = () => { buildLifetime.abort(); hold.releaseNow(); };
  const release = () => { buildLifetime.abort(); return hold.release(); };
  /** The app this command started and holds now; a restart replaces it */
  let held: ChildProcess | undefined;
  /** The backend of the build last copied into a packaged app (`backendRevision`) */
  let installedBackend: string | undefined;
  /** The session ends with the app it holds, unless that app was closed to restart it */
  const endWith = (child: ChildProcess) => child.once('exit', () => { if (child === held) void release().then(() => process.exit(0)); });

  /**
   * Publishes `<dataDir>/session.json`, so something can attach to the app this command holds.
   *
   * **The pid is this process's**, not the app's: this is the supervisor, and signalling it runs the
   * teardown below, which closes the app it holds — one signal ends both. Nothing goes the other way, so a
   * record naming the app would free the data dir and leave this process, its watcher and its dev server
   * running with nothing to serve.
   *
   * A launch with no debug port publishes nothing. That is the honest answer rather than a record with a
   * hole in it: the file means "attachable", and a `test` or packaged context is not.
   */
  async function publish(launchedAt: number): Promise<void> {
    if (app.kind !== 'source' || debugPortArgs(place).length === 0) return;
    try {
      const debugPort = await readDevToolsPort(userDataDir, { after: launchedAt });
      hold.holdsSession(publishSession({
        host: { kind: 'source', root: app.root },
        env: 'development',
        debugPort,
        apiPort: readApiEndpoint(apiPortFile)?.port,
        dataDir: userDataDir,
        supervisorPid: process.pid,
        startedBy: startedByFromEnv(),
      }));
      console.log(`  attachable on debug port ${debugPort} — \`apack pack drive\` can reach it`);
      armIdleReap({ startedBy: startedByFromEnv() });
      console.log('');
    } catch (error) {
      throw new Error(`Development debugging failed: ${errorMessage(error)}`);
    }
  }

  /**
   * Closes the app when nothing has attached for `IDLE_REAP_MS` — for the apps `reapsWhenIdle` names, and
   * no others.
   *
   * The timer is the only thing keeping this process honest about an app nobody is minding, so it says so
   * on the way up: a supervisor that closes itself silently is one whose user reports the app vanishing.
   */
  function armIdleReap(session: Pick<DevSession, 'startedBy'>): void {
    if (!reapsWhenIdle(session, place)) return;
    const minutes = Math.round(IDLE_REAP_MS / 60_000);
    console.log(`  it closes itself after ${minutes}m with nothing attached — each question resets that`);
    const tick = () => {
      const last = lastAttachedAt(userDataDir);
      // The session this process published has gone, so there is no record left to mind and nothing that
      // could attach through it either
      if (last === undefined) return void reap('its session file has gone');
      const { reap: now, againInMs } = idleVerdict(last, Date.now(), IDLE_REAP_MS);
      if (now) return void reap(`nothing has attached for ${minutes}m`);
      setTimeout(tick, againInMs);
    };
    setTimeout(tick, IDLE_REAP_MS);
  }

  /** Release, then exit, so the profile goes with the app as it does for any other way this ends. */
  async function reap(why: string): Promise<void> {
    console.log(`\nClosing the app this question started: ${why}.`);
    await release();
    process.exit(0);
  }

  hooks.teardown = release;
  process.on('exit', releaseNow);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void release().then(() => process.exit(0)));
  }

  if (profile && withSecrets) {
    const { count, from } = copySecretsInto(profile, env);
    console.log(`Copied ${count} secret${count === 1 ? '' : 's'} from ${from}`);
  }

  if (profile) {
    console.log(`Profile ${profile.name}${profile.ephemeral ? ' (removed on exit)' : ''}`);
    console.log(`  ${profile.dir}`);
    console.log(`  apack db --data-dir "${profile.dir}" to read it\n`);
  }

  if (pack) {
    console.log('Running initial build...\n');
    building = builder!.build({ signal: buildLifetime.signal });
    await building;
    buildLifetime.signal.throwIfAborted();
  }

  /**
   * **Reclaiming an app a tool started, which is what makes `--spawn` safe to point at this data dir.**
   *
   * One app per data dir, and `SingleInstanceApp` exits on the second — so without this a spawned one-shot
   * would hold the development dir and the developer's own `apack pack dev` or `npm run dev` would refuse, with the
   * blame landing on the command they just ran. The rule is narrow by construction: it takes what a tool
   * started *for itself* (`startedBy: 'drive'`) and nothing else, because a person's app is not a tool's to
   * take. The pid comes from a file the process wrote about itself, which is the only kind of kill allowed
   * here, and it is the supervisor's — its own teardown closes the app it holds, so one signal ends both.
   *
   * After it, the two commands converge rather than compete: the next question attaches to the app the
   * developer now has.
   */
  function verifyRunningSession(): void {
    if (app.kind !== 'source') throw new Error('A packaged host cannot verify the app already using this profile. Close it or choose another profile.');
    const session = readSession(userDataDir);
    if (!session) throw new Error('The running app has no development session. Close it and restart its development launcher.');
    verifySessionHost(session, app.root);
  }
  const reclaimable = readSession(userDataDir);
  if (reclaimable) {
    if (app.kind !== 'source') throw new Error('This profile is occupied by a source development session. Choose another profile.');
    verifySessionHost(reclaimable, app.root);
  }
  if (mayReclaim(reclaimable)) {
    console.log(`Reclaiming the app a question started (pid ${reclaimable!.supervisorPid})...`);
    await endAppHolding(userDataDir, reclaimable!.supervisorPid);
    console.log('  it has gone; starting yours\n');
  }

  // An app already on this data dir is the one to use: a second Electron over the same database is not a
  // choice anyone wants. Only an app this command started is one it may close.
  if (readApiEndpoint(apiPortFile)) {
    verifyRunningSession();
    console.log(`Using the ${env} app already running.\n`);
  } else {
    if (pack && app.kind === 'packaged') {
      // Before the launch: a packaged app takes no install request, so its build is copied while nothing runs
      console.log(`Installing pack into ${userDataDir}...`);
      console.log(`  ${(await installToApp(pack.root, place)).dir}\n`);
      installedBackend = backendRevision(pack.root);
    }
    console.log(`Starting ${hostLabel(app)}...`);
    // Before the launch, so the port file this waits for is the one this app writes rather than whatever a
    // previous app on this data dir left behind
    const launchedAt = Date.now();
    const spawned = launchApp(app, place);
    hold.holdsApp(spawned);
    held = spawned;
    const whose = await waitForApi(apiPortFile, spawned);
    if (whose === 'other') {
      // Ours was refused the data dir and another app has it. Forgetting it is what keeps the release
      // honest: it closes an app this command started, and this one started none that lived
      hold.forgetApp();
      held = undefined;
      verifyRunningSession();
      console.log(`Using the ${env} app that took the directory first.\n`);
    } else {
      console.log(`  up on ${env} data in ${userDataDir}\n`);
      // Published only for an app this command holds, and after its API is up so the session carries the
      // port a driver needs. An app that was already here has a session of its own or is not attachable,
      // and either way is not this command's to describe.
      await publish(launchedAt);
      endWith(spawned);
    }
  }

  if (!pack) {
    // The launch and the hold, which is all there is without a pack. Returning here is what makes every
    // step below — install, dev server, watchers, reload — a pack's rather than the command's.
    console.log('Holding the app session. Ctrl-C to close it.\n');
    await new Promise(() => {});
    return;
  }

  if (app.kind === 'source') {
    // The running app installs and starts it, so nothing it does meanwhile loads a half-copied build
    console.log(`Installing pack to the ${env} app...`);
    const installed = await installPackInApp(pack.root, place);
    // A pack that fails to load is the author's to fix, so the watcher keeps running and the next save retries
    if (installed.status !== 'delivered') {
      console.warn(`  The app did not install the pack (${'detail' in installed ? installed.detail : installed.status}). Fix it and save; the watcher keeps running.`);
    }
    console.log('');
  }

  /**
   * Delivers a packaged app a backend rebuild: close the app this command started, copy the build in, start it
   * again. The relaunch runs even when the copy fails, since a refused install leaves the previous build in place.
   */
  async function restartWithBuild(): Promise<DevDelivery> {
    const revision = backendRevision(pack!.root);
    if (revision === installedBackend) return { status: 'current' };
    const previous = held;
    if (!previous) return { status: 'failed', detail: 'this command did not start the app, so it cannot restart it' };
    console.log('[watch] backend rebuilt — restarting the app with it');
    held = undefined;
    hold.forgetApp();
    previous.kill();
    await exited(previous);
    let failure: unknown;
    try {
      await installToApp(pack!.root, place);
      installedBackend = revision;
    } catch (error) { failure = error; }
    if (buildLifetime.signal.aborted) return { status: 'failed', detail: 'the session is closing' };
    const next = launchApp(app, place);
    hold.holdsApp(next);
    held = next;
    if (await waitForApi(apiPortFile, next) === 'other') {
      hold.forgetApp();
      held = undefined;
      throw new Error('Another app took the data dir while this one restarted');
    }
    endWith(next);
    if (failure) throw failure;
    return { status: 'delivered' };
  }

  const watch = async () => {
    watching = startPackBuildWatcher(pack.root, {
      place,
      signal: buildLifetime.signal,
      builder: builder!,
      ...(app.kind === 'packaged'
        ? { onBuilt: restartWithBuild }
        : { onBuilt: () => installPackInApp(pack.root, place) }),
    });
    try { await (await watching).done; }
    finally { await release(); }
  };
  const address = await builder!.serveFrontend(address => {
    if (address) {
      writeDevServerMarker(userDataDir, pack.manifest.id, address);
      hold.holdsMarker(pack.manifest.id);
    } else removeDevServerMarker(userDataDir, pack.manifest.id);
  });
  if (address) console.log(`\nDev server running at http://localhost:${address.port}`);
  console.log('Frontend changes reload through Vite; authored inputs rebuild, reinstall and reload the verified pack.');
  console.log('Press Ctrl+C to stop.\n');
  await watch();
}
