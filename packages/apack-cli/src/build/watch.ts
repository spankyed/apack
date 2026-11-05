import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPackBuilder, type PackBuilder } from './build-process.ts';
import { withBuildSignals } from './build-signals.ts';
import { readValidManifest } from '../utils.ts';
import { isPackInputPath, packInputWatchTargets, packInputsHash } from '@apackdev/host/build/pack-inputs';
import { reloadPack, type AppPlace, type DevDelivery } from '../app/app-api.ts';
import { compilerWatchPaths, createCompilerWatchTools, compilerWatchTargets, createCompilerWatchMatcher, mergeCompilerWatchPaths, additionalCompilerObservations, packageInputWatchPaths, type CompilerWatchPaths } from './compiler-watch.ts';
import { checkoutBuildUnits } from './checkout-packages.ts';
import { cliPackageDirectory } from './tool-identity.ts';
import { createFrontendWatcher, type FrontendInputSnapshot } from './frontend-watch.ts';
import { createInputSubscriptions, type InputSubscription } from './input-subscriptions.ts';
import type { BuildWatchInputs } from './build-watch-inputs.ts';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { readPackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { assertNativeCompilerObservations, type CompilerInputObservations } from '@apackdev/host/build/compiler-inputs';

const DEBOUNCE_MS = 300;

export interface WatchOptions {
  readonly signal?: AbortSignal;
  readonly place?: AppPlace;
  /** Initial verified publication is ready for an app to boot against. */
  readonly onFirstBuild?: () => void;
  /**
   * Runs after each verified publication. Returning an outcome means it delivered the build to the app
   * itself (installed and started it, or restarted the app), so the watcher asks for no reload.
   */
  readonly onBuilt?: () => Promise<DevDelivery | void>;
  /** A dev session owns its shared compiler; standalone watchers own their builder. */
  readonly builder?: Pick<PackBuilder, 'build' | 'ensurePackages' | 'subscribeFrontendInputs' | 'isFrontendCurrent'>;
  readonly buildArgs?: readonly string[];
}

/**
 * One run at a time, and never a lost request.
 *
 * Two things a watcher has to get right, and they pull in opposite directions. Edits arrive in bursts — a
 * formatter saving a file writes it more than once — so a request **debounces**, and the run happens once
 * the edits stop. But a bundle takes time, and an edit landing while one is in flight is the most ordinary
 * thing there is: a `return` on a busy flag loses it, and the author is then looking at an app built from
 * the file before the one they just saved, with the loop reporting nothing wrong.
 *
 * So a request that arrives mid-run is remembered and taken when that run finishes, and several of them
 * collapse into one further run rather than a queue of them. A failed run is no different: the request that
 * came in while it was failing is the author fixing the error.
 *
 * `run` is awaited and must not throw — `rebuild` reports instead, so that a syntax error doesn't end the
 * loop.
 */
export function coalescingRunner(run: () => Promise<void>, delayMs: number = DEBOUNCE_MS): { request: () => void; close: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let closed = false;
  let active: Promise<void> | undefined;

  async function drain(): Promise<void> {
    running = true;
    try {
      // Cleared before the run, not after: a request that arrives during it is for the next one
      do { pending = false; await run(); } while (pending && !closed);
    } finally {
      running = false;
    }
  }

  return {
    close() { closed = true; pending = false; if (timer) clearTimeout(timer); return active ?? Promise.resolve(); },
    request() {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (running) { pending = true; return; }
        active = drain();
      }, delayMs);
    },
  };
}

/**
 * An edit that moves what the pack builds against publishes one complete build; an edit that moves only a package
 * the pack doesn't build against refreshes that package's `dist` and publishes nothing. done reports terminal failure
 * after cleanup; close drains disposal.
 */
