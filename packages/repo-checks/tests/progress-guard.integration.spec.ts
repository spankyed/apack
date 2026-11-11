// The progress guard (`@apackdev/testing`'s `vitest-progress-guard.ts`) over a real vitest run: what it fails and
// what it leaves alone, read from vitest's own JSON report. Every config in the repo turns vitest's clock off and
// loads it (`suite-timeouts.spec.ts`), so this is the whole of what bounds a test.
//
// Each fixture file acts out one shape. The idle window is the config's (`apack.idleMs`), shortened for these specs
// alone: the guard counts a tree as working once it adds a second of CPU in a window, so a window much shorter than
// this would fail a test starved below a fraction of a core, which is the load this exists to survive.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { boundedSpawn } from '../../../scripts/lib/bounded-spawn.ts';
import { SIZE_MS } from '../../../scripts/lib/unit-suites.ts';

const IDLE_MS = 15_000;
const GUARD = path.join(REPO_ROOT, 'packages/apack-testing/src/vitest-progress-guard.ts');
const burn = (ms: number) => `const end = Date.now() + ${ms}; while (Date.now() < end) {}`;

const FIXTURES: Record<string, string> = {
  'awaits.spec.ts': `import { it } from 'vitest';
    it('awaits forever', async () => { await new Promise(() => {}); });
    it('runs after the stalled one', () => {});`,
  // Fake timers replace the clock the guard would read, so this hang is found only by a guard holding the real one
  'faked.spec.ts': `import { it, vi } from 'vitest';
    it('fakes timers and awaits forever', async () => { vi.useFakeTimers(); await new Promise(() => {}); });`,
  'hook.spec.ts': `import { beforeAll, it } from 'vitest';
    beforeAll(async () => { await new Promise(() => {}); });
    it('never reached', () => {});`,
  'child.spec.ts': `import { it } from 'vitest';
    import { spawn } from 'node:child_process';
    it('waits on a child that sleeps', async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      try { await new Promise((resolve) => child.on('exit', resolve)); } finally { child.kill('SIGKILL'); }
    });`,
  // Longer on the clock than vitest's own 5s default, working throughout: what a busy machine does to a test
  'slow.spec.ts': `import { it } from 'vitest';
    it('is slow and working', async () => {
      for (let i = 0; i < 12; i++) { ${burn(500)} await new Promise((r) => setTimeout(r, 500)); }
    });`,
  'spin.spec.ts': `import { it } from 'vitest';
    it('spins', { meta: { cpuBudgetMs: 2_000 } }, async () => {
      for (;;) { ${burn(200)} await new Promise((r) => setImmediate(r)); }
    });`,
  // Two tests running together, each inside its own budget and past it together: charged each other's CPU, both
  // would be killed for work neither did
  'concurrent.spec.ts': `import { describe, it } from 'vitest';
    const share = async () => { for (let i = 0; i < 40; i++) { ${burn(100)} await new Promise((r) => setImmediate(r)); } };
    describe.concurrent('together', () => {
      it('one', { meta: { cpuBudgetMs: 5_000 } }, share);
      it('two', { meta: { cpuBudgetMs: 5_000 } }, share);
    });`,
  // Past its budget and finite: the ceiling's case for a run whose CPU is not a reading of work
  'over.spec.ts': `import { it } from 'vitest';
    it('spends past its budget', { meta: { cpuBudgetMs: 1_000 } }, () => { ${burn(3_000)} });`,
  // Started to outlive its starter, and nothing ends it. Each of these sleeps ends by itself, so none outlives
  // this spec by more than its seconds
  'detaches.spec.ts': `import { it } from 'vitest';
    import { spawn } from 'node:child_process';
    it('detaches a process and ends', () => { spawn('sleep', ['20'], { detached: true, stdio: 'ignore' }).unref(); });`,
  // What a git hook left in the background is: its parent exits and it runs on in the worker's process group
  'orphans.spec.ts': `import { it } from 'vitest';
    import { spawn } from 'node:child_process';
    it('starts a process whose parent exits', async () => {
      const shell = spawn('sh', ['-c', 'sleep 21 &'], { stdio: 'ignore' });
      await new Promise((resolve) => shell.on('exit', resolve));
    });`,
  // One signalled and not waited for, and one that ends by itself moments after its file does
  'ends.spec.ts': `import { it } from 'vitest';
    import { spawn } from 'node:child_process';
    it('signals a detached process without waiting for it', () => { spawn('sleep', ['22'], { detached: true, stdio: 'ignore' }).kill(); });
    it('detaches a process that is about to end', () => { spawn('sleep', ['1'], { detached: true, stdio: 'ignore' }).unref(); });`,
};

