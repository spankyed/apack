import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packagesBuiltOrRefuse } from '@apackdev/host/build/packages-built';
import { boundedSpawn, type BoundedResult } from './lib/bounded-spawn.ts';
import { TIMEOUT_MS } from './lib/step-timeouts.ts';
import { performanceQualificationCommand, performanceRevisionOptions } from './lib/performance-qualification.ts';

packagesBuiltOrRefuse('npm run packages:ensure');
const { coordinatePerformanceRevisions, readPerformanceRevisionComparison } = await import('@apackdev/testing/performance');
const root = path.resolve(import.meta.dirname, '..');
const options = performanceRevisionOptions(process.argv.slice(2), root);
if (process.env.E2E_DATA_DIR) throw Error('Revision comparison owns disposable profiles; unset E2E_DATA_DIR');
const variants = ['A', 'B'] as const;
for (const variant of variants) {
  options.roots[variant] = realpathSync(options.roots[variant]);
  if (!existsSync(path.join(options.roots[variant], 'packages/entry-point.mjs'))) throw Error('Revision root is not an apack checkout');
}
if (options.roots.A !== options.roots.B && realpathSync(path.join(options.roots.A, 'node_modules')) === realpathSync(path.join(options.roots.B, 'node_modules'))) throw Error('Revision worktrees cannot share node_modules');
mkdirSync(path.dirname(options.output), { recursive: true }); mkdirSync(options.output);
const preparation: Array<{ root: string; code: number; timedOut: boolean }> = [];
for (const own of new Set(Object.values(options.roots))) {
  const result = await boundedSpawn(process.execPath, ['scripts/with-source.mjs', 'tsx', 'scripts/chain.ts', '--only', 'packages:ensure,build:default-setup,build:runtime', '--no-native', '--cores', '1'], TIMEOUT_MS.suite.ms, { cwd: own, stream: true });
  preparation.push({ root: own, code: result.code, timedOut: result.timedOut ?? false });
  writeFileSync(path.join(options.output, 'preparation.json'), JSON.stringify(preparation, null, 2));
  if (result.code !== 0) throw Error(`Revision preparation failed; evidence: ${options.output}`);
}
for (const scenario of options.scenarios) {
  const output = path.join(options.output, scenario); mkdirSync(output);
  const abort = new AbortController();
  const deadline = Date.now() + TIMEOUT_MS.scenario.ms;
  const workers: Partial<Record<'A' | 'B', BoundedResult>> = {};
  let evidenceFailed = false;
  const jobs = variants.map(variant => {
    const own = path.join(output, variant); mkdirSync(own);
    const gate = path.join(output, 'coordination', variant); mkdirSync(gate, { recursive: true });
    const command = performanceQualificationCommand(scenario, own, { mode: options.mode, measured: options.measured }, process.env);
    command.env.APACK_PERFORMANCE_GATE = JSON.stringify({ directory: gate, deadline, mode: options.mode, lastIndex: options.measured + 4 });
    return boundedSpawn(process.execPath, command.args, TIMEOUT_MS.scenario.ms, { cwd: options.roots[variant], env: command.env, stream: true, signal: abort.signal }).then(result => {
      workers[variant] = result;
      try { writeFileSync(path.join(own, 'invocation.json'), JSON.stringify({ code: result.code, durationMs: result.ms,
        timedOut: result.timedOut ?? false, aborted: result.aborted ?? false, root: options.roots[variant], command: command.args }, null, 2)); }
      catch { evidenceFailed = true; }
      return result;
    });
  });
  try {
    console.log(`Comparing ${scenario}: ${options.roots.A} versus ${options.roots.B}; evidence: ${output}`);
    await coordinatePerformanceRevisions({ directory: output, mode: options.mode, measured: options.measured, deadline,
      workers: () => evidenceFailed ? { A: { code: 1 } } : workers });
    const results = await Promise.all(jobs);
    if (evidenceFailed || results.some(result => result.code !== 0)) throw Error('Revision process or evidence write failed');
    const comparison = readPerformanceRevisionComparison(output, options.measured);
    writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({ status: options.measured < 20 ? 'contract-only' : 'compared', ...comparison }, null, 2));
    console.log(JSON.stringify({ scenario, baseline: comparison.baseline.summary, candidate: comparison.candidate.summary,
      medianDifferenceMs: comparison.medianDifferenceMs, medianChangePercent: comparison.medianChangePercent }));
  } catch (error) { abort.abort(); await Promise.allSettled(jobs); throw error; }
}
