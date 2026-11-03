// Compare the real Vitest reporter API against its console in each pool invocation shape.
// Owned workspaces run tiny passed/skipped fixtures, never another package's product suite.
// Their caches and config-loader output stay private even when dependencies are linked.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { boundedSpawn } from '../../../scripts/lib/bounded-spawn.ts';
import { readReportedRun, SPEC_DURATIONS_FILE, SPEC_DURATIONS_PROGRESS_FILE } from '../../../scripts/lib/spec-durations-reporter.ts';
import { durationsOf } from '../../../scripts/lib/spec-durations.ts';
import { DEADLINE_FACTOR, SIZE_MS } from '../../../scripts/lib/unit-suites.ts';
import { CONFIG_BY_HALF } from '../../../scripts/lib/spec-halves.ts';
import { POOLS, type Pool } from '../../../scripts/lib/unit-pool.ts';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-agrees-'));
const lifetime = new AbortController();
const children: ReturnType<typeof boundedSpawn>[] = [];
afterAll(async () => {
  lifetime.abort();
  await Promise.allSettled([...children, ...runs.values()]);
  fs.rmSync(temp, { recursive: true, force: true });
});

// Keep node_modules itself private: Vite writes config-loader output beside its package links.
function linkVitest(root: string): void {
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(modules);
  for (const name of ['vitest', '.bin']) fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', name),
    path.join(modules, name), process.platform === 'win32' ? 'junction' : 'dir');
}

// eslint-disable-next-line no-control-regex -- the console colours its output and this reads it back
const ANSI = /\u001B\[[0-9;]*m/g;
/**
 * The default reporter's own per-file line, read here and **only** here.
 *
 * This is the pattern the production code stopped carrying, and it is in a spec on purpose: the point is
 * to compare the reporter against the console, which takes reading the console. A spec that is wrong about
 * the format fails; production code that is wrong about it goes quiet, which is why that copy went.
 */
const CONSOLE_LINE = /^\s*[✓×❯]\s+(?:(?:\|[^|]*\||\S+)\s+)?(\S+\.(?:spec|test)\.ts)\s+\([^)]*\)\s+(\d+)ms\b/;

interface Run {
  readonly printed: Map<string, number>;
  readonly reported: ReturnType<typeof readReportedRun>;
  readonly progressFiles: readonly string[];
}

/**
 * Every shape a pool invokes vitest in, which is the population and not an example of it.
 *
 * `standalone` is a package's own config run directly, the **pack** pool's shape — and the one where
 * `TestProject.name` is empty, so the fallback has a subject. `rootConfig` is the root config with
 * `--project`, the **host** pool's, and where most of this repo's durations come from. `integrationConfig`
 * is the root *integration* config, the third pool's, and it runs a different half.
 *
 * The first version of this spec pinned the standalone shape alone and so guarded the minority of the
 * numbers. The second pinned two and called that all of them; the population case below is what said
 * otherwise, and finding a third shape on its first run is the reason it is there rather than a comment
 * asserting the set is complete.
 */
const SHAPES = {
  standalone: () => ({
    half: 'fast' as const,
    command: 'npm',
    args: (workspace: string, reporter: string) =>
      ['test', '-w', workspace, '--', '--reporter=default', `--reporter=${reporter}`],
  }),
  rootConfig: () => ({
    half: 'fast' as const,
    // with-source supplies the condition the host pool's projects resolve under
    command: 'node',
    args: (workspace: string, reporter: string) =>
      [path.join(REPO_ROOT, 'scripts/with-source.mjs'), 'npx', '--no-install', 'vitest', 'run', '--project', workspace,
        '--reporter=default', `--reporter=${reporter}`],
  }),
  integrationConfig: () => ({
    half: 'integration' as const,
    command: 'npx',
    args: (workspace: string, reporter: string) =>
      ['--no-install', 'vitest', 'run', '--config', CONFIG_BY_HALF.integration, '--project', workspace,
        '--reporter=default', `--reporter=${reporter}`],
  }),
} as const;

type Shape = keyof typeof SHAPES;

