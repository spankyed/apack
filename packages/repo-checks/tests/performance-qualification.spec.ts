import { expect, it } from 'vitest';
import { performanceQualificationCommand, performanceQualificationOptions } from '../../../scripts/lib/performance-qualification.ts';
it('selects all four scenarios, declared trials and two different modes', () => {
  const options = performanceQualificationOptions(['--scenario', 'all'], '/checkout', 123);
  expect(options).toMatchObject({ scenarios: ['thread-open', 'search', 'streaming', 'populated-startup'], mode: 'disabled', comparison: 'lightweight', measured: 20,
    output: '/checkout/.apack/performance/qualification-disabled-vs-lightweight-123' });
  for (const args of [['--scenario', 'other'], ['--trials', '1'], ['--trials', '3'], ['--trials', '102'], ['--mode', 'lightweight'], ['--compare', 'other']]) {
    expect(() => performanceQualificationOptions(args, '/checkout')).toThrow();
  }
});
it('runs the actual scenario or startup controller and owns its output and environment', () => {
  const options = performanceQualificationOptions([], '/checkout', 123);
  const command = performanceQualificationCommand('thread-open', '/owned', options, { DISPLAY: ':12', APACK_PERFORMANCE_STARTUP: 'stale', APACK_PERFORMANCE_OUTPUT: 'stale' });
  expect(command.args).toEqual(['scripts/with-source.mjs', 'playwright', 'test', '--config', 'tests/performance/playwright.config.ts']);
  expect(command.env).toMatchObject({ DISPLAY: ':12', APACK_PERFORMANCE_RUN_OUTPUT: '/owned', APACK_PERFORMANCE_MODE: 'disabled', APACK_PERFORMANCE_COMPARE_MODE: 'lightweight', APACK_PERFORMANCE_TRIALS: '20' });
  expect(command.env.APACK_PERFORMANCE_STARTUP).toBeUndefined();
  expect(command.env.APACK_PERFORMANCE_OUTPUT).toBeUndefined();
  expect(performanceQualificationCommand('populated-startup', '/owned', options, {}).args).toEqual(['scripts/with-source.mjs', 'tsx', 'tests/performance/startup-run.ts']);
  expect(() => performanceQualificationCommand('thread-open', '/owned', options, { E2E_DATA_DIR: '/developer' })).toThrow(/disposable/);
});
