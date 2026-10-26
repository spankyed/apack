import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const GUARD = new URL('../src/vitest-exit-with-parent.ts', import.meta.url).href;
// Where `--import tsx` resolves from
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-with-parent-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * A forked child standing in for a vitest worker: it loads the guard before or after its parent's channel closes,
 * says so, and would run on for ten seconds. The parent closing the channel is its vitest going away.
 */
async function workerExit(loadsGuard: 'before the channel closes' | 'after the channel closed'): Promise<NodeJS.Signals | null> {
  const script = path.join(dir, `${loadsGuard.startsWith('before') ? 'before' : 'after'}.mts`);
  fs.writeFileSync(script, loadsGuard.startsWith('before')
    ? `await import(${JSON.stringify(GUARD)});\nprocess.send!('ready');\nsetTimeout(() => {}, 10_000);\n`
    : `process.once('disconnect', async () => { await import(${JSON.stringify(GUARD)}); });\nprocess.send!('ready');\nsetTimeout(() => {}, 10_000);\n`);
  const worker = fork(script, { execArgv: ['--import', 'tsx'], cwd: PACKAGE_DIR, stdio: 'ignore' });
  try {
    const exited = once(worker, 'exit');
    await once(worker, 'message');
    worker.disconnect();
    const [, signal] = await exited as [number | null, NodeJS.Signals | null];
    return signal;
  } finally {
    worker.kill('SIGKILL');
  }
}

describe('a vitest worker whose vitest is gone', () => {
  it('kills itself when the channel closes after the guard is installed', async () => {
    expect(await workerExit('before the channel closes')).toBe('SIGKILL');
  });

  it('kills itself when the channel had already closed as the guard is installed', async () => {
    expect(await workerExit('after the channel closed')).toBe('SIGKILL');
  });
});

describe('a vitest worker that vitest stops', () => {
  // What a spec's temporary databases close in, and so what removes their LMDB lock semaphores
  /** Stops a worker with SIGTERM, answering how it ended and whether its exit handlers ran */
  async function stopped(name: string, during: string[] = []) {
    const mark = path.join(dir, `${name}-exit-handlers-ran`);
    const script = path.join(dir, `${name}.mts`);
    fs.writeFileSync(script, [
      `import * as fs from 'node:fs';`,
      `await import(${JSON.stringify(GUARD)});`,
      `process.once('exit', () => fs.writeFileSync(${JSON.stringify(mark)}, 'ran'));`,
      ...during,
      `process.send!('ready');`,
      `setTimeout(() => {}, 10_000);`,
    ].join('\n'));
    const worker = fork(script, { execArgv: ['--import', 'tsx'], cwd: PACKAGE_DIR, stdio: 'ignore' });
    try {
      const exited = once(worker, 'exit');
      await once(worker, 'message');
      worker.kill('SIGTERM');
      const [code, signal] = await exited as [number | null, NodeJS.Signals | null];
      return { code, signal, handlersRan: fs.existsSync(mark) };
    } finally {
      worker.kill('SIGKILL');
    }
  }

  it('exits through its exit handlers when it is sent SIGTERM, as tinypool stops a worker', async () => {
    expect(await stopped('between-files')).toEqual({ code: 143, signal: null, handlersRan: true });
  });

  it('runs its exit handlers when it is stopped during a test, where vitest has made process.exit throw', async () => {
    const duringATest = [`process.exit = (() => { throw new Error('process.exit unexpectedly called'); }) as typeof process.exit;`];
    expect(await stopped('during-a-test', duringATest)).toEqual({ code: null, signal: 'SIGKILL', handlersRan: true });
  });
});
