# SQLite candidate harness

This directory began as the opt-in feasibility experiment preserved at `4a3fe698f8` on `session/sqlite-evaluation`
(apack `5838145675`, elmdb `9359949`). The current implementation follows
[the SQLite goal](../../../../docs/goals/goal-ears-sqlite.md) on `session/ears-sqlite`, with its pinned native baseline
and exact evidence recorded there. It does not select SQLite for normal app boot or migrate daily-use data.
Use synthetic/copied data and separate directories; elmdb directories are refused.

The [original evaluation plan](../../../../docs/plans/ears-sqlite-evaluation.md) and
[dated findings](../../../../docs/references/evidence/ears-sqlite-evaluation-2026-10-27.md) describe historical results,
not acceptance of the changing implementation.

## Reproduce

Use a separate worktree with private dependencies/output. Run broad checks in disposable Linux/CI, one expensive
owner at a time. From the repository root:

```sh
npm run test:linux -- bash -lc 'npm run typecheck -w @apackdev/ears && EARS_EVALUATION_BACKEND=sqlite npm test -w @apackdev/ears'
npm run test:linux -- npm test -w @apackdev/ears
```

SQLite uses pinned `better-sqlite3` 13.0.3 and `sqlite-vec` 0.1.9 from the normal workspace lockfile. The adapter
lives in `src/sqlite/` and its app-only entry is `@apackdev/ears/sqlite`; this directory now holds harnesses rather
than another implementation. Packaged Electron/native loading still needs qualification.
Ordinary tests select elmdb and skip SQLite-only cases. Targeted driver checks have run on macOS arm64 and
Linux; this is not Electron/Windows qualification. The current validation count and exact source pin live in the goal and retained evidence;
full app, operational and packaging qualification remains open.

From the repository root, run one expensive task at a time:

```sh
python3 packages/apack-ears/bench/sqlite/run-bench.py /private/tmp/ears-sqlite-api-trials
python3 packages/apack-ears/bench/sqlite/run-bench.py /private/tmp/ears-sqlite-durable-trials --durable
node --import tsx packages/apack-ears/bench/sqlite/capabilities.ts
node --import tsx packages/apack-ears/bench/sqlite/primitive-bench.ts
node --import tsx packages/apack-ears/bench/sqlite/explain.ts
```

`run-bench.py` alternates backend order, uses fresh processes, and preserves every timing sample and stderr.
`bench.ts` measures the actual EARS facade over the same synthetic fixture; SQLite transport is structured, while
MessagePack remains at the native elmdb boundary. Rerun comparisons on pinned current source before making claims.
The current benchmark also includes 64 large entities with 256 KiB repeated/high-entropy bodies, small counter
updates beside each body, projected large-row pages and sixteen 16 KiB streaming updates. Each output retains raw
samples, memory/resource and per-file sizes. Provenance records the commit, exact source/engine fingerprints and
native binding hashes. A separate instrumented pass records driver calls/spans and lossless codec spans; driver
time includes preparation, binding, SQL execution and result marshalling, which this binding does not time
individually. The remaining facade time includes mapping/checks/allocation and measurement overhead, not a pure
SQL compilation timer. Plans use the actual SQLite query diagnostics. Sync-disabled fixtures and durable-unit
acknowledgments are separate trials; this is not group-commit or platform durability qualification.
`primitive-bench.ts` is deliberately separate: native exact vector search without EARS overhead, not an application benchmark.
`mutations.py` targets the original prototype and belongs to its preserved checkpoint; current safeguards have
negative-proof evidence linked from the goal. The synthetic sine-generated vectors are low-rank; these timings do not establish ANN recall or real embedding quality.

The real host storage tests select each backend through normal constructors, without module aliases:

```sh
npm run test:linux -- npm test -w @apackdev/host -- tests/backup/storage.spec.ts tests/backup/import.spec.ts tests/backup/import-transaction.spec.ts tests/database/open-app-database.spec.ts
```

