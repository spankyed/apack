import { waitForApplicationWindow } from './application-window.ts';
import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
export { expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, execFileSync } from 'child_process';
import { createRequire } from 'module';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { resolveName } from '@apackdev/sdk/ids';
import { installPackFromLocal, PACK_LOAD_MESSAGES } from '@apackdev/host/packs';
import { resolveTestHost, type AppLaunch, type TestHostOptions } from './test-host.ts';
import { appVersion } from './app-version.ts';
import { appLaunchEnv, pinsViewport } from './launch-env.ts';
import { assertCheckoutPackagesFresh } from './checkout-freshness.ts';
import { assertPrebuiltPackCurrent, packArchiveAcceptance } from './prebuilt-pack.ts';

export interface AppDriver {
  sendEvent: (event: Record<string, unknown>) => Promise<void>;
  getState: () => Promise<unknown>;
  getContext: () => Promise<{ activeSurfaceId: string; surfaceIds: string[] }>;
  screenshot: (name: string) => Promise<Buffer>;
  /**
   * An answer a driving run is meant to be *read* for, rather than watched: written to
   * `.apack/drive/results/<name>.json` and printed as one `[drive:report] <name> <json>` line.
   *
   * **A driving script's output is otherwise `console.log` inside Playwright's reporter**, so whoever runs
   * it — usually an agent — invents a prefix and greps for it. Standardising the prefix and the file is the
   * whole of this: the line is for a human watching, the file is for a program, and neither has to be
   * agreed on per script.
   */
  report: (name: string, value: unknown) => Promise<string>;
  navigate: (surfaceId: string) => Promise<void>;
  waitForState: (check: string, timeout?: number) => Promise<void>;
  waitForSurface: (surfaceId: string, timeout?: number) => Promise<void>;
}

export interface CreateTestOptions extends TestHostOptions {
  screenshotDir?: string;
}

function resolveScreenshotDir(override?: string): string {
  if (override) return path.resolve(override);
  // Driving selects its own output through the environment; ordinary tests use the pack's work directory.
  if (process.env.E2E_SCREENSHOT_DIR) return path.resolve(process.env.E2E_SCREENSHOT_DIR);
  return path.resolve(process.env.PACK_DIR || process.cwd(), '.apack', 'tests', 'screenshots');
}

/**
 * Where `app.report` writes. `resolveScreenshotDir`'s shape and reasoning, for the same reason: the option
 * cannot reach the `test` a driving script imports, so the environment is how a driving run says where its
 * output goes.
 */
function resolveReportDir(): string {
  if (process.env.E2E_REPORT_DIR) return path.resolve(process.env.E2E_REPORT_DIR);
  return path.resolve(process.env.PACK_DIR || process.cwd(), '.apack', 'drive', 'results');
}

/** The apack CLI bin that builds the pack under test. */
function resolveApackBin(app: AppLaunch, packDir: string): string {
  // `apack pack test` passes itself, so the build uses the same CLI as the test run
  if (process.env.APACK_CLI) return process.env.APACK_CLI;
  const bases = [path.join(packDir, 'package.json'), ...(app.kind === 'source' ? [path.join(app.root, 'package.json')] : [])];
  for (const base of bases) {
    try {
      return path.join(path.dirname(createRequire(base).resolve('@apackdev/cli/package.json')), 'bin', 'apack.mjs');
    } catch {}
  }
  throw new Error('Could not find the apack CLI to build the pack. Install it in the pack (npm i -D @apackdev/cli) or run the tests with `apack pack test`.');
}

