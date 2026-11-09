/**
 * App environment resolution — the only place that decides which environment a process
 * belongs to and where its data lives.
 *
 * The Electron main process infers the environment once (_inferElectronAppEnv) and hands
 * APACK_ENV + APACK_USER_DATA_DIR to everything it spawns. Every other process either
 * receives those or passes { env } explicitly (CLI commands). Nothing falls back to
 * production: an unknown environment is an error, not a guess.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { boundHost } from '../runtime/host-runtime.ts';

/**
 * The environments, and the type of one.
 *
 * The list is the declaration and the union is derived from it, rather than the two being written side by side:
 * `APP_ENVS: readonly AppEnv[]` accepted a list missing a member, and the one thing that reads it is the guard
 * below — so an environment left out of the array would be rejected at startup as invalid.
 */
export const APP_ENVS = ['production', 'beta', 'preview', 'development', 'test'] as const;

export type AppEnv = (typeof APP_ENVS)[number];


/** Channels recorded in a packaged build manifest. */
export type AppChannel = Extract<AppEnv, 'production' | 'beta' | 'preview'>;

/** The app's own directory inside Electron's `userData`. See `AppEnvironment.appDir`. */
const APP_DIR = 'apack';

const APP_NAMES: Record<AppEnv, string> = {
  production: 'apack',
  beta: 'apack-beta',
  preview: 'apack-preview',
  development: 'apack-dev',
  test: 'apack-test',
};

export interface AppEnvironment {
  /** Runtime environment; independent of the selected data directory */
  env: AppEnv;
  /** Electron app name; also the default data dir name. */
  appName: string;
  /**
   * Electron's `userData` directory. Chromium owns its root — `Cache/`, `Preferences`, `Partitions/` and a
   * dozen more names that change with Electron — so nothing of the app's is written directly in it.
   */
  userDataDir: string;
  /**
   * Everything the app owns, inside `userDataDir`. One directory per stack: the database, the run history,
   * installed packs, their build output, secrets, logs and locks, and each pack's own data under
   * `pack-data/<packId>/`.
   *
   * It exists because the data dir stopped being just a database. Sharing a flat namespace with Chromium
   * meant a pack asking for `getDataDirPath('Cache')` could shadow Chromium's, and an app that writes
   * sixteen names into someone else's directory cannot say which files are its own — which is what a
   * backup, an instance and `apack db` all need to know.
   */
  appDir: string;
  packsDir: string;
  /** Build output (types/, build/) of the app's built-in packs, for pack authors' dependency resolution. */
  installedPacksFile: string;
  /** Where a running API publishes its port and process id, so local tools find it (`@apackdev/host/process-liveness`) */
  apiPortFile: string;
  /** A development app's API token, for local tools calling its API (written by the API, readable only by the user) */
  apiTokenFile: string;
  urlScheme: string;
}

export function parseAppEnv(value: string | undefined): AppEnv | undefined {
  if (value === undefined || value === '') return undefined;
  if ((APP_ENVS as readonly string[]).includes(value)) return value as AppEnv;
  throw new Error(`Invalid app environment "${value}". Expected one of: ${APP_ENVS.join(', ')}`);
}

function platformDataDir(appName: string): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', appName);
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), appName);
  }
}

/**
 * Resolve environment and data paths. Explicit input wins, then APACK_ENV /
 * APACK_USER_DATA_DIR. Throws when the environment can't be determined.
 */
/**
 * Where an environment's app keeps its data on this machine, whatever `APACK_USER_DATA_DIR` says: the dir a tool
 * means when it names an app (`apack db --profile development`), rather than the one a shell happens to point at.
 */
export function appDataDirFor(env: AppEnv): string {
  return platformDataDir(APP_NAMES[env]);
}

/**
 * The one directory the app owns inside a data dir. Taken as a function as well as an `AppEnvironment` member
 * because host code is often handed a data dir rather than a context — a lock file, a dev-server marker.
 *
 * @internal Host-only: a pack reaches its own directory through `getDataDirPath` (`#generated/paths`).
 */
export const _appDirOf = (userDataDir: string): string => path.join(userDataDir, APP_DIR);

/**
 * Resolve runtime identity and storage independently. Explicit inputs override the parent's
 * APACK_ENV and APACK_USER_DATA_DIR handoffs; omitted storage uses the environment's default.
 */
