import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { describe, expect, it } from 'vitest';
import { settles } from '@apackdev/sdk/testing/waiting';
import { LOOSE_CEILING_FACTOR } from '@apackdev/sdk/progress';
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

    let grandchild = 0;
    try {
      // The file is there before its pid is, so the pid is what is waited for, however long a busy machine takes
      grandchild = await settles(() => {
        const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
        if (!(pid > 0)) throw new Error('the grandchild has not written its pid');
        return pid;
      });
    } finally {
      // Stopped whatever happened above: a case that failed before this left the whole group running
      stop.abort();
      // Ending its group is what stopping it is, so it is asked nothing of what was running in it
      expect((await running).left).toBeUndefined();
    }
    await expectGone(grandchild);
  });

  // The shell exits 0 at once, leaving the grandchild running: a spec that started a server and forgot it, or a
  // vitest that died with its workers alive. It passed only because something kills what it left
  it('fails a command that exited 0 and left a process running, says which, and kills it', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-spawn-')), 'grandchild.pid');
    const result = await boundedSpawn('sh',
      ['-c', `${process.execPath} -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)' >/dev/null 2>&1 &
while [ ! -s ${JSON.stringify(pidFile)} ]; do sleep 0.05; done`],
      30_000);
    const grandchild = Number(fs.readFileSync(pidFile, 'utf-8'));
    expect(grandchild, 'nothing is proven if the grandchild never started').toBeGreaterThan(0);

    expect(result.code).toBe(1);
    expect(result.left?.map(left => left.pid)).toEqual([grandchild]);
    expect(result.output).toMatch(new RegExp(`it exited and left a process running, which was then killed:\\n {2}pid ${grandchild}: .*setInterval`));
    await expectGone(grandchild);
  });

  // A worker finishing after its pool, a service process reading a pipe that has just closed
  it('passes a command whose child is on its way out when it exits', async () => {
    const result = await boundedSpawn('sh', ['-c', 'sleep 0.4 >/dev/null 2>&1 &'], 30_000);

    expect(result).toMatchObject({ code: 0 });
    expect(result.left).toBeUndefined();
  });

  it('keeps the code of a command that failed by itself, and still says what it left', async () => {
    const result = await boundedSpawn('sh', ['-c', 'sleep 30 >/dev/null 2>&1 & exit 3'], 30_000);

    expect(result.code).toBe(3);
    expect(result.left?.map(left => left.command)).toEqual(['sleep 30']);
  });
});

/**
 * The watchdog over real processes. What it decides is `createStallTracker`'s, tested without a clock in
 * `@apackdev/sdk`'s `progress.spec.ts`; these are what only a real tree shows: reading it, its output reaching the
 * tracker, a descendant outside the group, the flag, and a spinning tree reaching its budget.
 */