let _packManifest: { id: string; surfaceIds: string[] } | null | undefined;
function getPackManifest(): { id: string; surfaceIds: string[] } | null {
  if (_packManifest !== undefined) return _packManifest;
  if (!process.env.PACK_DIR) { _packManifest = null; return null; }
  const manifestPath = path.join(path.resolve(process.env.PACK_DIR), 'apack.json');
  if (!fs.existsSync(manifestPath)) { _packManifest = null; return null; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  _packManifest = {
    id: manifest.id,
    // The ids the surfaces run under: a surface runs at `<packId>/<featureId>`, as a system does
    surfaceIds: Object.entries(manifest.features ?? {})
      .filter(([, f]: [string, any]) => f.surface)
      .map(([id]) => resolveName(id, manifest.id)),
  };
  return _packManifest;
}

const E2E_VIEWPORT = { width: 1400, height: 900 };

/** The pack's recorded install or apply error in the test app's installed packs, if any. */
function readPackLastError(packId: string, userDataDir: string): string | undefined {
  try {
    const registry = JSON.parse(fs.readFileSync(resolveAppEnvironment({ env: 'test', userDataDir }).installedPacksFile, 'utf-8'));
    return registry.packs?.find((p: { id: string }) => p.id === packId)?.lastError;
  } catch {
    return undefined;
  }
}

// Recent Electron stdout/stderr per app, so fixture failures can report the root
// cause (loader errors, crashes) without re-running under DEBUG_E2E.
const OUTPUT_TAIL_LINES = 200;
// Launch time per app, to report how long boot to a connected renderer took (once per worker)
const launchMonotonicStart = new WeakMap<ElectronApplication, number>();
function reportLaunchPhase(phase: string, started: number, pid?: number): void {
  console.log('[e2e.launch]', JSON.stringify({ phase, elapsedMs: performance.now() - started, at: Date.now(), pid }));
}
/** Parent-process monotonic time immediately before launching this owned application's process. */
export function applicationLaunchStartedAt(app: ElectronApplication): number {
  const started = launchMonotonicStart.get(app);
  if (started === undefined) throw new Error('The application was not launched by this fixture');
  return started;
}

const userDataDirs = new WeakMap<ElectronApplication, string>();
const outputTails = new WeakMap<ElectronApplication, string[]>();
/** Where this app's output is being written, so a failure can name it instead of asking for a re-run */
const appLogs = new WeakMap<ElectronApplication, string>();

/** What the pack loader said about the pack under test, kept whole while the tail scrolls past it. */
type PackLoad = { registered?: true; failure?: string };
const packLoads = new WeakMap<ElectronApplication, PackLoad>();

/**
 * The app's own output, where whoever ran the suite can read it after the fact.
 *
 * The tail below is a ring buffer the fixture reports on its own failures, and `DEBUG_E2E=1` prints
 * everything to the terminal — neither is reachable once a run is over, which is what made
 * "re-run under DEBUG_E2E" the standard next step. Electron's own logs are no better: a run given its own
 * data dir keeps them there (`packages/main/src/app-context.ts`), and an ephemeral drive session deletes
 * that dir on the way out, taking them with it.
 *
 * Playwright's `outputDir` is the one place that outlives the app and not the run: it is wiped at the start
 * of every run, so this is always exactly the last run and never an archive nobody prunes. Named per worker
 * because the app is worker-scoped — two workers' output in one file interleaves into neither's.
 */
function appLogPath(info: { project: { outputDir: string }; workerIndex: number }): string {
  return path.join(info.project.outputDir, `app-${info.workerIndex}.log`);
}

function captureOutput(app: ElectronApplication, logFile?: string): void {
  if (logFile) appLogs.set(app, logFile);
  const tail: string[] = [];
  outputTails.set(app, tail);
  const packLoad: PackLoad = {};
  packLoads.set(app, packLoad);
  const packId = getPackManifest()?.id;
  // The loader logs one line per outcome for every pack it reaches, and those lines are its contract with
  // this fixture (`PACK_LOAD_MESSAGES`, `@apackdev/host/packs`), not prose it happens to print. Watched from
  // the launch because the tail only keeps the last few hundred lines and the app has usually logged past
  // boot by the time a test asks.
  const escaped = packId?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const registered = escaped && new RegExp(`${PACK_LOAD_MESSAGES.registered} ${escaped}\\b`);
  const failed = escaped && new RegExp(`(${PACK_LOAD_MESSAGES.notLoaded.join('|')}) ${escaped}\\b`);
  // Appended, not buffered to the end: a crash or a hang is exactly when this is wanted, and either one
  // means no later flush arrives. `mkdirSync` because Playwright creates `outputDir` lazily, so the first
  // chunk can beat it.
  if (logFile) fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const onData = (data: Buffer) => {
    if (logFile) { try { fs.appendFileSync(logFile, data); } catch { /* a log is never worth failing a run */ } }
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
      if (registered && registered.test(line)) packLoad.registered = true;
      else if (failed && failed.test(line) && !packLoad.failure) packLoad.failure = line.trim();
    }
  };
  app.process().stdout?.on('data', onData);
  app.process().stderr?.on('data', onData);
}

const WILL_QUIT_MARKER = '[e2e] will-quit';

