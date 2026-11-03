#!/usr/bin/env node
import { sealBuildSession } from '../build/build-metadata.ts';
/**
 * `npm run build:runtime`: the four builds that produce the app, run at once.
 *
 *   npm run build:runtime                # all of them
 *   npm run build:runtime -- --cores 1   # one at a time, for a measurement or a confusing failure
 *
 * WHY THIS IS NOT `npm run build -w a -w b -w c` ANY MORE
 *
 * npm runs `-w` flags **in series**, and the four builds are independent, so the step spent its time one
 * bundler at a time. Measured 2026-10-06 on a ten-core box: **26.9s serially (median of 3, 26.8-27.8s)**
 * against a floor of 16.0s, which is `@app/renderer`'s vite build and what the run is now bounded by.
 *
 * It is worth doing because of *where* the step sits rather than what it costs: `build:runtime` is on the
 * chain's critical path (`packages:ensure -> build:default-setup -> build:runtime -> test:packaged-authoring`) and is the
 * whole cost of a one-package edit. `api-check.ts` made the same change for the same reason and records
 * the same shape of measurement.
 *
 * WHAT THE FOUR BUILDS OWE EACH OTHER: NOTHING
 *
 * Each resolves workspace code through the `@apackdev/source` condition to **source** — the renderer's
 * `resolve.conditions`, the api's `esbuildOptions.conditions`, main's `ssr.resolve.conditions` — so none
 * reads another's `dist`. Their outputs are the four disjoint directories `APP_OUTPUTS` names, and the one
 * directory two of them share (`node_modules/.cache/tsbuildinfo/`) takes a distinct filename each.
 *
 * **None of the four reads a pack's sources, and that is what keeps this step's inputs its own.** No pack is
 * compiled into the app: a pack's backend is loaded at run time from the `dist/runtime/index.cjs` its own
 * `apack pack build` wrote, and its frontend is fetched over `pack://` from the bundle beside it. So the app's
 * build reads the app's four workspaces and the built packs' `dist`, and an edit to a pack's `src` reaches
 * this step only through `build:default-setup`, which the chain orders ahead of it. A bundler config here that reached
 * into a pack's `src` again would make this step's real inputs the whole repo, which is the thing four
 * attempts at a cheaper chain each failed on.
 *
 * WHAT THIS OWES THE CHECKS THAT READ IT
 *
 * `check:tiers` scans this file's text for the ways the repo launches the app, and comments are stripped
 * while **string literals are not** — so a log line or an error message naming `playwright test`,
 * `apack pack test` or `_electron.launch` would fail that check for `build:runtime`. `chain-graph.spec.ts` derives
 * a step's timeout rung from the same text, so an `npm install` in it would imply `scenario` against the
 * declared `suite`. The commands themselves live in `lib/runtime-build-legs.ts`, which says why.
 */
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { RUNTIME_BUILD_LEGS, BUILD_TIMEOUT } from './lib/runtime-build-legs.ts';
import { schedule } from './lib/chain-schedule.ts';
import { box } from './lib/core-budget.ts';
import { exitOnEpipe } from './lib/exit-on-epipe.ts';
import { asCount, parseFlags } from './lib/measure.ts';
import { TIMEOUT_MS, timedOutBecause } from './lib/step-timeouts.ts';

exitOnEpipe();

/**
 * An explicit --cores wins; otherwise inherit the chain's budget, or use the box for a standalone build.
 * A child build must not reset the parent's allocation to the machine's full core count.
 *
 * No leg declares a weight, so each counts as one and a budget of the box runs all four — which is why
 * this shares the chain's scheduler and its one unit rather than counting legs of its own. `box()` rather
 * than `os.cpus().length`, which reads the host's cores where this wants a container's quota.
 */
const budgetFrom = (cores: string | undefined): number =>
  asCount(cores ?? process.env.APACK_CHAIN_CORES, 'cores') ?? Math.max(2, box());

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

interface Outcome { readonly ms: number; readonly code: number; readonly output: string; readonly timedOut?: true; readonly stalled?: true }

const done = new Map<string, Outcome>();

const result = await schedule({
  // No edges: the four are independent, and the one ordering constraint they share is the chain's, which
  // put `build:default-setup` ahead of this whole step. `lib/runtime-build-legs.ts` has the evidence for both halves.
  steps: RUNTIME_BUILD_LEGS.map((leg) => ({ ...leg, dependsOn: [] })),
  budget: budgetFrom(parseFlags(process.argv.slice(2), { values: ['cores'], booleans: [] }).values.cores),
  skip: () => false,
  async run(leg) {
    const [command, ...args] = leg.command.split(' ');
    // `BUILD_TIMEOUT` is declared beside the legs so the chain's copy of this step reads the same one
    const env = leg.heapMb === undefined ? process.env : {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--max-old-space-size=${leg.heapMb}`].filter(Boolean).join(' '),
    };
    // npm.cmd is a shell wrapper on Windows; preserve arguments through npm's JS entry.
    const npmCli = command === 'npm' ? process.env.npm_execpath : undefined;
    if (command === 'npm' && !npmCli) throw new Error('Run runtime builds with npm run build:runtime');
    const outcome = await boundedSpawn(npmCli ? process.execPath : command!, npmCli ? [npmCli, ...args] : args,
      TIMEOUT_MS[BUILD_TIMEOUT].ms, { env });
    done.set(leg.name, outcome);
    // One line as each finishes, so four concurrent bundlers are not one silence. Completion order, since
    // that is what progress is; the failures below are in declared order, which is what reading wants.
    process.stdout.write(`  ${outcome.code === 0 ? 'ok  ' : 'FAIL'} ${leg.name.padEnd(16)} ${secs(outcome.ms)}\n`);
    return outcome.code === 0;
  },
});

const failed = RUNTIME_BUILD_LEGS.filter((leg) => (done.get(leg.name)?.code ?? 0) !== 0);
for (const leg of failed) {
  const outcome = done.get(leg.name)!;
  const why = outcome.timedOut === true
    ? timedOutBecause({ what: leg.name, timeout: BUILD_TIMEOUT, stalled: outcome.stalled })
    : `${leg.name} failed (exit ${outcome.code})`;
  process.stderr.write(`\n${'─'.repeat(72)}\n${why}\n${'─'.repeat(72)}\n${outcome.output}\n`);
}

// A leg that threw is a bug in this runner rather than a failing build, so it is reported separately
for (const { step, error } of result.threw) {
  process.stderr.write(`\n${step}: the runner threw — ${error instanceof Error ? error.message : String(error)}\n`);
}

// `process.exitCode`, never `process.exit()`: this reprints a captured buffer, and exiting abandons
// whatever stdout has still to flush — which is exactly the failing build's output worth reading.
if (failed.length > 0 || result.threw.length > 0) {
  const names = failed.map((leg) => leg.name).join(', ');
  process.stderr.write(`\n❌ ${failed.length} of ${RUNTIME_BUILD_LEGS.length} failed: ${names}\n`);
  process.exitCode = 1;
} else if (result.skipped.length + result.started.length < RUNTIME_BUILD_LEGS.length) {
  // Dispatch stops after a failure, so this only reads as a scheduler bug
  process.stderr.write(`\n❌ only ${result.started.length} of ${RUNTIME_BUILD_LEGS.length} ran, and none failed\n`);
  process.exitCode = 1;
} else {
  if (process.env.APACK_BUILD_ROOT) sealBuildSession(process.env.APACK_BUILD_ROOT);
  console.log('✅ App built');
}
