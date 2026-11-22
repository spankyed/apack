/**
 * Restarts the API when its bundle is rebuilt, so a host, SDK or API edit costs a reload rather than a
 * manual build and a restarted app.
 *
 * `npm run dev` leaves `tsup --watch` on the bundle; an edit to `packages/server/src`, `@apackdev/host/src` or
 * `@apackdev/sdk/src` rewrites `dist/server.js`, and this asks `ApiServer` to replace the child. Measured
 * 2026-10-10: ~95ms to rebuild, 545ms for the API to come back ready. The window never closes.
 *
 * **The bundle is the trigger because nothing else can be.** Main owns the API child, so the restart has
 * to happen here, and nothing outside an Electron window can reach main — no socket, port or IPC. A write
 * is also the honest signal: it says the thing that would be loaded has changed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppModule } from '../../AppModule.ts';
import type { ApiServer } from './ApiServer.ts';
import { getApiPaths } from './config.ts';
import { getAppEnvironment } from '../../app-environment.ts';
import { logInfo, logError } from './logger.ts';

/** The variable `npm run dev` sets on the Electron it spawns. */
export const DEV_RELOAD_ENV = 'APACK_DEV_RELOAD';

/** A rebuild writes several files; without this the API restarts two or three times per edit. */
const DEBOUNCE_MS = 300;

/**
 * Whether this app watches its API bundle — **the build and the launcher, and neither alone.**
 *
 * `development` is true of `apack pack dev` and of a bare `electron .` as well, so it cannot be the whole
 * condition: the loop belongs to the run that is building the bundle. And the variable cannot be either,
 * or a stray export would arm a watcher in a packaged app or a `test` run, whose API restarting underneath
 * it would be a strange thing to debug.
 */
export function devReloadArmed(build: string, env: NodeJS.ProcessEnv): boolean {
  return build === 'development' && env[DEV_RELOAD_ENV] === '1';
}

/**
 * Runs `work` after `delayMs` of quiet, and never drops a request that arrives while it is running.
 *
 * A busy flag that returned would lose that request, leaving the author looking at an app built from the
 * file before the one they saved with nothing reporting anything wrong. `@apackdev/cli` has this
 * (`build/watch.ts`'s `coalescingRunner`) and cannot be imported from: that package publishes no exports
 * map, being a bin.
 */
export function coalescing(work: () => Promise<void>, delayMs: number = DEBOUNCE_MS): { request: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;

  const drain = async (): Promise<void> => {
    running = true;
    try {
      // Cleared before the run, not after: a request arriving during it is for the next one
      do { pending = false; await work(); } while (pending);
    } finally {
      running = false;
    }
  };

  return {
    request() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (running) pending = true;
        else void drain();
      }, delayMs);
    },
  };
}

export function createDevApiReloader(apiServer: Pick<ApiServer, 'reloadApiServer'>): AppModule {
  return {
    enable() {
      if (!devReloadArmed(getAppEnvironment().env, process.env)) return;

      const paths = getApiPaths();
      // `serverFile` is relative to `apiPath`, as `launchApiServer` spawns it
      const bundle = path.join(paths.apiPath, paths.serverFile);

      const runner = coalescing(async () => {
        logInfo('[MAIN] API bundle changed — reloading the API');
        // Reported, never thrown: a failed reload must not end the loop, because the next edit is the
        // author fixing whatever broke it
        await apiServer.reloadApiServer().catch((error: unknown) => logError('[MAIN] API reload failed:', error));
      });

      try {
        fs.watch(bundle, () => runner.request());
        logInfo(`[MAIN] Watching ${bundle} — an API rebuild reloads the API`);
      } catch (error) {
        // An app that runs without the loop beats one that refuses to start because of it
        logError('[MAIN] Not watching the API bundle, so rebuilds will not reload it:', error);
      }
    },
  };
}