The host owns actual data-file/open descriptors, checks both destination formats before replacement, and exercises
populated primary/run-history restore, media/acceptance rollback and retained recovery copies. The former alias
probe is removed; current evidence must come from the real path. Isolated app/CLI profile selection and startup readiness are implemented, with built Node boot evidence;
live pack admission and complete lifecycle/platform qualification remain in the goal.

## Implementation boundaries

`src/sqlite/database.ts` implements the structured database/unit port. Authoritative attributes live in native scalar columns
and out-of-row values through `src/sqlite/values.ts`; entities no longer hold a whole-row payload or JSON document.
Catalog metadata, derived scalar/list membership and relations use SQLite WAL transactions. `src/sqlite/query.ts` compiles
selection, projection and one-hop traversal into SQL. Mixed-value sorting remains a JavaScript fallback, and deep
traversal retains a JavaScript seen set with batched SQL frontiers.
`src/sqlite/search.ts` adapts native FTS5 and sqlite-vec distance functions to EARS text, embedding and hybrid operations.
Existing EARS builders, transactions, typed facades and observers are reused.

The candidate is unfinished: value/text/vector/trigram admission uses shared persistent background generations
with explicit search readiness, and declarations validate through Ajv plus structural checks. Error and real IO
qualification remain incomplete; fuzzy expansion scans the vocabulary; vectors use exact scalar scans; backup publication,
OS I/O failure semantics, permissions, migration and cross-platform packaging are not qualified. It is not a
second production backend. A passing EARS suite is a feasibility signal, not complete elmdb feature parity.

## Admission load

`run-admission.py` runs fresh-process 10k/100k fixtures with 53 watches, foreground writes/reads, index backfill and
retired-generation cleanup. Run it in the disposable runner, sequentially:

```sh
npm run test:linux -- python3 packages/apack-ears/bench/sqlite/run-admission.py .temp/value-index-sync-off
npm run test:linux -- python3 packages/apack-ears/bench/sqlite/run-admission.py .temp/value-index-durable --durable
```

The storage plan records targets before qualification. Every report retains all timing samples, complete batch
spans, correctness/commit checks, file/WAL observations and pass/fail budgets. A failed budget is saved before the
runner stops. An independent 8 ms heartbeat records scheduling delays during foreground work as well as background batches;
`turnWaitMs` separately times setImmediate waits between operations. Raw samples and both 16 ms p99 targets are
retained; the older archived `timerStallMs` measured only those turn waits. The heartbeat captures an overdue final
operation on stop and does not keep the process alive. `load-metrics.check.ts` verifies those behaviors and generic
native prebuild fingerprints before cohorts start. Source/native fingerprints are collected before the cohort,
and each admission process records its actually loaded native addon. The facade provenance probe uses the same
helper and explicitly includes the loaded vector extension. Preserve results before another Linux
sync, which replaces untracked volume content. This measures a synthetic same-connection slice; shared search-admission qualification is described below.
Full app budgets and platform durability qualification remain separate requirements.


### Background search admission qualification

`node --import tsx packages/apack-ears/bench/sqlite/admission.ts 1000 --search` is the first disposable smoke
for shared text/vector/trigram admission. The fixture indexes the short string `slug`, with 100 deterministic
buckets, while unrelated primary payloads stay outside the indexes. It retains the existing 53 primary watches
and adds three substring watches during building. Foreground writes update counters and periodically change
indexed slugs; scalar reads stay complete, substring reads explicitly refuse while building and are checked
against known answers when ready. The output tags those refused versus ready search calls. Retirement is
checked separately; no retired physical tables/chunks may remain. Vector chunks remain pending: this does not
evaluate embedding recall or large-text indexing.

