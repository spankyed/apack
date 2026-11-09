// Keeps a project's rows equal to git's view of it. Everything runs on the API's event loop, so the work is cut into
// slices that yield: no parse here has come near what the loop can spare, and yielding between files bounds the rest.
// A file's blob id and its symbols are written in one unit, so an interrupted sync leaves only finished files, and the
// next one starts from what they say.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import * as path from 'node:path';
import { createLogger } from '@apackdev/sdk/logger';
import { extractorStamp, languageOf, type Definition } from './extract.ts';
import { readGitView, readPackages } from './git-view.ts';
import { compilerAnswers } from './compiler-client.ts';
import { compilerReads } from './compiler.ts';
import { applyCompilerAnswers, drainDirtyFiles } from './graph.ts';
import { extractGraph, wantedNamesOf, type FileGraph, type Reexport } from './sites.ts';
import { codeIndexCommands, codeIndexQueries, projectIdOf, type CodeIndexProgress, type SkipReason } from './repository.ts';

const logger = createLogger('code-index');

const SLICE_MS = 8;
const PROGRESS_EVERY_MS = 250;
const FILE_PAGE = 500;
/** Over this a file is counted and left out, so no single parse can hold the event loop past its budget */
export const MAX_FILE_BYTES = 512 * 1024;

/** Names the compiler layer in the stamp; changing what it answers changes this */
const COMPILER_LAYER = 'compiler:1';

/** A function that yields to the event loop once `ms` have passed since it last did */
export function createSlicer(signal?: AbortSignal, ms = SLICE_MS): () => Promise<void> {
  let sliceStart = performance.now();
  return async () => {
    signal?.throwIfAborted();
    if (performance.now() - sliceStart < ms) return;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    signal?.throwIfAborted();
    sliceStart = performance.now();
  };
}

/** Every file row a project holds, by path, a page at a time */
async function readHeldFiles(project: string, pause: () => Promise<void>): Promise<Map<string, { oid: string; skipped?: SkipReason }>> {
  const held = new Map<string, { oid: string; skipped?: SkipReason }>();
  for (let page = codeIndexQueries.filesPage(project, undefined, FILE_PAGE); page.length > 0; page = codeIndexQueries.filesPage(project, page.at(-1)!.id, FILE_PAGE)) {
    for (const file of page) held.set(file.path, file);
    await pause();
  }
  return held;
}

/** A file's text, or why it is left out */
async function readSource(file: string): Promise<{ text: string } | { skipped: SkipReason }> {
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_FILE_BYTES) return { skipped: 'too-large' };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // A replacement character the file's own bytes don't spell out means they weren't UTF-8
  if (text.includes('�') && !bytes.includes(Buffer.from('�'))) return { skipped: 'not-utf8' };
  return { text };
}

/** Brings one enabled project's rows up to git's view. Throws an abort when `signal` fires */
export async function syncProject(root: string, signal: AbortSignal): Promise<void> {
  const startedAt = performance.now();
  // Read out in the log line below: this runs on the API's event loop, and its slicing is what keeps that loop turning
  const loop = monitorEventLoopDelay({ resolution: 5 });
  loop.enable();
  try {
    const changedFiles = await syncChanges(root, signal);
    if (changedFiles > 0) logger.info('Synced', { root, files: changedFiles, ms: Math.round(performance.now() - startedAt), longestLoopDelayMs: Math.round(loop.max / 1e6) });
  } finally { loop.disable(); }
}

