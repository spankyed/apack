import { definePerformanceConfig } from '@apackdev/testing/playwright';

// One scenario per invocation gives each corpus a fresh owned process/profile.
const scenario = process.env.APACK_PERFORMANCE_SCENARIO ?? 'thread-open';
if (!['thread-open', 'backend-block', 'search', 'search-supersession', 'streaming', 'seed', 'populated-startup'].includes(scenario)) throw new Error('Invalid APACK_PERFORMANCE_SCENARIO');
export default definePerformanceConfig({ testMatch: `${scenario}.spec.ts` });
