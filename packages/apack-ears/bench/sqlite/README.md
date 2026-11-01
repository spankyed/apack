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

For the matched current-source CI measurement, dispatch `app-acceptance.yml` with `suite=sqlite-bench`
on `session/ears-sqlite` after focused contracts converge. The separate OFF and FULL jobs each alternate three
fresh processes per backend under enforced 2 CPU/6 GiB/no-swap limits. Each records its exact app/native source,
actually loaded binding hashes, raw samples and failure outcomes. An incomplete or invalid run stops and retains
its evidence; a new run requires an empty output directory. Compare medians and dispersion per task and durability
cohort, retaining all three trials. These are synthetic API throughput/resource measurements, not app latency,
real-corpus recall or durability/platform acceptance. Do not combine OFF and FULL into one headline speed ratio.

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

The candidate remains unqualified. Value/text/vector/trigram admission uses persistent background generations,
and declarations validate through Ajv plus structural checks. Supported large vector queries can use ready
native models with adaptive owner budgets; smaller scopes, unsupported shapes and large K remain exact.
Primary embedding bytes survive derived retirement, and logical export/staging, audit/rebuild, host replacement
and cross-platform loading are implemented. Their evidence and limits belong to the
[current goal handoff](../../../../docs/goals/goal-ears-sqlite.md#current-handoff), rather than this historical
experiment directory. Passing contracts or one corpus pass do not establish complete app, resource,
filesystem, signed-distribution or adoption acceptance.

The protocols below retain earlier hypotheses and measurement cohorts. Read their linked source-pinned
receipts and the current goal before repeating them; an old “next run” is not authorization to restart an
already completed diagnostic or change a current production parameter.

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


The first int8-cosine cohort passes all transaction controls and 1k profiles, then stops at the first
10k clustered heartbeat miss (17.23ms p99). Before testing the next metric, preregister `l2-unit`:
normalize each input with double-precision norm, round 127 times each coordinate to signed int8, and
append 32 zero coordinates to queries. Stored vectors use those extra coordinates to make their
integer squared norm exactly R², R=ceil(127+sqrt(original dimensions)/2), by bounded greedy squares.
The rounding-error triangle bound makes this radius sufficient; assert remaining padding is zero.
Then squared L2=constant+queryNorm²-2*integerDot, eliminating stored quantization-norm bias while
allowing the library's int8 L2 kernel. Original Float32 cosine still supplies final scores.

Keep 64 candidates, original corpora/scopes/updates, all transaction/backup controls and every target.
Run 1k/10k/100k once in order, stopping at the first miss, and retain the rejected cosine results.
Check integer norm/distance identities, zero query padding and scaled/sparse/dense/held-out examples
before timing. Source v0.1.9 has a conditional NEON L2 path; do not infer that the tested binary uses
it, or that a speedup is caused by it, without runtime/build evidence. This remains a primitive
counterfactual with multi-chunk/large-k and integrated EARS/resource/app requirements still open.


The l2-unit cohort likewise stopped at 10k heartbeat p99 22.34ms, despite exact recall on sampled calls.
Before another strategy change, fix the next control: same upstream v0.1.9/e9f598ab source, same l2-unit
encoding/64 candidates/data/targets, private Linux `-O3 -DSQLITE_VEC_ENABLE_NEON` extension build only.
The npm binary's vec_debug reports blank build flags; upstream's Makefile enables NEON by default only
for Darwin arm64. This motivates a build-configuration control, not an assumed cause. Verify release
archive digest, source/header/native hashes, compiler command/version and runtime flags; all controls
must pass again. Run 1k/10k/100k once and stop on first miss. The diagnostic-only EARS_VECTOR_EXTENSION
path selects this private artifact; normal production loading and dependency lockfiles remain unchanged.

Also build a same-source/plain -O3 binary with the identical compiler and headers. After the NEON
cohort stops or completes, run one plain 10k diagnostic (expected failures retained, no restart) to
separate the explicit NEON flag from other prebuilt/compiler differences. The runner records each
exit independently and never retries either binary. This control is not another acceptance cohort.


The exact-source NEON control stops before corpus timing because its full-range int8 distance fails.
A direct scalar/NEON check at 8/35/1568 dimensions returns 254 in scalar but NULL in NEON for +127
versus -127. Source squares differences into signed 16-bit lanes before widening. Both return 180 for
+90 versus -90. This is an actual restricted-domain requirement, not a transaction failure.
Before measuring `l2-safe`, derive its scale as floor(sqrt(INT16_MAX)/2)=90 and bound every encoded
coordinate, including norm padding, to [-90,90]. Then every coordinate difference is at most 180 and
its square <=32400 fits. Keep normalization/constant norm, 32 padding slots, 64 candidates, all original
truth/recall/latency controls and source/binary pins. Public Float32 inputs stay unrestricted by this
internal encoding bound. Run this one bounded variant through 1k/10k/100k, stop on first miss, retain
the rejected full-range strategy, and perform the paired plain 10k control. No production optimized
binary is selected; shipping or exposing unrestricted int8 NEON would remain incorrect in this release.

## Offline membership repair cost protocol

`membership-repair.mjs` measures the actual app-only rebuild entry on fresh 1k, 10k and 100k profiles,
OFF and FULL commits. Fix the six-process order before execution: 1k OFF/FULL, 10k FULL/OFF,
100k OFF/FULL. One process per profile; no repeats, discarded failures or performance target chosen afterward.
Run only in disposable Linux with two CPUs/6 GiB/no swap. Inputs are eight mixed list members (including
duplicates/null/boolean/numeric-zero) and a 2048-character overflow body per entity, committed in 256-row
seed units. This is repetitive synthetic storage, not a representative app corpus or codec/entropy survey.

Delete only the duplicate-tag membership (one entry per entity), retaining the other populated membership
records, then time the native membership statement and complete offline rebuild
separately. Record seed time, actual synchronous/journal modes, file/WAL/page sizes, before/after process
memory and cumulative maxRSS/CPU (including seed); do not label cumulative peaks as repair-only memory.
Check all duplicate-tag matches, a selective group, representative retained primary fields, unchanged
logical commit, membership count and stale-handle refusal. Stop at the first correctness/setup failure;
retain it. No latency/resource ceiling is preregistered for this cost diagnosis, so completion is not
maintenance acceptance. OFF/FULL are different policies, not matched acknowledgments against elmdb.

### Primary embedding layout diagnostic

`embedding-layout.mjs` fixes fresh 1k then 10k clustered 1536-dimensional profiles, OFF commits, and
eight held-out queries across all-live, ten-percent and one-percent candidates. Run one process in
disposable Linux with two CPUs/6 GiB and a 180-second bound, stopping at the first failure. Normal EARS
calls populate the referenced layout; a diagnostic-only inline table copies identical chunks and bytes.
The first diagnostic omitted the inline layout's secondary indexes; retain it as an incomplete baseline,
not evidence attributing the observed broad-query difference to the vector join.

Before executing the corrected trial, reproduce every original inline chunk index, and fix order
**inline / linked / covered / covered / linked / inline** for each query/filter. `linked` pins the
observed incumbent plan (generation index for all-live, primary key for selective); `covered` uses a
diagnostic-only partial index on type/index/generation/entity/vector ID. Other SQL work remains identical.
Record every first/warm call and actual plans. Every variant must match independent exact truth and an
untimed current facade control. Capture source/fixture/corpus/vector/native hashes, files and RSS.
This isolates native layout/plan cost on warmed synthetic data; it does not compare complete app runtime,
prove a cold-store bound, resolve existing heartbeat failures or certify durability. Temporary duplicate
storage and process-wide RSS are not production-layout peak memory or disk measurements. The diagnostic
index is not adopted into production by this harness. Preserve both trials and decide from their limits.


### Real filesystem-full regression

`filesystem-full.mjs` runs only against an explicitly supplied Linux tmpfs mounted at `/fault`, limited to
8 MiB. It refuses another filesystem/size or an existing output report. Use a disposable Linux runner;
the SQLite platform workflow creates/owns/unmounts that mount and runs the source with `node --import tsx`.
It does not change page-count limits, FULL synchronous policy or default checkpoints. Four write paths
(COMMIT after an actual ENOSPC filler, ordinary write, bulk load and a unit with an earlier staged write)
exhaust real filesystem space. Every refusal must preserve the prior rows/logical sequence, end the unit
and avoid watch notification; after freeing space, reuse and read-only reopen must retain exactly the
incumbent and recovered write. The platform verifier requires all four actual cases and their observed
outcomes. This tests Linux filesystem ENOSPC handling, not device power loss, other I/O failures, arbitrary
filesystems, Windows durability or general resource/performance acceptance.

## Real paired hybrid correctness

`node --import tsx packages/apack-ears/bench/sqlite/real-hybrid.mjs <private-corpus> <new-report.json>`
runs on the matching disposable runtime after full paired-corpus verification. It imports the first
1,000 actual text/vector pairs and queries all 100 held-out title/vector pairs through EARS
for all-live, 10% candidate and 1% candidate scopes. Complete input hashes are streamed; only
the first 1,000 corpus vectors are retained, rather than the entire 585-MiB input. Its
independent fusion reference combines separately observed complete text and vector rankings with
reciprocal ranks (constant 60), preserving text-first insertion order for exact ties. Membership,
order, scores and duplicate absence must agree. FULL durability is asserted. Reports contain only
source/manifest hashes, row counts and numeric timing samples. Private database scratch is removed
on success or failure; the calling workflow also deletes the acquired corpus before artifact upload.

This is a correctness slice, not a semantic-relevance judgment, ANN recall study, full-corpus
performance result or resource-budget qualification. The current hybrid path requests all vector
candidates, so growth behavior remains an explicit unresolved performance concern. Runtime
qualification of this new recipe is pending.

The first actual paired hybrid run (41229505453, b95b0ed195) passed all 100 fusion checks
at 1,000 rows (warm p95 8.08ms, max 10.78ms), but only three held-out titles had lexical matches
in that prefix. A separately labelled set of 100 corpus-derived lexical controls now checks
that both rankings participate; these controls reuse corpus vectors and are explicitly not
held-out semantic-relevance judgments. Their execution and the later selective/heartbeat
changes remain unqualified until a matching run finishes.

The current probe accepts an optional final size argument of `1000`, `10000` or `99900`.
The corpus workflow runs every prefix against the same acquired dataset, creating and removing
a fresh database per prefix. Lexical controls are spread deterministically over each prefix.
Reports checkpoint every 25 completed queries so interrupted work remains explicitly incomplete.
The 30-minute workflow deadline is unchanged. These warm uncapped-runner timings do not
certify original responsiveness/resource budgets, cold behavior or sustained app workloads.

The first window-policy checkpoint uses the pinned native global vector depth `max(40, 4*k)`
before RRF. The reference still reads complete exact vectors and records top-ten overlap
with the full-ranking baseline, in addition to checking exact window-policy results. This
changes ranking semantics; it is not an equivalent exact optimization. Existing ANN routing
is unchanged, so the default window of 40 still takes the exact distance path. Performance,
usefulness and recall must be evaluated before adoption, with original budgets intact.

After all timed samples, a separate explain pass captures actual statement times, returned-row
counts, hashed SQL and SQLite query-plan details for each scope. It excludes query text,
bindings, IDs and vector payloads. This diagnoses distance/scoped access costs without putting
trace instrumentation into the timing samples. Its runtime qualification remains pending.

The next routing candidate extends the approximate-result limit from 32 to 64, retaining
the existing 256-owner rerank pool, exact small-scope route and exact larger-K fallback.
The probe compares approximate K=10/40/64 results against complete exact rankings for every
query, scope and family. Mean recall must reach 0.95 in each group at each K; failures retain
their raw numeric samples and matrix receipt and fail CI. Fusion correctness uses the observed
40-result leg; full-ranking top-ten overlap remains separately reported. This is an explicit
approximate-policy evaluation, not exact equivalence. No managed native-model owner is started
in this fixture: fallback candidate routing is exercised; ready-model app qualification and
independent Float64/update/trash vector matrices remain required. Original latency/heartbeat
limits are unchanged. Actual execution of this routing revision remains pending.

## App semantic usefulness checkpoint

The `sqlite-relevance` workflow preserves the frozen 214 public app-document sections, all
25 top-five judgments and their highlight requirements. It computes document and query vectors
locally using the pinned [all-MiniLM-L6-v2 model](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
(revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`, Apache-2.0 model card),
then executes the real EARS hybrid API on both backends. The model card's 384-dimensional,
256-token attention-mask mean/L2 policy is explicit; truncation counts are recorded. The recipe
checks every model/tokenizer/config byte against pinned hashes and imports exactly pinned
inference tools in a two-CPU/6-GiB/no-swap disposable container. Inference sends no corpus text
to a hosted model service. No inference dependency or model file enters the product.

Only numeric case results, source/model hashes and tool metadata are uploaded; private model
weights and generated vectors are removed. An independent verifier requires every original
ordinal once on each backend, matching provenance, actual useful results and source-correct
highlights. A miss fails the job while preserving its report. This new model-specific English
hybrid check does not replace the retained text-only relevance failure, multilingual/language
semantics, full-dimensional resource/recall trials or app UI acceptance. Recipes parse locally;
actual inference/backend qualification is pending.

`sqlite-corpus` also runs this app-judgment job on a separate disposable runner, so a routing
checkpoint includes both large-corpus recall/resource diagnostics and small real-app usefulness
evidence at the same source. `sqlite-relevance` selects only the latter when vector scaling is
unaffected. Each report states its scope; either job can fail independently.

The next scaling revision runs Node queries, not only acquisition, inside the two-CPU/6-GiB/
no-swap container. It mounts the matching runner-built dependencies and Node binary read-only,
disables runtime networking and writes databases/cache only to owned private scratch. The harness
refuses mismatched cgroup limits and records actual limits, Node/native hashes and peak RSS.
Earlier uncapped timings remain explicitly distinct. This warm diagnostic still does not certify
cold/reopen variance, sustained app/admission work or every original resource budget. Container
compatibility and this execution revision require actual qualification.

Node workload containers use Ubuntu 24.04, matching the runner that built their native modules,
and retain that image digest separately from the Python acquisition image. This avoids treating
an unrelated Python base image as evidence of native ABI compatibility. Actual loading and
query execution in the capped image remain required.

The real-corpus CI job accepts `sqlite_vector_models=managed` as a separate execution regime.
It prepares the cursor before ingestion, starts the ordinary model owner after embeddings are stored,
waits for ordinary admission and verifies a persisted ready model above the exact-search threshold.
The 1k prefix must retain exact routing without training; 10k/99.9k require a ready model.
Admission time/heartbeat samples, training sample count and model/extension hashes are retained;
workers are drained before private database removal. The default remains the separately identified
fallback regime. The managed recipe is not runtime-qualified yet and does not change recall or
latency targets. Admission measurements here do not exercise concurrent foreground write/watch load.

The hybrid recall recipe now generates independent Float64 cosine truth over the sealed
canonical Float32 corpus in the capped Python container. It covers both query families,
all three prefixes and the exact stride-based eligibility sets used by this probe.
Matrix results are checked with scalar `math.fsum` for six queries per cohort. Node checks
recipe/manifest identity, complete unique cases and eligibility before comparing recall
at 10/40/64. Oracle ordinals stay in private scratch; public receipts retain hashes and
numeric scalar checks. Fusion-policy correctness still has its separate exact-SQL reference.
This recipe is awaiting actual runtime qualification and does not retroactively relabel
earlier same-engine exact recall as independent truth.

The first managed run fails the unchanged mean recall target at K=40/64 despite improving
all-live latency. Its numeric failure evidence is retained under `managed-hybrid-b04`.
A corpus-only `sqlite_native_candidate_floor=1024` diagnostic requests at least 1,024
native chunk candidates before existing owner deduplication/reranking. It overrides the
benchmark process's candidate method only, records the override in every receipt, and
leaves production policy, training and eligibility unchanged. Use it only with managed
models. Its recall/latency remains unqualified; a passing diagnostic is not a production
policy decision. Private acquisition cleanup now writes an EXIT receipt on recall failure
as well as success, preserving the original nonzero exit status.

A separate `app-text-language.mjs` diagnostic evaluates the same frozen 214 English guide
sections and all original 25 top-five/highlight judgments under both no stemming and explicit
English stemming, on both adapters. Fields, weights, queries, expected IDs and cutoffs are
unchanged. Reports contain numeric ordinal/outcome/timing data only. The independent verifier
requires all 100 cases and cleanup receipts, preserving every configuration's failure count;
a successful diagnostic means complete execution, not that all configurations meet usefulness.
This does not modify the original unstemmed acceptance spec or choose a production language
policy. It is awaiting actual runtime evidence in the separate relevance CI job.

The 1,024-floor diagnostic still misses one K=64 group (0.94890625), and independent
training produced different model hashes from its 256-target predecessor. The next
`sqlite_native_candidate_floor=2048` run therefore records matched production/1,024/2,048
near-query recall and timings against the same ready model and database snapshot. Query
order rotates by ordinal; these are warm query measurements, not full variance/app proof.
The main hybrid pass uses the declared 2,048 floor, while comparison failures remain in
separate per-width metrics. Metadata coverage requires every width and depth. Production
policy remains unchanged. Width-only diagnostics omit repeated unaffected semantic inference;
the separately requested relevance/language workflow still runs its complete judgments.

The matched 2,048-floor run passes all declared mean recall targets while retaining
heartbeat failures and higher candidate/reranking costs. The production candidate now
uses distinct-owner budgets 256 through K=32, 1,024 through K=40 and 2,048 through K=64;
training admission and raw fallback budgets remain unchanged. Actual integrated policy
qualification is pending; the matched override alone does not establish it.

The managed corpus recipe also records a separate owner-projection diagnostic after timed
queries. For one fixed control vector per non-small cohort it compares native `owner`
projection with native heap `rowid` projection plus a batch canonical owner lookup, using
the same model/filter/K and three alternating-order samples at 256/1,024/2,048. Returned
owners must match exactly; public receipts retain only counts and timings. Upstream's
`vec1ColumnMethod` calls `vec1SeekCsr` for metadata columns, while `vec1Rowid` reads the
query heap. This source distinction motivates the test, but no runtime cost attribution
or production projection change is established until actual measurements are inspected.
