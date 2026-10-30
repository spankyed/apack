import path from 'node:path';
import { parseArgs } from 'node:util';

const SCENARIOS = ['thread-open', 'search', 'streaming', 'populated-startup'] as const;
const MODES = ['disabled', 'lightweight', 'detailed'] as const;
export function performanceQualificationOptions(args: string[], root: string, now = Date.now()) {
  const { values } = parseArgs({ args, options: { scenario: { type: 'string', default: 'thread-open' },
    mode: { type: 'string', default: 'disabled' }, compare: { type: 'string', default: 'lightweight' },
    trials: { type: 'string', default: '20' }, output: { type: 'string' } }, strict: true });
  const scenario = values.scenario!;
  if (scenario !== 'all' && !(SCENARIOS as readonly string[]).includes(scenario)) throw Error('Invalid qualification scenario');
  if (!(MODES as readonly string[]).includes(values.mode!) || !(MODES as readonly string[]).includes(values.compare!) || values.mode === values.compare) throw Error('Select two different recording modes');
  const measured = Number(values.trials);
  if (!Number.isSafeInteger(measured) || measured < 2 || measured > 100 || measured % 2) throw Error('ABBA trials must be an even number between 2 and 100');
  return { scenarios: scenario === 'all' ? [...SCENARIOS] : [scenario as typeof SCENARIOS[number]],
    mode: values.mode!, comparison: values.compare!, measured,
    output: path.resolve(root, values.output ?? `.apack/performance/qualification-${values.mode}-vs-${values.compare}-${now}`) };
}
export function performanceQualificationCommand(scenario: string, output: string, options: ReturnType<typeof performanceQualificationOptions>, inherited: NodeJS.ProcessEnv) {
  if (inherited.E2E_DATA_DIR) throw Error('Qualification owns disposable profiles; unset E2E_DATA_DIR');
  const env: NodeJS.ProcessEnv = { ...inherited, APACK_PERFORMANCE_SCENARIO: scenario, APACK_PERFORMANCE_MODE: options.mode,
    APACK_PERFORMANCE_COMPARE_MODE: options.comparison, APACK_PERFORMANCE_TRIALS: String(options.measured), APACK_PERFORMANCE_RUN_OUTPUT: output };
  for (const key of ['APACK_PERFORMANCE_STARTUP', 'APACK_PERFORMANCE_SEED_REPORT', 'APACK_PERFORMANCE_INDEX', 'APACK_PERFORMANCE_OUTPUT']) delete env[key];
  return { env, args: ['scripts/with-source.mjs', ...(scenario === 'populated-startup'
    ? ['tsx', 'tests/performance/startup-run.ts'] : ['playwright', 'test', '--config', 'tests/performance/playwright.config.ts'])] };
}
