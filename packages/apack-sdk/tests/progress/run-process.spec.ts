import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess, type ProcessFailure, type ProcessOutcome } from '../../src/progress.ts';
import { settles } from '../../src/testing/waiting.ts';

/**
 * How long a child that waits lives when nothing ends it. Every child here that waits ends itself after this, so
 * one the code under test failed to stop is gone soon after its spec, whatever the spec made of it.
 */
const SELF_EXIT_MS = 60_000;

/** Runs `script` in a Node child */
const node = (script: string, options: Parameters<typeof runProcess>[2] = {}): Promise<ProcessOutcome> =>
  runProcess(process.execPath, ['-e', script], options);

/** The failure of an outcome that has one, of the kind the case is about */
function failureOf<K extends ProcessFailure['kind']>(outcome: ProcessOutcome, kind: K): Extract<ProcessFailure, { kind: K }> {
  if (outcome.ok) throw new Error(`The process succeeded: ${outcome.stdout}`);
  if (outcome.failure.kind !== kind) throw new Error(`The process failed as ${outcome.failure.kind}, not ${kind}`);
  return outcome.failure as Extract<ProcessFailure, { kind: K }>;
}

/** Whether a process with this id exists */
function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-process-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** A script that writes its pid to `file` once it runs, then `then` */
const announcing = (file: string, then: string): string =>
  `require('node:fs').writeFileSync(${JSON.stringify(file)}, String(process.pid)); ${then}`;

/** The pid a child wrote to `file`, once it has */
const announced = (file: string): Promise<number> => settles(() => {
  const pid = Number(fs.readFileSync(file, 'utf8'));
  if (!(pid > 0)) throw new Error(`The child has not written its pid to ${file}`);
  return pid;
});

describe('a process that ends by itself', () => {
  it('answers with both streams, having been given its input', async () => {
    const outcome = await node(
      "let text = ''; process.stdin.on('data', (chunk) => { text += chunk; }); process.stdin.on('end', () => { process.stdout.write(text.toUpperCase()); process.stderr.write('noted'); });",
      { input: 'héllo' },
    );
    expect(outcome).toEqual({ ok: true, stdout: 'HÉLLO', stderr: 'noted' });
  });

  it('runs in the directory and environment it is given, and no other', async () => {
    const outcome = await node('process.stdout.write(JSON.stringify([process.cwd(), process.env.ONLY, process.env.HOME ?? null]))',
      { cwd: dir, env: { ONLY: 'this' } });
    if (!outcome.ok) throw new Error(`The process failed as ${outcome.failure.kind}`);
    expect(JSON.parse(outcome.stdout)).toEqual([fs.realpathSync(dir), 'this', null]);
  });

  it('reports another exit code as a failure carrying what was written', async () => {
    const failure = failureOf(await node("process.stdout.write('partial'); process.stderr.write('why'); process.exitCode = 3;"), 'exited');
    expect(failure).toEqual({ kind: 'exited', exitCode: 3, signal: null, stdout: 'partial', stderr: 'why' });
  });

  it('survives a child that exits without reading its input', async () => {
    // More than a pipe holds, so the write is still under way when the reader is gone
    const outcome = await node('process.exit(0)', { input: 'x'.repeat(4 * 1024 * 1024) });
    expect(outcome.ok).toBe(true);
  });
});

describe('a process that cannot start', () => {
  it('names the missing file in a failure, and throws nothing', async () => {
    const failure = failureOf(await runProcess(path.join(dir, 'no-such-program'), []), 'not-started');
    expect(failure.error.code).toBe('ENOENT');
  });
});

describe('a process stopped by its caller', () => {
  it('is not started for a signal that has already aborted', async () => {
    const marker = path.join(dir, 'ran');
    const stopped = new AbortController();
    stopped.abort(new Error('never mind'));
    const failure = failureOf(await node(announcing(marker, ''), { signal: stopped.signal }), 'aborted');
    expect(failure.reason).toBe(stopped.signal.reason);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('is gone by the time its outcome is reported, with what it wrote and the reason it was stopped', async () => {
    const marker = path.join(dir, 'pid');
    const stopping = new AbortController();
    // Written, synchronously, before the child says it is running, so it has written when it is stopped: a pipe write
    // that is queued dies with the process, and the case is about what reached the pipe
    const run = node(`require('node:fs').writeSync(1, 'started'); ${announcing(marker, `setTimeout(() => {}, ${SELF_EXIT_MS});`)}`,
      { signal: stopping.signal });
    const pid = await announced(marker);
    stopping.abort(new Error('changed my mind'));
    const failure = failureOf(await run, 'aborted');
    expect(isRunning(pid)).toBe(false);
    expect(failure).toMatchObject({ reason: stopping.signal.reason, stdout: 'started' });
  });

  it.skipIf(process.platform === 'win32')('is killed when it ignores the request and does nothing', async () => {
    const marker = path.join(dir, 'pid');
    const stopping = new AbortController();
    // Announced only once the handler is in place, so the request cannot arrive before the child ignores it
    const run = node(`process.on('SIGTERM', () => {}); ${announcing(marker, `setTimeout(() => {}, ${SELF_EXIT_MS});`)}`,
      { signal: stopping.signal, stopIdleMs: 400 });
    const pid = await announced(marker);
    stopping.abort();
    failureOf(await run, 'aborted');
    expect(isRunning(pid)).toBe(false);
  });
});

describe('a process that stops working', () => {
  it('is ended as stalled, and is gone when that is reported', async () => {
    const marker = path.join(dir, 'pid');
    const run = node(announcing(marker, `setTimeout(() => {}, ${SELF_EXIT_MS});`), { idleMs: 400 });
    const pid = await announced(marker);
    const failure = failureOf(await run, 'refused');
    expect(failure.refusal).toMatchObject({ kind: 'stalled', idleMs: 400 });
    expect(isRunning(pid)).toBe(false);
  });
});