/**
 * Settles once the app's own quit sequence has finished: Electron emits `will-quit` only after
 * `before-quit` has let it through, which the API server's handler does once the API child has exited.
 * What Electron does after that is Chromium's shutdown, flushing the profile — slow under load, and the
 * fixture's to skip for a profile it deletes (the teardown below).
 */
async function watchQuitSequence(app: ElectronApplication): Promise<{ done: Promise<void> }> {
  const child = app.process();
  const done = new Promise<void>(resolve => {
    const onData = (data: Buffer) => { if (data.toString().includes(WILL_QUIT_MARKER)) resolve(); };
    child.stdout?.on('data', onData);
    child.once('exit', () => resolve());
  });
  await app.evaluate(({ app }, marker) => {
    app.once('will-quit', () => { process.stdout.write(`${marker}\n`); });
  }, WILL_QUIT_MARKER);
  // Wrapped, since an async function returning a promise would hand back its settlement instead
  return { done };
}

/**
 * Waits for the pack under test to have been loaded and registered by the app's backend.
 *
 * Nothing else in this fixture observes the backend: an apply reports only its own failures, and the
 * surface wait below covers a pack with a frontend. A backend-only pack whose systems never registered
 * — an incompatible hostVersion, an unsupported layout, a throw in its runtime — would otherwise pass
 * its whole suite while dead, because every test it runs asks the app about something else.
 */
/**
 * The ref a spec's surface name is, as the pack under test's own code names surfaces: its features by id, any
 * other (the host's too) as `<packId>/<featureId>`.
 */
function resolveSurface(name: string): string {
  return resolveName(name, getPackManifest()?.id);
}

async function waitForPackBackend(app: ElectronApplication, packId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const load = packLoads.get(app);
    if (load?.registered) return;
    if (load?.failure) throw describeFailure(`Pack ${packId} was not loaded by the app:\n  ${load.failure}`, app);
    if (Date.now() >= deadline) {
      throw describeFailure(`Pack ${packId} was not loaded by the app within ${timeoutMs / 1000}s (the loader never reached it)`, app);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** The pid of the API serving this app, from the `{ port, pid }` file the API writes about itself as it starts */
function apiPidOf(app: ElectronApplication): number | undefined {
  const userDataDir = userDataDirs.get(app);
  if (!userDataDir) return undefined;
  const endpointFile = resolveAppEnvironment({ env: 'test', userDataDir }).apiPortFile;
  try { return (JSON.parse(fs.readFileSync(endpointFile, 'utf8')) as { pid?: number }).pid; }
  catch (error) {
    // No file is no API yet (or one that has exited); a file that cannot be read is a fault worth hearing about
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const ERROR_LINE = /error|exception|failed|cannot|not found|no machine export/i;

function describeFailure(message: string, app: ElectronApplication, rendererErrors: string[] = []): Error {
  const sections = [message];
  if (rendererErrors.length > 0) {
    sections.push('Renderer errors:\n' + rendererErrors.map(e => `  ${e}`).join('\n'));
  }
  const errorLines = (outputTails.get(app) ?? []).filter(l => ERROR_LINE.test(l)).slice(-30);
  if (errorLines.length > 0) {
    sections.push('Electron/API output (error lines):\n' + errorLines.map(l => `  ${l}`).join('\n'));
  }
  const logFile = appLogs.get(app);
  sections.push(logFile
    ? `Full Electron and API output: ${logFile}`
    : 'Re-run with DEBUG_E2E=1 for full Electron output.');
  return new Error(sections.join('\n\n'));
}

async function findMainWindow(electronApp: ElectronApplication): Promise<Page> {
  try { return await waitForApplicationWindow(electronApp, 45_000); }
  catch { throw describeFailure('Main window with applicationState did not appear within timeout', electronApp); }
}

/** What `awaitShell` waits for. A descriptor rather than a predicate, because a function cannot cross into the page. */
type ShellCondition = { kind: 'surface'; ref: string } | { kind: 'state'; path: string };

/**
 * Waits for the app shell to reach a condition by **subscribing** to its actor.
 *
 * A sampled wait fails in two ways a subscription cannot: it can pass over a state the app held between
 * two samples, and its interval is a second deadline nobody declared — `expect.poll`'s 5s default gave up
 * 28.4s into a pack-restore test while the app was working correctly. Here the actor says when it changed,
 * the condition is read on that transition, and the `timeout` only names what never arrived.
 *
 * **The actor's own arrival is still sampled, and cannot be otherwise today.** `window.applicationState`
 * is a plain assignment in `renderer/src/main.ts`, so there is no event to subscribe to; this polls for the
 * global and nothing else. Give the renderer a readiness event and that half goes too.
 */
async function awaitShell(page: Page, condition: ShellCondition, timeout: number): Promise<void> {
  await page.waitForFunction(() => (window as any).applicationState !== undefined, null, { timeout });
  await page.evaluate(([what, ms]) => new Promise<void>((resolve, reject) => {
    const actor = (window as any).applicationState;
    /** The dot-path match `waitForState` has always used: a nested value, or a leaf equal to the segment. */
    const atPath = (value: unknown, path: string): boolean => {
      if (typeof value !== 'object' || value === null) return value === path;
      let current: any = value;
      for (const part of path.split('.')) {
        if (typeof current === 'object' && current !== null && part in current) current = current[part];
        else return current === part;
      }
      return true;
    };
    const holds = (): boolean => {
      const snapshot = actor.getSnapshot();
      return what.kind === 'surface'
        ? (snapshot?.context?.surfaces ?? []).some((surface: { id: string }) => surface.id === what.ref)
        : atPath(snapshot?.value, what.path);
    };
    const describe = (): string => what.kind === 'surface'
      ? `no surface at ${what.ref}; the app has ${JSON.stringify((actor.getSnapshot()?.context?.surfaces ?? []).map((s: { id: string }) => s.id))}`
      : `the shell is ${JSON.stringify(actor.getSnapshot()?.value)}, waiting for ${what.path}`;
    if (holds()) return resolve();
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`after ${ms}ms: ${describe()}`));
    }, ms);
    const subscription = actor.subscribe(() => {
      if (!holds()) return;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve();
    });
  }), [condition, timeout] as [ShellCondition, number]);
}

