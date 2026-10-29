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
qualification remain incomplete; bounded query-derived typo alternatives need cost/usefulness qualification;
vectors use exact scalar scans; backup publication,
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

### Default-typo growth cost protocol

Before its first execution, `text-typo-cost.mjs` fixes 1k/10k/100k fresh profiles with one unique ten-character
term per ordinary row and a shared broad term. Compare pinned vocabulary-scan e452d67ae1 against bounded
alternatives 9beb23ebc9 in order **scan / bounded / bounded / scan**, one fresh process per trial, one owned
Linux container with two CPUs and 6 GiB. Each process runs all three sizes with OFF commits and normal
built package entries. Copy this identical diagnostic fixture into both sources; change no production code.
Use the existing 180-second process diagnostic bound, stop on the first failure and retain partial JSON,
stdout/stderr and source/native/fixture hashes. No automatic retries or discarded samples.

Each profile records one first invocation and twelve warm calls for exact, deletion, transposition, absent,
maximum eligible token, phrase, prefix, Unicode, broad and highlighted queries, with fixed useful answers.
The default fuzzy option stays enabled. First invocation is **not cold storage**: backfill and prior queries
warm the OS/database cache. Retain all raw times, independent heartbeat samples, RSS/heap/resource usage,
file/WAL bytes and a separate untimed binding observation including returned vocabulary rows and argument
bytes. The 100k profile and 32-character typo are mandatory, even if they are slow. These are SQLite
revision diagnostics, not matched elmdb, whole-app budget, cold-start, memory-bound or language acceptance.


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


### Actual admission runtime trace (predeclared)

The four quota/affinity controls completed without own-group throttling during timing; scalar SQL/facade
p99 stayed below 3 ms in all four, while the fixed CPU loop had two >30 ms calls at ordinals 31–32 in each.
These controls do not establish the cause of the original admission miss or justify changing the runner.

Next run exactly one fresh **100k OFF full-watch search admission** using the existing source/tsx invocation,
`--search --progress --diagnostic`, unchanged two-CPU/6 GiB limits, unchanged 300-second process bound and all
original workload/resource targets. Set `EARS_ADMISSION_TRACE` to a new owned report prefix. The optional helper
starts after seeding/initial watch settlement, records GC events, a CPU profile and cgroup counters every 64 ms,
and stops after the independent heartbeat stops. It does not change production SQL, watch/batch constants,
query-watch counts or primary workload. Counter sampling runs on the event loop and can be delayed; profile
and GC recording add overhead. Retain that scope and every budget outcome, including failure. This is one
diagnostic, never a replacement acceptance trial, a retry-until-green cohort, or permission to proceed to FULL.
Correlate actual heartbeat overdue windows with GC/spans and cgroup intervals before proposing a remedy.

### Source-string FTS shape diagnostic

Before measuring the new source-string representation, run one fixed **old / new / new / old** cohort, four
fresh Node processes in one Linux container with the unchanged two-CPU quota and 6 GiB. Old is `9a2771ec25`;
new is the converged selective-document implementation. Use the exact same `text-shape.mjs` fixture with
normal built entries, OFF commits and 10,000 rows: one camelCase name, a mostly 500-byte body (1/128 large),
and three tags. Admit text indexing after seed. Retain every seed/admission/readiness duration, sampled
file/WAL/RSS high-water, raw heartbeat, call counts, 250 point and cross-field reads, 50 broad limited reads,
and 1,000 name updates. No warm samples are discarded. Stop on setup/correctness failure; no automatic retry.
Each process has a 180-second safety bound. This diagnostic measures shape costs and answer parity for common
queries, not realistic relevance, FULL durability, app/watch acceptance or the unresolved 100k admission gate.

### Selective conjunction correction cohort

