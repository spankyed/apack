/** Run all host unit tests through the same scheduling and reporting path as the chain. */
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { BUDGET_MS } from './lib/step-budgets.ts';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run unit tests with npm run test:unit');
const outcome = await boundedSpawn(process.execPath, [npmCli, 'run', 'test:unit:host', '--', '--all'],
  BUDGET_MS.suite.ms, { stream: true });
process.exitCode = outcome.code;
