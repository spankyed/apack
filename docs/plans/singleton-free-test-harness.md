# Singleton-free test harness and Vitest `isolate: false`

Status: proposed, 2026-11-23. Target: designed into the rewritten `@apackdev/testing` and `@apackdev/sdk/testing`
harness during the `@apackdev/state` cutover ([apack-state.md](apack-state.md), step 5), with an optional
pre-cutover win for already-pure unit suites.

## Why (measured cost)

Every Vitest suite currently runs with `isolate: true`, destroying and re-evaluating the JavaScript module graph
for every spec file. Measured on a 10-core `npm run test:unit` run across 866 spec files (583 host pool + 283
pack pool):

- **Host pool (11 suites, 583 files):** 333s CPU in import and setup out of 497s total (~67% module-graph tax).
- **Pack pool (`@app/default-setup`, 283 files):** 508s CPU in import and setup against 467s of test execution —
  more CPU spent rebuilding module graphs than running assertions.

The root cause is **ambient mutable module state** in the current test harness (`bindHost()`, `startTestRuntime()`,
`unbindHost()`, `openAppStore()`, `testPacks`, `testRootEvents`, `appPacks`). Because runtime state lives in
module-level singletons, the only safe isolation boundary between spec files is tearing down and re-importing the
entire module graph.

## Core principle

Replace ambient mutable singletons with **explicitly scoped capability values and affine resource ownership
(`using` / `[Symbol.dispose]`)**.

When modules export only pure, immutable definitions (functions, schemas, state specs) and every test runtime is a
value whose lifetime is bound lexically to a `using` block, the module graph becomes immutable shared memory across
files. Workers load and transform it once instead of once per file.

Where pack-facing SDK helpers still require implicit runtime lookup during a call (e.g. `boundHost()`), scope that
lookup per-execution with Node's `AsyncLocalStorage` bound to the `using` handle rather than a module-level `let`.

## Before vs. after (code)

**Before** (global singletons force `isolate: true` and manual teardown):

```ts
// Module-level side effect mutates process globals on import
startTestRuntime();

afterEach(() => {
  takeSystemErrors();
  testPacks.designations.clear();
  unbindHost(); // forgetting one reset leaks across tests
  vi.restoreAllMocks();
});

it('saves a note', async () => {
  const actor = createActor(notesMachine);
  actor.start();
  try {
    actor.send({ type: 'SAVE', text: 'hi' });
    // asserts against ambient testRootEvents / boundHost
  } finally {
    actor.stop();
  }
});
```

**After** (pure modules + `using`-scoped value, safe under `isolate: false` and `--shuffle`):

```ts
// Zero top-level side effects. Zero afterEach boilerplate.
it('saves a note', async () => {
  using app = createTestApp({ systems: [notesSystem] });

  await app.tell('notes', { type: 'SAVE', text: 'hi' });
  expect(app.state('notes').data.count).toBe(1);
  // Scope exit deterministically disposes kernel, timers, views, listeners, and temp store
});
```

## Algorithmic breakdown

Let $F$ be the number of spec files (866), $W$ the Vitest worker count (10), $M$ the module-graph transform and
evaluation cost per file, and $T$ the test assertion work.

- **Before (`isolate: true`, ambient singletons):**
  $$\text{Total CPU} = O(F \cdot M) + O(T)$$
  Every file pays $M$ (~841s total import/setup CPU across the two pools) plus GC churn from discarding 866 dead
  module graphs.
- **After (`isolate: false`, pure modules + `using` runtime):**
  $$\text{Total CPU} = O(W \cdot M) + O(T)$$
  Module-graph evaluations drop by $\frac{F}{W}$ (**~28× fewer** in `default-setup`, **~58× fewer** in the host
  pool). Per-test isolation becomes an $O(1)$ plain JS object allocation (`createTestApp`), deterministically
  reclaimed at scope exit via `using`.

## Before / after at every level

| Level | Before (XState + ambient harness) | After (`@apackdev/state` + `using` + `isolate: false`) |
|---|---|---|
| **Modules** | Stateful singletons (`boundHost`, `testPacks`, `rootEvents`, `appPacks`) | Pure immutable definitions (functions, schemas, state specs) |
| **Test harness** | Global `startTestRuntime()` / `unbindHost()` + manual `afterEach` resets | Value-scoped `using app = createTestApp(...)` (with `AsyncLocalStorage` where ambient lookup is needed) |
| **Test authoring** | Fragile `beforeEach`/`afterEach` teardown; `try/finally` actor stops | Zero teardown boilerplate; deterministic disposal on thrown assertions; `it.concurrent`-capable |
| **Vitest worker** | `isolate: true` — rebuilds module graph 866 times ($O(F \cdot M)$) | `isolate: false` — loads module graph once per worker ($O(W \cdot M)$), verified with `--shuffle` |
| **Suite performance** | ~155–220s wall (~841s CPU spent in import/setup alone) | Import/setup drops an order of magnitude; unit suite approaches pure assertion time; single-spec runs feel near-instant |
| **Meta-tooling** | Heavy guards to absorb slow imports (`spec-halves`, `@slow:`, timeout budgets) | Flatter per-file cost distribution; fewer slow-tail outliers |

## Sequencing around the `@apackdev/state` cutover

The cutover is **not** strictly required for already-pure specs, but it determines where the bulk of the 841s
savings live:

1. **Before the cutover (optional, zero conflict with XState):**
   Add a Vitest 4 `test.projects` entry with `isolate: false` for suites that already touch zero XState and zero
   `bindHost()` singletons (e.g. pure unit specs in `@apackdev/cli`, `@apackdev/sdk/tests/{utils,build}/`, and
   pure `@app/internal-repo-checks` / `@apackdev/host` helpers). Do **not** spend effort de-polluting the ~132
   XState specs that are about to be rewritten.
2. **During the cutover ([apack-state.md](apack-state.md), step 5):**
   Design the rewritten `@apackdev/testing` and `@apackdev/sdk/testing` harness to be singleton-free and
   `using`-disposable from day 1, so every newly ported feature spec is `isolate: false`-compatible by construction.
3. **After the cutover:**
   Move the rewritten runtime and feature specs into the `isolate: false` Vitest project, leaving only genuinely
   process-mutating specs (e.g. `process.env` / global prototype / native-handle tests) in an explicit
   `isolate: true` project.

## Safety guardrails & acceptance

- **Two concurrent runtimes in one test:** A harness spec must construct two independent `using app = createTestApp(...)`
  instances in the same test case, mutate both, and verify zero cross-talk (proving no hidden module singleton).
- **Order-independence check:** Every `isolate: false` project must pass `vitest run --shuffle` across consecutive
  runs with identical results before shipping.
- **Explicit opt-out:** Specs that mutate `process.env`, `process.chdir`, global objects, or module mocks remain in
  an `isolate: true` project rather than adding fragile manual global restores.
