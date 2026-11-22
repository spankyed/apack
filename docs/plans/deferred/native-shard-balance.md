# Time-balanced native shards in the strict gate

Status: deferred by request, 2026-10-22. Designed, not started. Resume when app-and-rest is no longer the next
limit, or when the native imbalance grows enough to buy more than the figure below.

## Context

The strict gate (`.github/workflows/strict-chain.yml`) splits the native half across two jobs with vitest's
`--shard=k/2`, which assigns files by path hash, not by cost. In run 39721817559 (`a41159e5a`, 2026-10-22):

| Job | Wall | Native files | File time |
|---|---|---|---|
| native-1 | 24m09s | 8 | 1344s (`frontend-resources-watch` alone 383s) |
| native-2 | 14m09s | 7 | 749s |
| app-and-rest | 22m50s | — | — |

The two halves hold 2093s of file time. Split by cost they would be about 1047s each, so each native job
would run about 19 minutes. **The gate gains only about 1.3 minutes**, because app-and-rest (22m50s) then
becomes the slowest job. That is why this is deferred: app-and-rest is the job to shrink first, and
balancing native pays off only once app-and-rest is under about 19 minutes.

These are one run's figures; re-read them from a current strict run before resuming.

## The constraint

A cost-balanced split needs each file's duration, and a strict runner starts with none. The repo does not
commit per-spec costs: `spec-cost.json` was deleted for comparing one recorded millisecond across machines and
pools (`scripts/lib/spec-durations.ts` header), and the root guide states a step's cost is a reading, never a
committed figure. So the split cannot come from a checked-in table.

## Design

1. **CI keeps its own readings.** An `actions/cache` step in the consumers job restores and saves
   `node_modules/.cache/apack-spec-durations/` for the native jobs, keyed by runner image with a rolling
   suffix so each run saves a newer window. The records are what the native pool already writes
   (`writeDurations`); they stay readings of the runner class that produced them.
2. **A sequencer assigns files by reading.** `vitest.native.config.ts` names a custom sequencer whose
   `shard()` reads the cached window (`readDurations` for the native half), sorts files by cost and assigns
   each to the lighter shard (longest first). A file with no reading takes the median of those that have one.
   Assignment is deterministic for a given window and file list, so the two jobs agree without talking to
   each other: both read the same restored cache.
3. **No readings falls back visibly.** With an empty or unreadable cache the sequencer uses vitest's default
   split, and the native pool's result line says the shards are unbalanced, so a cold cache is never silent
   (root guide: a partial result says so).
4. **Both jobs must see the same window.** If the two jobs restore different cache versions, a file could run
   in both shards or neither. Prevent this by restoring by an exact key that the producers job writes
   (the producers job restores the latest window and publishes its key as a job output for both shards),
   or by having each shard check that its assignment covers every file exactly once across both shards and
   refuse otherwise.

## Scope

- Sequencer and its assignment function: ~60 lines in `packages/apack-cli/tests/_support/`.
- Workflow: one cache restore/save and the shared key, ~20 lines in `strict-chain.yml`.
- Specs: the assignment covers every file exactly once and balances a known window; an empty window falls
  back to vitest's split; a file with no reading is placed.

## Verification

- The assignment specs above, in `@app/internal-repo-checks` or the CLI's fast half.
- One strict run with a warm cache: both native jobs within about a minute of each other, and every native
  file reported exactly once across the two logs.
- One strict run with the cache cleared: the fallback note appears and the gate passes.

## Alternatives rejected

- **A committed file-to-shard list.** Simplest, but it is the committed figure the repo removed, and it
  drifts as files are added or slow down.
- **More native shards.** A free account runs at most five macOS jobs at once (the workflow's matrix
  comment); a sixth job waits and pays its own setup, lengthening the gate.
