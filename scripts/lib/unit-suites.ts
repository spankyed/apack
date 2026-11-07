/**
 * The workspaces `test:unit` covers, and where each lives.
 *
 * One definition, because everything that runs or schedules them reads it — `scripts/test-unit.ts`, the
 * chain's steps, the pool's per-project cache, the per-machine duration cache — and a second list would
 * drift the first time a package was added.
 *
 * **The order is not an execution order.** Vitest's sequencer decides what runs when, across every project
 * at once; the root `vitest.config.ts` is where that is written down. So this is not sorted by cost, and a
 * reader should not infer that it is — it once claimed to be, and was wrong in a way nothing could notice.
 * What the order does have to do is match the `projects` list in that config, which `chain-inputs.spec.ts`
 * asserts.
 *
 * If an order is ever wanted, sort at the point of use from what a run measured
 * (`spec-durations.ts`'s cache) rather than re-sorting this literal. A guard on sortedness is the thing
 * not to add: the largest fast halves sit within a few percent of each other, so it would fail on
 * measurement drift and never on a mistake.
 */
export interface UnitSuite {
  /** The npm workspace name, as `npm test -w` takes it */
  readonly workspace: string;
  /** Its directory under `packages/`, which is what an input path needs */
  readonly dir: string;
  /**
   * Which resolution a suite runs under, and therefore which pool it can share.
   *
   * `host` suites resolve the workspace `@apackdev` packages to source, under the `@apackdev/source`
   * condition. `pack` suites must resolve the published `dist` — the one layout a pack author ever has —
   * which is why `check:specifiers` fails a pack config that declares that condition.
   *
   * **Node conditions are per process**, and vitest shares its worker pool across projects: per-project
   * `poolOptions.execArgv` is ignored, measured. So the two kinds cannot be one pool. Probed 2026-09-25,
   * a `default-setup` spec resolves `@apackdev/sdk` to `dist` today and to `src` inside a pooled process
   * carrying the condition, which would silently change what the pack suite verifies.
   */
  readonly kind: 'host' | 'pack';
}

export const UNIT_SUITES: readonly UnitSuite[] = [
  { workspace: '@apackdev/sdk', dir: 'apack-sdk', kind: 'host' },
  { workspace: '@app/default-setup', dir: 'default-setup', kind: 'pack' },
  { workspace: '@apackdev/cli', dir: 'apack-cli', kind: 'host' },
  { workspace: '@apackdev/host', dir: 'apack-host', kind: 'host' },
  { workspace: '@app/api', dir: 'api', kind: 'host' },
  { workspace: '@app/repo-checks', dir: 'repo-checks', kind: 'host' },
  { workspace: '@apackdev/ears', dir: 'apack-ears', kind: 'host' },
  { workspace: '@app/renderer', dir: 'renderer', kind: 'host' },
  { workspace: '@app/main', dir: 'main', kind: 'host' },
  { workspace: '@app/preload', dir: 'preload', kind: 'host' },
  { workspace: '@apackdev/testing', dir: 'apack-testing', kind: 'host' },
  { workspace: '@apackdev/ui', dir: 'apack-ui', kind: 'host' },
  { workspace: '@app/publish-checks', dir: 'publish-checks', kind: 'host' },
];

/**
 * The chain step that runs a suite: one per pool rather than one per suite. That is `POOL_STEPS`' decision
 * and its doc in `scripts/lib/chain-steps.ts` carries the reasoning, including what the per-suite steps were
 * buying and where it went instead.
 */
export const unitStepName = (suite: UnitSuite): string => `test:unit:${suite.kind}`;

/**
 * What one test may spend, by the size of the target that runs it — Bazel's `size`, a bucket whose whole purpose
 * is a default bound.
 *
 * **CPU, not the clock.** Every config turns vitest's clock off and loads the progress guard
 * (`@apackdev/testing`'s `vitest-progress-guard.ts`), which fails a test or hook whose process tree goes `IDLE_MS`
 * without CPU and a test that spends its CPU deadline. A busy machine stretches a test's wall time and leaves its
 * CPU where it was, so neither fires on a test that is only slow: two chain runs at a load of 35 failed different
 * tests each time on vitest's per-test clock, and a test failed at 240s passed alone in 118s.
 *
 * **One bucket per half, because each half is what consumes one.** The fast half is `small`, the integration
 * half `large`, and the native half `enormous`: its specs compose cold compiler captures, builds and watcher
 * cycles. A bucket must be one something distinguishes. Sized against forced readings on 2026-11-07: the fast
 * half's heaviest test spent 7.3s of CPU and the integration half's heaviest without a budget of its own 34.6s.
 *
 * A config declares the deadline, not the budget, as `provide: { 'apack.testCpuMs': … }`; `suite-timeouts.spec.ts`
 * holds every config to its size's, since a vitest config importing across package layers is the thing
 * `check:specifiers` exists to prevent.
 */
export const SIZE_MS = { small: 15_000, large: 60_000, enormous: 300_000 } as const;
export type Size = keyof typeof SIZE_MS;

/**
 * How far past its size budget a test's CPU goes before it is failed: a config gives the guard
 * `DEADLINE_FACTOR × SIZE_MS[size]` as `apack.testCpuMs`.
 *
 * **Two numbers with two jobs.** The budget is what a test is expected to cost, and a test that passed having
 * spent past it is *reported* — the pool names it and the chain shows it under the step — as a reading. The
 * deadline is there to catch a test that spins, the one hang that keeps spending CPU.
 *
 * A test that needs more declares `meta: cpuBudget(ms)` (`@apackdev/testing/vitest`), which is its deadline and is
 * not multiplied: each is composed from operations that carry their own bounds, and the reason it needs more is
 * listed in `suite-timeouts.spec.ts`.
 */
export const DEADLINE_FACTOR = 2;

/**
 * Which size a given test file runs at is `sizeOf` (`scripts/lib/test-timeouts.ts`), not a field here.
 *
 * It is derived rather than declared, because what it would declare is already decided elsewhere: a spec
 * lives in the fast, integration or native half, declared by its filename, and the halves *are* size
 * classes. A per-suite `size` field would be a constant — every fast half small, every integration half
 * large, every native half enormous — and a list whose every entry is the same value is one nobody maintains.
 *
 * It lives there rather than here so this module stays a leaf: answering for a *spec* needs
 * `INTEGRATION_SUITES`, and importing that would point this file at `chain-steps.ts`, which imports it.
 */
