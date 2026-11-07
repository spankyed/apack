import { definePerformanceConfig } from '@apackdev/testing/playwright';

// One scenario per invocation gives each corpus a fresh owned process/profile.
const scenario = process.env.APACK_PERFORMANCE_SCENARIO ?? 'thread-open';
const scenarios = ['thread-open', 'search', 'streaming', 'seed', 'populated-startup', 'terminal-open'];
const checks = ['thread-counterfactual', 'search-resource-refusal', 'backend-block', 'renderer-block', 'query-plans', 'search-supersession'];
if (![...scenarios, ...checks].includes(scenario)) throw new Error('Invalid APACK_PERFORMANCE_SCENARIO');
export default definePerformanceConfig({ testMatch: `${scenarios.includes(scenario) ? 'scenarios' : 'checks'}/${scenario}.spec.ts` });