The first shape cohort is retained in `text-shape` evidence; its mixed-field regression is not accepted.
After functional proof, run one **legacy / materialized / selective / selective / materialized / legacy**
cohort, six fresh Linux processes, unchanged two CPUs/6 GiB and 180 seconds each. Legacy is `9a2771ec25`,
materialized is `026b6b18b0`, selective is the new native-intersection checkpoint. All six receive exactly the
same updated `text-shape.mjs`: its name now includes `group${i % 100}`, and it adds reverse point/common
and both orders of a 100-row group/common query, selective/global exclusion, and a two-ticket disjunction
(250 samples each), preserving every earlier measurement.
This is a changed diagnostic fixture and implementation comparison, not a rerun of the old failed cohort.

Native probes count at most 32/128/512/2048 eligible joined rows per clause and return only that count,
stopping after the first level with an unsaturated clause. This bounds counted output, not FTS posting
traversal, tokenization, rejected rows or elapsed work. Counts select order only; the final SQL statement
rereads current matches, and answers are never truncated by estimates. If all clauses saturate the maximum,
this heuristic does not promise optimal order. Single clauses, OR groups and `any` keep their existing
semantics/scores. Global exclusions use owner candidates from the positive groups, rather than materializing
their entire matching corpus; this does not change their truth conditions or positive scores. Record all calls/samples, including probe overhead. Retain larger/broad materialization,
index-size/build and app-budget limits as unresolved until separately qualified. Stop on any correctness or
setup failure; never repeat automatically or change a deadline/expectation after the result.

### Native owner-postings correction cohort

The six-process conjunction cohort at `aadd721d43` is retained: rowid constraints fix a point case but
regress a 100-owner case to ~68 ms. That implementation is not accepted. After focused correctness checks,
run exactly **legacy / rowid / postings / postings / rowid / legacy**, fresh processes in one Linux container,
unchanged two CPUs/6 GiB and 180 seconds per process. Legacy is `9a2771ec25`, rowid is `aadd721d43`, postings
is the new owner-column implementation. Use the identical updated `text-shape.mjs` from the previous cohort
for all six, including both word orders, 100-owner groups, exclusions, OR, broad reads, writes, all samples,
bytes/calls/RSS/heartbeat. Stop on setup/correctness failure; no automatic retries or discarded samples.

Owner terms encode the immutable entity sequence in a private indexed column with zero BM25 weight. MATCH
intersects owner postings in one expression; no per-document MATCH loop is used. Build the mask in the final
SQL snapshot, cap generated terms at 2048, and fall back to the unrestricted clause if the runtime owner set
is larger. Estimates never truncate results. The indexed column changes document-length statistics and adds
storage/build work, which this cohort must report. Fresh/reset copied format-one profiles are required.
This diagnostic does not settle broad-query pagination, fuzzy scaling, real app budgets or phase 3–7 acceptance.

### Ranked-prefix and late-fetch cohort

Before measuring the adjacent-limit/single-clause correction, run exactly **legacy / postings / prefix /
prefix / postings / legacy**, six fresh Linux processes, unchanged two CPUs/6 GiB and 180 seconds each.
Legacy is `9a2771ec25`, postings is `c132441538`, prefix is the converged ranked-prefix implementation.
All six receive the identical `text-shape.mjs`, retaining its dataset and every earlier measurement, plus
50 broad highlighted/picked-name reads and 50 positive-recency broad reads. The latter explicitly measures
the generic-value recency fallback rather than excluding it from the comparison. Read counts stay at 250
for point/conjunction/group/exclusion/OR, 50 for each broad mode and 1000 name writes. All samples, binding
calls, file/RSS/WAL/heartbeat and actual entrypoints/native hashes remain. No warm samples are discarded.
Stop on correctness/setup failure, retain every attempted process, and never retry automatically.

The prefix optimization caps only an adjacent limit or a final first/first-row/exists terminal. It preserves
each type's possible global winners and applies the existing global pipeline afterward. Active recency
ranks generic values before limiting in JS; it has no premature SQL prefix. Single-clause aggregation removes
redundant native grouping. Bounded highlight queries score first, then fetch complete matching strings for
selected entities inside the request's read snapshot; only requested primary hit fields are projected.
Actual native returned-row and highlight-call controls are required before timing. This diagnostic is not
100k/FULL admission, full app qualification, bounded fuzzy, vector recall or an adoption decision.

