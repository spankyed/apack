# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. Current app integration pins master 98386b36a1
and native engine 6ab2f69. Inspect the current handoff and actual source before continuing.
Work in the isolated session/ears-sqlite checkout and preserve concurrent work.

Finished when the SQLite candidate runs the complete app data lifecycle, all required
contracts and recorded performance/relevance/recall budgets pass, full validation is
recorded on pinned source in disposable environments, and a draft PR is ready for
an adoption decision. Commit usable checkpoints. Do not silently drop requirements.
```

Status: active candidate integration and qualification, 2026-10-29.
Branch: `session/ears-sqlite`. Checkout: `monorepo-worktrees.noindex/sqlite-evaluation`.
The original `session/sqlite-evaluation` branch preserves the experiment at `4a3fe698f8`.

## Scope

Build a complete, maintainable SQLite implementation of the app's EARS needs, using the prototype's tests,
fixtures and integration lessons. Replace its experimental execution/transport choices where appropriate.
The deliverable is a candidate that boots an isolated app profile and supports installed packs, entity and
relation operations, watches, search, embeddings, live declarations, run history, CLI data operations,
backup/import/recovery and supported packaging. A benchmark adapter or test-only factory alias is insufficient.

Preserve current data-integrity, transaction, typing, lifecycle and observability contracts, including relevant
work committed after the original experiment. Search acceptance measures user usefulness and explicit features;
exact scores and rank order need not reproduce elmdb. Important identifier matching, correct highlights and
phrase boundaries remain requirements. Typo handling, syntax and language choices must be specified and evaluated.

Use the [feasibility evidence](../references/evidence/ears-sqlite-evaluation-2026-10-27.md) as historical findings,
not current acceptance. Existing trial results used an older elmdb/API baseline and low-rank synthetic vectors.

A production cutover is the final adoption decision after a complete reviewable candidate. Until then keep the
normal production composition on elmdb. Use copied/synthetic profiles for SQLite; never migrate daily-use data
implicitly. Follow the repository's format-one policy: developer conversion is an explicit operation on a copy,
not a legacy compatibility layer in normal boot.

## Decisions

- Preserve the pack-facing EARS facade and its current typed contracts. Exported storage/construction types may
  change with every call site and API report updated together. Introduce a small private structured backend
  boundary using typed operations/results/transactions. Keep MessagePack where native boundaries or lossless
  persistence require it; SQLite's JavaScript path must not encode/decode requests and results unnecessarily.
- Adapt elmdb at that boundary while it remains the baseline. Avoid a general database framework, plugin registry,
  second query language or permanent dual-backend product. If adopted, SQLite becomes the single supported backend
  and temporary selection/comparison machinery is removed or retained only as explicit historical fixtures.
- Give SQLite selective filtering, projection, ordering, pagination, aggregation and traversal wherever compatible
  with the contract. Define necessary value/collation fallbacks explicitly. Do not promote the prototype's JS scans,
  per-node/per-row SQL loops, vocabulary scans or full-row rewrites into the final design by default.
- Choose one storage layout after measuring representative field reads, rows/pages, streaming field updates and
  typed dynamic declarations. Evaluate the prototype's duplicate MessagePack/JSON/index storage against selective
  typed storage. Do not assume either per-type SQL tables or a generic field layout is correct without this slice.
- Keep primary entity/relation data authoritative and derived indexes rebuildable. Derive watch invalidation from
  successfully committed logical mutations; keep precise commit identity and failed-operation atomicity.
- Keep backend-specific file/open/backup/recovery knowledge at the host storage boundary. Replace hard-coded
  `data.mdb` preflight with concrete storage descriptors and real open/validation paths, not marker files.
- Use a pinned FTS5-capable SQLite distribution and an explicitly chosen vector strategy. The tested
  better-sqlite3/sqlite-vec combination is a starting candidate, not a settled packaging or ANN choice.
- Local checks remain targeted EARS/driver/static checks. Compiler/captured-runtime tests and broad gates run in
  disposable Linux/CI. Packaged-platform checks use disposable runners/VMs. Session-specific compiler caches and
  independent dependencies/output are required; a Rust build additionally needs an isolated engine checkout and
  private target/artifacts. Do not borrow a mutable build from the other agent.

## Phases

### 1 Reconcile contracts and pin the integration base

Inventory changes since the prototype and map each current EARS/host requirement to its owning test and backend
responsibility. Include typed-field enforcement for every ordinary writer and the deliberate unchecked repair/import contract,
explain diagnostics, call counting,
watch scheduling/settlement and ongoing search/schema changes. Preserve useful prototype operational cases and
remove accidental protocol/implementation assumptions from shared assertions only through explicit decisions.

Integrate a pinned committed snapshot of the concurrent branch through the repository's detached integration
workflow in disposable Linux/CI. Never copy its dirty files or merge a moving branch blindly. Record the commit,
matching elmdb native artifact and inherited contracts. Reconcile later relevant changes at deliberate checkpoints.

Acceptance: a current contract matrix, a pinned clean integration result, baseline suites and native provenance,
and explicit search invariants versus approved behavioral flexibility. Source integration is not acceptance by itself.

### 2 Deliver the structured backend and first native SQL slice

Implement the private typed backend/transaction boundary and elmdb adapter. Put the SQLite candidate under normal
source ownership and production dependency/packaging conventions. Implement its chosen authoritative layout,
lossless value representation, typed validation, CRUD, relations, nested units and committed change delivery.
Complete native selective lookup, a representative page and a common graph query through the actual EARS facade.

Measure source-to-SQL mapping, binding calls, decoding/allocation and SQL execution separately. Include small
field updates in large entities so the layout is not selected by whole-row reads alone. Preserve useful call
counting; explain must report actual SQLite access paths rather than fabricate LMDB-equivalent work counters.

Acceptance: shared core/model tests pass for both adapters, the slice has verified query plans, and a first honest
EARS benchmark comparison on the pinned current baseline. Open the draft PR here with a working vertical slice,
its outstanding requirements and this goal. Keep it updated through the remaining phases.

### 3 Complete live declarations and watches

Implement type/field/index declaration validation and refusal atomically, including stale-handle checks and
interactions with open units. Define index states, build generations, committed change capture, readiness and
recovery. Backfill in bounded work, reconcile intervening writes and publish readiness atomically. Define correct
reads while an index is building, cancellation, reopen and failed-build behavior.

Choose foreground connection and worker ownership explicitly. Our synchronous API cannot become asynchronous
silently. Moving a long index build to a worker alone does not solve writer-lock contention: foreground calls
must not sit in a long busy wait. Set and test budgets for index admission, foreground stalls and WAL/disk growth.

Preserve scheduler behavior, watch settlement, commit identity, rollback and notifications for every write path.
Document same-process ownership and any deliberate cross-process limitation.

Acceptance: declaration changes during realistic read/write/watch load remain correct and within recorded latency
and resource budgets; interrupted builds recover; model/watch/scheduler tests and meaningful negative proofs pass.

### 4 Deliver search and vector behavior

Build a shared relevance corpus from representative app fixtures: identifiers/camelCase, names, accents, phrases,
field restrictions, typos, list fields, supported languages and mixed relevance/recency. Record expected useful
results before tuning. Specify matching, query syntax, language/stemming support, tie-breaking and highlighting.
Use native FTS indexes/ranking and only justified adaptation. Avoid an unbounded vocabulary scan per query.

Choose vector execution using target corpus sizes, dimensions, update rates and candidate-filter selectivity.
Use deterministic high-dimensional clustered and mixed corpora plus representative real embeddings from approved
fixtures. Compare exact ground truth, recall@k, latency and resource/update cost. If exact scan meets the app's
recorded budget, it is acceptable; otherwise select and qualify an ANN solution. Preserve model/hash/chunk
freshness, rollback, trash/candidate filtering and hybrid behavior independently of the search algorithm.

Acceptance: explicit relevance and recall targets pass, important search features work, and behavior differences
are reviewed against user needs rather than exact elmdb score equality. Extensions load in the supported runtime.

### 5 Integrate the complete app lifecycle

Replace test-only aliases with normal host composition for an explicitly isolated SQLite profile. Wire both app
and run-history stores, dynamic pack registration, SDK testing, CLI data commands, diagnostics, export/import and
settings/media acceptance. Exercise the actual app and representative streaming, browsing and reactive flows.

Complete storage descriptors, backup publication, read-only access, populated replacement and coordinated rollback
when database replacement, media installation or acceptance fails. Keep a durable recoverable incumbent when
restoration fails. Define corruption versus permission/disk-full refusal at run-history boot. Provide required
logical export, audit and rebuild operations for the app; disposition raw elmdb-only tooling explicitly.

Acceptance: the four known backup-import failures are resolved through the real storage path; complete lifecycle
and failure scenarios pass on disposable profiles, including a copied-profile developer conversion and reopen.

### 6 Qualify operational behavior and packaging

Map SQLite failures to truthful EARS outcomes. Do not classify an ambiguous COMMIT failure as definitely committed
or definitely refused without evidence. Qualify disk-full/I/O faults, killed processes, interrupted admission and
backup/replacement, busy writers, long readers, checkpoint behavior and schema/index corruption. Set durability
policies and compare matched acknowledgments, including macOS full-device flushing where required.

Package and test the selected binding/extensions with Electron and CLI on supported OS/architectures. Verify
native loading, signing/distribution, file permissions and actual read-only mounts. Publish supported filesystem
assumptions without claiming that a few CI hosts certify arbitrary filesystems.

Acceptance: failure-injection and platform evidence on pinned source, complete required CI gates in disposable
runners, and explicit resource/ownership policies. No residual native-loader or recovery assumption hidden in a helper.

### 7 Review and decide adoption

Before optimization, record app latency/resource budgets from representative flows and current instrumentation.
Evaluate warm and cold/reopen paths, sustained writes/watches, background work, corpus growth, peak memory,
disk/WAL growth and search recall/relevance. Preserve samples and variance. Compare matched current elmdb and
SQLite behavior; microsecond ratios alone are not the cutover criterion.

Review owned invariants, code complexity, native dependencies, upgrade burden and operational recovery. A material
regression needs a concrete product tradeoff, not a relaxed test added after the result. Produce a complete draft
with adoption evidence and the remaining decision stated plainly.

Acceptance: all requirements above have evidence or an explicit approved disposition, reference/public docs and
API reports match the result, and the candidate is ready for a final adoption decision. On adoption remove obsolete
production elmdb paths and temporary backend selection, finish conversion/recovery instructions and rerun integrated
validation. If rejected, record why and close the draft without leaving a permanent second backend obligation.

## Validation

Reuse and extend independent EARS contracts/models, transaction/watch/scheduler tests and host lifecycle suites.
Use differential tests where semantics must match and relevance/recall tests where search is deliberately different.
Demonstrate new safeguards with mutations or realistic fault injection on disposable copies. Keep fast tests
independent of native/compiler captures; run the full repository and packaging gates in disposable environments.
Record source/dependency/native-artifact revisions, conditions and raw results. Benchmark, compatibility and
platform claims must identify their actual tested scope.

## Current handoff

The goal remains active. All scope, phases and acceptance above remain required. Publication is the existing
[draft PR #286](https://github.com/spankyed/apack/pull/286), branch `session/ears-sqlite`; no merge/adoption,
release or version update is authorized. Active continuation is `/private/tmp/ears-sqlite-diagnosis-evidence`.
Runtime source `de48f5a924` implements the first ordinary-projection/native owner-candidate vector slice.
Disposable Linux ARM64 validation passes all 606 SQLite EARS cases, 135 affected host/storage cases,
package builds, EARS types/API, lint/imports and three meaningful negative controls. The plain-Node source
loading regression is fixed; earlier failures and corrected package-provenance refusal are retained in
[vector integration evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-integration/README.md).
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
live-view/restart lifecycle. Exact [receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-40947780198/README.md)
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
[real-model matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/real-vector-matrix/README.md).
The primitive runs used 2 MiB SQLite cache and mounted-result database paths; EARS sets 64 MiB.
Do not use primitive timings as application estimates.

The pinned sqlite-vec comparison completes all six default-cache and four app-cache configurations.
Ordinary SQL is cheaper for selective candidate sets (100k/256 candidates: initial pooled p95 7.51 ms
at 10%, 4.38 ms at 1%); broad p95 53.15 ms still fails responsiveness. All mean recall checks exceed 0.95.
Vec0 is cheaper for broad K=256 but expensive at K=1,024, consistent with its repeated-minimum chunk
selection. No profiler attribution or application qualification is established. See
[layout control evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/real-vector-matrix/sqlite-vec/README.md).

The first integrated slice uses ordinary derived projections, native owner candidates and exact reranking
with the existing dependency. Canonical bytes remain primary; units/savepoints/watches, owner chunk
aggregation, exact fallback, numeric extremes, cascade deletion, audit and rebuild have affected functional proof.

Two full real-corpus matrices complete, retaining all scopes/phases and raw samples. Mean recall is
0.999–1.0. At 100k initial broad query p95 improves from 304.41 ms to 55.63 ms after the repair, but
heartbeat p99 is still 58.37 ms versus 16 ms. The 10% scope is 35.29 ms query p95 /41.92 ms heartbeat;
1% is 13.31/14.68 ms. These are actual EARS query/update paths, not whole-app or cold/installed acceptance.
See [integrated real-vector evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/integrated-real-vectors/README.md).

Owner-only reranking (`f8a5706b1e`) and native SQL scopes (`d28c296edb`) are implemented and measured.
The latest full matrix has initial 100k p95 61.14 ms broad /28.55 ms at 10% /12.56 ms at 1%; heartbeat
p99 is 64.32/37.02/14.39 ms. High sampled recall does not pass the missing 16 ms responsiveness gate.

Next checkpoint: qualify a native ANN strategy's transaction, rollback, snapshot, filter-before-K,
backup/reopen, update and resource behavior independently before any dependency adoption. Preserve the
correct SQL scope path and investigate native admission/execution ownership; do not relax budgets.
A scratch-only test of `sqlite-vec@0.1.10-alpha.4` DiskANN fails hard filtering and an exact-match
retrieval fixture, while matching flat controls pass. It rejects metadata columns. Unit/snapshot/backup
checks after the failure remain unrun. No production dependency changed; see
[ANN gate evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/sqlite-vec-ann-compat/README.md).
Evaluate another native strategy and its ownership/update costs; this failed prerequisite is not adoption
or a disposition of the unmet broad responsiveness requirement.
Exploratory same-model vec1 IVF probes complete: 32 probes meet broad/10% sampled recall and heartbeat
but fail 1% recall (0.947); 64 probes meet sampled recall but miss heartbeat. Neither passes the full
matrix. No dependency changed. [Probe evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/vec1-ivf-probes/README.md)
now includes the [owner-scope prerequisite](../references/evidence/ears-sqlite-implementation-2026-10-28/vec1-owner-scope/README.md):
UUID owner-IN filtering takes roughly 2.5 seconds at 10% and 270 ms at 1%, despite identical candidate
results. Constant range filters do not qualify actual EARS scopes; this vec1 path is unsuitable for
graph-sized arbitrary scopes. [Stable vec0 chunk controls](../references/evidence/ears-sqlite-implementation-2026-10-28/vec0-chunk-control/README.md)
at 64/128/256 rows all pass sampled recall but miss broad heartbeat; the configuration hypothesis
does not solve responsiveness. No production dependency/layout changes follow. Next evaluate a native
strategy with efficient arbitrary membership filtering and transactional ownership, including the
maintenance cost of any required extension change, before integration. Fresh frozen queries and complete integrated/admission/platform checks remain required
before acceptance. No strategy selection or adoption is established.
A scratch [text-IN extension patch](../references/evidence/ears-sqlite-implementation-2026-10-28/vec1-text-in-patch/README.md)
reduces the UUID owner predicate to about 19.46 ms p95 at 10% and 13.75 ms at 1%, with
93 ordinary-SQL comparisons passing on both original/patched code and 20 small compatibility
groups passing on the patch. This still misses scoped responsiveness before EARS integration.
The patch is bench-only; no production dependency/loader/layout changed. Next inspect compact
integer owner surrogates and efficient membership, then review any fork's maintenance and
platform burden before adoption. Keep all fresh-query, admission and complete goal acceptance.
The [integer membership diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/vec1-integer-in-patch/README.md)
completes: matched native owner-IN p95 at 9,889 owners is 96.19 ms original /13.65 ms
with a bounded bitmap patch, and 17.42/9.48 ms at 988 owners. Both extensions pass 306
independent SQL comparisons; the patched code passes the small compatibility gate.
The ten-query broad first-pass p95 of 17.50 ms remains retained. Sparse/wide IDs retain
the old slow path. No final responsiveness, native adoption or integrated claim follows.
[Fresh validation protocol](../../packages/apack-ears/bench/sqlite/REAL-VECTOR-FRESH-PROTOCOL.md)
is frozen before new queries are evaluated; the [independent fresh oracle](../references/evidence/ears-sqlite-implementation-2026-10-28/fresh-vector-oracle/README.md)
now covers eighteen cohorts with 54 scalar checks and the 101-ordinal exclusion union.
The [actual fresh EARS matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/fresh-native-ears/README.md)
at `71810414e8` now completes: all eighteen cohorts pass mean recall (minimum 0.972),
but responsiveness fails. Broad 100k timed p95 is roughly 19 ms; large filtered groups
are roughly 139–149 ms. Admission heartbeat p99 is 24.34 ms. The independent verifier
rejects the full matrix on unchanged gates and rejects corrupted evidence. `dacd2093ca`
profiles native filtered SQL at about 121–124 ms, scope/count/rerank overhead separately,
and COMMIT as 20.05 of 27.84 s of admission (maximum 385.69 ms). Model installation and
observed GC are small. Next remove unneeded native candidate BLOB projections, improve
scope/count/rerank plans, qualify native membership/distribution and test off-thread
PASSIVE checkpoints while preserving FULL logical durability and bounded WAL/drain safety.
Keep the failed matrix and frozen ANN settings/budgets; no retuning or adoption follows.
No more primitive result alone can establish the required final execution design.
Internal generation storage, background training and a durable shared-scheduler model queue
now exist in `vector-index.ts`, `vector-training.ts` and `vector-models.ts`.
Runtime `666aa6e0c9` passes 624 EARS, 135 host/storage and seventeen native lifecycle cases,
builds/types/API/static checks in disposable Linux. [Scheduler evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-model-scheduler/README.md)
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
[checkpoint history](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md).
