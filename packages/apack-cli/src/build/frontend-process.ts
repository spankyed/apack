import { spawnCompilerWorker } from './compiler-process.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compilationConditions } from './compilation-inputs.ts';
import { COMPILER_INPUTS_ENV } from './compiler-installation-inputs.ts';
import { COMPILER_PROCESS_GROUP_ENV, stopCompilerProcessGroup } from './compiler-process-group.ts';
import type { CompilerInstallation } from './compiler-installation.ts';
import { assertCompilerLibraryEnvironment } from './compiler-native-libraries.ts';
import { compilerStartupOptions, COMPILER_NODE_OPTIONS_ENV } from './compiler-startup-options.ts';
import { BUILD_INPUTS_DIRECTORY_ENV, removeCompilerReadTree } from './compiler-read-tree.ts';
import { BUILD_INPUTS_IPC_ENV, readCompilerWatchReports } from './build-watch-inputs.ts';
import { mergeCompilerWatchPaths, type CompilerWatchPaths } from './compiler-watch.ts';
import { COMPILER_NATIVE_REPORT } from './compiler-native-reports.ts';
import { fromNow, processWork, watchWork } from '@apackdev/sdk/progress';

export interface PackFrontendAddress { readonly port: number; readonly pid: number }
export interface FrontendInputUpdate { readonly paths: CompilerWatchPaths; readonly changed: boolean }

// A blocked dev process must not hold the builder's replacement queue indefinitely: one doing no work for this
// long is answered for as not current. A busy one is still working and is waited for.
const INPUT_CHECK_IDLE_MS = 10_000;

export interface PackFrontend {
  readonly address: PackFrontendAddress;
  alive(): boolean;
  isCurrent(signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}

/** A generation's Vite modules are private; authored sources stay live for HMR. */
export async function startPackFrontend(root: string, compiler: CompilerInstallation, signal: AbortSignal,
  onInputs?: (inputs: FrontendInputUpdate) => void): Promise<PackFrontend> {
  signal.throwIfAborted();
  assertCompilerLibraryEnvironment();
  const grouped = process.platform !== 'win32';
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-vite-')));
  const nodeOptions = compilerStartupOptions(compiler.bin, process.env.NODE_OPTIONS);
  let child: ReturnType<typeof spawnCompilerWorker>;
  try {
    child = spawnCompilerWorker(compiler, [...compilationConditions().map(value => `--conditions=${value}`), compiler.bin], {
      cwd: root, detached: grouped, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, ...compiler.environment, APACK_FRONTEND_WORKER: '1', APACK_BUILD_WORKER: undefined,
        [COMPILER_INPUTS_ENV]: compiler.inputsFile, [COMPILER_PROCESS_GROUP_ENV]: grouped ? '1' : undefined,
        APACK_FRONTEND_DIRECTORY: directory,
        [BUILD_INPUTS_DIRECTORY_ENV]: directory, [COMPILER_NODE_OPTIONS_ENV]: nodeOptions.user,
        [BUILD_INPUTS_IPC_ENV]: onInputs ? '1' : '0',
        NODE_OPTIONS: nodeOptions.worker, ELECTRON_RUN_AS_NODE: '1', TSX_DISABLE_CACHE: '1' },
    }, directory);
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw error;
  }
  let failure: Error | undefined;
  const closed = new Promise<void>(resolve => {
    child.once('error', error => { failure = error; });
    child.once('close', () => resolve());
  });
  let closing: Promise<void> | undefined;
  let inputWatch: fs.FSWatcher | undefined;
  const deliverInputs = (changed = false) => {
    if (!onInputs) return;
    const paths = readCompilerWatchReports(directory).reduce((paths, inputs) =>
      mergeCompilerWatchPaths(paths, new Map(inputs.probes)), new Map() as CompilerWatchPaths);
    onInputs({ paths, changed });
  };
  const close = () => closing ??= (async () => {
    inputWatch?.close();
    const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    try {
      if (child.connected) child.send('frontend-close', () => {});
      else child.kill('SIGKILL');
      await closed;
      // The private read tree goes whether or not the group stopped, so a refused stop cannot leak it
      try {
        if (grouped && child.pid) await stopCompilerProcessGroup(child.pid);
        deliverInputs();
      } finally { removeCompilerReadTree(directory); }
    } finally { clearTimeout(timer); }
  })();
  const abort = () => { void close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let sequence = 0;
  const isCurrent = (signal: AbortSignal) => new Promise<boolean>((resolve, reject) => {
    signal.throwIfAborted();
    if (!child.connected || child.exitCode !== null || child.signalCode !== null) { resolve(false); return; }
    const id = ++sequence;
    const finish = (current: boolean, error?: unknown) => {
      watch?.stop();
      signal.removeEventListener('abort', aborted);
      child.removeListener('message', response);
      child.removeListener('close', exited);
      error !== undefined ? reject(error) : resolve(current);
    };
    const aborted = () => finish(false, signal.reason);
    const exited = () => finish(false);
    const watch = child.pid === undefined ? undefined
      : watchWork({ work: fromNow(processWork(child.pid)), idleMs: INPUT_CHECK_IDLE_MS, onRefused: () => finish(false) });
    const response = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'frontend-inputs'
        || !('id' in message) || message.id !== id) return;
      finish('current' in message && message.current === true);
    };
    signal.addEventListener('abort', aborted, { once: true });
    child.on('message', response);
    child.once('close', exited);
    child.send({ type: 'frontend-inputs', id }, error => { if (error) finish(false, error); });
  });
  try {
    if (onInputs) {
      const refused = (error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
        child.kill('SIGKILL');
      };
      inputWatch = fs.watch(directory, (_event, name) => {
        if (name && !/^watch-\d+\.jsonl$/.test(name) && !COMPILER_NATIVE_REPORT.test(name)) return;
        try { deliverInputs(true); } catch (error) { refused(error); }
      });
      inputWatch.on('error', refused);
    }
    const address = await new Promise<PackFrontendAddress>((resolve, reject) => {
      child.on('message', message => {
        if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'frontend-ready') return;
        if (!('hash' in message) || message.hash !== compiler.hash || !('port' in message)
          || !('pid' in message) || typeof message.pid !== 'number' || !Number.isSafeInteger(message.pid) || message.pid <= 0
          || typeof message.port !== 'number' || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          reject(new Error('Invalid pack frontend readiness')); return;
        }
        resolve({ port: message.port, pid: message.pid });
      });
      void closed.then(() => reject(failure ?? new Error(`Pack frontend exited before readiness (${child.exitCode ?? child.signalCode})`)));
    });
    deliverInputs();
    signal.throwIfAborted();
    return { address, alive: () => child.exitCode === null && child.signalCode === null, isCurrent, close };
  } catch (error) {
    await close();
    signal.throwIfAborted();
    throw error;
  } finally { signal.removeEventListener('abort', abort); }
}