### Actual text execution-plan diagnostic

After the ranked-prefix cohort, run exactly one pinned 10k profile with `text-plan.mjs` in disposable Linux,
unchanged two CPUs/6 GiB and OFF commits. Seed the same name/body/tags shape. Take ten consecutive samples
per point, point/common, 100-owner/common, broad limited, highlighted, recency and unlimited read. Retain
all samples, actual facade SQL/parameters/native EXPLAIN QUERY PLAN, binding time/returned rows and total
facade time. Capture plans after timing. Use normal built entries and native hashes; stop on setup or answer
failure, with one 180-second process bound and no automatic retries. This diagnoses SQL versus JS cost and
ranking materialization; it does not replace the failed cohort, discard cold samples or qualify latency.

### Entity-sequence ranking correction cohort

The retained actual-plan diagnostic shows three entity seeks along the broad ranking path. After the
carry-sequence correction passes functional and native-plan removal checks, run exactly **prefix / sequence /
sequence / prefix**, four fresh processes in one disposable Linux container, unchanged two CPUs/6 GiB and
180 seconds per process. Prefix is 76b1aa2765; sequence is the new converged source. Copy the identical
`text-shape.mjs` fixture to both: all 10k data, point/conjunction/group/exclusion/OR, broad, highlights,
recency and 1000 writes remain. Retain all samples, answers, plans/provenance, bytes/RSS/WAL/heartbeat and
build/admission costs. No retry or discarded samples. This compares a changed execution plan, not a rerun
to replace the failed prefix or 100k/FULL qualification. Recency is still the generic-value path.

### Native recency correction cohort

After finite native recency passes functional, snapshot and native row/decode-bound removal checks, run
exactly **sequence / recency / recency / sequence**, four fresh processes in one Linux container with the
unchanged two CPUs/6 GiB and 180 seconds each. Sequence is 2d0bdcbde9, recency is the converged native-value
ranking source. Both receive the identical updated `text-shape.mjs`, preserving its dataset, all existing
samples and 1000 name writes, plus 50 recency-highlight/picked-name reads. Verify complete tag highlights
for both highlighted modes. Recency uses the existing createdAt timestamps and one fixed clock per trial.
Retain every sample, answer, native hash/entrypoint, bytes/WAL/RSS, heartbeat and binding counts. Stop on
setup or correctness failure; no discarded cold samples or automatic retry. This measures the changed
native ranking path, not acceptance of phase 3's failed 100k/FULL gate, fuzzy, real corpus or app budgets.

### Native recency execution-plan diagnosis

After the completed native-recency cost cohort, run one changed-source 10k `text-plan.mjs` profile, same
resources and 180-second process bound. Preserve ten consecutive samples for every preceding path and
add ten recency-highlight reads. Capture actual native plans plus VDBE programs for FTS statements after
timing, with binding/total time, row counts, answers, source/native hashes and normal built entries. No
retry or discarded samples. This diagnoses timestamp selection, projection and ranking work; it does not
rerun qualification or establish a cause before the actual plans are inspected.

### Indexed timestamp-selection cost cohort

After the selected-stage native-plan guard and old-join removal check pass, run exactly **materialized /
indexed / indexed / materialized**, four fresh processes in one disposable Linux container, unchanged two
CPUs/6 GiB and 180 seconds each. Materialized is 0f57770e1f; indexed is the converged correlated timestamp
selection source. Use the identical expanded `text-shape.mjs` from the native-recency cohort, including
50 recency-highlight reads and every other case/write. Retain every raw sample, answer, native fingerprint,
entrypoint, call count and file/WAL/RSS/heartbeat result. No retries, discarded samples or budget changes.
Native plan evidence comes from functional validation; this cohort measures the changed execution shape.
It does not replace phase 3 qualification or close bounded fuzzy, realistic search/vector or app budgets.


### High-dimensional vector protocol

