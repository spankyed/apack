import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertComparable, validatePerformanceRun } from '@apackdev/testing/performance';

// Manual report admission, separate from ordinary CI's deterministic checks.
const [leftPath, rightPath, countInput = '20'] = process.argv.slice(2);
if (!leftPath) throw Error('Usage: verify-run.ts RUN [COMPARISON_RUN] [MEASURED_TRIALS]');
const measured = Number(countInput);
function read(file: string): unknown {
  // Check before allocating/parsing. Per-process bounds are checked by the shared schemas.
  if (statSync(file).size > 64 * 1024 * 1024) throw Error(`Report exceeds the 64 MiB admission budget: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
function load(directory: string) {
  const result = read(path.join(directory, 'results.json')) as { trials?: unknown; status?: string; invocations?: Array<{ exitCode: number | null }> };
  const trials = result.trials as Array<{ scenario?: string }> | undefined;
  const startup = trials?.[0]?.scenario === 'populated-startup';
  if (startup && (result.status !== 'passed' || !Array.isArray(result.invocations)
    || result.invocations.length !== measured + 6 || result.invocations.some(invocation => invocation.exitCode !== 0))) throw Error('Incomplete startup invocation lifecycle');
  const manifest = read(path.join(directory, startup ? 'trial-0/manifest.json' : 'manifest.json'));
  const run = validatePerformanceRun(manifest, result.trials, measured);
  if (startup) for (const trial of run.trials) {
    const ownManifest = read(path.join(directory, `trial-${trial.index}/manifest.json`));
    // Unlike cross-revision comparison, trials within a run must have identical source/build identities too.
    if (JSON.stringify(ownManifest) !== JSON.stringify(manifest)) throw Error('Startup trial manifests differ');
    const own = read(path.join(directory, `trial-${trial.index}/results.json`)) as { trials?: unknown };
    if (JSON.stringify(own.trials) !== JSON.stringify([trial])) throw Error('Startup aggregate differs from its trial report');
  }
  return run;
}
const left = load(path.resolve(leftPath));
if (!rightPath) console.log(JSON.stringify({ status: 'validated-run', scenario: left.trials[0]!.scenario, summary: left.summary }, null, 2));
else {
  const right = load(path.resolve(rightPath));
  assertComparable(left.manifest, right.manifest);
  if (left.trials[0]!.scenario !== right.trials[0]!.scenario) throw Error('Incompatible scenarios');
  const baseline = left.summary.medianMs!;
  const candidate = right.summary.medianMs!;
  console.log(JSON.stringify({ baseline: left.summary, candidate: right.summary,
    medianDifferenceMs: candidate - baseline, medianChangePercent: baseline === 0 ? null : (candidate / baseline - 1) * 100,
    limitation: 'Report compatibility alone does not certify balanced execution order or quiet resources' }, null, 2));
}
