import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPerformanceRunStore, trialSchema } from '@apackdev/testing/performance';

// One immutable seeded profile, one closed/copy/launch/close trial at a time. Copies are outside measurement.
const root = path.resolve(import.meta.dirname, '../..');
const measured = Number(process.env.APACK_PERFORMANCE_TRIALS ?? 20);
if (!Number.isSafeInteger(measured) || measured < 1 || measured > 100) throw Error('Trials must be between 1 and 100');
if (process.env.E2E_DATA_DIR) throw Error('Startup controller owns its disposable profiles; unset E2E_DATA_DIR');
const mode = process.env.APACK_PERFORMANCE_MODE ?? 'lightweight';
if (!['disabled', 'lightweight', 'detailed'].includes(mode)) throw Error('Invalid recording mode');
const output = path.join(root, '.apack/performance', `populated-startup-${mode}-${Date.now()}`);
mkdirSync(output, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'apack-startup-qualification-'));
const seed = path.join(work, 'seed');
const seedReport = path.join(output, 'seed.json');
let journal: ReturnType<typeof createPerformanceRunStore> | undefined;
const invocations: Array<{ phase: string; index?: number; exitCode: number | null; signal: NodeJS.Signals | null }> = [];
const save = () => {
  writeFileSync(path.join(output, 'lifecycle.json'), JSON.stringify({ invocations }, null, 2));
  journal?.save(invocations);
};
async function run(phase: string, profile: string, index?: number) {
  const environment: NodeJS.ProcessEnv = { ...process.env, E2E_DATA_DIR: profile, APACK_PERFORMANCE_SCENARIO: phase,
    APACK_PERFORMANCE_MODE: mode, APACK_PERFORMANCE_SEED_REPORT: seedReport,
    APACK_PERFORMANCE_INDEX: String(index ?? 0), APACK_PERFORMANCE_OUTPUT: path.join(output, `trial-${index ?? 'seed'}`) };
  delete environment.APACK_PERFORMANCE_STARTUP;
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/with-source.mjs', 'tsx', 'scripts/bounded.ts', 'scenario', 'playwright', 'test', '--config', 'tests/performance/playwright.config.ts'], {
      cwd: root, env: environment, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  invocations.push({ phase, index, ...result });
  if (index !== undefined) {
    try {
      const reportFile = path.join(environment.APACK_PERFORMANCE_OUTPUT!, 'results.json');
      if (statSync(reportFile).size > 128 * 1024 * 1024) throw Error('Startup trial exceeds admission budget');
      const report = JSON.parse(readFileSync(reportFile, 'utf8'));
      const ownManifest = JSON.parse(readFileSync(path.join(environment.APACK_PERFORMANCE_OUTPUT!, 'manifest.json'), 'utf8'));
      journal ??= createPerformanceRunStore(output, ownManifest, measured);
      if (!isDeepStrictEqual(ownManifest, JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8')))) throw Error('Startup trial manifests differ');
      if (report.trials.length !== 1) throw Error('Expected one startup trial per process');
      journal.append(trialSchema.parse(report.trials[0]));
    } catch (error) {
      const file = path.join(environment.APACK_PERFORMANCE_OUTPUT!, 'driver-failure.json');
      try {
        const driver = JSON.parse(readFileSync(file, 'utf8'));
        journal?.append(trialSchema.parse({ scenario: 'populated-startup', index, warmup: index < 5, outcome: 'incomplete', correct: false,
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
  for (let index = 0; index < 5 + measured; index++) {
    const profile = path.join(work, `profile-${index}`);
    cpSync(seed, profile, { recursive: true });
    try { await run('populated-startup', profile, index); }
    finally { rmSync(profile, { recursive: true, force: true }); }
  }
} finally { save(); rmSync(work, { recursive: true, force: true }); }
console.log(`Startup evidence: ${output}`);
