import {app} from 'electron';
import * as path from 'node:path';
import {readFileSync} from 'node:fs';
import {packagedShippedPacksDir} from '@apackdev/host/packs/assets';
import {_inferElectronAppEnv, resolveAppEnvironment, type AppEnvironment} from '@apackdev/sdk/env';

/** The app's environment and paths, plus the log directory only this process can resolve. */
export interface MainAppEnvironment extends AppEnvironment {
  /**
   * Where this run's log files go: the platform's log directory, or one inside the data dir when the run
   * was pointed at its own. Resolved here because only this process can ask the platform, and read from
   * here by everything that writes or names a log file — electron-log, the API process, the IPC that
   * opens the log file — so none of them decides it for itself.
   */
  logsDir: string;
}

let environment: MainAppEnvironment | null = null;

/**
 * Decides the app environment, points Electron at its data and log directories, and answers with both.
 *
 * Initialised on first use rather than by a call that has to come first. `logger.ts` imports this module
 * and asks for the environment while it configures electron-log, so the module graph is what puts this before
 * any log write — an ordering a comment asks for is an ordering the next import silently breaks. It once
 * did: electron-log fixed its directory at import and every run's logs went to the same place.
 */
function initialise(): MainAppEnvironment {
  const channel = app.isPackaged
    ? JSON.parse(readFileSync(path.join(app.getAppPath(), 'build-manifest.json'), 'utf8')).channel
    : '';
  const env = _inferElectronAppEnv({
    playwrightTest: process.env.PLAYWRIGHT_TEST === 'true',
    isPackaged: app.isPackaged,
    channel,
    envVar: process.env.APACK_ENV,
  });
  // Read before the assignment below, so this is the caller's choice and not the one made here
  const isolated = Boolean(process.env.APACK_USER_DATA_DIR);
  const resolved = resolveAppEnvironment({ env });

  // Electron derives its userData dir and single-instance lock from these
  app.setName(resolved.appName);
  app.setPath('userData', resolved.userDataDir);

  // The platform's own answer for a normal run — on macOS that is ~/Library/Logs/<app>, which is where
  // Console.app looks. A run given its own data dir keeps its logs there instead, so that one Playwright
  // worker's logs are not another's.
  const logsDir = isolated ? path.join(resolved.appDir, 'logs') : app.getPath('logs');
  app.setPath('logs', logsDir);

  process.env.APACK_ENV = resolved.env;
  process.env.APACK_USER_DATA_DIR = resolved.userDataDir;
  return {...resolved, logsDir};
}

/** The server installs offered packs from here before it starts their runtimes. */
export function shippedPacksDir(): string {
  const appDir = app.getAppPath();
  return app.isPackaged ? packagedShippedPacksDir(appDir) : path.join(appDir, 'packages');
}

/** Decides the app environment if it hasn't been decided yet. Idempotent; `getAppEnvironment()` does the same. */
export function initAppEnvironment(): MainAppEnvironment {
  return getAppEnvironment();
}

export function getAppEnvironment(): MainAppEnvironment {
  return (environment ??= initialise());
}
