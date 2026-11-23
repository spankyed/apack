# Cache layers

Five things in this repo skip work because they recorded that it was done. Each is justified on its own;
together they are the hardest part of the tooling to reason about, because a step that looks cached can be
cached at more than one level. This page says, for each: what it caches, its key, what invalidates it, and
how it relates to the others. Two further records are readings, not caches, and are listed last so they are
not mistaken for one.

Every layer below follows one rule from the root guide: **a key that cannot go stale, or a scope in which it
cannot.** Each is content-keyed — a file's path and bytes, never its modification time — and each is written
only after the work it records succeeded, so an interrupted or failed run reads as not done.

## The layers, outermost first

| Layer | Where | What it skips | Key | Invalidated by |
|---|---|---|---|---|
| Chain step stamps | `node_modules/.cache/apack-chain/<step>.json` | a whole chain step | the step's declared `inputs`, `excludes` and the command, fingerprinted (`unitFor`, `scripts/lib/chain-stamps.ts`) | any byte under a declared input; `--all` ignores it |
| Pool project stamps | `node_modules/.cache/apack-unit-pool/<suite>.<half>.<provenance>.json` | one vitest project inside a pool step | that suite's reads for the half (`suiteInputs`), plus the pool command and its worker cap (`poolUnitFor`, `scripts/lib/unit-pool.ts`) | any byte the suite reads; the step's `forceArgs: ['--all']` reaches inside it |
| Package build stamps | `node_modules/.cache/apack-packages-build/<workspace>.json` | rebuilding a published package's `dist` (`packages:ensure`) | the unit's sources, `@apackdev/host`, the bundler script, manifests and tsconfigs (`BUILD_UNITS`, `packages-built.ts`) | any byte in those; a missing output |
| Pack phase cache | `<pack>/dist/phase-cache.json`, sealed with the build | the facade-types and DSL-definition phases of `apack pack build` | authored pack files, generated entries, the phase's extra inputs and its tools (`phase-cache.ts`) | any of those; a receipt or recorded build input that no longer verifies, which forces a cold build |
| Codegen stamp | `<pack>/.apack/generate-entries.json` | regenerating `src/__generated__/` | the pack's module sources, manifest data, dependency snapshots and the SDK/CLI generation code, plus the bytes of every file it wrote | any input; a generated file deleted or edited |

## How they relate

- **The outer layer never answers for the inner one.** A chain step stamp says the step's declared inputs
  have not moved since it passed. It says nothing about the caches the step consults while it runs: the
  pool steps keep project stamps, external fixture builds keep their own pack compiler caches, and
  `packages:ensure` keeps package build stamps.
- **`packages:ensure` is never cached at the chain level**, and the reason is the relation above. What it
  guarantees is recorded in the package build stamps, which its chain fingerprint cannot see: with the
  stamps removed and `dist` still on disk the chain would call it cached while every suite's
  `packagesBuiltOrRefuse()` refused. Its own check is a content comparison that returns in a fraction of a
  second, so a chain stamp on top would only add a second record that can disagree
  (`neverCachedBecause`, `chain-steps.ts`).
- **The pool steps keep both layers on purpose.** A pool step's inputs are the union of its projects', so
  the step stamp and the project stamps cannot disagree about a tree: the step is skipped when nothing any
  project reads moved, and when it runs, it runs only the projects whose reads moved. `--all` forces both.
- **One definition per key.** A pool project's reads are declared once (`suiteInputs`) and both the step's
  inputs and the project's stamp are derived from it. A package build unit is the same shape as a chain
  step (`BuildUnit`), so one freshness check (`unitStaleReason`) serves both.
- **Recording is suppressed where the run proves less than the key claims.** A shard runs part of each
  project's specs, so it records no project stamp and no step stamp (`DIAGNOSTIC_RUN_ENV`). A build is
  never suppressed: other processes read the package build stamps as a precondition.
- **Each stamp directory has one writer at a time**, held by a lock beside it (`chain.lock`,
  `packages-build.lock`, the pool's lock), so a cached result means "this tree passed" rather than "some run
  with these inputs passed".

## What the pack build records beside its cache

`dist/build-inputs.json` is not a cache: it is the completed record of what the compiler read, sealed with
the output by `dist/integrity.json`. Reuse of a phase checks it first, and the chain's `facade:check` replays
it (`--from-build`) to prove a build is current without rebuilding. Where a compiler read a file's
modification time, the record holds that file's content hash, so it replays on a checkout whose times
differ.

## Readings, which are not caches

- **Spec durations** (`node_modules/.cache/apack-spec-durations/`, `spec-durations.ts`): the last ten runs'
  per-spec times, which `npm run spec:dry` prices a plan from and the pools rank their slowest files by.
- **Step durations** (`node_modules/.cache/apack-step-durations/steps.json`, `step-durations.ts`): the last
  ten passing runs' per-step times, which `npm run chain -- --dry` draws its critical path from and a
  failure report quotes.

Both share one window implementation, are machine-local and uncommitted, and decide nothing: deleting either
changes what is printed and never what runs.

## Clearing them

Each layer is under `node_modules/.cache/` or inside a pack's build output, so deleting the directory is
always safe and costs only the work it skipped. The chain's own `--all` is the deliberate way to ignore the
chain and pool layers without deleting anything.
