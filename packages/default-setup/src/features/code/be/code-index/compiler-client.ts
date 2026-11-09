// The main thread's side of the compiler layer: one worker for the process, started on first use and again after it
// exits. A wait on it lasts as long as it keeps working (`answerWhileWorking`), never a fixed time, since a first
// program over a large checkout takes as long as it takes.
import { Worker } from 'node:worker_threads';
import { answerWhileWorking, threadWork } from '@apackdev/sdk/progress';
import { createLogger } from '@apackdev/sdk/logger';
import { workerPath } from '#generated/workers.ts';
import type { CompilerAnswer } from './compiler.ts';
import type { CompilerRequest, CompilerResponse } from './compiler-worker.ts';

const logger = createLogger('code-index');

/** What the worker's heap may grow to; past it the worker exits, and the index keeps its syntax edges */
const WORKER_HEAP_MB = 3072;

type Pending = { resolve: (response: CompilerResponse) => void; reject: (error: Error) => void };
type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** The checkouts the running worker holds a project for; a new worker holds none */
const open = new Set<string>();

function start(): Worker {
  const started = new Worker(workerPath('codeIndexCompiler'), { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
  started.on('message', (response: CompilerResponse) => {
    const waiting = pending.get(response.id);
    pending.delete(response.id);
    waiting?.resolve(response);
  });
  started.on('error', error => logger.error('The compiler worker failed', { error }));
  started.on('exit', (code) => {
    if (worker === started) { worker = null; open.clear(); }
    for (const waiting of pending.values()) waiting.reject(new Error(`The compiler worker exited (${code})`));
    pending.clear();
  });
  // A worker waiting for work keeps nothing alive: the process may exit around it
  started.unref();
  return started;
}

function ask(request: Distribute<CompilerRequest>, what: string): Promise<CompilerResponse> {
  worker ??= start();
  const id = nextId++;
  const answer = new Promise<CompilerResponse>((resolve, reject) => pending.set(id, { resolve, reject }));
  worker.postMessage({ ...request, id });
  return answerWhileWorking(answer, { work: threadWork(worker), what });
}

/**
 * What the compiler says each site of `files` names, after telling it what moved; `null` for a file it doesn't read,
 * or for every file when it couldn't answer, which leaves those files on the syntax layer
 */
export async function compilerAnswers(
  root: string, every: () => string[], changes: { path: string; gone?: boolean }[], files: readonly string[],
): Promise<Map<string, CompilerAnswer[] | null> | null> {
  // Nothing to answer needs no program: a checkout is opened by the first sync that resolves something
  if (files.length === 0) return new Map();
  try {
    if (!open.has(root)) {
      const opened = await ask({ type: 'open', root, files: every() }, 'The compiler opening a checkout');
      if (!opened.ok) throw new Error(opened.message);
      open.add(root);
    } else if (changes.length > 0) {
      const changed = await ask({ type: 'changed', root, changes }, 'The compiler taking changes');
      if (!changed.ok) throw new Error(changed.message);
    }
    const answered = await ask({ type: 'answers', root, files: [...files] }, 'The compiler answering');
    if (!answered.ok) throw new Error(answered.message);
    return new Map(Object.entries(answered.answers ?? {}));
  } catch (error) {
    logger.warn('The compiler layer could not answer; those files keep their syntax edges', { root, error });
    return null;
  }
}
