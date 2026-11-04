import { COMPILER_INPUTS_ENV } from './compiler-installation-inputs.ts';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { spawnCompilerWorker } from './compiler-process.ts';
import { COMPILER_PROCESS_GROUP_ENV, stopCompilerProcessGroup } from './compiler-process-group.ts';
import { checkoutBuildUnits, checkoutFor, ensureCheckoutPackages } from './checkout-packages.ts';
import { packageBuildState } from '@apackdev/host/build/packages-built';
import { captureCompilerInstallation, compilerPackageDirectory, type CompilerInstallation } from './compiler-installation.ts';
import { cliPackageDirectory } from './tool-identity.ts';
import { compilationConditions } from './compilation-inputs.ts';
import { compilerStartupOptions, COMPILER_NODE_OPTIONS_ENV } from './compiler-startup-options.ts';
import { BUILD_INPUTS_IPC_ENV, readBuildWatchInputs, readCompilerWatchReports, type BuildWatchInputs } from './build-watch-inputs.ts';
import { holdPackBuildLock } from './build-lock.ts';
import { readValidManifest } from '../utils.ts';
import { buildStagingDir, publishPackBuild, readPackBuildCandidate, type PackBuildCandidate } from './build-publication.ts';
import { BUILD_INPUTS_DIRECTORY_ENV, removeCompilerReadTree } from './compiler-read-tree.ts';
import { startPackFrontend, type PackFrontend, type PackFrontendAddress, type FrontendInputUpdate } from './frontend-process.ts';
import { findFEEntry, readPackDevServerInputs } from './fe-bundler.ts';
import { assertCompilerLibraryEnvironment } from './compiler-native-libraries.ts';
import { mergeCompilerWatchPaths, type CompilerWatchPaths } from './compiler-watch.ts';

// Give worker SIGTERM handlers a short cleanup phase before forced termination.
const STOP_GRACE_MS = 2_000;

export interface PackBuildOptions {
  readonly args?: readonly string[];
  readonly onInputs?: (inputs: BuildWatchInputs) => void | Promise<void>;
  readonly signal?: AbortSignal;
  /** The caller has just run `ensurePackages`, and will be told of any edit since: a watcher, by its own subscriptions. */
  readonly packagesEnsured?: boolean;
}

