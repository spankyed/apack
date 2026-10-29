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

Status: active contract integration and storage implementation, 2026-10-28.
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

The existing [draft PR #286](https://github.com/spankyed/apack/pull/286) is the publication surface for
`session/ears-sqlite`. The latest exact published green checkpoint is
**585dcafccf5da62ea50f2e5d37294d9de8a11b9f**:
[strict run 40790543472](https://github.com/spankyed/apack/actions/runs/40790543472) completed SUCCESS, all six jobs.
The approved guarded helper advanced clean canonical `monorepo-worktrees.noindex/sqlite-evaluation` from
1a0f664d01 to 585dcafccf; its BASE is now 585dcafccf. App master/native remain pinned to 98386b36a1 / 6ab2f69.
No master merge, adoption, local compiler or native build occurred.

Active continuation is `/private/tmp/ears-sqlite-diagnosis-evidence`. Committed **bccf1ee752** implements explicit
`db recover`, resumable offline incumbent restoration, forensic retention and managed-reader exclusion.
The final runtime snapshot adds preparation durability barriers and permission/failure cases. It passes five
builds, host/API/CLI types, **73 host cases**, **3 CLI cases**, lint/imports and three removal controls. Actual
SIGKILL after primary import COMMIT and at both restore publication boundaries is covered for both backends;
a separate live reader blocks recovery, and its dead claim is reclaimed after SIGKILL. The real built CLI
inspects and restores a partial SQLite import, independently verified in a fresh process. Metadata must be
writable for managed read-only tools; direct backend snapshot construction remains unchanged. Retained files/tree
and the preparation's parent are synced before the first live replacement; injected sync refusal touches no
live data. See [import recovery evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/import-recovery/README.md)
for exact archives, source comparison, prior failures and qualified limits. No owned Linux container remains live.

Recovery checkpoint **d9e23b00b7df22124e59625ea8c5de266860c583** had the exact
[strict run 40796822583](https://github.com/spankyed/apack/actions/runs/40796822583) completed FAILURE: five jobs passed; app/rest failed five recovery crash cases because child processes
inherited the source condition and plain Node refused SDK namespaces. Preserve that failure; do not promote.
The local fix strips only the source condition using the existing helper, asserts built package resolution,
and passes 73 focused Linux recovery/storage cases with the inherited source flag; removing the fix
reproduces all five failures. Package builds, host types and lint pass. See
[recovery launch evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/recovery-launch/README.md).
Descendant **e5fe7ea16bee7b96acaa495fe132ad65fe766a7c** had the exact [strict run 40804552364](https://github.com/spankyed/apack/actions/runs/40804552364)
completed FAILURE in producers: benchmark Vitest lacked the required source condition; consumers were skipped.
Both benchmark/root EARS configs now declare it and pass the actual Linux import guard. Preserve that failure;
the failed run remains retained. The local helper
already exists with BASE 585dcafccf and exact-success guards; the user's renewed approval does not bypass them.
Latest published functional checkpoint is **7cba75f4311d4f20b4f86b1ac8f46355913c2a08**, on the existing
`session/ears-sqlite` branch and clean detached integration checkout. Its single exact strict gate is
[40814018368](https://github.com/spankyed/apack/actions/runs/40814018368); poll that handle rather than dispatching
duplicates. Do not promote canonical before exact success. Local continuation/handoff beyond this published
tip is distinct from CI source; no master merge, release or adoption occurred.

Next resume phase 3's recorded 100k admission/heartbeat miss and phase 4's representative search corpus before
tuning. Phase 4 now preregisters `tests/fixtures/search-relevance.json`: 28 repository-domain documents and
32 useful-result cases, shared by both backends through `engine/search-relevance.spec.ts`. Expectations cover
identifiers/case/accents, per-element phrases and highlights, field restrictions/syntax, boolean/any/negation,
last-word prefix, typo opt-out, recency and exact multilingual terms plus English stemming. Run unchanged
expectations against both pinned backends before tuning; retain failures, then fix demonstrated candidate gaps.
This curated corpus is a first contract slice, not full real-world relevance, scalability or language qualification.
The corrected fixture inputs pass 32/32 on pinned elmdb. The new local source-string FTS implementation also
passes that unchanged corpus, with native clause combination, original/identifier columns, source-offset
mapping and per-field selective maintenance. Linux source-loading/types and the full SQLite EARS suite pass
**471/471**. Five normal package builds, 95 focused cases, imports/lint and three removal controls pass on the
snapshot preceding the sole parameter-property-to-field-assignment loader correction. See
[source-string evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/text-documents/README.md)
for exact source patches, setup/config/loader failures and qualified limits. The earlier
[corpus evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/search-relevance/README.md)
retains fixture corrections and pre-fix failures. No query budget or useful-result expectation was weakened.
Earlier functional checkpoint **026b6b18b0b786f5cc732ffb83982b2b90d37ca1** introduced the string representation. Its
preregistered old/new/new/old 10k text-shape cohort completed all four expected-answer trials. Cross-field
p50 regresses from ~0.29 ms to ~20 ms because common clause matches materialize before intersection; broad
queries are ~1.9× slower, readiness ~3.3× slower, main database ~25% larger, while name writes remain close.
These costs are not accepted. See [shape evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/text-shape/README.md).
The new local native-clause correction uses capped native count probes to order a conjunction, native MATCH
plus owner-index rowid constraints for subsequent clauses, and positive-owner constraints for global exclusions.
It passes **473/473 SQLite**, 98 focused cases, EARS build/types/lint, a native-plan removal control and the
unchanged relevance corpus. Its preceding adaptive snapshot also passes five builds/imports and 42 native
search cases. See [native-conjunction evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-conjunctions/README.md).
The preregistered six-process comparison completed all expected-answer trials at **aadd721d43**. Point/common
improves to ~0.7 ms, but the 100-owner case worsens to ~68 ms (both word orders), versus legacy ~0.5 ms and
unpruned ~20 ms. This correction is not accepted. See
[conjunction cost evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/conjunction-cost/README.md).
The converged owner-postings source **c132441538bbbad60a53dc12fb79f77755c83406** uses a private FTS owner
column and one native MATCH intersection, runtime 2048-owner cap and untruncated fallback. It passes
**475 SQLite / 288 native EARS cases**, five builds, EARS types/API reports, lint/imports; focused mask/removal
proof remains **100 cases**. See [owner-postings implementation](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-postings/README.md).
The complete preregistered six-process owner cohort fixes medium queries to ~3.1 ms in both orders versus
rowid ~69 ms; point conjunctions ~0.7 ms, private owner bytes ~3% above the preceding string shape. Broad
limited reads remain ~28 ms versus legacy ~15 ms, unaccepted. See
[owner cost and exact functional proof](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-cost/README.md).
The functional checkpoint is published at 7cba75f431 with exact gate 40814018368 above. This is not adoption
or performance acceptance. Keep canonical on 585dcafccf until that exact gate succeeds.
Local ranked-prefix/late-highlight-fetch checkpoint passes **483 SQLite / 289 native** EARS cases, five
builds, types/API reports, lint/imports and five removal controls. See [prefix evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/text-prefixes/README.md).
The preregistered six-process cost cohort completed on pinned prefix source 76b1aa2765: broad p50 ~18.5 ms
versus postings ~29 ms, highlights ~20 versus ~62 ms, recency ~48 versus ~56 ms. Selective paths get modestly
slower; broad/recency remain unaccepted. See [prefix cost evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/prefix-cost/README.md). Published gate
40814018368 is terminal FAILURE: five jobs pass; app/recovery fails two elmdb path-alias cases. The local
physical-parent/fixed-leaf correction passes five builds, types, **95 recovery/import/storage cases**,
lint/imports and twelve baseline-failing alias controls; real SIGKILL also covers symlinked profiles and
resume through another spelling for both backends. Foreign/leaf-link refusals and reader exclusion remain.
See [recovery alias evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/recovery-aliases/README.md).
Recovery correction is committed at 964f1e1fd2. Publish the completed functional/cost checkpoint and run one
new exact strict gate; do not promote before exact success. Next diagnose actual native ranking/recency
plans and remaining costs, preserving every failed cohort and the entire phase 3–7 scope. Preserve every failed cohort and all remaining
phase 3–7 requirements. Preserve the first cohort; do not retry identical source into acceptance. Publish/run one new exact strict gate only
after that functional/cost checkpoint converges. Per-string ranking/index costs are not accepted by correctness alone. This does not replace phase 3's failed
100k heartbeat/FULL gate. Fuzzy vocabulary bounding, larger relevance/languages, vector qualification and the
rest of phases 4–7 remain required. A preregistered four-process quota/affinity diagnostic now lives in the benchmark README and
`runtime-control.mjs`: same two-CPU quota/6 GiB, ABBA order, 500 fixed samples per path, first-150/remaining-350
strata, cgroup counters/GC/CPU profiles and no discarded cold samples. This is diagnostic only; it cannot
replace the failed admission cohort. That four-process control is complete: all answers pass, no own-group throttling is observed during timing,
SQL/facade p99 stay below 3 ms, and the CPU loop has two ~30 ms calls at ordinals 31–32 in every process.
Do not change the runner/query compiler on that evidence. See
[runtime quota evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/runtime-quota/README.md).
The single preregistered full-watch 100k OFF trace completed on ebf86401a2: diagnostic heartbeat p99
7.076 ms and lookup p99 2.726 ms, original budgets met. Ten individual heartbeat delays exceeded 16 ms;
none overlapped the 445 observed GC events and no own-group throttle increment was recorded. Scalar watches
already track fields/membership and the workload changes the watched slug. Native SQLite hashes match older
controls. No production optimization or runner change follows from this evidence alone. See
[admission runtime evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-runtime/README.md).
This diagnostic does not supersede the failed qualification or permit FULL. Preserve every existing phase 3–7 criterion. Phase 5/6 app/media ownership, raw/unmanaged readers,
directory-creation hierarchy, read-only mounts, filesystem/power-loss/platform and large-copy resource
qualification remain required before adoption. Never delete a pending preparation to bypass startup.
The earlier 431 SQLite / 256 native suite and real WAL-sync evidence remains in
[commit/maintenance evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/commit-maintenance/README.md).

Previous **3f4651b009** / [40775526128](https://github.com/spankyed/apack/actions/runs/40775526128) is terminal FAILURE.
Producer and both native jobs passed; integration-1 and app/rest failed on undeclared API bundler inputs fixed
in the new descendant. Integration-2 failed with an unhandled Vitest RPC timeout despite 538 passing tests;
its cause remains unisolated and its failed status stands. The earlier local scripts timeout is retained; later
unchanged 60-second scripts checks pass. Failed predecessor 460866c5c2 / run 40761412029 is also retained.

Local functional lifecycle source **51d4e11d2961a342ca0f33e160a779d30d7bbc65** adds registry-owned index readiness
and async startup/activation/update/restore/reload while preserving synchronous installer acceptance and claims.
Permission-aware Linux validation passes 127 lifecycle cases, 4 SQLite API profile cases, three removal controls,
restored cases, types/lint/imports, six reset/reopen parity cases per backend and two actual built Node API boots.
See [live admission evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/live-pack-admission/README.md).
The earlier 414 SQLite / 251 native contracts and compiled CLI regex/substring/vector proof remain in
[profile/runtime evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/profile-runtime/README.md).

Local **5e20fb5956cb0543d8934f34232d088d108818b1** fixes cache declarations, API runtime dependency and bundling,
and extends the native smoke to SQLite/FTS/regex/WASM/vectors. Its packaging validation is terminal SUCCESS:
five builds, unchanged lockfile, API types, 78 cache guards, populated API compiler-read coverage, removal controls,
original 60-second scripts types, lint/imports, and the actual SQLite smoke block under both Node and Electron.
The same pinned v13 Node-API addon loads across ABI 131 / 136; unnecessary rebuild-list changes were removed.
See [runtime packaging evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/packaging-runtime/README.md).
This proves probe logic against built workspace packages, not complete packaged/signed distributions. ASAR is disabled.
The terminal published run also has an integration-2 unhandled Vitest RPC timeout despite 538 passing tests;
its cause remains unisolated and its failed status stands. Both native jobs passed.

Latest qualified storage source **479e6bc333c82020ceb66a61dd84882aab396a5f** fixes error masking when SQLite
rolls back a transaction itself after SQLITE_FULL. Actual 4 MiB tmpfs controls trigger write-spill and COMMIT
failures; both now retain SQLITE_FULL, preserve incumbent data/sequence/watches and recover after capacity is freed.
Units cannot resume after automatic rollback. Rollback failure retains both errors and blocks connection reuse
while allowing close/reopen. Four regression cases and their pre-fix removal control pass; full **418 SQLite / 251
native cases**, types/API checks, source Node, lint/imports pass. See
[storage exhaustion evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/storage-exhaustion/README.md).
Ambiguous COMMIT IOERR outcomes and physical durability remain open; this is not a general commit-outcome proof.

Canonical remains a889531dd1. The approved helper requires clean source/native pins and exact strict success
before private promotion. The corrected evidence descendant is published and its single exact gate is live;
leave that tip unchanged while it runs. Further work stays local until a deliberate checked checkpoint. No master merge/adoption or daily-use profile conversion occurred. Keep the full goal.

Earlier strict 78eff95202 timed out in typecheck:scripts without a captured TypeScript diagnostic. Its exact command
passed unchanged in two-core Linux within the original 60-second budget; the Mac cause is unisolated. The newer
a1356b64b1 gate passed without changing budgets or rerunning superseded 78eff95202. See
[timeout evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/ci78-producer-timeout/README.md).

The pinned integration combines app master **98386b36a18d244c19ffb501830b990ed49f7653** through merge
4af1b513e3 and private native source **6ab2f69fa13289ed4f02952253c58b4d41922c98**, held immutable in
`elmdb-worktrees.noindex/sqlite-baseline-6ab2f69`. Check actual refs before combining later work. Normal
production still uses elmdb; this goal authorizes neither master merge nor SQLite adoption.

### Implemented and verified scope

- A private typed structured backend port and native adapter; pure root imports and app-only storage entries;
  scalar/rowid-overflow authoritative values with selective reads/updates and lossless values; SQL selection,
  projection, one-hop traversal and batched BFS. Typed/primary-layout evidence is in the
  [implementation directory](../references/evidence/ears-sqlite-implementation-2026-10-28/).
- Actual SQLite statements/plans/bindings/counts/timings in explanations, with honest driver spans rather than
  fabricated LMDB counters. Watch transaction/savepoint tracking, lifetime and explicit settlement have shared
  and process proofs in [lifecycle evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/integrated-watch-lifecycle/README.md).
- Persistent yielding value-index generations, authoritative fallbacks, intervening writes, bounded retirement,
  rollback/busy/stale/read-only and killed-process recovery. See
  [admission evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/value-index-admission-8220a11d70/README.md).
  The continuation below extends this scheduler to text/vector/trigram; full admission resource/IO qualification remains required.
- Ajv declaration validation, explicit semantic refusals, stored-schema CORRUPT refusal, locale propagation and
  incumbent prefix checks under writer ownership. See
  [schema evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/schema-validation/README.md) and
  [prefix race proof](../references/evidence/ears-sqlite-implementation-2026-10-28/schema-prefix-ownership/README.md).
- Owned statement retention bounded to 256 entries and 1 MiB of UTF-8 SQL text, with meaningful mutations.
  This is not a total native VM/RSS bound. See
  [cache evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/statement-cache/README.md).
- Batched ordering keys, guarded SQL scalar ordering and adjacent-limit pushdown preserve stability, duplicate
  IDs, primary integrity and pipeline scope. General top-k, ICU fallback and distinct/group complexity remain open.
- Per-string transactional FTS5 trigram documents and exact Rust substring/regex verification preserve Unicode,
  list boundaries and disposal. The pinned upstream runtime uses the default allocator after stock wee_alloc
  failed memory controls. Runtime provenance/license/build recipe and installed-package execution are retained.
  At 78eff95202, **374 SQLite tests pass**, including all three formerly failing substring/regex cases; EARS
  types, 73 focused cases, six independent safeguard mutations, five package builds, three unchanged API reports,
  70 build-input/document-link cases, lint/import/publishing types and source/staged/npm-tarball loading pass in
  disposable Linux. See [filtering evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/trigram-filtering/README.md).

### Current shared-search-generation checkpoint

One persistent catalog/scheduler now owns value, text, trigram and vector generations. Admission creates empty
private generations without corpus hydration; foreground writes reconcile them; each batch commits cursor,
postings and readiness together. Value reads keep primary fallbacks; search explicitly reports INDEX_BUILDING
or INDEX_FAILED. Owners can await database.indexesReady(); watches retry after visibility changes without a
new logical commit. Timers stay unreferenced except during explicit waits. Retirement alternates with building;
valid embeddings reuse matching content/model/dimensions, and the latest complete predecessor is retained until
replacement readiness. Failed deferred cleanup does not spin. Physical recovery now queues fresh generations
instead of synchronous full backfill and advances the ownership epoch so cached old owners refuse writes.

Functional pin **ac84b7d3fb4dba6b6c460ea5163096c4a1a1cdb1** passes **413 SQLite / 250 native cases**, EARS
types, 71 adjacent cases before/after eighteen routine mutations, a stronger paired-epoch counterexample, five
package builds, 3 EARS/30 SDK API checks, 64 build-input cases, lint/import rules and scripts typecheck
(20.95s / original 60s). The reviewed root API adds indexesReady(), optional derived visibility subscription and
two explicit index error codes. Pack-facing operation signatures and SDK reports are unchanged.
[Search-generation evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/search-generations/README.md)
retains exact source hashes, process-kill/lifetime checks, all negative proofs and earlier failures.

The first 1k OFF smoke and the original three 10k OFF trials pass. The initial 100k OFF process hit its 240s safety
limit without a final report; the exact pre-fix source is reconstructable from a1356b64b1 plus the retained patch.
Review found quadratic FTS deletion by an unindexed column. The pin uses rowid point deletion and selective
retirement indexes, with real plan guards. Pending-vector indexing avoids embedding BLOB keys. Corrected 10k
build median is 2.58s versus the earlier 9.07s instrumented fixture; do not claim an isolated-line or app speedup.

All three corrected 100k OFF processes finish. The first two pass all limits; the third fails heartbeat p99
**26.43ms / 16ms**, despite operation/lookup/turn p99 1.22/8.06/5.34ms and resource limits passing. Batch p99 remains
short but rare long batches and larger lookup/I/O tails remain. Conservative stage/deadline bounds place 180 of 196 stalls above 16 ms entirely within cleanup; callback attribution remains open. The trace lacks correlated heartbeat phase stamps,
so the cause is unproven. The cohort stopped; FULL was not run. Preserve the miss and add distinct correlated
controls before tuning, rather than retrying until green or relaxing the target. Do not label 100k/FULL qualified.

This is not completion of phase 3. Qualify realistic declarations/read/write/watch load, large fields, FULL
commits, WAL/disk growth and ownership/recovery. Physical presence is not a postings checksum; static secondary
index recreation on populated damaged profiles can still block, and orphaned entries after catalog corruption
need audit/rebuild. Same-handle readiness invalidation does not promise cross-handle/process reactivity.

### Unqualified results and failures

- The earlier facade slice used native 933aa19; do not relabel it as current 6ab2f69 evidence.
- Batched 10k numeric sorting improved its paired cohort 220.91 to 56.95 ms (3.88x), still 7.36x native.
  A later nine-process SQL scalar cohort showed no overall win: 38.24 to 41.21 ms, native 5.89 ms, with substantial
  variability. Adjacent-limit sequential profiles improved but are not balanced qualification. See
  [ordering](../references/evidence/ears-sqlite-implementation-2026-10-28/batched-ordering/README.md),
  [scalar cohort](../references/evidence/ears-sqlite-implementation-2026-10-28/native-scalar-ordering/README.md) and
  [limit evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/scalar-limit-pushdown/README.md).
- Six sync-disabled admission trials pass their original targets. The first FULL trial fails operation/turn p99
  (16.79/19.39 ms); later durable trials stopped. COMMIT dominates controlled diagnosis, but ordering/host variance
  prevents a fair backend ranking. Do not change durability or budgets to pass. See
  [durable diagnosis](../references/evidence/ears-sqlite-implementation-2026-10-28/durable-admission-diagnosis/README.md).
- The independent 8 ms heartbeat harness retains its first 1k sync-disabled failure at lookup/turn/heartbeat p99
  31.82/19.53/34.41 ms. No retry-until-green. See
  [measurement correction](../references/evidence/ears-sqlite-implementation-2026-10-28/load-metrics-correction/README.md).
- Older CI timeout, fixture and prerequisite failures remain historical evidence. One targeted identical-source
  retry made the 683 gate green; its Mac CLI timeout cause remains unisolated. No timeout or compiler budget changed.

### Real host storage checkpoint

Functional pin b36c179fe2 implements format identity and host-owned file/open descriptors, explicit constructor
selection and preflight of all destination formats before validation/replacement. Wrong backend selection refuses
as STORAGE_MISMATCH outside run-history corruption salvage. Backup metadata remains provenance; actual files
are opened. Ordinary production composition remains elmdb. The alias-only probe is removed.

Pinned Linux checks pass 41 real host cases, two negative safeguards and restoration, 413 SQLite / 250 native
cases, five package builds, EARS/SDK API checks, host/SDK/CLI types and import rules. One reviewed EARS root API
line adds readonly format; SDK API reports are unchanged. Additional appData success cases initially exposed an
unbound test fixture, retained as failure evidence; 1d7b7a9930 corrects actual host binding and installed declarations.
The corrected check is terminal success: 45 host cases, the stronger preflight counterexample, restored cases,
host types, EARS/SDK API checks, lint/import rules and five package builds. Test-only b8231cb734 additionally
asserts changed settings through the bound runtime; both affected cases pass and implementation hashes match.
The four former data.mdb preflight failures now have real SQLite host-path coverage; this does not complete
app/CLI profile selection, full boot, live packs, logical conversion or physical failure qualification. See
[host storage evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/host-storage/README.md).
After that check closes, publish a usable descendant through the existing draft, with its own exact strict gate.
The a889531dd1 gate is green and that exact checkpoint has been privately promoted; the newer host descendant needs its own gate.

### Next deliverables and full remaining scope

The latency failures below remain unresolved; publication/canonical state is owned by Current handoff above. The predeclared diagnostic
pair at 201a2c8cbb is complete: heartbeat checks and EARS types pass, but both 100k OFF diagnostics miss latency
limits. Full-watch / query-watch-free heartbeat p99 is 97.40 / 44.73 ms; scalar lookup p99 38.03 / 20.46 ms.
During cleanup scalar lookups consume 35.83 / 33.24 s, against 5.18 / 4.55 s inside background batches. Query
watches add substantial measured work but removing them does not resolve the miss. Sequential order and
instrumentation prevent causal or qualification claims. See [raw diagnostic evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/cleanup-diagnostic/README.md).
The [independent scalar probe](../references/evidence/ears-sqlite-implementation-2026-10-28/scalar-lookup-probe/README.md)
captures actual SQL/plans without watches or background work: facade / generated-SQL medians 1.335 / 1.225 ms,
p99 17.82 / 14.34 ms. Its native driver call holds 1,092 of 1,176 CPU-profile samples. The generated fallback
repeats entity, scalar/overflow and list-membership probes per candidate; no temporary sort appears. The [four-way predicate diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/scalar-predicate-variants/README.md)
finds no compelling median improvement; retain the varying tails and do not select the best p99 as acceptance.
No production predicate change was made. The [fixed-work CPU sentinel](../references/evidence/ears-sqlite-implementation-2026-10-28/scalar-cpu-control/README.md)
is complete: JS loop / SQL / facade p99 27.48 / 9.33 / 11.30 ms. Large tails occur without database calls, but
the longer CPU loop has eleven outliers only within its first 143 calls; JIT/runtime/host causes remain unisolated.
This neither excuses the failed workload nor proves a host-contention cause. Preserve cold samples and original
targets. Continue controlled cold/steady-state resource diagnosis alongside real host/storage/backup composition;
do not add an unproven predicate rewrite or retune scheduling merely for a synthetic pass. Declared scalar types cannot exclude unchecked imported array values. Complete
large-text and FULL qualification under unchanged targets; do not rerun the same failed qualification until green. The candidate explicitly chooses INDEX_BUILDING over a slow foreground search scan; complete app
composition must handle that state and await readiness where required before adoption.

All unmet phase 3–7 requirements remain: native lazy substring/regex refusal ordering with mixed types/later zero
limits (qualify or explicitly decide); realistic multilingual/identifier/typo relevance, correct full-text list/phrase
boundaries and no unbounded fuzzy vocabulary scan; high-dimensional and approved real-vector recall/update/latency;
complete app/CLI profile and run-history composition; extend the now-tested host format/populated replacement/media
rollback path through full lifecycle and physical failure qualification; explicit copied-profile conversion and logical export/audit/rebuild; truthful IO/COMMIT failures,
crash/checkpoint/long-reader/ownership qualification; Electron/CLI loading/signing/native packaging and supported
filesystem assumptions; representative warm/cold/growth/resource budgets, execution-complexity and maintenance
review, and final adoption decision. No microbenchmark or small corpus certifies app latency, memory growth,
filesystem support, production durability or overall relevance/recall.