Preregister the next diagnostic before execution: 1536 Float32 dimensions, 64 independent Gaussian cluster
centers, and clustered (0.6 center + 0.8 independent noise) and mixed (alternating clustered/uniform Gaussian)
corpora. Normalize after generation, then preserve Float32 rounding in independent double-accumulated cosine
ground truth. Queries use a disjoint PRNG stream, never an indexed row. Pin generator/fixture/runtime hashes.
No low-rank trigonometric fixture, self-neighbor or native search result may serve as ground truth.

The first smoke is one fresh SQLite process then one fresh native-baseline process, 1k rows for each
distribution, 16 held-out queries, k=10, three paths (unfiltered, 10% indexed membership, 1% indexed membership),
one first call and two warm calls per query/path. Every seventeenth entity is trashed. Check known independent
cosine examples, deterministic regeneration, coordinate variance, exact SQLite recall=1 (allow only demonstrated
floating-point boundary ties), native mean recall@10 >=0.95 per path, no duplicate/out-of-scope/trashed results,
and no mutation of input vectors. Retain all query IDs/scores, truth, first/warm timings, independent heartbeat,
setup/update costs, loaded entries/addons, memory/resource usage, and DB/WAL files. Content updates and subsequent
embedding publication are separate acknowledged operations; record both and verify stale hashes/pending work.

After the smoke passes, run fresh 10k and 100k profiles in balanced SQLite/native/native/SQLite order, one
owned Linux container, 2 CPUs/6 GiB/no extra swap, same fixture and OFF write policy. Each process has a
600-second diagnostic bound; preserve partial reports on failure and stop the cohort. No automatic retry,
discarded first call or changing thresholds after observations. Query work is measured separately from truth
computation and fixture generation. Do not infer physical cold storage from a fresh process after backfill.
Before trying ANN alternatives, use provisional engineering ceilings: warm query p95 <=100 ms at 10k and
<=200 ms at 100k, query heartbeat-delay p99 <=16 ms, mean recall@10 >=0.95 for each path/distribution.
These are diagnostic thresholds for selecting an execution strategy, not approved full-app/adoption budgets;
actual representative app-flow acceptance and matched durability remain required. A synthetic pass cannot
replace licensed, attributed real-model corpus qualification or complete chunk/hybrid/lifecycle contracts.


### Int8 candidate counterfactual

Before its first run, freeze `vector-quantized.mjs`: pinned better-sqlite3/sqlite-vec only, no production
change. Quantize each Float32 vector independently by max absolute component, rounding/clamping to
[-127,127]. Search native vec0 int8 cosine for **64 candidates**, then rerank original Float32 values
with native cosine for k=10. No corpus-trained scale, external cache or ANN graph is introduced.
Keep live metadata in the same SQLite transaction; selective paths include native primary-candidate
lookup, rowid-list transport and vector filtering. Use explicit INTEGER PRIMARY KEY identities.

First verify direct quantized KNN and reranking through own writes, nested savepoint deletion/rollback,
metadata changes, two-handle WAL snapshots, close/reopen and VACUUM INTO. Then run one fresh process
at 1k, then 10k, then 100k, both existing 1536-dimensional clustered/mixed distributions, held-out 16
queries, all/10%/1% scopes, first +2 warm calls and one post-update call each. Stop the cohort at the
first correctness/recall or strategy ceiling miss; retain partial reports and unrun members. Keep existing
mean recall@10 >=0.95 per scope/phase, warm p95 <=100ms at10k /200ms at100k and heartbeat p99 <=16ms;
1k is a correctness smoke. No retries or changed candidate count after seeing recall. Record generation,
index/update cost, every answer/truth, candidate/rerank/total spans, files, memory and native fingerprints.

This is a native primitive counterfactual, not an integrated EARS strategy or app acceptance. Multiple
chunks per entity, adaptive distinct-owner admission, arbitrary/large k and hybrid semantics, background
generations and full backup/rebuild still require integration proof before selection. Current source
`chunks` uses an implicit rowid; a durable derived index must not join on that unstable identity across
VACUUM backups ([SQLite documentation](https://www.sqlite.org/lang_vacuum.html)). Require a stable owner
mapping or explicit primary key and test backup/reopen; do not change production layout before evidence.
