import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import threads, { SHARE_ENV, BroadcastChannel, getEnvironmentData, setEnvironmentData, type WorkerOptions } from 'node:worker_threads';
import { withoutCompilerFileReads, type CompilerInputObservations } from '@apackdev/host/build/compiler-inputs';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import { COMPILER_NODE_OPTIONS_ENV, compilerStartupArguments } from './compiler-startup-options.ts';

const HANDOFF = 'apack.compiler.worker';
interface ThreadHandoff { pid: number; channel: string; report: string; environment: Record<string, string> }
interface ThreadReport { observations?: CompilerInputObservations[]; error?: string }

/** Private transport only; completed observations join the build's common input record. */
export function compilerThreadHandoff(): ThreadHandoff | undefined {
  const handoff = getEnvironmentData(HANDOFF) as ThreadHandoff | undefined;
  return handoff?.pid === process.pid ? handoff : undefined;
}

/** Own compiler-created workers, including their explicit termination and natural exit. */
export function ownCompilerThreads(bootstrap: string, workspace: string, environment: Record<string, string>) {
  const NativeWorker = threads.Worker;
  const workers: Array<{ collect(finish: boolean): Promise<CompilerInputObservations[]> }> = [];
  let closing = false;
  threads.Worker = new Proxy(NativeWorker, {
    construct(target, args, newTarget) {
      const [filename, options = {}] = args as [string | URL, WorkerOptions?];
      if (closing) throw new Error('Compiler cannot start worker threads after input collection');
      let workerOptions = options;
      let startupEnvironment = environment;
      if (options.execArgv !== undefined) {
        const source = options.env === SHARE_ENV ? process.env : options.env ?? process.env;
        const userOptions = source.NODE_OPTIONS === undefined ? '' : String(source.NODE_OPTIONS);
        const flags = parseNodeOptions(userOptions);
        // NODE_OPTIONS requires run before execArgv requires, so ownership must start in both places.
        if (options.env === SHARE_ENV && flags.some(flag => /^--(?:require|import|(?:experimental-)?loader)(?:=|$)|^-r/.test(flag))) {
          throw new Error('Compiler workers with SHARE_ENV and explicit execArgv cannot run NODE_OPTIONS preloads; inherit execArgv or use a private environment');
        }
        workerOptions = { ...options, execArgv: compilerStartupArguments(bootstrap, options.execArgv),
          ...(options.env === SHARE_ENV ? {} : { env: { ...source,
            NODE_OPTIONS: formatNodeOptions(compilerStartupArguments(bootstrap, flags)) } }) };
        startupEnvironment = { ...environment, [COMPILER_NODE_OPTIONS_ENV]: userOptions };
      }
      const handoff: ThreadHandoff = { pid: process.pid, channel: randomUUID(), report: path.join(workspace, `thread-${randomUUID()}.json`), environment: startupEnvironment };
      const channel = new BroadcastChannel(handoff.channel);
      channel.unref();
      const previous = getEnvironmentData(HANDOFF);
      setEnvironmentData(HANDOFF, handoff);
      let worker: InstanceType<typeof NativeWorker>;
      try {
        worker = Reflect.construct(target, [filename, workerOptions], newTarget);
      } catch (error) { channel.close(); throw error; }
      finally { setEnvironmentData(HANDOFF, previous); }
      const terminate = worker.terminate.bind(worker);
      let readyResolve!: () => void;
      const ready = new Promise<void>(resolve => { readyResolve = resolve; });
      let report: ThreadReport | undefined, exited = false, sequence = 0;
      let stopping: Promise<number> | undefined;
      const pending = new Map<number, { timer?: ReturnType<typeof setTimeout>; resolve(value: CompilerInputObservations[]): void; reject(error: Error): void }>();
      const result = (value: ThreadReport): CompilerInputObservations[] => {
        if (value.error) throw new Error(`Compiler worker inputs could not be collected: ${value.error}`);
        if (!value.observations) throw new Error('Compiler worker exited without its input observations');
        return value.observations;
      };
      channel.onmessage = event => {
        const { data } = event as { data: ThreadReport & { id: number; ready?: boolean; collecting?: boolean } };
        if (data.ready) { readyResolve(); return; }
        const request = pending.get(data.id);
        if (!request) return;
        if (data.collecting) { clearTimeout(request.timer); return; }
        pending.delete(data.id);
        try { request.resolve(result(data)); } catch (error) { request.reject(error as Error); }
      };
      worker.once('exit', () => {
        exited = true;
        withoutCompilerFileReads(() => {
          try { report = JSON.parse(fs.readFileSync(handoff.report, 'utf8')); }
          catch (error) { report = { error: `Worker exited without a readable input report: ${String(error)}` }; }
        });
        readyResolve();
        for (const request of pending.values()) {
          try { request.resolve(result(report!)); } catch (error) { request.reject(error as Error); }
        }
        pending.clear();
        channel.close();
      });
      const request = async (finish: boolean) => {
        if (exited) return result(report!);
        channel.ref();
        try {
          await ready;
          if (exited) return result(report!);
          const id = ++sequence;
          return await new Promise<CompilerInputObservations[]>((resolve, reject) => {
            // Bound an unresponsive worker, not filesystem verification or nested collection.
            const timer = finish ? setTimeout(() => {
              pending.delete(id);
              reject(new Error('Compiler worker did not accept input collection before termination; refusing publication'));
            }, 2_000) : undefined;
            pending.set(id, {
              timer,
              resolve: value => { clearTimeout(timer); resolve(value); },
              reject: error => { clearTimeout(timer); reject(error); },
            });
            channel.postMessage({ id, finish });
          });
        } finally { if (!exited) channel.unref(); }
      };
      let finished: Promise<CompilerInputObservations[]> | undefined;
      const collect = (finish: boolean): Promise<CompilerInputObservations[]> => finish
        ? finished ??= (async () => {
          try { return await request(true); }
          finally { await (stopping ??= terminate()); }
        })() : request(false);
      worker.terminate = () => {
        const collected = collect(true);
        // Keep native exit-status semantics; the build owner retains collection refusals.
        return collected.then(() => stopping!, () => stopping!);
      };
      workers.push({ collect });
      return worker;
    },
  });
  syncBuiltinESMExports();
  return async (finish: boolean): Promise<CompilerInputObservations[]> => {
    if (finish) closing = true;
    return (await Promise.all(workers.map(worker => worker.collect(finish)))).flat();
  };
}

