import { resolveAppEnvironment } from '@apackdev/sdk/env';

/** Only test-owned launches forward recorder configuration to a renderer. */
export function performanceStartupQuery(): { performanceStartup: string } | undefined {
  const input = resolveAppEnvironment().env === 'test' ? process.env.APACK_PERFORMANCE_STARTUP : undefined;
  return input === undefined ? undefined : { performanceStartup: input };
}
