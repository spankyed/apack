import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expensiveSteps, MACHINE_LOCK } from '../../../scripts/lib/machine-lock.ts';
import { STAMP_DIR } from '../../../scripts/lib/chain-stamps.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-lock-'));
  file = path.join(dir, 'expensive.lock');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** The lock as another chain holds it: this machine's name, and a pid that is running and not ours */
const heldByAnother = (what: string): void => {
  fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, machine: os.hostname(), what, since: new Date().toISOString() }));
};

describe('the machine lock', () => {
  it('lives outside every checkout', () => {
    expect(path.resolve(MACHINE_LOCK).startsWith(path.resolve(STAMP_DIR, '..'))).toBe(false);
    expect(path.dirname(MACHINE_LOCK)).toBe(os.tmpdir());
  });

  it('lets one chain\'s steps overlap under one hold, and goes back when the last leaves', async () => {
    const run = expensiveSteps({ what: 'a chain', file });
    let release!: () => void;
    const first = run(() => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(fs.existsSync(file)).toBe(true);

    // A step of the same chain doesn't wait for its sibling, and leaving doesn't let the lock go while the sibling is in
    await expect(run(async () => 'second')).resolves.toBe('second');
    expect(fs.existsSync(file)).toBe(true);

    release();
    await first;
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false));
  });

  it('waits for another chain, says who for, and goes on when that chain is done', async () => {
    heldByAnother('npm run chain --all');
    const told: string[] = [];
    let pauses = 0;
    const run = expensiveSteps({
      what: 'this chain', file,
      onWait: (holder) => told.push(holder),
      pause: async () => {
        pauses++;
        if (pauses === 3) fs.rmSync(file);
        await new Promise((resolve) => setImmediate(resolve));
      },
    });
    let ran = false;
    await run(async () => { ran = true; expect(pauses).toBeGreaterThanOrEqual(3); });
    expect(ran).toBe(true);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('npm run chain --all');
  });

  it('takes the lock over from a chain that died', async () => {
    fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 1, machine: os.hostname(), what: 'gone', since: new Date().toISOString() }));
    await expect(expensiveSteps({ what: 'this chain', file })(async () => 'ran')).resolves.toBe('ran');
  });

  it('lets go when a step throws, so the next chain isn\'t left waiting', async () => {
    const run = expensiveSteps({ what: 'a chain', file });
    await expect(run(async () => { throw new Error('the step failed'); })).rejects.toThrow('the step failed');
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false));
  });
});
