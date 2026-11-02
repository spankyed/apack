# Handoff before master integration, 2026-10-29

Historical state at `68cf78a2f4`, preserved before preparing the `8b1a479b96` master integration.
This is not the current handoff. No unmet requirement is completed or removed by archiving it.

## Current handoff

The goal remains active. All scope, phases and acceptance above remain required. Publication is the existing
[draft PR #286](https://github.com/spankyed/apack/pull/286), branch `session/ears-sqlite`; no merge/adoption,
release or version update is authorized. Active continuation is `/private/tmp/ears-sqlite-diagnosis-evidence`.
Runtime source `de48f5a924` implements the first ordinary-projection/native owner-candidate vector slice.
Disposable Linux ARM64 validation passes all 606 SQLite EARS cases, 135 affected host/storage cases,
package builds, EARS types/API, lint/imports and three meaningful negative controls. The plain-Node source
loading regression is fixed; earlier failures and corrected package-provenance refusal are retained in
[vector integration evidence](vector-integration/README.md).
Runtime `a4a49fba10` fixes a measured vector-plan regression: candidate membership drives
canonical lookups, and the threshold probe stops at 4,097 rows. All 606/135 affected cases, build/type/API,
lint/import and two negative plan/probe controls pass. The full integrated real-corpus matrix now exists;
its remaining budget failures are recorded below. Runtime `d28c296edb` keeps vector owner scopes in SQLite; all 607/135 affected cases and the new shared
scoped-query contract on pinned elmdb pass, with four negative controls. Native-scope full real-corpus
results retain high recall but still miss responsiveness. No newer full Strict is established. Inspect
actual source, branch and process state before resuming.

Canonical `monorepo-worktrees.noindex/sqlite-evaluation` stays at exact full-green `6cf6c8349e`,
[Strict 40861662941](https://github.com/spankyed/apack/actions/runs/40861662941), all nine jobs successful.
Only an exact full Strict green may advance it. Focused platform
[40947780198](https://github.com/spankyed/apack/actions/runs/40947780198) is successful on exact `5ddcf922b7`
for Linux x64/macOS ARM64/Windows x64, including the SQL plan/probe/owner/scope changes,
five native profile groups, seven dump cases, five real process-kill boundaries and existing
EARS/host/archive/CLI checks. Linux additionally passes the actual native-controlled starter-pack/API/
live-view/restart lifecycle. Exact [receipts](platform-40947780198/README.md)
retain counts, native/source hashes and explicit skips. Later commits are benchmark/evidence only.
This does not establish performance acceptance or final full Strict.
Runtime/native pins remain `98386b36a1`/`6ab2f69`. Reviewed master `3d2929177d` differs only in two plan docs;
reconcile any later changes deliberately. Preserve the other agent's source/build state. Compile/full validation
only in disposable Linux/CI, one local expensive container at a time, two CPUs/6 GiB/no swap.

Implemented candidate includes structured operations/units/committed watches, scalar/overflow values, native
selective queries, persistent declaration/index generations, FTS/trigram search, canonical primary embeddings,
logical snapshots/audit/rebuild, coordinated host import/recovery, explicit copied-profile conversion and CLI
maintenance. Evidence for these features retains exact source and limitations. Production still uses elmdb.
The optional Codex executable is absent in both native and SQLite API gate images, so its startup failure does
not establish successful external inference or complete pack health.

The real-model vector oracle uses 99,900 publisher-labeled 1536D vectors and 100 held-out queries.
Original fixed-probe IVF fails scoped recall. Exact flat also loses duplicate cutoff ties after updates.
A separately identified full binary scan passes all 36 mean-recall checks (0.989–1.0) but fails the 16 ms
heartbeat at 100k. No vec1 production dependency is added. Payloads/source IDs/models remain private and
outside Git; publisher metadata declares no license permitting redistribution. See
[real-model matrix](real-vector-matrix/README.md).
The primitive runs used 2 MiB SQLite cache and mounted-result database paths; EARS sets 64 MiB.
Do not use primitive timings as application estimates.

The pinned sqlite-vec comparison completes all six default-cache and four app-cache configurations.
Ordinary SQL is cheaper for selective candidate sets (100k/256 candidates: initial pooled p95 7.51 ms
at 10%, 4.38 ms at 1%); broad p95 53.15 ms still fails responsiveness. All mean recall checks exceed 0.95.
Vec0 is cheaper for broad K=256 but expensive at K=1,024, consistent with its repeated-minimum chunk
selection. No profiler attribution or application qualification is established. See
[layout control evidence](real-vector-matrix/sqlite-vec/README.md).

The first integrated slice uses ordinary derived projections, native owner candidates and exact reranking
with the existing dependency. Canonical bytes remain primary; units/savepoints/watches, owner chunk
aggregation, exact fallback, numeric extremes, cascade deletion, audit and rebuild have affected functional proof.

Two full real-corpus matrices complete, retaining all scopes/phases and raw samples. Mean recall is
0.999–1.0. At 100k initial broad query p95 improves from 304.41 ms to 55.63 ms after the repair, but
heartbeat p99 is still 58.37 ms versus 16 ms. The 10% scope is 35.29 ms query p95 /41.92 ms heartbeat;
1% is 13.31/14.68 ms. These are actual EARS query/update paths, not whole-app or cold/installed acceptance.
See [integrated real-vector evidence](integrated-real-vectors/README.md).

Owner-only reranking (`f8a5706b1e`) and native SQL scopes (`d28c296edb`) are implemented and measured.
The latest full matrix has initial 100k p95 61.14 ms broad /28.55 ms at 10% /12.56 ms at 1%; heartbeat
p99 is 64.32/37.02/14.39 ms. High sampled recall does not pass the missing 16 ms responsiveness gate.

Next checkpoint: qualify a native ANN strategy's transaction, rollback, snapshot, filter-before-K,
backup/reopen, update and resource behavior independently before any dependency adoption. Preserve the
correct SQL scope path and investigate native admission/execution ownership; do not relax budgets.
A scratch-only test of `sqlite-vec@0.1.10-alpha.4` DiskANN fails hard filtering and an exact-match
retrieval fixture, while matching flat controls pass. It rejects metadata columns. Unit/snapshot/backup
checks after the failure remain unrun. No production dependency changed; see
[ANN gate evidence](sqlite-vec-ann-compat/README.md).
Evaluate another native strategy and its ownership/update costs; this failed prerequisite is not adoption
or a disposition of the unmet broad responsiveness requirement.
Exploratory same-model vec1 IVF probes complete: 32 probes meet broad/10% sampled recall and heartbeat
but fail 1% recall (0.947); 64 probes meet sampled recall but miss heartbeat. Neither passes the full
matrix. No dependency changed. [Probe evidence](vec1-ivf-probes/README.md)
now includes the [owner-scope prerequisite](vec1-owner-scope/README.md):
UUID owner-IN filtering takes roughly 2.5 seconds at 10% and 270 ms at 1%, despite identical candidate
results. Constant range filters do not qualify actual EARS scopes; this vec1 path is unsuitable for
graph-sized arbitrary scopes. [Stable vec0 chunk controls](vec0-chunk-control/README.md)
at 64/128/256 rows all pass sampled recall but miss broad heartbeat; the configuration hypothesis
does not solve responsiveness. No production dependency/layout changes follow. Next evaluate a native
strategy with efficient arbitrary membership filtering and transactional ownership, including the
maintenance cost of any required extension change, before integration. Fresh frozen queries and complete integrated/admission/platform checks remain required
before acceptance. No strategy selection or adoption is established.
A scratch [text-IN extension patch](vec1-text-in-patch/README.md)
reduces the UUID owner predicate to about 19.46 ms p95 at 10% and 13.75 ms at 1%, with
93 ordinary-SQL comparisons passing on both original/patched code and 20 small compatibility
groups passing on the patch. This still misses scoped responsiveness before EARS integration.
The patch is bench-only; no production dependency/loader/layout changed. Next inspect compact
integer owner surrogates and efficient membership, then review any fork's maintenance and
platform burden before adoption. Keep all fresh-query, admission and complete goal acceptance.
The [integer membership diagnostic](vec1-integer-in-patch/README.md)
completes: matched native owner-IN p95 at 9,889 owners is 96.19 ms original /13.65 ms
with a bounded bitmap patch, and 17.42/9.48 ms at 988 owners. Both extensions pass 306
independent SQL comparisons; the patched code passes the small compatibility gate.
The ten-query broad first-pass p95 of 17.50 ms remains retained. Sparse/wide IDs retain
the old slow path. No final responsiveness, native adoption or integrated claim follows.
[Fresh validation protocol](../../../../packages/apack-ears/bench/sqlite/REAL-VECTOR-FRESH-PROTOCOL.md)
is frozen before new queries are evaluated; the [independent fresh oracle](fresh-vector-oracle/README.md)
now covers eighteen cohorts with 54 scalar checks and the 101-ordinal exclusion union.
The [actual fresh EARS matrix](fresh-native-ears/README.md)
at `71810414e8` now completes: all eighteen cohorts pass mean recall (minimum 0.972),
but responsiveness fails. Broad 100k timed p95 is roughly 19 ms; large filtered groups
are roughly 139–149 ms. Admission heartbeat p99 is 24.34 ms. The independent verifier
rejects the full matrix on unchanged gates and rejects corrupted evidence. `dacd2093ca`
profiles native filtered SQL at about 121–124 ms, scope/count/rerank overhead separately,
and COMMIT as 20.05 of 27.84 s of admission (maximum 385.69 ms). Model installation and
observed GC are small. [Projection/shared-scope work](vector-projection-scope/README.md)
now passes 625 EARS/135 host plus seventeen native cases. Owner-only native projection
has no material speedup; bounded shared count/exact eligibility reduces a sampled small
exact query from 20.91 to 16.72 ms, while broad samples are worse and large filtered
queries remain 134–143 ms. A deterministic fixture fixes an initial scoped-limit failure;
the old duplicate-evaluation path fails the new scalar witness. No acceptance is claimed.
Next consolidate remaining scope/count/rerank work in one SQL execution frame, qualify
native membership/distribution and test off-thread PASSIVE checkpoints while preserving
FULL logical durability and bounded WAL/drain safety. Integrate the pinned concurrent
master snapshot deliberately before final current-baseline claims.
Keep the failed matrix and frozen ANN settings/budgets; no retuning or adoption follows.
No more primitive result alone can establish the required final execution design.
Internal generation storage, background training and a durable shared-scheduler model queue
now exist in `vector-index.ts`, `vector-training.ts` and `vector-models.ts`.
Runtime `666aa6e0c9` passes 624 EARS, 135 host/storage and seventeen native lifecycle cases,
builds/types/API/static checks in disposable Linux. [Scheduler evidence](native-model-scheduler/README.md)
retains exact sources and checks. Attempts are committed before read-only workers launch;
completed models remain available until the result transaction commits. Restart recovery is
explicit under the managed exclusive writer. Projection and retirement use bounded batches,
and readiness shares the existing scheduler without advancing logical commit identity.
Ready attached models now feed actual EARS near/hybrid vector execution with bounded
chunk-to-owner expansion and canonical exact reranking; unready/insufficient native owners
retain the existing fallback. EARS fixtures cover native invocation, 300-chunk owner expansion, stable ties, large SQL
scopes, like exclusion, canonical scoring and unit visibility. `89539dda3e` passes the
strengthened best-chunk/expansion mutation controls. These are not real-corpus recall/latency acceptance.
Normal app composition does not activate this service. Automatic eligibility admission,
incumbent-preserving physical model refresh, host drain-before-replacement/deletion, final
multi-chunk/filter/tie/freshness qualification and complete audit/rebuild/restore integration remain required.
[Platform 40969207041](https://github.com/spankyed/apack/actions/runs/40969207041) passes
Linux/macOS/Windows on `ae156ce242`, with all seventeen native cases, producer conversion,
process-kill boundaries and per-host verification. The Windows linker fix is exercised.
Counts: 624 EARS/135 host on Linux/macOS; 623 EARS/122 host on Windows with explicit
POSIX/directory-sync omissions. Linux covers the converted API restart/live-pack gate.
Text receipts and original failed runs remain in scheduler evidence. Later benchmark-only
commits are not retroactively qualified by this exact run. Final exact-tip gates remain.
Normal native distribution/fork selection and all frozen fresh/app/resource/full Strict gates
remain required. The active integrated vector path still fails broad responsiveness.
Concurrent master advanced to `8b1a479b96` (PR #287), with application query-efficiency
changes, an SDK testing export and native pin `4d558a2754`. Our measured source still uses
the `98386b36a1` runtime baseline and `6ab2f69` native pin. Deliberately integrate that
committed master snapshot and matching native artifact in isolation, then validate affected
app/SDK/native contracts before claiming current-baseline comparison or final acceptance.
Publishing this checkpoint does not integrate or qualify that concurrent work.
Closing checks must cover candidate/trash filtering before K, multiple-chunk owner scoring, ties, large K,
model/generation/hash freshness, own-unit/savepoint reads, watches, audit/rebuild/restore, representative real
recall/update/resource/latency and heartbeat budgets. Preserve canonical Float32 bytes and original failures.
Synchronous EARS contracts cannot silently become asynchronous; choose execution/admission ownership explicitly.

Still required, without narrowing phases 3–7:

- Resolve admission/cleanup and vector responsiveness misses; qualify FULL writes, realistic streaming/watch
  load, large fields, growth, peak memory, disk/WAL/checkpoint behavior and warm/cold/reopen app budgets.
- Complete representative language/identifier/typo/relevance usefulness, vector/hybrid/multi-chunk/update
  qualification and matched current elmdb/SQLite comparisons. Existing samples are not application acceptance.
- Complete Electron/renderer, executable-pack/SDK flows and installed/signed CLI/app OS/architecture coverage.
- Qualify disk-full/I/O/unknown commit, long readers/busy writers, interrupted admission/import/backup,
  physical/resource faults, corruption, permissions/read-only mounts and Windows ACL/directory durability.
  CI hosts do not certify arbitrary filesystems. Preserve explicit unsupported-filesystem refusals.
- Resolve the pinned native own-unit embedding-visibility failure with its shared assertion intact; achieve
  the full required Strict gate on the actual final tip. Older unrelated failures remain separately evidenced.
- Complete architecture/native dependency/maintenance review, current API/reference docs and an evidence-based
  final adoption decision. No earlier green, document move or benchmark completes an unmet requirement.

Detailed dated checkpoints and original failures are preserved in
[checkpoint history](checkpoint-history.md).
