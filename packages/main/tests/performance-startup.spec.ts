import { afterEach, expect, it, vi } from 'vitest';
const environment = vi.hoisted(() => ({ env: 'production' }));
vi.mock('@apackdev/sdk/env', () => ({ resolveAppEnvironment: () => environment }));
import { performanceStartupQuery } from '../src/modules/performance/startup.ts';
afterEach(() => vi.unstubAllEnvs());

it('forwards launch configuration only for a test-owned renderer', () => {
  const input = JSON.stringify({ mode: 'detailed' });
  vi.stubEnv('APACK_PERFORMANCE_STARTUP', input);
  for (const env of ['production', 'development']) {
    environment.env = env;
    expect(performanceStartupQuery()).toBeUndefined();
  }
  environment.env = 'test';
  for (const value of [input, '']) {
    vi.stubEnv('APACK_PERFORMANCE_STARTUP', value);
    expect(performanceStartupQuery()).toEqual({ performanceStartup: value });
  }
  vi.stubEnv('APACK_PERFORMANCE_STARTUP', undefined);
  expect(performanceStartupQuery()).toBeUndefined();
});
