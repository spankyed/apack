import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import threads, { SHARE_ENV, BroadcastChannel, getEnvironmentData, setEnvironmentData, type WorkerOptions } from 'node:worker_threads';
import { withoutCompilerFileReads, type CompilerInputObservations } from '@apackdev/host/build/compiler-inputs';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import { answerWhileWorking, threadWork } from '@apackdev/sdk/progress';

/**
 * How much of its own CPU a worker may spend before it accepts the final input collection: what refuses a worker
 * spinning in pack code, which can never reach its message handler, where a plain `apack pack build` has no step
 * ceiling around it. A worker that is only starved by a busy machine adds almost no CPU while it waits for its turn,
 * and one finishing a synchronous stretch of compilation reaches its handler at the end of it, so thirty seconds of
 * its own thread's CPU is past anything a healthy worker spends between the request and its acceptance, and a spin
 * is refused in about that long rather than held to the build's own bounds.
 */
const ACCEPT_CPU_MS = 30_000;
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
      const pending = new Map<number, { accepted(): void; resolve(value: CompilerInputObservations[]): void; reject(error: Error): void }>();
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
        if (data.collecting) { request.accepted(); return; }
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
            // Bound an unresponsive worker, not filesystem verification or nested collection: a worker that is
            // computing answers late and is waited for, and one doing nothing for the watchdog's window is refused.
            // Its own CPU, since a thread shares its process's pid.
            let accepted!: () => void;
            const acceptance = new Promise<void>(settle => { accepted = settle; });
            if (finish) {
              answerWhileWorking(acceptance, { work: threadWork(worker), what: 'Compiler worker', ceilingMs: ACCEPT_CPU_MS }).catch((cause: unknown) => {
                if (!pending.delete(id)) return;
                reject(new Error('Compiler worker did not accept input collection before termination; refusing publication', { cause }));
              });
            }
            pending.set(id, {
              accepted,
              resolve: value => { accepted(); resolve(value); },
              reject: error => { accepted(); reject(error); },
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
