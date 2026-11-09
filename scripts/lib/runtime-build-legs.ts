// The app's builds, as a table a runner and a spec can both read.
//
// Its own module rather than part of `scripts/build-runtime.ts` for the reason `typecheck-legs.ts` and
// `unit-pool.ts` are separate from their runners: a runner does its work on import, so nothing can import
// it to ask a question. Here that has a second and sharper cause — `chain-table.spec.ts` asks whether the
// chain builds every workspace that has a `build` script, and it answered by matching `-w` against
// `build:runtime`'s npm script text. Once the scheduling moved into a script that text is gone, so this list
// has to be importable or that case loses the independently-derived answer which is its whole point.
//
// **Each command is a literal string.** `chain-inputs.spec.ts` walks the real module closure of the `.ts`
// entries a step's script names, so this module is a declared input of `build:runtime`; and an interpolated
// command would hide which workspace a leg builds from every reader except the runtime.
import type { BudgetClass } from './step-budgets.ts';

/** One workspace's build */
export interface RuntimeBuildLeg {
  /** The workspace: what a failure is reported as, and what `chain-table.spec.ts` compares to the manifests */
  readonly name: string;
  /** Spelled out rather than built from `name` — see the header */
  readonly command: string;
  /**
   * A V8 heap ceiling for this leg's process tree, appended to `NODE_OPTIONS`. A ceiling, not an allocation,
   * so it costs nothing where the default suffices; set only where a cold build on a hosted runner exceeded
   * the ~2 GiB default.
   */
  readonly heapMb?: number;
}

/**
 * Declared once rather than on each leg, where four entries would hold the same value —
 * `typecheck-legs.ts`'s `LEG_BUDGET` is the precedent. It is the `build:runtime` step's own class, so the
 * chain's kill deadline and this runner's cannot disagree.
 */
export const BUILD_BUDGET: BudgetClass = 'suite';

/**
 * The four builds that produce the app, longest first.
 *
 * Order matters a little: `schedule` dispatches in table order, so the leg that sets the floor starts
 * first rather than last on a budget too small to admit everything at once.
 *
 * **No leg declares `cores`.** Four legs against a budget of the whole box admit all four whatever weights
 * they carried, so a number here would be a figure informing no decision. The budget earns its place
 * anyway: it is what `--cores 1` uses to reproduce the serial run, and what stops a fifth leg
 * oversubscribing the box silently.
 *
 * **`@app/renderer` runs `build-only`, not `build`.** Its `build` is
 * `run-p type-check "build-only {@}"`, and that `type-check` is the identical `vue-tsc` the `typecheck:renderer`
 * chain step runs — the same compile twice, in a step reached only by the chain, where `typecheck:renderer` is
 * already its own step. It costs the leg that sets this table's floor: the pair is 18.0s against the vite
 * build's 16.0s. Whoever runs `npm run build -w @app/renderer` directly still typechecks.
 *
 * **`@apackdev/sdk` is absent, and that is four facts rather than a speed choice.** Its `build` is
 * `tsc -p tsconfig.json` over a config setting `noEmit: true`: it emits nothing, so it adds no output to
 * a step whose product is `APP_OUTPUTS`; `typecheck:sdk` runs that identical compile; the `build:runtime`
 * step's `inputs` name `renderer, api, main, preload` and never `apack-sdk`, so dropping the leg makes
 * the declaration honest rather than narrower; and the step's key would not cover it — the four
 * workspaces' `package.json` files are declared inputs and the sdk's is not, so a leg building it would
 * depend on a script the step does not watch.
 *
 * **`@app/default-setup` is absent** because `build:default-setup` runs that exact command, and a second run of it
 * rewrites the `dist` five steps read.
 */
export const RUNTIME_BUILD_LEGS: readonly RuntimeBuildLeg[] = [
  { name: '@app/renderer', command: 'npm run build-only -w @app/renderer', heapMb: 4096 },
  { name: '@app/api', command: 'npm run build -w @app/api' },
  { name: '@app/main', command: 'npm run build -w @app/main' },
  { name: '@app/preload', command: 'npm run build -w @app/preload' },
];
