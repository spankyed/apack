import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packagesBuiltOrRefuse } from '@apackdev/host/build/packages-built';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { TIMEOUT_MS } from './lib/step-timeouts.ts';
import { performanceQualificationCommand, performanceQualificationOptions } from './lib/performance-qualification.ts';

// Explicit manual qualification. Ordinary CI never launches this or gates on its timing budget.
packagesBuiltOrRefuse('npm run packages:ensure');
const { readPerformanceModeComparison } = await import('@apackdev/testing/performance');
const root = path.resolve(import.meta.dirname, '..');
const options = performanceQualificationOptions(process.argv.slice(2), root);
if (process.env.E2E_DATA_DIR) throw Error('Qualification owns disposable profiles; unset E2E_DATA_DIR');
mkdirSync(path.dirname(options.output), { recursive: true });
mkdirSync(options.output);
for (const scenario of options.scenarios) {
  const output = path.join(options.output, scenario);
  mkdirSync(output);
  const command = performanceQualificationCommand(scenario, output, options, process.env);
  console.log(`Qualifying ${scenario}: ${options.mode} versus ${options.comparison}; evidence: ${output}`);
  const result = await boundedSpawn(process.execPath, command.args, TIMEOUT_MS.scenario.ms, { cwd: root, env: command.env, stream: true });
  writeFileSync(path.join(output, 'invocation.json'), JSON.stringify({ code: result.code, durationMs: result.ms,
    timedOut: result.timedOut ?? false, aborted: result.aborted ?? false, command: [process.execPath, ...command.args] }, null, 2));
  if (result.code !== 0) throw Error(`Qualification process failed; evidence: ${output}`);
  const comparison = readPerformanceModeComparison(output, options.measured);
  const status = options.measured < 20 ? 'contract-only' : comparison.budget?.assessment === 'over-budget' ? 'over-budget'
    : comparison.budget?.assessment === 'unresolved' ? 'unresolved' : 'qualified';
  writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({ status, ...comparison }, null, 2));
  console.log(JSON.stringify({ scenario, status, baseline: comparison.baseline.summary, candidate: comparison.candidate.summary,
    medianDifferenceMs: comparison.medianDifferenceMs, medianChangePercent: comparison.medianChangePercent, budget: comparison.budget }));
  if (['over-budget', 'unresolved'].includes(status)) { process.exitCode = 1; }
}