/** Answers how many files it had to look at */
async function syncChanges(root: string, signal: AbortSignal): Promise<number> {
  const project = projectIdOf(root);
  const view = await readGitView(root);
  signal.throwIfAborted();
  const packages = await readPackages(root).catch(() => []);
  signal.throwIfAborted();
  // What a specifier means is in the manifests, so a changed one is a changed extractor as far as any file's edges go;
  // and every file's edges include the compiler layer's answers, so a checkout indexed without it is read again once
  const stamp = createHash('sha1').update(extractorStamp()).update(JSON.stringify(packages)).update(COMPILER_LAYER).digest('base64url').slice(0, 16);
  const row = codeIndexQueries.project(root);
  if (!row) return 0;
  if (!view) {
    codeIndexCommands.setProgress(root, { state: 'not-git', files: 0, symbols: 0, pending: 0, skipped: {} });
    return 0;
  }
  const pause = createSlicer(signal);
  const held = await readHeldFiles(project, pause);
  const extractorMoved = row.extractorStamp !== stamp;
  const stale = [...view].filter(([file, oid]) => extractorMoved || held.get(file)?.oid !== oid);
  const gone = [...held.keys()].filter(file => !view.has(file));

  let pending = stale.length + gone.length;
  // Why each file is left out, kept as files move rather than read back, since reading every row holds the event loop
  const skippedFiles = new Map([...held].flatMap(([file, { skipped }]): [string, SkipReason][] => (skipped ? [[file, skipped]] : [])));
  const progress = (state: CodeIndexProgress['state']): CodeIndexProgress => {
    const skipped: CodeIndexProgress['skipped'] = {};
    for (const reason of skippedFiles.values()) skipped[reason] = (skipped[reason] ?? 0) + 1;
    return { state, files: view.size, symbols: state === 'idle' ? codeIndexQueries.symbolCount(project) : row.progress.symbols, pending, skipped };
  };
  const waiting = codeIndexQueries.dirtyCount(project);
  if (pending === 0 && waiting === 0) {
    if (extractorMoved) codeIndexCommands.setStamp(root, stamp);
    if (row.progress.state !== 'idle') codeIndexCommands.setProgress(root, progress('idle'));
    return 0;
  }
  const changedFiles = pending;
  const parsedFiles = new Map<string, FileGraph>();
  codeIndexCommands.setProgress(root, progress('syncing'));
  let lastProgress = performance.now();
  const step = () => {
    pending--;
    if (performance.now() - lastProgress < PROGRESS_EVERY_MS) return;
    codeIndexCommands.setProgress(root, progress('syncing'));
    lastProgress = performance.now();
  };

  for (const file of gone) {
    codeIndexCommands.removeFile(project, file);
    skippedFiles.delete(file);
    step();
    await pause();
  }
  for (const [file, oid] of stale) {
    const language = languageOf(file);
    if (language) {
      let definitions: readonly Definition[] = [];
      let reexports: readonly Reexport[] = [];
      let parsed: FileGraph | undefined;
      let skipped: SkipReason | undefined;
      let source: Awaited<ReturnType<typeof readSource>> | undefined;
      // A file can go between git's listing and this read; the next view says so
      try { source = await readSource(path.join(root, file)); } catch { source = undefined; }
      signal.throwIfAborted();
      if (source) {
        if ('skipped' in source) skipped = source.skipped;
        else {
          const graph = extractGraph(file, source.text);
          if (graph.ok) { parsed = graph; ({ definitions, reexports } = graph); parsedFiles.set(file, graph); }
          else skipped = 'parse-error';
        }
        codeIndexCommands.applyFile(project, {
          path: file, oid, language, skipped, reexports, defaultLocal: parsed?.defaultLocal ?? null, wantedNames: parsed ? wantedNamesOf(parsed) : [],
        }, definitions, held.size === 0);
        if (skipped) skippedFiles.set(file, skipped); else skippedFiles.delete(file);
      }
    }
    step();
    await pause();
  }
  const drained = await drainDirtyFiles(root, packages, parsedFiles, signal, pause, (left) => {
    pending = left;
    if (performance.now() - lastProgress < PROGRESS_EVERY_MS) return;
    codeIndexCommands.setProgress(root, progress('syncing'));
    lastProgress = performance.now();
  });
  // The compiler, in its worker, for the files just resolved: told first what moved, so it answers against this view
  const changes = [...stale.map(([file]) => ({ path: file })), ...gone.map(file => ({ path: file, gone: true }))];
  const answers = await compilerAnswers(root, () => [...view.keys()], changes, drained.filter(compilerReads));
  signal.throwIfAborted();
  if (answers) await applyCompilerAnswers(root, packages, answers, signal, pause);
  codeIndexCommands.setStamp(root, stamp);
  pending = 0;
  codeIndexCommands.setProgress(root, progress('idle'));
  return changedFiles + waiting;
}

/** Takes every row of a project that was turned off, in slices, then the project */
export async function removeProject(root: string, signal: AbortSignal): Promise<void> {
  const project = projectIdOf(root);
  const row = codeIndexQueries.project(root);
  if (!row) return;
  codeIndexCommands.setProgress(root, { ...row.progress, state: 'removing' });
  const pause = createSlicer(signal);
  for (const file of (await readHeldFiles(project, pause)).keys()) {
    codeIndexCommands.removeFile(project, file);
    await pause();
  }
  codeIndexCommands.removeProject(root);
}

/**
 * The one sync running at a time. A request while one runs cancels it and starts again from a fresh view, and
 * whatever the cancelled one finished is already stored, so it costs only its remaining files.
 */
export function createSyncRunner(onError: (error: unknown, root: string) => void) {
  let current: { root: string; controller: AbortController; done: Promise<void> } | undefined;
  let stopped = false;

  const run = async (root: string, signal: AbortSignal) => {
    const project = codeIndexQueries.project(root);
    if (!project) return;
    try {
      await (project.enabled ? syncProject(root, signal) : removeProject(root, signal));
    } catch (error) {
      if (signal.aborted) return;
      onError(error, root);
      const row = codeIndexQueries.project(root);
      if (row) codeIndexCommands.setProgress(root, { ...row.progress, state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    /** Brings `root` up to date; `null` is no directory, which only cancels */
    request(root: string | null): Promise<void> {
      current?.controller.abort();
      const previous = current?.done ?? Promise.resolve();
      if (stopped || root === null) { current = undefined; return previous; }
      const controller = new AbortController();
      const done = previous.then(() => (controller.signal.aborted ? undefined : run(root, controller.signal)));
      current = { root, controller, done };
      return done;
    },
    stop(): Promise<void> {
      stopped = true;
      current?.controller.abort();
      return current?.done ?? Promise.resolve();
    },
  };
}