/** The state a ready app is in, as the dot-path `waitForState` takes. */
export const APP_READY_STATE = 'running.connected';

/**
 * Waits until the app is ready to be driven, dismissing onboarding on the way.
 *
 * **The dismissal is inside the predicate, not a step before it.** Onboarding can arrive at any point
 * during the boot, so a check-then-dismiss-then-wait has a window in which it appears after the check and
 * the second wait hangs to its deadline. `engine/index.ts`' `reloadWindow` already learned that for a
 * reloaded window; this is the same shape, used by every caller.
 *
 * `window.__disableOnboardingUI` is defined unconditionally (`renderer/src/main.ts`), so a page that
 * arrived over CDP reaches it exactly as a launched one does. It dismisses this window's onboarding UI
 * without completing the persisted onboarding lifecycle. Call again after a window reload.
 *
 * `state` is a parameter with a default because the caller this leaves room for wants onboarding **left
 * up**: driving the onboarding screens themselves, which nothing can do today. A hard-coded terminal state
 * would make that a rewrite rather than an argument.
 */
export function waitForAppReady(page: Page, { state = APP_READY_STATE, timeout = 45_000 } = {}): Promise<unknown> {
  return page.waitForFunction(({ path: want, dismiss }) => {
    const win = window as unknown as {
      applicationState?: { getSnapshot(): { value?: unknown } };
      __disableOnboardingUI?: () => void;
    };
    const value = win.applicationState?.getSnapshot().value;
    if (typeof value !== 'object' || value === null) return value === want;
    // Dismissed from inside the poll because it can arrive at any point during the boot
    if (dismiss && 'onboarding' in value) win.__disableOnboardingUI?.();
    let current: unknown = value;
    for (const part of want.split('.')) {
      if (typeof current === 'object' && current !== null && part in current) current = (current as Record<string, unknown>)[part];
      else return current === part;
    }
    return true;
  }, { path: state, dismiss: state === 'running.connected' }, { timeout });
}

/**
 * The `AppDriver` over a page, as a free function.
 *
 * **It was only ever a function of a `Page`** — every method is `page.evaluate`, `page.waitForFunction` or
 * `page.screenshot` — and looked fixture-bound because the fixture is where it was constructed. A page that
 * arrived over CDP rather than from a launch gets the same verbs from the same code, which is what makes
 * one implementation serve both and is the reason this is extracted rather than copied.
 *
 * `screenshotDir` is the one thing it closes over; the report directory is resolved per call, since a run
 * that reports nothing should leave no directory behind.
 */
