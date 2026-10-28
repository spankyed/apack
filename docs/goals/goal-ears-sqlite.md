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
`session/ears-sqlite`. The last exact published green checkpoint is
**a1356b64b1249b52f86d7ee79ee9bf824d883114**: [strict run 40733030134](https://github.com/spankyed/apack/actions/runs/40733030134)
completed successfully, all six jobs on attempt 1. Canonical `monorepo-worktrees.noindex/sqlite-evaluation` is clean at that commit. Detached integration
`monorepo-worktrees.noindex/integration-FyE9XZ` is clean at published evidence descendant a889531dd1. The guarded helper has privately
fast-forwarded canonical from 194c72c77c; its next BASE is a1356b64b1. No master merge or adoption occurred.

Active continuation remains `/private/tmp/ears-sqlite-diagnosis-evidence`, with no installed dependencies,
native build or captured runtime. Functional pin ac84b7d3fb is published through evidence descendant a889531dd1 on the existing draft branch.
Its exact [strict run 40753623963](https://github.com/spankyed/apack/actions/runs/40753623963) is running;
poll it before promotion or another publication. Local diagnostic pin 201a2c8cbb adds measurement hooks only.
Inspect actual refs/PR for the newest published head and exact CI handle; do not dispatch
duplicates or promote a descendant on its parent's success. `/private/tmp/ears-promote-sqlite.py` verifies clean
checkouts, remote tip, source/engine pins and exact strict success before private promotion. Never copy concurrent
dirty files or compile/run full checks on the daily Mac.

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

### Next deliverables and full remaining scope

Poll the existing exact strict gate at a889531dd1; promote only on its own success. The predeclared diagnostic
pair at 201a2c8cbb is complete: heartbeat checks and EARS types pass, but both 100k OFF diagnostics miss latency
limits. Full-watch / query-watch-free heartbeat p99 is 97.40 / 44.73 ms; scalar lookup p99 38.03 / 20.46 ms.
During cleanup scalar lookups consume 35.83 / 33.24 s, against 5.18 / 4.55 s inside background batches. Query
watches add substantial measured work but removing them does not resolve the miss. Sequential order and
instrumentation prevent causal or qualification claims. See [raw diagnostic evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/cleanup-diagnostic/README.md).
Inspect actual unindexed lookup SQL/plans and profile execution separately from background work before tuning. Complete
large-text and FULL qualification under unchanged targets; do not rerun the same failed qualification until green. The candidate explicitly chooses INDEX_BUILDING over a slow foreground search scan; complete app
composition must handle that state and await readiness where required before adoption.

All unmet phase 3–7 requirements remain: native lazy substring/regex refusal ordering with mixed types/later zero
limits (qualify or explicitly decide); realistic multilingual/identifier/typo relevance, correct full-text list/phrase
boundaries and no unbounded fuzzy vocabulary scan; high-dimensional and approved real-vector recall/update/latency;
complete app/run-history/storage descriptors; four host backup-format failures and populated replacement/media
rollback/recovery; explicit copied-profile conversion and logical export/audit/rebuild; truthful IO/COMMIT failures,
crash/checkpoint/long-reader/ownership qualification; Electron/CLI loading/signing/native packaging and supported
filesystem assumptions; representative warm/cold/growth/resource budgets, execution-complexity and maintenance
review, and final adoption decision. No microbenchmark or small corpus certifies app latency, memory growth,
filesystem support, production durability or overall relevance/recall.
