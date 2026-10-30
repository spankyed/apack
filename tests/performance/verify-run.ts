import path from 'node:path';
import { assertComparable, readPerformanceRun } from '@apackdev/testing/performance';

// Manual report admission, separate from ordinary CI's deterministic checks.
const [leftPath, rightPath, countInput = '20'] = process.argv.slice(2);
if (!leftPath) throw Error('Usage: verify-run.ts RUN [COMPARISON_RUN] [MEASURED_TRIALS]');
const measured = Number(countInput);
const load = (directory: string) => readPerformanceRun(directory, measured);
const left = load(path.resolve(leftPath));
if (!rightPath) console.log(JSON.stringify({ status: 'validated-run', scenario: left.scenario, summary: left.summary }, null, 2));
else {
  const right = load(path.resolve(rightPath));
  assertComparable(left.manifest, right.manifest);
  if (left.scenario !== right.scenario) throw Error('Incompatible scenarios');
  const baseline = left.summary.medianMs!;
  const candidate = right.summary.medianMs!;
  console.log(JSON.stringify({ baseline: left.summary, candidate: right.summary,
    medianDifferenceMs: candidate - baseline, medianChangePercent: baseline === 0 ? null : (candidate / baseline - 1) * 100,
    limitation: 'Report compatibility alone does not certify balanced execution order or quiet resources' }, null, 2));
}