export function createAppDriver(page: Page, screenshotDir: string): AppDriver {
  const app: AppDriver = {
    sendEvent: async (event) => {
      await page.evaluate((e) => {
        (window as any).applicationState.send(e);
      }, event);
    },
  
    getState: async () => {
      return page.evaluate(() => {
        return (window as any).applicationState?.getSnapshot()?.value;
      });
    },
  
    getContext: async () => {
      return page.evaluate(() => {
        const snap = (window as any).applicationState?.getSnapshot();
        return {
          activeSurfaceId: snap?.context?.activeSurface?.id ?? '',
          surfaceIds: (snap?.context?.surfaces ?? []).map((p: any) => p.id),
        };
      });
    },
  
    screenshot: async (name) => {
      // Made on first use, not at fixture setup: every run of every spec used to leave an empty
      // `.apack/tests/screenshots/` behind, including suites that screenshot nothing
      fs.mkdirSync(screenshotDir, { recursive: true });
      const filePath = path.join(screenshotDir, `${name}.png`);
      return page.screenshot({ path: filePath });
    },
  
    report: async (name, value) => {
      // Made on first use, as the screenshot dir is: a run that reports nothing leaves nothing behind
      const reportDir = resolveReportDir();
      fs.mkdirSync(reportDir, { recursive: true });
      const filePath = path.join(reportDir, `${name}.json`);
      fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
      console.log(`[drive:report] ${name} ${JSON.stringify(value)}`);
      return filePath;
    },
  
    navigate: async (surfaceId) => {
      const id0 = resolveSurface(surfaceId);
      await page.evaluate((id) => {
        (window as any).applicationState.send({ type: 'SELECT_SURFACE', surface: id });
      }, id0);
      await page.waitForFunction((id) => {
        const snap = (window as any).applicationState?.getSnapshot();
        if (snap?.context?.activeSurface?.id !== id) return false;
        // The state switching is not the canvas being on screen: Vue renders on the next flush, and a
        // test that clicks or screenshots straight after a navigate needs that flush to have happened.
        // data-active-surface (WebApp.vue) is written in the flush that swaps the canvas.
        return document.querySelector(`[data-active-surface="${id}"]`) !== null;
      }, id0, { timeout: 10_000 });
    },
  
    waitForSurface: async (surfaceId, timeout = 30_000) =>
      awaitShell(page, { kind: 'surface', ref: resolveSurface(surfaceId) }, timeout),

    waitForState: async (check, timeout = 10_000) =>
      awaitShell(page, { kind: 'state', path: check }, timeout),
  };
  return app;
}