/** A dedicated channel leaves workerData and application messages unchanged. */
export function serveCompilerThread(
  handoff: ThreadHandoff,
  snapshot: () => Promise<CompilerInputObservations[]>,
  finish: () => Promise<CompilerInputObservations[]>,
) {
  const channel = new BroadcastChannel(handoff.channel);
  channel.unref();
  let finished: Promise<ThreadReport> | undefined;
  const finalize = () => finished ??= (async () => {
    let report: ThreadReport;
    try { report = { observations: await finish() }; }
    catch (error) { report = { error: error instanceof Error ? error.message : String(error) }; }
    // Exit and broadcast delivery have no shared ordering. The owner reads this on native exit.
    withoutCompilerFileReads(() => fs.writeFileSync(handoff.report, JSON.stringify(report)));
    return report;
  })();
  channel.onmessage = async event => {
    const { data } = event as { data: { id: number; finish: boolean } };
    try {
      if (data.finish) channel.postMessage({ id: data.id, collecting: true });
      channel.postMessage({ id: data.id, ...(data.finish ? await finalize() : { observations: await snapshot() }) });
    }
    catch (error) { channel.postMessage({ id: data.id, error: String(error) }); }
  };
  process.once('beforeExit', () => {
    channel.ref();
    void finalize().finally(() => channel.close());
  });
  channel.postMessage({ ready: true });
}
