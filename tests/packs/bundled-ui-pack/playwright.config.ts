import { definePackE2EConfig } from '@apackdev/testing/playwright';

// Everything a pack's E2E suite needs: `tests/e2e`, the suite's timeout, one worker per three cores — each
// launches its own app on its own data dir — and output under `.apack/tests/`. Pass anything Playwright takes.
// Keep failure traces in both focused acceptance and the strict full-chain fixture run.
export default definePackE2EConfig({ use: { trace: 'retain-on-failure' } });