export interface PackBuilder {
  build(options?: PackBuildOptions): Promise<void>;
  /**
   * Brings the checkout's packages up to date ahead of a build, so what a watcher reads next includes what this
   * rewrote. While nothing a package build reads or writes has moved since the last refresh it spawns nothing: a
   * refresh that succeeded stands, and one that failed rejects again, since its own scratch writes are watched and
   * would otherwise restart it for as long as the source stays broken.
   */
  ensurePackages(): Promise<void>;
  serveFrontend(changed: (address: PackFrontendAddress | undefined) => void): Promise<PackFrontendAddress | undefined>;
  subscribeFrontendInputs(listener: (inputs: FrontendInputUpdate) => void): () => void;
  isFrontendCurrent(signal?: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}

/** How a builder obtains a compiler installation; the default captures a private one per builder. */
export type CaptureCompiler = typeof captureCompilerInstallation;

export interface PackBuilderOptions {
  /**
   * Supplies the installation when the builder needs one. The builder still checks `isCurrent` before every
   * reuse and calls `dispose` when no generation holds it, so a supplier lending one installation to several
   * builders hands each a `dispose` that leaves it in place.
   */
  readonly captureCompiler?: CaptureCompiler;
  /** Refreshes the packages this builder's pack and compiler come from. Injected for tests. */
  readonly refreshPackages?: () => void;
  /** What a failed refresh is compared against. Injected for tests. */
  readonly packagesState?: () => string;
}

/** A pack retains its accepted compiler and frontend until a replacement is ready. */
export function createPackBuilder(root: string, {
  captureCompiler,
  refreshPackages = () => {
    ensureCheckoutPackages(root);
    const cli = cliPackageDirectory();
    if (checkoutFor(cli) !== checkoutFor(root)) ensureCheckoutPackages(cli);
  },
  packagesState = () => packageBuildState(checkoutBuildUnits([root, cliPackageDirectory()])),
}: PackBuilderOptions = {}): PackBuilder {
  interface Generation { compiler: CompilerInstallation; frontend?: PackFrontend; configuration?: string; inputs?: CompilerWatchPaths }
  let current: Generation | undefined;
  const owned = new Set<Generation>();
  const inputListeners = new Set<(inputs: FrontendInputUpdate) => void>();
  let failedInputs: CompilerWatchPaths = new Map();
  const frontendInputs = () => [...owned].reduce((paths, generation) =>
    mergeCompilerWatchPaths(paths, generation.inputs ?? new Map()), failedInputs);
  const publishInputs = (changed = false) => {
    const paths = frontendInputs();
    for (const listener of inputListeners) listener({ paths, changed });
  };
  let frontendChanged: ((address: PackFrontendAddress | undefined) => void) | undefined;
  let active = Promise.resolve();
  let stopping: Promise<void> | undefined;
  const stopped = new AbortController();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (stopped.signal.aborted) return Promise.reject(new Error('Pack builder is closed'));
    const result = active.then(async () => {
      // Let pending shutdown signals run before another synchronous compiler-input scan.
      await yieldToEventLoop();
      stopped.signal.throwIfAborted();
      return operation();
    });
    // A failed operation must not prevent a later build or cleanup.
    active = result.then(() => {}, () => {});
    return result;
  };
  const dispose = async (generation: Generation) => {
    try { await generation.frontend?.close(); }
    finally {
      owned.delete(generation);
      if (![...owned].some(other => other.compiler === generation.compiler)) await generation.compiler.dispose();
    }
  };
  const ensureFrontend = async (generation: Generation, signal: AbortSignal) => {
    const entry = findFEEntry(root);
    const configuration = readPackDevServerInputs(root);
    if (!entry) {
      await generation.frontend?.close();
      generation.frontend = undefined;
      generation.inputs = undefined;
      publishInputs();
      return;
    }
    if (generation.frontend?.alive()) {
      if (generation.configuration !== configuration) {
        throw new Error('Pack frontend configuration changed; build the pack before serving it again');
      }
      if (!await generation.frontend.isCurrent(signal)) {
        throw new Error('Pack frontend inputs could not be verified; build the pack before serving it again');
      }
      return generation.frontend.address;
    }
    await generation.frontend?.close();
    generation.frontend = await startPackFrontend(root, generation.compiler, signal, inputs => {
      if (!owned.has(generation)) return;
      generation.inputs = mergeCompilerWatchPaths(generation.inputs ?? new Map(), inputs.paths);
      publishInputs(inputs.changed && generation === current);
    });
    if (readPackDevServerInputs(root) !== configuration) {
      await generation.frontend.close();
      generation.frontend = undefined;
      throw new Error('Pack frontend configuration changed during startup; build the pack again');
    }
    generation.configuration = configuration;
    return generation.frontend.address;
  };
  let lastRefresh: { state: string; error?: unknown } | undefined;
  const refresh = () => {
    const state = packagesState();
    if (lastRefresh?.state === state) {
      if ('error' in lastRefresh) throw lastRefresh.error;
      return;
    }
    try {
      refreshPackages();
      lastRefresh = { state: packagesState() };
    } catch (error) {
      lastRefresh = { state, error };
      throw error;
    }
  };
  return {
    ensurePackages() {
      return enqueue(async () => refresh());
    },
    build({ args = [], onInputs, signal, packagesEnsured }: PackBuildOptions = {}) {
      const options = { args: [...args], onInputs, signal: signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal };
      return enqueue(async () => {
        options.signal.throwIfAborted();
        assertCompilerLibraryEnvironment();
        if (!packagesEnsured) refresh();
        const directory = compilerPackageDirectory();
        const configuration = frontendChanged ? readPackDevServerInputs(root) : undefined;
        const compiler = current?.compiler.isCurrent(directory, { cwd: root }) ? current.compiler : undefined;
        const reusable = compiler && (!current?.frontend
          || (current.configuration === configuration && await current.frontend.isCurrent(options.signal)));
        const candidate: Generation = current && reusable ? current
          : { compiler: compiler ?? await (captureCompiler ?? captureCompilerInstallation)(directory, { cwd: root, signal: options.signal }) };
        owned.add(candidate);
        try {
          options.signal.throwIfAborted();
          // A replacement must be ready before its backend can replace the accepted build.
          if (frontendChanged && candidate !== current && current?.frontend) await ensureFrontend(candidate, options.signal);
          const lock = await holdPackBuildLock(root, {
            packId: readValidManifest(root).id, what: ['apack pack build', ...args].join(' '), signal: options.signal,
            onWait: holder => console.log(`Waiting for ${holder} to finish...`),
          });
          try { await buildWithCompiler(root, candidate.compiler, options); }
          finally { lock.release(); }
          if (frontendChanged) {
            const before = current?.frontend?.address;
            let address: PackFrontendAddress | undefined;
            let retired: Generation['frontend'];
            try { address = await ensureFrontend(candidate, options.signal); }
            catch (error) {
              // The build is already published, so a dev server that cannot be re-verified is restarted rather
              // than turning a published build into a reported failure. The old server keeps serving until its
              // replacement is ready, and stays when the replacement fails, so the dev-server marker never
              // names a port nothing listens on
              options.signal.throwIfAborted();
              const stale = candidate.frontend;
              candidate.frontend = undefined;
              try { address = await ensureFrontend(candidate, options.signal); }
              catch (restart) {
                candidate.frontend = stale;
                throw new Error(`The build was published, but its dev server could not restart: ${restart instanceof Error ? restart.message : String(restart)}`,
                  { cause: new AggregateError([error, restart]) });
              }
              retired = stale;
            }
            if (address !== before) frontendChanged(address);
            await retired?.close();
          }
          const previous = current;
          current = candidate;
          if (previous && previous !== candidate) await dispose(previous);
          failedInputs = new Map();
          publishInputs();
        } catch (error) {
          if (candidate !== current) {
            try { await dispose(candidate); }
            finally {
              failedInputs = mergeCompilerWatchPaths(failedInputs, candidate.inputs ?? new Map());
              publishInputs();
            }
          }
          throw error;
        }
      });
    },
    serveFrontend(changed) {
      return enqueue(async () => {
        if (!current) throw new Error('Build the pack before starting its frontend');
        const address = await ensureFrontend(current, stopped.signal);
        changed(address);
        frontendChanged = changed;
        return address;
      });
    },
    subscribeFrontendInputs(listener) {
      stopped.signal.throwIfAborted();
      inputListeners.add(listener);
      try { listener({ paths: frontendInputs(), changed: false }); }
      catch (error) { inputListeners.delete(listener); throw error; }
      return () => { inputListeners.delete(listener); };
    },
    isFrontendCurrent(signal) {
      return enqueue(() => current?.frontend?.isCurrent(signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal) ?? Promise.resolve(true));
    },
    close() {
      if (!stopping) {
        stopped.abort();
        inputListeners.clear();
        stopping = active.then(async () => { await Promise.all([...owned].map(dispose)); current = undefined; });
      }
      return stopping;
    },
  };
}

