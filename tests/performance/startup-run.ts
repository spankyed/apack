import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPerformanceScenarioRun, performanceSchedule, manifestSchema, trialSchema, type PerformanceInvocation, type PerformanceScheduleEntry, type PerformanceVariant } from '@apackdev/testing/performance';

// One closed immutable seed; every scheduled mode gets a copied profile and a fresh process.
const root = path.resolve(import.meta.dirname, '../..');
const measured = Number(process.env.APACK_PERFORMANCE_TRIALS ?? 20);
const mode = process.env.APACK_PERFORMANCE_MODE ?? 'lightweight';
const comparison = process.env.APACK_PERFORMANCE_COMPARE_MODE;
const schedule = performanceSchedule(mode, measured, comparison);
if (process.env.E2E_DATA_DIR) throw Error('Startup controller owns its disposable profiles; unset E2E_DATA_DIR');
const output = process.env.APACK_PERFORMANCE_RUN_OUTPUT ? path.resolve(process.env.APACK_PERFORMANCE_RUN_OUTPUT)
  : path.join(root, '.apack/performance', `populated-startup-${mode}${comparison ? `-vs-${comparison}` : ''}-${Date.now()}`);
mkdirSync(output, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'apack-startup-qualification-'));
const seed = path.join(work, 'seed');
const seedReport = path.join(output, 'seed.json');
let journal: ReturnType<typeof createPerformanceScenarioRun> | undefined;
const invocations: Record<PerformanceVariant, PerformanceInvocation[]> = { A: [], B: [] };
const variants: PerformanceVariant[] = comparison ? ['A', 'B'] : ['A'];
const save = () => {
  writeFileSync(path.join(output, 'lifecycle.json'), JSON.stringify({ invocations }, null, 2));
  journal?.save(invocations);
};
async function run(phase: 'seed' | 'populated-startup', profile: string, entry?: PerformanceScheduleEntry) {
  const variant = entry?.variant ?? 'A';
  const own = comparison && entry ? path.join(output, variant) : output;
  const environment: NodeJS.ProcessEnv = { ...process.env, E2E_DATA_DIR: profile, APACK_PERFORMANCE_SCENARIO: phase,
    APACK_PERFORMANCE_EXECUTION_POLICY: comparison ? 'alternating-modes-v1' : 'single-scenario-v1',
    APACK_PERFORMANCE_MODE: entry?.mode ?? mode, APACK_PERFORMANCE_SEED_REPORT: seedReport,
    APACK_PERFORMANCE_INDEX: String(entry?.index ?? 0), APACK_PERFORMANCE_OUTPUT: path.join(own, `trial-${entry?.index ?? 'seed'}`) };
  delete environment.APACK_PERFORMANCE_STARTUP;
  delete environment.APACK_PERFORMANCE_COMPARE_MODE;
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/with-source.mjs', 'tsx', 'scripts/bounded.ts', 'scenario', 'playwright', 'test', '--config', 'tests/performance/playwright.config.ts'], {
      cwd: root, env: environment, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  for (const target of entry ? [variant] : variants) invocations[target].push({ phase, index: entry?.index, ...result });
  if (entry) {
    try {
      const reportFile = path.join(environment.APACK_PERFORMANCE_OUTPUT!, 'results.json');
      if (statSync(reportFile).size > 128 * 1024 * 1024) throw Error('Startup trial exceeds admission budget');
      const report = JSON.parse(readFileSync(reportFile, 'utf8'));
      const ownManifest = JSON.parse(readFileSync(path.join(environment.APACK_PERFORMANCE_OUTPUT!, 'manifest.json'), 'utf8'));
      if (!isDeepStrictEqual(ownManifest, JSON.parse(readFileSync(path.join(own, 'manifest.json'), 'utf8')))) throw Error('Startup trial manifests differ');
      if (report.trials.length !== 1) throw Error('Expected one startup trial per process');
      journal!.append(entry, trialSchema.parse(report.trials[0]));
    } catch (error) {
      const file = path.join(environment.APACK_PERFORMANCE_OUTPUT!, 'driver-failure.json');
      try {
        const driver = JSON.parse(readFileSync(file, 'utf8'));
        journal!.append(entry, trialSchema.parse({ scenario: 'populated-startup', index: entry.index, warmup: entry.warmup, outcome: 'incomplete', correct: false,
          completion: 'missing', work: {}, processes: { driver }, failure: 'startup-process-failed' }));
      } catch { /* Invocation failure remains explicit even when the worker could not write a capture. */ }
      save(); throw error;
    }
  }
  save();
  if (result.exitCode !== 0) throw Error(`Startup ${phase} failed; preserved evidence: ${output}`);
}
try {
  await run('seed', seed);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(`${seedReport}.manifest.json`, 'utf8')));
  journal = createPerformanceScenarioRun(output, manifest, measured, comparison);
  save();
  for (const entry of schedule) {
    const profile = path.join(work, `profile-${entry.ordinal}`);
    cpSync(seed, profile, { recursive: true });
    try { journal.begin(entry); await run('populated-startup', profile, entry); }
    finally { rmSync(profile, { recursive: true, force: true }); }
  }
} finally { save(); rmSync(work, { recursive: true, force: true }); }
console.log(`Startup evidence: ${output}`);
