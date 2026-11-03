// apack db runs: the flow runs in a data dir's run history, newest first, or one run's whole tree
import * as fs from 'node:fs';
import { _appDataPaths } from '@apackdev/sdk/utils';
import type { EARS } from '@apackdev/ears';
import { _createRunHistory, type RunNode, type RunNodeId } from '@apackdev/sdk/services';
import { findRunningApp, openRunHistory } from '@apackdev/host/database';
import { toJSON } from './output';
import { parseDbArgs, TARGET_USAGE, type DbIo } from './target';

const OPTIONS = {
  run: { type: 'string' },
  flow: { type: 'string' },
  limit: { type: 'string', default: '20' },
  json: { type: 'boolean', default: false },
} as const;

export const RUNS_USAGE = [
  'Usage: apack db runs [--run <id>] [options]',
  '',
  'Lists the flow runs in the run history, newest first: each session\'s root and every flow it ran. With --run,',
  'prints that run and everything under it as JSON.',
  '',
  'Options:',
  '  --run <id>             One run node and its whole tree, as JSON',
  '  --flow <id>            Only the runs of this flow',
  '  --limit <n>            How many runs to list (default 20)',
  '  --json                 The list as JSON',
  TARGET_USAGE,
].join('\n');

/** One line per run: its id, status, when it started, its label and the flow it ran */
export function runLine(run: RunNode): string {
  const flow = run.flowId ? `  (${run.flowId})` : '';
  return `${run.id}  ${run.status.padEnd(9)}  ${new Date(run.startedAt).toISOString()}  ${run.label}${flow}`;
}

export async function dbRuns(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, RUNS_USAGE);
  if (positionals.length > 0) throw new Error(`Unexpected argument ${positionals[0]}\n\n${RUNS_USAGE}`);
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive whole number\n\n${RUNS_USAGE}`);

  const dir = _appDataPaths(target.userDataDir).runHistory;
  io.err(`Run history: ${dir} (offline)`);
  if (!fs.existsSync(dir)) throw new Error(`No run history in ${target.userDataDir}: apack hasn't run a flow on it`);
  const running = findRunningApp(target);
  if (running) io.err(`Warning: apack is running on it (${running.why}); this reads what it has committed`);

  // History is read, never changed, so this works while the app runs. Read-only data.mdb still requires
  // writable reader registration in lock.mdb.
  const runs = openRunHistory(dir, { readOnly: true });
  try {
    const history = _createRunHistory(runs.engine);
    if (typeof values.run === 'string') {
      const tree = history.tree(values.run as RunNodeId);
      if (!tree) throw new Error(`No run node ${values.run} in the run history`);
      io.out(toJSON(tree));
      return;
    }
    const found = history.findRuns({ limit, ...(typeof values.flow === 'string' && { flowId: values.flow as EARS.EntityId }) });
    if (values.json) io.out(toJSON(found));
    else if (found.length === 0) io.out('No runs');
    else found.forEach((run) => io.out(runLine(run)));
  } finally {
    runs.database.close();
  }
}