export async function runPackBuild(root: string, options: PackBuildOptions = {}): Promise<void> {
  const builder = createPackBuilder(root);
  try { await builder.build(options); }
  finally { await builder.close(); }
}

async function buildWithCompiler(root: string, compiler: CompilerInstallation, { args = [], onInputs, signal }: PackBuildOptions): Promise<void> {
  const inputsDirectory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-build-inputs-')));
  try {
    assertCompilerLibraryEnvironment();
    const candidate = await new Promise<PackBuildCandidate>((resolve, reject) => {
      let processError: Error | undefined;
      let observationError: Error | undefined;
      let candidate: PackBuildCandidate | undefined;
      let observing = Promise.resolve();
      let stopping: Promise<void> | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const grouped = process.platform !== 'win32';
      const nodeOptions = compilerStartupOptions(compiler.bin, process.env.NODE_OPTIONS);
      const child = spawnCompilerWorker(compiler, [
        ...compilationConditions().map(condition => `--conditions=${condition}`),
        compiler.bin, 'pack', 'build', ...args,
      ], {
        cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], signal, detached: grouped,
        // Transform with this captured compiler, rather than reuse another installation's tsx cache.
        env: { ...process.env, ...compiler.environment, APACK_FRONTEND_WORKER: undefined, [COMPILER_PROCESS_GROUP_ENV]: grouped ? '1' : undefined, TSX_DISABLE_CACHE: '1', APACK_BUILD_WORKER: '1', [COMPILER_INPUTS_ENV]: compiler.inputsFile,
          [BUILD_INPUTS_DIRECTORY_ENV]: inputsDirectory,
          [BUILD_INPUTS_IPC_ENV]: onInputs ? '1' : '0', [COMPILER_NODE_OPTIONS_ENV]: nodeOptions.user,
          NODE_OPTIONS: nodeOptions.worker, ELECTRON_RUN_AS_NODE: '1' },
      }, inputsDirectory);
      const stop = () => {
        if (stopping) return;
        stopping = grouped && child.pid ? stopCompilerProcessGroup(child.pid)
          : Promise.resolve().then(() => { child.kill('SIGKILL'); });
        // close awaits this result; observe rejection even if inherited pipes delay close.
        void stopping.catch(() => {});
      };
      const abort = () => { escalation = setTimeout(stop, STOP_GRACE_MS); };
      const clearStop = () => { clearTimeout(escalation); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.on('message', message => {
        try {
          const reported = readPackBuildCandidate(message);
          if (reported) {
            if (candidate) throw new Error('Build worker reported more than one candidate');
            candidate = reported;
          }
        } catch (error) { observationError ??= error instanceof Error ? error : new Error(String(error)); }
        const inputs = readBuildWatchInputs(message);
        if (inputs && onInputs) {
          observing = observing.then(() => onInputs(inputs)).catch(error => {
            observationError ??= error instanceof Error ? error : new Error(String(error));
          });
        }
      });
      child.once('error', error => { processError = error; });
      child.once('exit', () => { clearStop(); if (grouped) stop(); });
      child.once('close', async (code, exitSignal) => {
        clearStop();
        try { await stopping; } catch (error) { reject(error); return; }
        await observing;
        try {
          if (onInputs) for (const inputs of readCompilerWatchReports(inputsDirectory)) await onInputs(inputs);
        } catch (error) { observationError ??= error instanceof Error ? error : new Error(String(error)); }
        if (processError || observationError) reject(processError ?? observationError);
        else if (code === 0 && candidate) resolve(candidate);
        else if (code === 0) reject(new Error('Build worker exited without a completed candidate'));
        else reject(new Error(`Pack build process ${exitSignal ? `terminated with ${exitSignal}` : `exited with code ${code}`}`));
      });
    });
    signal?.throwIfAborted();
    publishPackBuild(root, candidate);
  } finally {
    fs.rmSync(buildStagingDir(root), { recursive: true, force: true });
    removeCompilerReadTree(inputsDirectory);
  }
}
