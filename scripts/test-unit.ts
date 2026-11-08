/**
 * The unit suites, as two pools, one after another.
 *
 * One pool hands vitest every project's files as one list, which its sequencer sorts longest-first — the
 * greedy makespan approximation. Running suites as separate invocations would be two schedulers with no
 * shared budget, oversubscribing within a suite instead of filling idle cores.
 *
 * **There are two pools and not one, and the boundary is forced.** Host suites resolve the workspace
 * `@apackdev` packages to source under the `@apackdev/source` condition; the pack suite must resolve the
 * published `dist`, which is the only layout a pack author ever has. Node conditions are per process and
 * vitest shares its worker pool across projects — per-project `poolOptions.execArgv` is ignored, measured —
 * so one process cannot give each kind its own. Probed 2026-09-25: under a pooled process carrying the
 * condition, a `default-setup` spec resolves `@apackdev/sdk` to `src` where it resolves `dist` today. One
 * pool would not have failed; it would have quietly tested something else.
 *
 * `packages:ensure` is not run here: each pool run does it, for the reason npm `pretest` hooks do not fire
 * under a root run. Doing it in the driver as well invoked it three times for one command.
 */
import * as os from 'node:os';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { BUDGET_MS, whyKilled } from './lib/step-budgets.ts';
import { UNIT_SUITES } from './lib/unit-suites.ts';
import { poolDurationLines, type Pool as PoolKind } from './lib/unit-pool.ts';
import { exitOnEpipe } from './lib/exit-on-epipe.ts';

exitOnEpipe();

/**
 * The two pools this command runs, each through `scripts/test-unit-pool.ts`.
 *
 * **Never vitest directly, with its own copy of what a pool is.** `scripts/lib/unit-pool.ts` declares a
 * pool's half, suites and invocation, and the pool runner owns the durations reporter, the `@slow:` marker
 * gate, the per-file ranking and the duration cache — so a second path would check less.
 *
 * `--all` because this command means *all the unit tests*. The pool runner's per-project staleness is for
 * the chain, which asks what changed; asked by hand, the answer should not depend on what a previous run
 * happened to cover.
 *
 * `integration` is not here: it is `npm run test:integration`, its own pool and its own chain step.
 */
interface Pool { label: string; kind: PoolKind }

const POOLS: Pool[] = (['host', 'pack'] as const).map((kind) => ({
  // Named rather than counted where there is one, since `pack pool (1 suite)` says less than the suite does
  label: ((held: readonly { workspace: string }[]) =>
    `${kind} pool (${held.length === 1 ? held[0]!.workspace : `${held.length} suites`})`)(UNIT_SUITES.filter((suite) => suite.kind === kind)),
  kind,
}));

const cpus = os.availableParallelism?.() ?? os.cpus().length;

/**
 * **There is no lane scheduler here.** It runs the pools one after another and lets each one's vitest own
 * the cores, so there are never two budgets. `--maxWorkers` is the single budget,
 * which is Decision 6 of `goal-test-tiers.md` satisfied by construction rather than by a script.
 *
 * Running the two pools at once was measured and is not worth it: 34.3s against 35.2s serial, for 66.0s of
 * pool time against 35.2s, and one of those runs failed a test. The host pool alone is 21.1s and 33.6s
 * beside the pack pool, because each already spreads across the cores.
 */

interface Result { pool: string; code: number; ms: number; output: string; why?: string }

async function run(pool: Pool): Promise<Result> {
  // `suite` is five minutes, and the slowest pool is ~22s alone — so this says wedged rather than slow.
  // It was `budgetFor(75)`, which reached the same number through a measurement nobody took.
  const { code, output, ms, timedOut } = await boundedSpawn('npx',
    ['tsx', 'scripts/test-unit-pool.ts', pool.kind, '--all'], BUDGET_MS.suite.ms);
  const why = timedOut ? whyKilled({ what: pool.label, budget: 'suite' }) : undefined;
  return { pool: pool.label, code, ms, output, ...(why === undefined ? {} : { why }) };
}

async function main(): Promise<void> {
  console.log(`${POOLS.length} pools over ${UNIT_SUITES.length} suites, one at a time (${cpus} cpus)`);

  const started = Date.now();
  const results: Result[] = [];
  for (const pool of POOLS) {
    const result = await run(pool);
    results.push(result);
    console.log(`  ${(result.code === 0 ? 'ok' : result.why ? 'TIMEOUT' : 'FAIL').padEnd(7)} ${result.pool.padEnd(22)} ${(result.ms / 1000).toFixed(1)}s`);
    // What that pool measured, since its own output is buffered and printed only on failure
    if (result.code === 0) for (const line of poolDurationLines(pool.kind, 8, new Date(Date.now() - result.ms), { wallMs: result.ms })) console.log(`  ${line}`);
  }

  const failed = results.filter((result) => result.code !== 0);
  for (const result of failed) console.log(`\n${'='.repeat(70)}\n${result.why ?? result.pool}\n${'='.repeat(70)}\n${result.output}`);
  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${failed.length ? `${failed.length} pool(s) failed` : 'unit suites passed'} — ${total}s wall`);
  // Not process.exit(): it drops whatever is still in stdout's buffer, and a failing pool's captured output
  // is the one thing here worth reading. Piped, that truncates at 128KB — measured.
  process.exitCode = failed.length ? 1 : 0;
}

void main();