export function resolveAppEnvironment(input: { env?: AppEnv; userDataDir?: string } = {}): AppEnvironment {
  const env = input.env ?? parseAppEnv(process.env.APACK_ENV);
  if (!env) {
    throw new Error(
      `App environment unknown: pass { env } or set APACK_ENV (${APP_ENVS.join(' | ')}). ` +
      'Processes spawned by the app receive it automatically.',
    );
  }
  const appName = APP_NAMES[env];
  const userDataDir = input.userDataDir ?? (process.env.APACK_USER_DATA_DIR || platformDataDir(appName));
  const appDir = _appDirOf(userDataDir);
  return {
    env,
    appName,
    userDataDir,
    appDir,
    packsDir: path.join(appDir, 'packs'),
    installedPacksFile: path.join(appDir, 'installed-packs.json'),
    apiPortFile: path.join(appDir, 'api-port'),
    apiTokenFile: path.join(appDir, 'api-token'),
    urlScheme: env === 'beta' ? 'apack-beta' : env === 'preview' ? 'apack-preview' : 'apack',
  };
}

/**
 * The Electron main process's inference, kept pure for testing:
 * 1. Playwright → test
 * 2. Packaged → the channel stamped at build time (a missing stamp is a broken build)
 * 3. Unpackaged → APACK_ENV if set, otherwise development
 *
 * @internal Host-only: the Electron main process infers its environment.
 */
export function _inferElectronAppEnv(input: {
  playwrightTest: boolean;
  isPackaged: boolean;
  channel: string;
  envVar: string | undefined;
}): AppEnv {
  if (input.playwrightTest) return 'test';

  if (input.isPackaged) {
    if (input.channel !== 'production' && input.channel !== 'beta' && input.channel !== 'preview') {
      throw new Error(
        `Packaged build has no valid release channel stamp (got "${input.channel}"). ` +
        'Build with build/build.sh (production|beta) or npm run build:preview (preview).',
      );
    }
    return input.channel;
  }

  return parseAppEnv(input.envVar) ?? 'development';
}

/** The running app's version (the test host's is `0.0.0-test`); throws, naming bindHost, when no app is bound */
export function getAppVersion(): string {
  return boundHost().appVersion;
}

/**
 * The variables the app sets on a process it starts: its identity, its paths, its port and its token.
 *
 * The list is the declaration and {@link AppProcessEnv} is derived from it, so the construction that sets them
 * (`getEnvironment`, `@app/main`'s api-server module) cannot add one the list does not name and cannot omit one
 * it does — the record it builds is typed by this, and either direction fails the typecheck.
 *
 * That is what makes the strip at the other end safe. Everything the API starts inherits its environment —
 * the shell a terminal spawns and an agent child alike, and whatever either of them goes on to run — and
 * every name here is the app talking to itself: `ELECTRON_RUN_AS_NODE=1` breaks any Electron app launched
 * from there, `NODE_ENV=production` changes what an `npm install` does, `APACK_USER_DATA_DIR` and
 * `SHIPPED_PACKS_DIR` say where the user's data is, and the token is app-process-level access to it.
 */
export const APP_PROCESS_ENV_VARS = [
  'NODE_ENV',
  'API_PORT',
  'APACK_API_TOKEN',
  'APACK_STARTUP_ID',
  'APACK_LOG_DIR',
  'SHIPPED_PACKS_DIR',
  'APACK_ENV',
  'APACK_APP_MANIFEST',
  'APACK_USER_DATA_DIR',
  'ELECTRON_RUN_AS_NODE',
] as const;

/** A complete record of {@link APP_PROCESS_ENV_VARS}: what the app sets when it starts a process. */
export type AppProcessEnv = Record<(typeof APP_PROCESS_ENV_VARS)[number], string | undefined>;

/**
 * Dynamic-loader variables, which nothing the app spawns should inherit.
 *
 * They make a program load code chosen by whoever set them, so a process that inherits one hands it to
 * everything it runs. The app does not set `LD_PRELOAD`; it strips it because the API's own parent might
 * have, and because it sets `NODE_OPTIONS` itself for a source run — a user's shell inheriting
 * `--conditions=@apackdev/source` is this repo's own development setup leaking into their machine.
 */
export const BLOCKED_LOADER_VARS = [
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
] as const;

/**
 * `env` without the variables the app set on its own process, and without the loader variables above.
 *
 * **What the app spawns for the user must not inherit the app's identity.** A shell or an agent child that
 * inherits `ELECTRON_RUN_AS_NODE=1` breaks any Electron app launched from it; one that inherits
 * `APACK_USER_DATA_DIR` or `SHIPPED_PACKS_DIR` can be pointed at the user's data by anything it runs.
 *
 * **Derived, not written**, which is the whole point: `APP_PROCESS_ENV_VARS` is the same declaration the
 * construction that sets them is typed by, so a variable added there is stripped here without anyone
 * remembering to add it. A hand-written deny-list is the shape that rots, and this repo has the finding to
 * prove it.
 */
export function withoutAppProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const name of [...BLOCKED_LOADER_VARS, ...APP_PROCESS_ENV_VARS]) delete clean[name];
  return clean;
}
