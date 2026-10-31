import { expect, it } from 'vitest';
import path from 'node:path';
import { performanceQualificationCommand, performanceQualificationOptions, performanceRevisionOptions } from '../../../scripts/lib/performance-qualification.ts';
it('selects all four scenarios, declared trials and two different modes', () => {
  const options = performanceQualificationOptions(['--scenario', 'all'], '/checkout', 123);
  expect(options).toMatchObject({ scenarios: ['thread-open', 'search', 'streaming', 'populated-startup'], mode: 'disabled', comparison: 'lightweight', measured: 20,
    output: path.resolve('/checkout/.apack/performance/qualification-disabled-vs-lightweight-123') });
  for (const args of [['--scenario', 'other'], ['--trials', '1'], ['--trials', '3'], ['--trials', '102'], ['--mode', 'lightweight'], ['--compare', 'other']]) {
    expect(() => performanceQualificationOptions(args, '/checkout')).toThrow();
  }
});
it('runs the actual scenario or startup controller and owns its output and environment', () => {
  const options = performanceQualificationOptions([], '/checkout', 123);
  const command = performanceQualificationCommand('thread-open', '/owned', options, { DISPLAY: ':12', APACK_PERFORMANCE_STARTUP: 'stale', APACK_PERFORMANCE_OUTPUT: 'stale' });
  expect(command.args).toEqual(['scripts/with-source.mjs', 'playwright', 'test', '--config', 'tests/performance/playwright.config.ts', '--output', path.join('/owned', 'playwright')]);
  expect(command.env).toMatchObject({ DISPLAY: ':12', APACK_PERFORMANCE_RUN_OUTPUT: '/owned', APACK_PERFORMANCE_MODE: 'disabled', APACK_PERFORMANCE_COMPARE_MODE: 'lightweight', APACK_PERFORMANCE_TRIALS: '20' });
  expect(command.env.APACK_PERFORMANCE_STARTUP).toBeUndefined();
  expect(command.env.APACK_PERFORMANCE_OUTPUT).toBeUndefined();
  expect(performanceQualificationCommand('populated-startup', '/owned', options, {}).args).toEqual(['scripts/with-source.mjs', 'tsx', 'tests/performance/startup-run.ts']);
  expect(() => performanceQualificationCommand('thread-open', '/owned', options, { E2E_DATA_DIR: '/developer' })).toThrow(/disposable/);
});

it('requires explicit revision checkouts and uses independent worker output without nested mode comparison', () => {
  const options = performanceRevisionOptions(['--baseline', 'before', '--candidate', 'after', '--scenario', 'all'], '/checkout', 123);
  expect(options.roots).toEqual({ A: path.resolve('/checkout', 'before'), B: path.resolve('/checkout', 'after') });
  expect(options.scenarios).toHaveLength(4); expect(options.measured).toBe(20);
  const command = performanceQualificationCommand('search', '/owned/B', { mode: 'lightweight', measured: 20 }, { APACK_PERFORMANCE_COMPARE_MODE: 'detailed', APACK_PERFORMANCE_GATE: 'stale' });
  expect(command.env.APACK_PERFORMANCE_COMPARE_MODE).toBeUndefined();
  expect(command.env.APACK_PERFORMANCE_GATE).toBeUndefined();
  for (const args of [[], ['--baseline', 'before'], ['--baseline', 'before', '--candidate', 'after', '--trials', '3']]) expect(() => performanceRevisionOptions(args, '/checkout')).toThrow();
});
