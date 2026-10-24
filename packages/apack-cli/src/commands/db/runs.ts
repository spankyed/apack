// apack db runs: the flow runs in a data dir's run history, newest first, or one run's whole tree
import * as fs from 'node:fs';
import { _appDataPaths } from '@apackdev/sdk/utils';
import type { EARS } from '@apackdev/ears';
import { _createRunHistory, type RunHistory, type RunNode, type RunNodeId } from '@apackdev/sdk/services';
import { findRunningApp, openRunHistoryStore } from '@apackdev/host/database';
import { askRunningApp } from './app';
import { toJSON } from './output';
import { parseDbArgs, TARGET_USAGE, type DbIo, type DbTarget } from './target';

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

  const run = typeof values.run === 'string' ? values.run : undefined;
  const flowId = typeof values.flow === 'string' ? values.flow : undefined;
  // The running app answers from the history it keeps; offline, its store is read here
  const answered = await askRunningApp(target, () => ({ kind: 'runs', limit, ...(run !== undefined && { run }), ...(flowId !== undefined && { flowId }) }), io);
  const found = answered ? answered.result as RunNode[] | RunTree | null : readOffline(target, { run, flowId, limit }, io);

  if (run !== undefined) {
    if (!found) throw new Error(`No run node ${run} in the run history`);
    io.out(toJSON(found));
    return;
  }
  const runs = found as RunNode[];
  if (values.json) io.out(toJSON(runs));
  else if (runs.length === 0) io.out('No runs');
  else runs.forEach((each) => io.out(runLine(each)));
}

type RunTree = NonNullable<ReturnType<RunHistory['tree']>>;

/** One run's tree, or the runs newest first, read from the run history's own store */
function readOffline(target: DbTarget, { run, flowId, limit }: { run?: string; flowId?: string; limit: number }, io: DbIo): RunNode[] | RunTree | null {
  const dir = _appDataPaths(target.userDataDir).runHistory;
  io.err(`Run history: ${dir} (offline)`);
  if (!fs.existsSync(dir)) throw new Error(`No run history in ${target.userDataDir}: apack hasn't run a flow on it`);
  const running = findRunningApp(target);
  if (running) io.err(`Warning: apack is running on it (${running.why}); what it hasn't written yet isn't here`);

  // Read-only: the history is read, never changed, so this works while an app runs and on files it may not write
  const store = openRunHistoryStore(dir, { readOnly: true });
  try {
    const history = _createRunHistory(store);
    if (run !== undefined) return history.tree(run as RunNodeId) ?? null;
    return history.findRuns({ limit, ...(flowId !== undefined && { flowId: flowId as EARS.EntityId }) });
  } finally {
    store.close();
  }
}
