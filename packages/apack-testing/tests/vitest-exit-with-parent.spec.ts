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
