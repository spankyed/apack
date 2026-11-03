import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { describe, expect, it } from 'vitest';
import { boundedSpawn } from '../../../scripts/lib/bounded-spawn.ts';

/** Signal delivery precedes kernel reaping; require disappearance rather than a single immediate probe. */
async function expectGone(pid: number): Promise<void> {
  await expect.poll(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error;
    }
  }).toBe(true);
}

/**
 * Regression coverage for process startup and cancellation, including the thing that bites a person hours later: `npm run measure --busy` starts processes
 * that burn a core each, and stopping it has to stop them.
 *
 * It spawns a grandchild that outlives its parent shell, because that is the shape the kill has to reach —
 * `npm run x` is a shell that spawns node that spawns vitest, and killing the child orphans the rest. An
 * earlier version of the burners registered its own signal handlers, which could never run, and three of
 * three survived an interrupt.
 */
describe('stopping a bounded spawn', () => {
  it('reports startup failures without an uncaught error', async () => {
    const result = await boundedSpawn('/apack-nonexistent-command', [], 5_000);
    expect(result.code).toBe(1);
    expect(result.output).toContain('ENOENT');
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('reaps a TERM-resistant grandchild on parent-only %s', async (signal) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-parent-'));
    const script = path.join(dir, 'parent.mjs');
    const helper = pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/bounded-spawn.ts')).href;
    const childCode = `process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000)`;
    fs.writeFileSync(script, `import { boundedSpawn } from ${JSON.stringify(helper)};
await boundedSpawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], 30000, {stream: true});`);
    const parent = spawn(process.execPath, ['--import', 'tsx', script], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let grandchild = 0;
    try {
      const exited = once(parent, 'exit');
      const [chunk] = await once(parent.stdout!, 'data');
      grandchild = Number(String(chunk).trim());
      expect(grandchild).toBeGreaterThan(0);
      parent.kill(signal);
      const [, exitSignal] = await exited;
      expect(exitSignal).toBe(signal);
      await expectGone(grandchild);
    } finally {
      parent.kill('SIGKILL');
      if (grandchild) { try { process.kill(grandchild, 'SIGKILL'); } catch { /* exited */ } }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills the whole group, not the process it started', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-spawn-')), 'grandchild.pid');
    const stop = new AbortController();
    const running = boundedSpawn('sh',
      ['-c', `${process.execPath} -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)' & wait`],
      30_000, { signal: stop.signal });

    for (let waited = 0; waited < 5000 && !fs.existsSync(pidFile); waited += 50) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    const grandchild = Number(fs.readFileSync(pidFile, 'utf-8'));
    expect(grandchild, 'nothing is proven if the grandchild never started').toBeGreaterThan(0);

    stop.abort();
    await running;
    await expectGone(grandchild);
  });

  it('kills what the child left in its group when it exits, a pass included', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-spawn-')), 'grandchild.pid');
    // The shell exits 0 at once, leaving the grandchild running: a vitest that died with its workers alive
    const result = await boundedSpawn('sh',
      ['-c', `${process.execPath} -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)' >/dev/null 2>&1 &
while [ ! -s ${JSON.stringify(pidFile)} ]; do sleep 0.05; done`],
      30_000);
    const grandchild = Number(fs.readFileSync(pidFile, 'utf-8'));
    expect(grandchild, 'nothing is proven if the grandchild never started').toBeGreaterThan(0);
    expect(result.code).toBe(0);
    await expectGone(grandchild);
  });
});

/**
 * The watchdog over real processes. What it decides is `createStallTracker`'s, tested without a clock in
 * `process-tree-cpu.spec.ts`; these are what only a real tree shows: reading it, its output reaching the
 * tracker, a descendant outside the group, the flag, and a spinning tree reaching its budget.
 */
describe('a bounded spawn that stops making progress', () => {
  const node = (code: string) => [process.execPath, ['-e', code]] as const;
  const burn = (ms: number) => `const end = Date.now() + ${ms}; while (Date.now() < end) {}`;
  // For the cases that need CPU: wide enough that a tree starved to an eighth of a core still clears a second
  // of CPU in it, since these run beside the rest of the integration pool
  const CPU_IDLE = 8_000;

  it('ends a silent tree that only ticks a timer as stalled, long before its budget', async () => {
    const [command, args] = node('setInterval(() => {}, 5)');
    const result = await boundedSpawn(command, args, 30_000, { idleMs: 2_000 });
    expect(result).toMatchObject({ code: 124, timedOut: true, stalled: true });
    expect(result.ms).toBeLessThan(15_000);
  });

  it('counts output as progress for a tree that is only waiting', async () => {
    const [command, args] = node('let n = 0; const t = setInterval(() => { console.log(n); if (++n === 8) clearInterval(t); }, 500)');
    const result = await boundedSpawn(command, args, 30_000, { idleMs: 1_500 });
    expect(result).toMatchObject({ code: 0 });
  });

  it('leaves an idle tree alone under APACK_WATCHDOG=off', async () => {
    const [command, args] = node('setTimeout(() => {}, 3_000)');
    process.env.APACK_WATCHDOG = 'off';
    try {
      const result = await boundedSpawn(command, args, 30_000, { idleMs: 1_000 });
      expect(result).toMatchObject({ code: 0 });
    } finally {
      delete process.env.APACK_WATCHDOG;
    }
  });

  it('counts the CPU of a descendant in a process group of its own', async () => {
    // Playwright's shape: the runner waits while Electron, started in its own group, does the work
    const [command, args] = node(`const { spawn } = require('child_process');
spawn(process.execPath, ['-e', ${JSON.stringify(burn(CPU_IDLE + 2_000))}], { detached: true, stdio: 'ignore' }).on('exit', () => process.exit(0));`);
    const result = await boundedSpawn(command, args, 60_000, { idleMs: CPU_IDLE });
    expect(result).toMatchObject({ code: 0 });
  });

  it('leaves a tree that spins to its budget, which reports a timeout and not a stall', async () => {
    const [command, args] = node(burn(60_000));
    const result = await boundedSpawn(command, args, CPU_IDLE + 2_000, { idleMs: CPU_IDLE });
    expect(result).toMatchObject({ code: 124, timedOut: true });
    expect(result.stalled).toBeUndefined();
  });
});