// All assertions for a shape inspect the same completed child run.
const runs = new Map<Shape, Promise<Run & { workspace: string; files: string[] }>>();
const bothReporters = (shape: Shape) => {
  if (!runs.has(shape)) runs.set(shape, runShape(shape));
  return runs.get(shape)!;
};

async function runShape(shape: Shape): Promise<Run & { workspace: string; files: string[] }> {
  const cwd = path.join(temp, shape), pack = path.join(cwd, 'packages/fixture');
  fs.mkdirSync(path.join(pack, 'tests'), { recursive: true });
  linkVitest(cwd);
  const workspace = '@fixture/durations-reporter';
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: '@fixture/reporter-root', private: true, type: 'module', workspaces: ['packages/*'],
  }));
  fs.writeFileSync(path.join(pack, 'package.json'), JSON.stringify({
    name: workspace, private: true, type: 'module', scripts: { test: 'vitest run' },
  }));
  for (const half of ['fast', 'integration'] as const) {
    const suffix = half === 'fast' ? '.spec.ts' : '.integration.spec.ts';
    for (const name of ['first', 'second']) fs.writeFileSync(path.join(pack, 'tests', name + suffix),
      `import { expect, it } from 'vitest';
       it('calculates a total', () => expect(Array.from({ length: 10000 }, (_, i) => i).reduce((a, b) => a + b, 0)).toBe(49995000));`);
    fs.writeFileSync(path.join(pack, 'tests', 'skipped' + suffix),
      `import { it } from 'vitest'; it.skip('does not run', () => {});`);
    fs.writeFileSync(path.join(pack, CONFIG_BY_HALF[half]), `export default ${JSON.stringify({
      root: pack, cacheDir: path.join(pack, '.cache', half),
      test: { include: [`tests/*${suffix}`], exclude: half === 'fast' ? ['**/*.integration.spec.ts'] : [] },
    })};`);
    fs.writeFileSync(path.join(cwd, CONFIG_BY_HALF[half]), `export default ${JSON.stringify({
      cacheDir: path.join(cwd, '.cache', half),
      test: { projects: [half === 'fast' ? 'packages/fixture' : `packages/fixture/${CONFIG_BY_HALF.integration}`] },
    })};`);
  }
  const out = path.join(cwd, 'durations.json');
  const reporter = path.join(REPO_ROOT, 'scripts/lib/spec-durations-reporter.ts');
  const { half, command, args } = SHAPES[shape]();
  const child = boundedSpawn(command, [...args(workspace, reporter), '--maxWorkers=1', '--minWorkers=1'], SIZE_MS.small,
    { cwd, env: { ...process.env, [SPEC_DURATIONS_FILE]: out, [SPEC_DURATIONS_PROGRESS_FILE]: path.join(cwd, 'progress') }, signal: lifetime.signal });
  children.push(child);
  const result = await child;
  expect(result.code, `${shape} fixture failed: ${result.output}`).toBe(0);
  const printed = new Map<string, number>();
  for (const line of result.output.replace(ANSI, '').split('\n')) {
    const match = CONSOLE_LINE.exec(line);
    if (match !== null) printed.set(match[1]!, Number(match[2]));
  }
  const suffix = half === 'fast' ? '.spec.ts' : '.integration.spec.ts';
  return { printed, reported: readReportedRun(out), workspace,
    progressFiles: fs.readdirSync(cwd).filter(file => /^progress\.\d+\.jsonl$/.test(file)).map(file => path.join(cwd, file)),
    files: ['first', 'second'].map(name => `tests/${name}${suffix}`) };
}

describe('the durations reporter agrees with the console it replaced', () => {
  it.each(Object.keys(SHAPES) as Shape[])('in a %s run, reports the files the console printed with the same milliseconds', async (shape) => {
    const { printed, reported, files } = await bothReporters(shape);
    expect(reported, `no file at ${temp} — the reporter did not run, so this case proves nothing`).toBeDefined();
    expect([...printed.keys()].sort(), 'only the selected fixture half may run').toEqual(files);
    expect(reported!.modules.filter(module => module.skipped)).toHaveLength(1);

    // Also what pins `module.state()`: if it stopped answering `passed`, every module would read as skipped
    // and this set would be empty — which matters because `durationsOf` drops skipped modules, so the pool
    // would record nothing and the marker gate would quietly check no marker at all
    const ran = reported!.modules.filter((module) => !module.skipped);
    expect(ran.map((module) => module.file).sort(), 'the two disagree about which files ran')
      .toEqual([...printed.keys()].sort());

    // **The claim.** `getDurationPrefix` rounds `task.result.duration`; this reads `diagnostic().duration`.
    // Equality after rounding is what says they are the same quantity rather than two near ones, and it is
    // what vitest's own `json` reporter fails — that one has no per-file duration at all, only a span
    // between a module's first and last test, measured 0.5-42ms low per file.
    const disagreed = ran
      .map((module) => ({ file: module.file, reported: module.ms, console: printed.get(module.file)! }))
      .filter((row) => Math.round(row.reported) !== row.console);
    expect(disagreed, 'the reporter and the console no longer name the same duration: vitest has changed what '
      + 'one of diagnostic().duration or task.result.duration means, and every @slow: marker was calibrated '
      + 'against the other').toEqual([]);
  });

  /**
   * And it reports a file's overhead, which the console does not print — so this claim is narrower on purpose.
   *
   * `ms` is pinned to the console's own figure because both read `task.result.duration`. Nothing displays
   * the four fields this sums, so there is no second account to agree with and the most that can be
   * asserted is that it arrives and is a real measurement. Said plainly rather than left to look like the
   * same kind of check as the one above.
   *
   * It is recorded at all because `ms` is tests and hooks only, and which part of the rest dominates
   * depends on the pool: collection for the host pool (68-85s against 71-92s of tests), setup for the pack
   * pool (`content-parity` at 1,703ms of setup against 753ms of tests). A `work/cores` computed from `ms`
   * alone understates by about two, which is how an 18.3s floor came to be read as binding against a
   * `work/cores` of 8.7s.
   */
  it.each(Object.keys(SHAPES) as Shape[])('reports a file\'s overhead beside its tests in a %s run', async (shape) => {
    const { reported } = await bothReporters(shape);
    const ran = reported!.modules.filter((module) => !module.skipped);
    expect(ran, 'no module ran, so there is nothing to have cost anything').not.toEqual([]);
    const missing = ran.filter((module) => !(module.overheadMs > 0));
    expect(missing.map((module) => module.file),
      'a module that ran was imported and prepared, so its overhead cannot be zero — one of '
      + 'collectDuration/setupDuration/environmentSetupDuration/prepareDuration has stopped answering')
      .toEqual([]);
  });

  /**
   * And it names the project in both shapes, which vitest itself does in only one.
   *
   * `TestProject.name` is "the name of the project or **an empty string if not set**", and standalone projects may leave it unnamed. Under the root config vitest fills it from each project's `package.json`; for a
   * standalone run of one package's own config — the pack pool's shape — it is empty. Observed before the
   * fallback existed: the pack pool refused its own run because `@app/default-setup` "never reported". The
   * fallback reads the same `package.json` vitest would, so the two shapes answer alike and there is one
   * notion of a project's identity rather than two that agree by accident.
   */
  it.each(Object.keys(SHAPES) as Shape[])('names the project in a %s run', async (shape) => {
    const { reported, workspace: expected } = await bothReporters(shape);
    expect(reported!.projects, 'the project is unnamed, so attribution would fail for every file in it')
      .toEqual([expected]);
    expect([...new Set(reported!.modules.map((module) => module.project))]).toEqual([expected]);
  });

  it.each(Object.keys(SHAPES) as Shape[])('retains per-file progress separately from completed evidence in a %s run', async (shape) => {
    const { progressFiles, reported } = await bothReporters(shape);
    expect(progressFiles).toHaveLength(1);
    const progress = fs.readFileSync(progressFiles[0]!, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const module of reported!.modules) {
      const events = progress.filter(event => event.file === module.file);
      expect(events.map(event => event.event)).toEqual(['queued', 'ended']);
      expect(events[1]).toMatchObject({ project: module.project, duration: module.ms });
      expect(events[1].collectDuration + events[1].setupDuration
        + events[1].environmentSetupDuration + events[1].prepareDuration).toBe(module.overheadMs);
    }
    expect(readReportedRun(progressFiles[0]!), 'partial diagnostics must never be accepted as a completed run').toBeUndefined();
  });

  // The population, so neither case above can pass over a shape nobody runs
  it('covers every shape a pool invokes vitest in', () => {
    const invoked = (Object.keys(POOLS) as Pool[]).map((pool) =>
      POOLS[pool].run(POOLS[pool].suites())[0]!.command);
    expect(new Set(invoked), 'a pool invokes vitest some way these shapes do not cover')
      .toEqual(new Set(Object.keys(SHAPES).map((shape) => SHAPES[shape as Shape]().command)));
  });
});


it('attributes qualified subprojects to their confirmed workspace without hiding unrelated names', async () => {
  const root = path.join(temp, 'workspace-projects'); fs.mkdirSync(root);
  const workspace = '@fixture/multiple-projects';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: workspace, type: 'module' }));
  linkVitest(root);
  for (const name of ['backend', 'frontend', 'foreign']) fs.writeFileSync(path.join(root, `${name}.spec.ts`),
    `import { it } from 'vitest'; it('runs', () => {});`);
  fs.writeFileSync(path.join(root, 'vitest.config.ts'), `export default { cacheDir: ${JSON.stringify(path.join(root, '.cache'))}, test: { projects: [
    { test: { name: '${workspace}:backend', include: ['backend.spec.ts'] } },
    { test: { name: '${workspace}:frontend', include: ['frontend.spec.ts'] } },
    { test: { name: 'foreign:frontend', include: ['foreign.spec.ts'] } },
  ] } };`);
  const out = path.join(root, 'durations.json');
  const child = boundedSpawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', path.join(root, 'vitest.config.ts'),
    `--reporter=${path.join(REPO_ROOT, 'scripts/lib/spec-durations-reporter.ts')}`, '--maxWorkers=1', '--minWorkers=1'], SIZE_MS.small,
    { cwd: root, env: { ...process.env, [SPEC_DURATIONS_FILE]: out }, signal: lifetime.signal });
  children.push(child);
  const result = await child;
  expect(result.code, result.output).toBe(0);
  const report = readReportedRun(out)!;
  expect([...report.projects].sort()).toEqual([workspace, 'foreign:frontend'].sort());
  expect(report.modules.filter(module => module.project === workspace).map(module => module.file).sort())
    .toEqual(['backend.spec.ts', 'frontend.spec.ts']);
  expect(report.modules.find(module => module.file === 'foreign.spec.ts')?.project).toBe('foreign:frontend');
  expect(() => durationsOf(report, [{ workspace, dir: 'fixture', kind: 'pack' }])).toThrow('none of the');
});

it('records a test that passed past its budget, and only that one, against the budget the deadline implies', async () => {
  const root = path.join(temp, 'over-budget'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@fixture/over-budget', type: 'module' }));
  linkVitest(root);
  // A deadline of 400ms is a budget of 200ms: the slow test passes inside the one and past the other
  fs.writeFileSync(path.join(root, 'timing.spec.ts'), `import { it } from 'vitest';
    it('slow', () => new Promise((resolve) => setTimeout(resolve, 300)));
    it('quick', () => {});`);
  fs.writeFileSync(path.join(root, 'vitest.config.ts'),
    `export default { cacheDir: ${JSON.stringify(path.join(root, '.cache'))}, test: { include: ['timing.spec.ts'], testTimeout: ${2 * DEADLINE_FACTOR * 100} } };`);
  const out = path.join(root, 'durations.json');
  const child = boundedSpawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', path.join(root, 'vitest.config.ts'),
    `--reporter=${path.join(REPO_ROOT, 'scripts/lib/spec-durations-reporter.ts')}`, '--maxWorkers=1', '--minWorkers=1'], SIZE_MS.small,
    { cwd: root, env: { ...process.env, [SPEC_DURATIONS_FILE]: out }, signal: lifetime.signal });
  children.push(child);
  const result = await child;
  expect(result.code, result.output).toBe(0);
  const [module] = readReportedRun(out)!.modules;
  expect(module.overBudget).toEqual([{ name: 'slow', ms: expect.any(Number), budgetMs: 200 }]);
  expect(module.overBudget[0].ms).toBeGreaterThan(200);
});
