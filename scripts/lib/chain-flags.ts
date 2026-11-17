// Every flag `npm run chain` accepts, as data, with what each one does.
//
// Its own module because `scripts/chain.ts` runs the chain when imported, so nothing may import it to ask a
// question. `parseFlags` refuses a flag that is not here, so a typo is an error rather than an ignored
// argument, and `npm run chain -- --help` prints this table — the one place the flags are written down.

import { wrapAt } from './chain-output.ts';

/** Flags that take a value: the value's placeholder, and what the flag does */
const VALUE_FLAGS = {
  cores: ['N', "how much of the machine to spend; this machine's cores by default. A step declares its own "
    + 'width (POOL_WIDTH, core-budget.ts), and the budget also caps Vitest workers'],
  only: ['a,b', 'run just the named steps, for one job of a split gate. Each producer left out must already '
    + 'be current here — its outputs and stamps downloaded from the job that ran it — or the run refuses'],
  shard: ['k/N', 'with --only naming pool steps: one vitest shard of their specs. A shard records no stamp'],
  job: ['J', 'one job of the parallel strict gate, its steps derived from the graph (chain-only.ts): '
    + 'producers, integration, native, app or rest, or a comma list run as one'],
} as const;

/** Flags that take none, and what each does */
const BOOLEAN_FLAGS = {
  dry: 'the plan, why each step is or is not cached, and the critical path over recent runs here, with the '
    + 'most any step on it could buy. Runs nothing and writes nothing. With --all, the cold chain',
  all: 'every step regardless of its stamp, forcing those that keep a cache of their own',
  'no-native': 'leave out test:native (compiler runtime, native fixtures, live watchers) for a faster local run when '
    + 'nothing under packages/apack-cli/src/build changed; the run says it is partial, and the strict gate runs it',
  strict: "fail the run when a step's inputs moved while it ran — it read a tree that no longer exists. "
    + 'Always reported; this decides whether it fails the run',
  wait: 'queue behind a run already holding the lock, up to 10 minutes, rather than refusing',
  help: 'print this',
} as const;

/** The flags in the shape `parseFlags` takes them — without their leading `--` */
export const CHAIN_FLAGS = {
  values: Object.keys(VALUE_FLAGS) as (keyof typeof VALUE_FLAGS)[],
  booleans: Object.keys(BOOLEAN_FLAGS) as (keyof typeof BOOLEAN_FLAGS)[],
};

/** What `npm run chain -- --help` prints */
export function chainHelp(): string {
  const rows: [string, string][] = [
    ...Object.entries(VALUE_FLAGS).map(([name, [arg, text]]): [string, string] => [`--${name} ${arg}`, text]),
    ...Object.entries(BOOLEAN_FLAGS).map(([name, text]): [string, string] => [`--${name}`, text]),
  ];
  const width = Math.max(...rows.map(([flag]) => flag.length));
  return ['usage: npm run chain -- [flags]', '',
    ...rows.map(([flag, text]) => `  ${flag.padEnd(width)}  ${wrapAt(width + 4, text)}`)].join('\n');
}