describe('a bounded spawn that stops making progress', () => {
  const node = (code: string) => [process.execPath, ['-e', code]] as const;

  it('ends a silent tree that only ticks a timer as stalled, long before its budget', async () => {
    const [command, args] = node('setInterval(() => {}, 5)');
    const result = await boundedSpawn(command, args, 30_000, { idleMs: 2_000 });
    expect(result).toMatchObject({ code: 124, timedOut: true, stalled: true });
    expect(result.ms).toBeLessThan(15_000);
  });

  // Unix alone: Windows has no listing that says what state a process is in
  it.skipIf(process.platform === 'win32')('says what each process of a stalled tree was doing, before it ends them', async () => {
    const [command, args] = node('setInterval(() => {}, 5) // the-one-that-waits');
    const result = await boundedSpawn(command, args, 30_000, { idleMs: 2_000 });
    expect(result.stalled).toBe(true);
    // The process it started, asleep on an event or queued for the CPU to run a tick rather than waiting on a disk, and
    // what it was running. Which of the two it is depends on the load: on a busy machine a tick waits its turn often
    // enough that the listing finds it runnable about half the time
    expect(result.output).toMatch(/Its process tree when it was found doing nothing[^\n]*\n {2}pid \d+ \(parent \d+\) [SR]\S*, \S+ CPU in \S+[^\n]*the-one-that-waits/);
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

  // The cases that spend CPU spin until a ceiling ends them and leave the stall window at its default. A tree counts as working when it adds a second of
  // CPU within the window, so a window of W seconds reads a tree starved below 1/W of a core as stalled while it
  // spins: eight seconds would need an eighth of a core, which a load of 150 on ten cores does not give. The default
  // needs a hundred-and-twentieth, is what every step runs with, and these cases are about the CPU a tree is read to
  // spend rather than about a stall, which the cases above cover
  it('counts the CPU of a descendant in a process group of its own', async () => {
    // Playwright's shape: the runner waits while Electron, started in its own group, does the work. The runner spends
    // next to nothing, so only the descendant's CPU can bring the tree to its budget
    const [command, args] = node(`const { spawn } = require('child_process');
console.log(spawn(process.execPath, ['-e', 'for (;;) {}'], { detached: true, stdio: 'ignore' }).pid);`);
    const budget = 3_000;
    const running = boundedSpawn(command, args, budget);
    let result: Awaited<typeof running> | undefined;
    try {
      result = await running;
    } finally {
      // Outside the group the kill reaches, so ended here, by the pid it was started with
      const descendant = Number((result?.output ?? '').split('\n')[0]);
      if (descendant > 0) {
        try { process.kill(descendant, 'SIGKILL'); } catch { /* exited */ }
        await expectGone(descendant);
      }
    }
    expect(result).toMatchObject({ code: 124, timedOut: true });
    expect(result?.stalled).toBeUndefined();
    expect(result?.cpuMs).toBeGreaterThanOrEqual(budget);
  });

  it('leaves a tree that spins to its CPU budget, which reports a timeout and not a stall', async () => {
    // For ever, so the case rests on the CPU it spends and not on how soon a starved machine gets through a burn
    const [command, args] = node('for (;;) {}');
    const budget = 4_000;
    const result = await boundedSpawn(command, args, budget);
    expect(result).toMatchObject({ code: 124, timedOut: true });
    expect(result.stalled).toBeUndefined();
    expect(result.cpuMs).toBeGreaterThanOrEqual(budget);
    expect(result.output).toContain(`spent its ${budget / 1000}s CPU budget`);
  });

  it('leaves a tree that outlives its budget by the clock alone, which is what a busy machine does to a run', async () => {
    // Twice its budget in wall time, with next to no CPU and output keeping the watchdog quiet
    const [command, args] = node('let n = 0; const t = setInterval(() => { console.log(n); if (++n === 10) clearInterval(t); }, 400)');
    const result = await boundedSpawn(command, args, 2_000, { idleMs: 3_000 });
    expect(result).toMatchObject({ code: 0 });
    expect(result.ms).toBeGreaterThan(2_000);
    expect(result.cpuMs).toBeLessThan(2_000);
  });

  it('holds a tree to ten times its CPU budget under APACK_CEILING=loose, with the watchdog still on', async () => {
    // The container's case: CPU there is the host's load too, so the ceiling is held loosely rather than to its size
    // For ever, so it is the loosened ceiling that ends it, at whatever pace a starved machine lets it get there
    const [command, args] = node('for (;;) {}');
    const budget = 1_000;
    process.env.APACK_CEILING = 'loose';
    try {
      const result = await boundedSpawn(command, args, budget);
      expect(result).toMatchObject({ code: 124, timedOut: true });
      expect(result.stalled).toBeUndefined();
      expect(result.cpuMs).toBeGreaterThanOrEqual(LOOSE_CEILING_FACTOR * budget);
      expect(result.output).toContain(`spent its ${LOOSE_CEILING_FACTOR * budget / 1000}s CPU budget`);
    } finally {
      delete process.env.APACK_CEILING;
    }
  });

  it('bounds a tree it cannot read by the clock', async () => {
    const [command, args] = node('setTimeout(() => {}, 20_000)');
    const result = await boundedSpawn(command, args, 1_500, { idleMs: false });
    expect(result).toMatchObject({ code: 124, timedOut: true });
    expect(result.cpuMs).toBeUndefined();
    expect(result.output).toContain('on the clock');
  });
});