export async function startPackBuildWatcher(root: string, options: WatchOptions = {}): Promise<{ close: () => Promise<void>; readonly done: Promise<void> }> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  const packId = readValidManifest(root).id;
  const ownedBuilder = options.builder ? undefined : createPackBuilder(root);
  const builder = options.builder ?? ownedBuilder!;
  let closed = false;
  let stopping: Promise<void> | undefined;
  let failure: Error | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Startup may fail before the caller receives the handle; done still reports the same failure later.
  void done.catch(() => {});
  let ready = false;
  let pending = false;
  let lastChange = '';
  const tools = createCompilerWatchTools(root);
  let compilerPaths: CompilerWatchPaths = new Map();
  let observedPaths: CompilerWatchPaths = new Map();
  let frontendPaths: CompilerWatchPaths = new Map();
  let unsubscribe: (() => void) | undefined;
  let acceptedObservations: CompilerInputObservations | undefined;
  const observedInputsCurrent = () => {
    if (!acceptedObservations) return true;
    try { assertNativeCompilerObservations(acceptedObservations); return true; }
    catch { return false; }
  };
  let matchesCompilerInput = createCompilerWatchMatcher(compilerPaths);
  let compilerSignature: string | undefined;
  let authoredSignature: string | undefined;
  let frontendSignature: string | undefined;
  const invalidateInputs = () => {
    compilerSignature = undefined;
    authoredSignature = undefined;
    frontendSignature = undefined;
  };
  const dataDirectory = options.place?.userDataDir ?? (options.place ? resolveAppEnvironment(options.place).userDataDir : undefined);
  const frontend = createFrontendWatcher(root, dataDirectory,
    file => request(path.relative(root, file)), fail, checkoutBuildUnits([root, cliPackageDirectory()]).flatMap(unit => unit.outputs), recheck);
  const publish = async (): Promise<boolean> => {
    // First, so the signature below already includes what this rewrites and the build isn't followed by a second
    await builder.ensurePackages();
    signal.throwIfAborted();
    const compiler = refreshInputs();
    const authored = packInputsHash(root) + JSON.stringify(compiler.authored);
    const beforeFrontend = frontend.snapshot();
    if (compiler.signature === compilerSignature && authored === authoredSignature && beforeFrontend.hash === frontendSignature
      && observedInputsCurrent() && await builder.isFrontendCurrent(signal)) return false;
    compilerSignature = compiler.signature;
    authoredSignature = authored;
    frontendSignature = beforeFrontend.hash;
    if (readValidManifest(root).id !== packId) throw new Error('Pack identity changed; restart the development session');
    let reported: { inputs: BuildWatchInputs; snapshot: FrontendInputSnapshot } | undefined;
    let observed: CompilerWatchPaths = new Map();
    let nativeReported = false;
    try {
      await builder.build({ args: options.buildArgs, signal, packagesEnsured: true, onInputs: async inputs => {
        if (inputs.probes) { nativeReported = true; observed = mergeCompilerWatchPaths(observed, new Map(inputs.probes)); return; }
        reported = { inputs, snapshot: await frontend.observe(inputs) };
      } });
      if (closed) return false;
      acceptedObservations = nativeReported ? additionalCompilerObservations({
        root: fs.realpathSync(root), entries: readPackBuildInputs(path.join(root, 'dist')).observations,
      }, observed, compiler.staticPaths) : undefined;
      observedPaths = observed;
    } catch (error) {
      // Failed workers can discover absent inputs. Subscribe before waiting for their repair.
      if (!closed) {
        observedPaths = mergeCompilerWatchPaths(observedPaths, observed);
        refreshInputs();
      }
      throw error;
    }
    if (closed) return false;
    const accepted = reported?.inputs.successful ? reported.inputs : { files: [], directories: [], successful: true };
    await frontend.accept(accepted);
    if (closed) return false;
    const frontendChanged = !beforeFrontend.current() || (reported && !reported.snapshot.current());
    frontendSignature = frontendChanged ? beforeFrontend.hash : reported?.snapshot.hash ?? frontend.snapshot().hash;
    // Close the discovery/subscription window before retaining the initial tooling inventory.
    if (!ready) tools.changed(undefined, 'rename');
    const after = refreshInputs(true);
    if (frontendChanged || !observedInputsCurrent() || after.signature !== compiler.signature || packInputsHash(root) + JSON.stringify(after.authored) !== authored) {
      request('inputs changed during the build');
    }
    return true;
  };
  const runs = coalescingRunner(async () => {
    if (closed) return;
    const changed = lastChange;
    try {
      if (!await publish()) return;
      if (closed) return;
      const delivered = await options.onBuilt?.();
      if (closed) return;
      const outcome = delivered ?? await reloadPack(packId, options.place);
      if (outcome.status === 'delivered') console.log(`[watch] ${changed} — delivered to the app`);
      else if (outcome.status === 'current') console.log(`[watch] ${changed} — built; the backend is unchanged`);
      else {
        if (outcome.status === 'failed' || outcome.status === 'unreachable') invalidateInputs();
        console.warn(`[watch] ${changed} — built, but the app did not reload (${outcome.detail})`);
      }
    } catch (error) {
      // A failed build/install/reload must not suppress a later save with identical inputs.
      invalidateInputs();
      if (!closed) console.error(`[watch] Build/reload failed: ${String(error)}`);
    }
  });
  const request = (relative: string) => {
    if (closed) return;
    lastChange = relative;
    if (ready) runs.request();
    else pending = true;
  };
  // A change to what is held may have lost events on every watch, so one more pass compares the inputs themselves.
  // That pass holds the same set and so ends here, whatever it finds.
  function recheck() {
    if (closed) return;
    if (ready) runs.request();
    else pending = true;
  }
  const inputs = createInputSubscriptions((directory, error) => {
    const refused = new Error(`Cannot watch pack input "${directory}": ${String(error)}`, { cause: error });
    fail(refused);
    return refused;
  });
  const rootSubscription: InputSubscription = {
    key: 'root', directory: root, recursive: true,
    // The authored root stays subscribed across replacement of linked/compiler inputs.
    receive(event, filename) {
      if (closed) return;
      tools.changed(filename ? path.resolve(root, filename) : undefined, event);
      if (!filename || isPackInputPath(filename)) request(filename ?? 'authored inputs');
      else if (matchesCompilerInput(path.resolve(root, filename), event)) request(filename);
    },
  };
  function refreshInputs(replace = false) {
    const compiler = compilerWatchPaths(root, tools, mergeCompilerWatchPaths(mergeCompilerWatchPaths(observedPaths, frontendPaths),
      packageInputWatchPaths(checkoutBuildUnits([root, cliPackageDirectory()]))));
    const paths = replace && compiler.complete ? compiler.paths : mergeCompilerWatchPaths(compilerPaths, compiler.paths);
    const authored = packInputWatchTargets(root);
    const wanted: InputSubscription[] = [rootSubscription];
    for (const target of authored.slice(1)) {
      wanted.push({
        key: `authored:${target.directory}:${target.child ?? ''}`, directory: target.directory, recursive: true,
        receive(_event, filename) {
          if (closed || (target.child && filename && filename !== target.child)) return;
          const relative = target.child ? target.relative : path.join(target.relative, filename ?? '');
          if (isPackInputPath(relative)) request(relative);
        },
      });
    }
    for (const [directory, target] of compilerWatchTargets(paths, root)) {
      const matches = createCompilerWatchMatcher(target.paths);
      wanted.push({
        key: `compiler:${directory}:${target.recursive}`, directory, recursive: target.recursive,
        receive(event, filename) {
          if (closed || (filename && !matches(path.resolve(directory, filename), event))) return;
          tools.changed(filename ? path.resolve(directory, filename) : undefined, event);
          request(path.relative(root, path.resolve(directory, filename ?? '')));
        },
      });
    }
    if (inputs.hold(wanted)) recheck();
    compilerPaths = paths;
    matchesCompilerInput = createCompilerWatchMatcher(paths);
    return { ...compiler, authored };
  }
  const close = () => {
    if (!stopping) {
      signal.removeEventListener('abort', abort);
      closed = true;
      const cleanup: Array<() => unknown> = [
        () => inputs.close(),
        () => unsubscribe?.(), () => frontend.close(), () => runs.close(), () => ownedBuilder?.close(),
      ];
      stopping = Promise.allSettled(cleanup.map(stop => Promise.resolve().then(stop))).then(results => {
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Could not close pack watcher');
      });
      void stopping.then(() => failure ? rejectDone(failure) : resolveDone(), error => rejectDone(failure
        ? new AggregateError([failure, error], failure.message, { cause: failure }) : error));
      controller.abort(failure);
    }
    return stopping;
  };
  function fail(error: Error) {
    if (closed) return;
    failure = error;
    void close().catch(() => {});
  }
  // Startup and the returned close promise report cleanup errors to the owner.
  const abort = () => { void close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    inputs.hold([rootSubscription]);
    unsubscribe = builder.subscribeFrontendInputs(({ paths, changed }) => {
      if (closed) return;
      if (paths.size !== frontendPaths.size || [...paths].some(([file, kind]) => frontendPaths.get(file) !== kind)) {
        frontendPaths = paths;
        try { refreshInputs(true); }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error), { cause: error })); return; }
      }
      if (changed) request('frontend compiler inputs discovered');
    });
    await publish();
    signal.throwIfAborted();
    options.onFirstBuild?.();
    ready = true;
    if (pending) runs.request();
    console.log('[watch] Watching build inputs; each successful build publishes verified dist/');
    return { close, done };
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error), { cause: error });
    try { await close(); }
    catch (cleanup) { throw new AggregateError([failure, cleanup], failure.message, { cause: failure }); }
    throw failure;
  }
}

export async function watchPackBuild(root: string, options: WatchOptions = {}): Promise<void> {
  await withBuildSignals(async stoppedByProcess => {
    const signal = options.signal ? AbortSignal.any([options.signal, stoppedByProcess]) : stoppedByProcess;
    let watcher: Awaited<ReturnType<typeof startPackBuildWatcher>> | undefined;
    try {
      watcher = await startPackBuildWatcher(root, { ...options, signal });
      await watcher.done;
    } finally {
      await watcher?.close();
    }
    signal.throwIfAborted();
  });
}