Before the first search smoke: retain the existing 100 ms admission ceiling, 16 ms p99 foreground/lookup/turn
and independent 8 ms heartbeat-delay targets, 16 MiB (or incumbent + 4 MiB) observed WAL ceiling and baseline
file bytes * 2 + 16 MiB observed-file ceiling. Apply 16 ms also to the tagged substring calls. Admission must
hydrate zero primary rows. Start with one fresh 1k sync-disabled process; preserve its first failure rather than
retrying until green. Larger 10k/100k and FULL runs remain required after diagnosis. Do not infer byte-memory or
application budgets from this short-string synthetic, or fairness between native and SQLite from this single
backend fixture. Fingerprint the loaded SQLite binding and vector extension after sampling stops so provenance
collection does not perturb the measured heartbeat.


After the passing first 1k smoke, predeclare the next cohort: three fresh sync-disabled processes each at 10k
then 100k, followed only if all six pass by one first 10k FULL process. Stop at the first correctness, resource
or latency miss; preserve the failed sample and leave later trials unrun. No rerun of an identical failed sample
and no relaxed target. Each process uses the same source/fixture; include cold per-process matcher loading and
all original heartbeat/resource limits. A first FULL miss leaves FULL qualification open rather than scheduling
more durable trials without a remedy. These counts are set before the larger cohort runs.


### Cleanup diagnostic controls

After the corrected cohort's third 100k OFF process missed the unchanged heartbeat target, run exactly one
fresh 100k OFF process with `--search --progress --diagnostic`, then one with the additional
`--no-query-watches`. Keep the same 50 point watches, foreground writes/scalar lookups, seed and retirement
work in both. The control removes the three scalar-query watches and three build-only substring watches;
it is a diagnostic variant, never a replacement qualification fixture. Both retain exact heartbeat timestamps
and spans for watched reads, foreground operations/lookups and background batches. Measurement overhead and
watch scheduling can change; neither outcome qualifies the original workload. Preserve both outcomes and
correlate overdue timer intervals with spans before attributing stalls or changing production scheduling.
No FULL retry, batch tuning, target change or reduced-size replacement is part of this diagnostic pair.

### Runtime quota diagnostic (predeclared)

The fixed-work sentinel left cold/runtime/host causes unisolated. Before another qualification run, execute
exactly four fresh 100k profiles in order **quota-only, affinity-two, affinity-two, quota-only**. All remain in
one owned Linux container with the existing `--cpus 2 --memory 6g`; affinity-two additionally pins the child
and its threads to the first two CPUs in its initial allowed mask. Do not remove the quota, increase memory,
change database/query code, calibrate loop work or rerun a favorable subset. Stop on setup/correctness failure;
retain every completed process and failure. The pinned runtime/dependency image is unchanged.

`runtime-control.mjs` uses normal built EARS entries, the previous fresh 100k seed, actual generated SQL and
three-million-iteration integer loop, twenty alternating forward/reverse blocks of 25 calls per mode
(500 samples each). Retain all samples; separately report ordinals 0–149 and 150–499 for each mode, with that
boundary chosen before execution from the prior first-143-call observation. These are call-age strata, not
cold disk: seeding and SQL capture precede timing. No sample is removed from whole-run statistics.

Record actual CPU/memory constraints, per-call cgroup CPU counters, process CPU, GC spans and a CPU profile.
Counter reads bracket a wider interval than the timed operation; their deltas include that instrumentation
and all processes in the container, not just main-thread execution. The own-group throttling counters do not
exclude ancestor throttling or guest/host descheduling when zero. The outer counters also include assertion
and sampling work between calls. GC overlap and throttling association do not establish exclusive causality.
Profiling/instrumentation differs from the earlier sentinel, equally in both variants; four sequential processes
cannot certify host scheduling or production behavior. This diagnostic has no watches or admission work and
cannot supersede the failed 100k cohort or its original 16 ms targets. FULL and actual-app acceptance remain open.

The [kernel's cgroup CPU interface](https://docs.kernel.org/admin-guide/cgroup-v2.html#cpu-interface-files)
defines quota periods and throttling counters; [Docker's CPU limits](https://docs.docker.com/engine/containers/resource_constraints/#configure-the-default-cfs-scheduler)
distinguish bandwidth limits from CPU affinity. This is a hypothesis to test, not an attribution of the old miss.