interface Report {
  testResults: { name: string; message: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-guard-'));
const lifetime = new AbortController();
afterAll(() => {
  lifetime.abort();
  fs.rmSync(temp, { recursive: true, force: true });
});

async function runFixtures(name: string, include: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Report> {
  const root = path.join(temp, name);
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', 'vitest'), path.join(root, 'node_modules', 'vitest'), 'dir');
  for (const file of include) fs.writeFileSync(path.join(root, file), FIXTURES[file]!);
  fs.writeFileSync(path.join(root, 'vitest.config.ts'), `export default { cacheDir: ${JSON.stringify(path.join(root, '.cache'))}, test: {
    include: ${JSON.stringify(include)}, testTimeout: 0, hookTimeout: 0, provide: { 'apack.idleMs': ${IDLE_MS} },
    setupFiles: [${JSON.stringify(GUARD)}] } };`);
  const out = path.join(root, 'report.json');
  const result = await boundedSpawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', path.join(root, 'vitest.config.ts'), '--reporter=json', `--outputFile=${out}`, `--maxWorkers=${include.length}`],
  SIZE_MS.large, { cwd: root, env: { ...process.env, ...env }, signal: lifetime.signal });
  expect(fs.existsSync(out), `vitest wrote no report:\n${result.output}`).toBe(true);
  return JSON.parse(fs.readFileSync(out, 'utf-8')) as Report;
}

const outcome = (report: Report, file: string, test: string) =>
  report.testResults.find((result) => result.name.endsWith(file))?.assertionResults.find((each) => each.title === test);

describe('with the CPU ceiling on', () => {
  let report: Report;
  beforeAll(async () => {
    report = await runFixtures('ceiling', ['awaits.spec.ts', 'faked.spec.ts', 'hook.spec.ts', 'child.spec.ts', 'slow.spec.ts', 'spin.spec.ts', 'concurrent.spec.ts']);
  });

  it('fails a test that awaits forever, as itself, and runs the next one', () => {
    expect(outcome(report, 'awaits.spec.ts', 'awaits forever')).toMatchObject({ status: 'failed' });
    expect(outcome(report, 'awaits.spec.ts', 'awaits forever')!.failureMessages.join('\n')).toContain(`"awaits forever" stalled: its worker's process tree used no CPU for ${IDLE_MS / 1000}s`);
    expect(outcome(report, 'awaits.spec.ts', 'runs after the stalled one')).toMatchObject({ status: 'passed' });
  });

  it('fails a test that fakes timers and hangs, the guard keeping the real clock', () => {
    expect(outcome(report, 'faked.spec.ts', 'fakes timers and awaits forever')!.failureMessages.join('\n')).toContain('stalled');
  });

  it('fails a file whose hook awaits forever, naming the file', () => {
    const file = report.testResults.find((result) => result.name.endsWith('hook.spec.ts'))!;
    expect(file.message).toMatch(/hook\.spec\.ts \(its beforeAll, afterAll and the time between tests\) stalled/);
  });

  it('counts a child that sleeps as no progress', () => {
    expect(outcome(report, 'child.spec.ts', 'waits on a child that sleeps')!.failureMessages.join('\n')).toContain('stalled');
  });

  it('leaves a test alone that is slow on the clock and working', () => {
    expect(outcome(report, 'slow.spec.ts', 'is slow and working')).toMatchObject({ status: 'passed' });
  });

  it('holds tests running together to no budget of their own, since their CPU cannot be split', () => {
    expect(outcome(report, 'concurrent.spec.ts', 'one')).toMatchObject({ status: 'passed' });
    expect(outcome(report, 'concurrent.spec.ts', 'two')).toMatchObject({ status: 'passed' });
  });

  it('fails a test that spins, at its CPU budget, saying what it spent', () => {
    expect(outcome(report, 'spin.spec.ts', 'spins')!.failureMessages.join('\n')).toMatch(/"spins" spent its 2s CPU budget: [\d.]+s of CPU in [\d.]+s of wall time/);
  });
});

describe('under APACK_CEILING=loose', () => {
  it('lets a test spend past its budget within ten times it, the stall still judged', async () => {
    const report = await runFixtures('ceiling-loose', ['over.spec.ts', 'awaits.spec.ts'], { APACK_CEILING: 'loose' });
    expect(outcome(report, 'over.spec.ts', 'spends past its budget')).toMatchObject({ status: 'passed' });
    expect(outcome(report, 'awaits.spec.ts', 'awaits forever')).toMatchObject({ status: 'failed' });
  });
});

// Unix alone: a listing there says which process group each process is in, which is what both shapes are read from
describe.skipIf(process.platform === 'win32')('a file that ends with a process still running', () => {
  const file = (report: Report, name: string) => report.testResults.find((result) => result.name.endsWith(name))!;

  it('fails a file that detached a process, naming it, and leaves alone one whose processes are on their way out', async () => {
    const report = await runFixtures('detached', ['detaches.spec.ts', 'ends.spec.ts']);

    expect(outcome(report, 'detaches.spec.ts', 'detaches a process and ends'), 'its tests passed').toMatchObject({ status: 'passed' });
    expect(file(report, 'detaches.spec.ts').message).toMatch(/detaches\.spec\.ts left a process running:\n {2}pid \d+: sleep 20 .*started by this file, detached from it/);
    expect(file(report, 'ends.spec.ts')).toMatchObject({ status: 'passed', message: '' });
  });

  // Alone in its run: nothing is left to say which worker an orphan came from, so a file running beside this one
  // would be failed for it too
  it('fails a file whose process lost its parent and ran on', async () => {
    const report = await runFixtures('orphaned', ['orphans.spec.ts']);

    expect(file(report, 'orphans.spec.ts').message).toMatch(/pid \d+: sleep 21 .*lost its parent while this file ran/);
  });
});