export function createTest(options: CreateTestOptions = {}) {
  const screenshotDir = resolveScreenshotDir(options.screenshotDir);

  const test = base.extend<
    { appPage: Page; app: AppDriver },
    { electronApp: ElectronApplication }
  >({
    // Playwright's signature for a fixture that depends on no other fixture. It always passes an object, and
    // dropping the parameter would change the fixture's arity.
    // eslint-disable-next-line no-empty-pattern
    electronApp: [async ({}, use, workerInfo) => {
      const appLaunch = resolveTestHost(options);
      // From a checkout this fixture is built on demand, and a stale build tests the previous app
      assertCheckoutPackagesFresh();
      // Every worker gets a fresh data dir: no data, installed packs or onboarding state leak
      // between runs or from other packs, and nothing touches the developer's apack-test dir
      // E2E_DATA_DIR overrides that with one the caller owns and keeps, which is how `npm run dev:drive --`
      // runs against a profile whose state survives the session. An environment variable rather than a
      // `createTest` option because the `test` every spec imports is built at module scope with no
      // options, so an option could never reach it.
      const givenDataDir = process.env.E2E_DATA_DIR;
      const userDataDir = givenDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'apack-e2e-'));
      // Removed however the worker ends, including a failed pack build or launch
      try {
        if (process.env.PACK_DIR) {
          const packDir = path.resolve(process.env.PACK_DIR);
          const manifest = getPackManifest();
          if (!manifest) throw new Error(`No apack.json found in PACK_DIR: ${packDir}`);
          // PACK_ARCHIVE names a packed .tgz to install as it is, so a run can exercise the build a
          // release ships rather than another build of the same source. Everything else — the surface ids
          // the fixture waits for, the screenshot directory — still comes from PACK_DIR.
          const archive = process.env.PACK_ARCHIVE ? path.resolve(process.env.PACK_ARCHIVE) : undefined;
          const acceptArchive = archive ? packArchiveAcceptance(packDir, !!process.env.APACK_PACK_RELEASE) : undefined;
          if (!archive && process.env.APACK_PACK_PREBUILT) {
            // Reuse the caller's build without silently testing changed inputs or altered output.
            assertPrebuiltPackCurrent(packDir, !!process.env.APACK_PACK_RELEASE);
          } else if (!archive) {
            // Always rebuild: installing an existing dist would silently test stale code
            const apackBin = resolveApackBin(appLaunch, packDir);
            // A release run tests what it ships: without this the rebuild below replaces the release
            // build with a development one, and the archive is cut from that.
            const buildArgs = process.env.APACK_PACK_RELEASE ? ['pack', 'build', '--release'] : ['pack', 'build'];
            console.log(`[pack] Building ${manifest.id} from ${packDir}${process.env.APACK_PACK_RELEASE ? ' (release)' : ''}...`);
            try {
              execFileSync(process.execPath, [apackBin, ...buildArgs], { cwd: packDir, stdio: 'pipe' });
            } catch (e: any) {
              const output = [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join('\n') || e.message;
              throw new Error(`Pack build failed for ${manifest.id}:\n${output}`);
            }
          }
          // Install through the same bundle path users get (stage → verify → place)
          const { packsDir } = resolveAppEnvironment({ env: 'test', userDataDir });
          console.log(`[pack] Installing ${manifest.id} from ${archive ?? packDir} into an isolated test data dir...`);
          // `hostVersion` is the launched app's own (its package.json), so this is that app's answer rather than a
          // second opinion. No `packFormat`: whether this app can read the pack's build is the app's to decide, and
          // it does, at boot, naming which side is older. Nothing here can tell — the CLI that runs the fixture
          // needn't be the app's, and inferring the app's format from a build it ships refuses good packs
          // whenever that build is the stale one. `waitForPackBackend` reports the app's verdict within 15s.
          await installPackFromLocal(archive ?? packDir, packsDir, {
            hostVersion: appVersion(appLaunch), accept: acceptArchive,
            beforePlace: installed => {
              if (installed.id !== manifest.id) throw new Error(`Expected pack ${manifest.id}, received ${installed.id}`);
            },
          });
        }

        // A checkout runs its sources with its own electron, so packs don't need electron installed
        const launch = appLaunch.kind === 'source'
          ? {
            executablePath: createRequire(path.join(appLaunch.root, 'package.json'))('electron') as unknown as string,
            args: [path.join(appLaunch.root, '.')],
            cwd: appLaunch.root,
          }
          : { executablePath: appLaunch.executable, args: [] };

        const monotonicStart = performance.now();
        reportLaunchPhase('requested', monotonicStart);
        const app = await _electron.launch({
          ...launch,
          env: appLaunchEnv(process.env, userDataDir),
        });

        launchMonotonicStart.set(app, monotonicStart);
        reportLaunchPhase('process-attached', monotonicStart, app.process().pid);
        userDataDirs.set(app, userDataDir);
        captureOutput(app, appLogPath(workerInfo));
        const quitSequence = await watchQuitSequence(app);
        if (process.env.DEBUG_E2E) {
          app.process().once('exit', (code, signal) => console.log('[e2e shutdown] process exited', { code, signal }));
          app.once('close', () => console.log('[e2e shutdown] Playwright application closed'));
          if (process.env.DEBUG_E2E !== 'shutdown') await app.evaluate(({ app, BrowserWindow }) => {
            const observe = (window: Electron.BrowserWindow) => {
              const id = window.id;
              window.on('close', () => console.log('[e2e shutdown] window closing', id));
              window.on('closed', () => console.log('[e2e shutdown] window closed', id));
            };
            BrowserWindow.getAllWindows().forEach(observe);
            app.on('browser-window-created', (_event, window) => observe(window));
            app.on('before-quit', () => console.log('[e2e shutdown] before-quit'));
            app.on('will-quit', () => console.log('[e2e shutdown] will-quit'));
            app.on('quit', () => console.log('[e2e shutdown] quit'));
          });
          if (process.env.DEBUG_E2E !== 'shutdown') {
            app.process().stdout?.on('data', (data: Buffer) => {
              process.stdout.write(`[electron] ${data}`);
            });
            app.process().stderr?.on('data', (data: Buffer) => {
              process.stderr.write(`[electron] ${data}`);
            });
          }
        }

        await use(app);
        const apiPid = apiPidOf(app);
        if (process.env.DEBUG_E2E) console.log('[e2e shutdown] calling close');
        const inspectShutdown = process.env.DEBUG_E2E ? setTimeout(() => {
          console.log('[e2e shutdown] still waiting', {
            pid: app.process().pid,
            exitCode: app.process().exitCode,
            signalCode: app.process().signalCode,
            stdoutEnded: app.process().stdout?.readableEnded,
            stderrEnded: app.process().stderr?.readableEnded,
            windows: app.windows().map(page => ({ closed: page.isClosed() })),
          });
          const pid = app.process().pid;
          if (process.env.DEBUG_E2E === 'sample' && process.platform === 'darwin' && pid && app.process().exitCode === null) {
            const output = `${appLogPath(workerInfo)}.shutdown.sample.txt`;
            execFile('/usr/bin/sample', [String(pid), '2', '-file', output], { timeout: 10_000 }, error => {
              console.log('[e2e shutdown] sample', error ? error.message : output);
            });
          }
        }, 5000) : undefined;
        try {
          const closing = app.close();
          // A data dir this fixture made is deleted below, so Chromium writing its profile is work nobody reads;
          // a dir the caller gave is relaunched on, so its profile is waited for. A quit sequence that never
          // finishes still hangs here, into the worker's teardown timeout, without the line below.
          if (givenDataDir === undefined) {
            await quitSequence.done;
            if (app.process().exitCode === null && app.process().signalCode === null) {
              console.log('[e2e] quit sequence finished; ending Electron without its profile writes');
              app.process().kill('SIGKILL');
            }
          }
          await closing;
        } finally { clearTimeout(inspectShutdown); }
        // Electron close must include its API child; otherwise deleting storage races the final writes.
        if (apiPid !== undefined) {
          let alive = true;
          try {
            process.kill(apiPid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
            alive = false;
          }
          if (alive) throw new Error(`Electron closed while API process ${apiPid} was still alive`);
        }
        if (process.env.DEBUG_E2E) console.log('[e2e shutdown] close resolved');
      } finally {
        // A dir the caller gave is the caller's to remove; this owns only the one it made
        if (givenDataDir !== undefined) {
          console.log(`[e2e] left the data dir it was given: ${userDataDir}`);
        } else if (process.env.E2E_KEEP_DATA) {
          console.log(`[e2e] kept test data dir: ${userDataDir}`);
        } else {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      }
    }, { scope: 'worker' }],

    appPage: async ({ electronApp }, use, testInfo) => {
      const page = await findMainWindow(electronApp);
      reportLaunchPhase('application-state-present', applicationLaunchStartedAt(electronApp), electronApp.process().pid);
      // Deterministic for a suite, and the window's own size for a run someone is watching — see `pinsViewport`
      if (pinsViewport(process.env)) await page.setViewportSize(E2E_VIEWPORT);

      reportLaunchPhase('viewport-ready', applicationLaunchStartedAt(electronApp), electronApp.process().pid);
      const rendererErrors: string[] = [];
      let rejectPackFeFailed: (err: Error) => void = () => {};
      const packFeFailed = new Promise<never>((_, reject) => { rejectPackFeFailed = reject; });
      packFeFailed.catch(() => {}); // only observed while waiting for pack surfaces
      const onPageError = (error: Error) => {
        console.error('[page error]', error);
        rendererErrors.push(`[page error] ${error.stack ?? error.message}`);
      };
      const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
        if (msg.type() === 'error') {
          console.error(`[console.error] ${msg.text()}`);
          rendererErrors.push(`[console.error] ${msg.text()}`);
          // Only the pack under test fails fast; other installed packs' errors are just reported
          const packId = getPackManifest()?.id;
          if (packId && msg.text().includes(`[pack-loader] Failed to load FE entry pack://${packId}/`)) {
            rejectPackFeFailed(describeFailure('Pack FE failed to load', electronApp, rendererErrors));
          }
        }
      };
      page.on('pageerror', onPageError);
      page.on('console', onConsole);

      const waitOrDescribe = async (what: string, wait: Promise<unknown>) => {
        try {
          await wait;
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('Pack FE failed to load')) throw err;
          throw describeFailure(`${what}: ${(err as Error).message.split('\n')[0]}`, electronApp, rendererErrors);
        }
      };

      await waitOrDescribe('App did not reach connected state', waitForAppReady(page));

      reportLaunchPhase('connected', applicationLaunchStartedAt(electronApp), electronApp.process().pid);

      /**
       * Every send the bus dropped during the test, collected from the app's own SYSTEM_ERROR events.
       *
       * A send to a surface nobody declares is the failure the outgoing check exists to catch, and it is
       * reported quietly (`diagnostic`, so it raises no toast) — which means without this it would sit
       * in the log and fail nothing. `takeSystemErrors()` does the same job for unit tests; this is its
       * counterpart for a running app.
       */
      await page.evaluate(() => {
        const win = window as any;
        if (win.__droppedSends) return;
        win.__droppedSends = [];
        win.applicationState?.system?.inspect?.((inspection: any) => {
          const event = inspection?.event;
          if (inspection?.type !== '@xstate.event' || event?.type !== 'SYSTEM_ERROR') return;
          if (event.operation === 'broadcastToSurface') win.__droppedSends.push(String(event.message ?? ''));
        });
      });

      if (process.env.PACK_DIR) {
        const manifest = getPackManifest();
        // Applying runs before the backend accepts connections, so its outcome is final by now
        const applyError = manifest && readPackLastError(manifest.id, userDataDirs.get(electronApp)!);
        if (applyError) {
          throw describeFailure(`Pack ${manifest!.id} failed to apply its content:\n${applyError}`, electronApp, rendererErrors);
        }
        if (manifest) await waitForPackBackend(electronApp, manifest.id);
        if (manifest && manifest.surfaceIds.length > 0) {
          for (const surfaceId of manifest.surfaceIds) {
            // Fail on the captured loader error as soon as it appears instead of timing out later
            await waitOrDescribe(`Pack surface "${surfaceId}" did not load within 30s`, Promise.race([
              packFeFailed,
              page.waitForFunction((id) => {
                const snap = (window as any).applicationState?.getSnapshot();
                return snap?.context?.surfaces?.some((p: any) => p.id === id);
              }, surfaceId, { timeout: 30_000 }),
            ]));
          }
        }
      }

      const apiPidAtStart = apiPidOf(electronApp);
      await use(page);

      // An API that restarted under a failing test is the cause to name: the window reconnects, the shell replaces
      // every surface's actor, and whatever their components held (typed text among it) is reset — so the failure
      // describes that restart rather than the code under test. A test that passed through one is left alone.
      const apiPidAtEnd = apiPidOf(electronApp);
      if (testInfo.status !== testInfo.expectedStatus && apiPidAtStart !== undefined && apiPidAtEnd !== apiPidAtStart) {
        const description = `The app's API restarted during this test (pid ${apiPidAtStart} → ${apiPidAtEnd ?? 'none'}). `
          + 'A reconnect replaces every surface\'s actor, which resets what its components held; see '
          + (appLogs.get(electronApp) ?? 'the app output') + ' for why the API exited.';
        testInfo.annotations.push({ type: 'api-restarted', description });
        console.error(`[e2e] ${description}`);
      }

      page.removeListener('pageerror', onPageError);
      page.removeListener('console', onConsole);

      // Read after the test rather than during it, so a drop fails the test that caused it. A page that
      // navigated away loses the collector, which is a miss rather than a false alarm.
      const dropped: string[] = await page.evaluate(() => (window as any).__droppedSends ?? []).catch(() => []);
      if (dropped.length > 0) {
        throw describeFailure(
          `The bus dropped ${dropped.length} send(s) to surfaces during this test:\n  ${[...new Set(dropped)].join('\n  ')}`,
          electronApp,
          rendererErrors,
        );
      }
    },

    app: async ({ appPage: page }, use) => {
      await use(createAppDriver(page, screenshotDir));
    },
  });

  return { test, expect: base.expect };
}

// Direct exports — the app comes from `apack pack test` (APACK_HOST_EXECUTABLE / APACK_HOST_ROOT) or the enclosing monorepo
const _default = createTest();
export const test = _default.test;

/**
 * The same runner under a name that says what a driving script is, for `npm run dev:drive --`. A driving script
 * asserts nothing and nothing gates on it, so calling it `test` was the whole confusion; Playwright
 * discovers work from the calls made at import rather than from the binding's name, so the alias costs
 * nothing and reporters and `--grep` still match titles.
 */
export const drive = _default.test;

/**
 * A session over the app something else is holding, which is how a question is asked of it.
 *
 * Re-exported here rather than from an entry of its own: a driving script already imports `drive` from
 * this module, and a session is the same job done one question at a time. `src/engine/` has the detail.
 */
export { type EngineWindow } from './engine/index.ts';
export { attachToApp, findWindow, type AttachedApp, type AttachOptions, type AttachTargets } from './engine/cdp-page.ts';
export { attachedSession, type AttachedSession, type AttachedSessionOptions } from './engine/index.ts';
