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

Canonical branch `session/ears-sqlite` remains at `9c339d89a4` in
`monorepo-worktrees.noindex/sqlite-evaluation`, pending a successful combined gate. Detached integration
`monorepo-worktrees.noindex/integration-FyE9XZ` combines that exact input with app master
`98386b36a18d244c19ffb501830b990ed49f7653` through merge `4af1b513e3`. Native source is immutable private
`elmdb-worktrees.noindex/sqlite-baseline-6ab2f69` at `6ab2f69fa13289ed4f02952253c58b4d41922c98`.
Remote/local master still match this app input. No dirty concurrent source was copied.

Active continuation is `/private/tmp/ears-sqlite-diagnosis-evidence`, descended from integration `6c29f083f3`:
`cab5f1c42c` retains the durable diagnosis, `59395aea0f` corrects load measurements, and `31300a9532` batches
projected ordering keys. It has no installed dependencies, native build or captured runtime. Each disposable Linux
validation owns a private dependency/output copy, including workspace-local modules. Before the next gate,
fast-forward the detached integration to the committed continuation and push the existing draft branch. Canonical
promotion stays conditional on that exact gate. `/private/tmp/ears-promote-sqlite.py` checks source/engine pins,
clean checkouts, remote tip and successful exact strict run before its optional private fast-forward.

[Draft PR #286](https://github.com/spankyed/apack/pull/286) remains an implementation review surface. Normal
production still uses elmdb; there is no SQLite adoption or master merge authorized by this goal.

### Implemented and verified scope

- The typed structured port owns mutations, reads, loads, plans and results; native MessagePack stays in the lmdb
  adapter. Root imports remain pure, SQLite is an app-only entry, and pack import/AST guards preserve that boundary.
  [Typed-port evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/typed-port-linux.txt) and
  the contract matrix retain compile-time counterexamples and checked-write/unchecked-repair distinctions.
- Authoritative SQLite values use scalar columns and rowid overflow values, preserving dates/bytes, missing/null,
  signed zero, lists/objects and own prototype-named properties. Partial writes avoid unrelated values; no duplicate
  whole-row payload remains. Native SQL selection/projection/one-hop traversal, batched BFS and relation hydration
  preserve caller/kind order and explicit versus unconstrained endpoint rules. Cross-type graph tracking remains
  conservative and needs load qualification. [Implementation evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/)
  preserves the primary-layout, codec/normalization and constructor/ownership proofs.
- SQLite diagnostics record actual statements/plans, bindings, row counts and scoped timings. Driver spans combine
  binding, execution and marshalling; they are not isolated allocator/compiler measurements. The shared facade/UI
  distinguishes native and SQLite explanations without invented counters.
- SQLite rollback dependencies accumulate per successful batch/savepoint, with independent negative proofs;
  native deliberately retains conservative rollback invalidation. Watch close/process-lifetime fixes cover read
  dependencies and explicit versus unawaited settlement. Linux passes five consumer types, EARS/SDK API reports
  (3/30), 37 shared watch/scheduler cases per driver and four SQLite process cases.
  [Lifecycle evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/integrated-watch-lifecycle/README.md)
  identifies each exact test snapshot and the native-importing local attempt that lacked a private Mac binding.
- Value-index admission persists generations/cursors and advances yielding batches on the owning connection.
  Building/failed indexes use authoritative fallbacks; writes reconcile the admitted generation; removed generations
  receive bounded cleanup. Atomic cache publication, rollback failure, busy/stale owners, read-only reopen and real
  killed-process recovery are covered. [Admission evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/value-index-admission-8220a11d70/README.md)
  retains four safeguard mutations and the original qualification results. Text/vector admission remains synchronous.
- Ordering projects/batches comparison keys, preserving stable ties and duplicates across physical layouts. Linux
  passes types and 34 focused cases; at `31300a9532`, the full SQLite suite passes **280 with three failures**, all
  inherited substring/regex cases. Independent cost mutations fail per-entity SQL (770 versus at most 16 SELECTs
  for 256 rows) and unrelated-body hydration guards. [Ordering evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/batched-ordering/README.md)
  retains the failures and nine paired actual-facade trials. Median-of-process-medians 10k sorting improves
  **220.91 → 56.95 ms (3.88×)**, but remains **7.36×** current native's 7.74 ms. Comparison still uses JS and
  retains all keys; native typed sorting/top-k remains unfinished.

The next local descendant now orders boolean/numeric/date/null keys in SQLite after checking actual scalar
cells and candidate types. Unsupported/invalid cells keep the existing decoder/ICU fallback. It preserves stable
null/zero/int64 ties, date clipping, prior limits/order and actual-primary integrity; selected or empty queries
avoid unrelated type tables. EARS types and 48 focused cases pass; full SQLite passes 294 with the same three
open search failures. Seven independent mutations fail meaningful assertions.
[Scalar-order evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-scalar-ordering/README.md)
retains complete results. The paired nine-process cohort does not show an overall speedup: median sort is
38.24 ms before, 41.21 ms after and 5.89 ms native (7.7% slower; substantial process variability).
A subsequent isolated change pushes an immediately following limit into SQL, returning only that prefix of IDs.
Private Linux passes types, 50 focused cases, nine safeguard mutations and 296 full SQLite cases, with the same
three open search failures. Sequential statement profiles reduce instrumented numeric-page time from
33.57 to 28.90 ms flexible and 31.52 to 26.33 ms typed, but do not replace balanced qualification. Full candidate
validation still scans all rows; general ordering/pagination and latency qualification remain open.
[Limit-pushdown evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/scalar-limit-pushdown/README.md)

### Unqualified results and current CI

The earlier [actual-facade slice](../references/evidence/ears-sqlite-implementation-2026-10-28/facade-slice.md)
preserves the isolated rowid-overflow correction, projection improvement and ordinary-read/vector regressions
against its recorded native `933aa19` baseline. Do not relabel those as current `6ab2f69` results. Scalar/inline
thresholds remain provisional. Quadratic distinct/group work, per-entity hydration in those paths, unbounded
statement caching and sustained memory growth still need the execution/phase-7 review required by the matrix.

The original six sync-disabled 10k/100k value-admission trials pass their recorded targets. The first FULL/durable
10k trial fails operation/turn-wait p99 (16.79/19.39 ms); subsequent durable trials were stopped. Targets were not
relaxed. [Controlled diagnosis](../references/evidence/ears-sqlite-implementation-2026-10-28/durable-admission-diagnosis/README.md)
adds three idle SQLite controls, three build/cleanup runs and three later native controls. SQLite write COMMIT
accounts for nearly all current durable operation latency, and both backends exceed 16 ms on this host. Ordering
and host variability prevent a backend ranking or attribution of the earlier sample's exact cause.

The old timer metric measured only waits between foreground operations. The maintained harness now retains that
as `turnWaitMs` and adds an independent 8 ms heartbeat with the same 16 ms p99 target, recorded before its first
measurement. A shared helper fingerprints actual generic `.node` prebuilds and explicitly loaded extensions.
Four behavior checks pass; three independent mutations fail final-overdue-sample, process-lifetime and generic
binding assertions. EARS types and zero-trial provenance pass in private Linux. The first 1k sync-disabled smoke
emits correctness-checked data but fails lookup/turn/heartbeat budgets (**31.82/19.53/34.41 ms**). It is retained,
not retried until green. [Measurement evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/load-metrics-correction/README.md)
records exact source/sample counts and the successful final assertion refinement without repeating the load.

Strict run `40676231748` at `6c29f083f3` is terminal failure (the now-fixed bare wait, and a confirmed
60-minute integration-1 timeout after a 30-minute Node download). The lifecycle wait fix passes its four cases
and the repository's four-case wait guard, through normal five-package build preparation. Earlier fully green
runs cover older inputs; cancelled `40655434334` is not a green gate.

Current strict run **40688661462**, attempt 1 at exact published candidate `683e1d5912`, passes five jobs but
integration-1 fails three existing CLI deadlines. All three targets pass unchanged in the owned Linux runner
(**36 cases**) with original budgets. Only the terminal failed shard was retried once on identical source;
**attempt 2 is live**. [Timeout investigation](../references/evidence/ears-sqlite-implementation-2026-10-28/ci683-integration-timeouts/README.md)
retains failures, exact reproduction and verified warm toolchain restore (about 4.7 s for 36 MiB; Node 23.11.1).
This proves the cache operation but not the Mac timeout's cause. Do not repeatedly retry or raise deadlines if
it fails again. Poll this run; don't dispatch duplicates or restart for elapsed observation time.

Node version, npm caching and compiler/test budgets remain unchanged. The detached integration and remote draft
are clean at `683e1d5912`; canonical is still `9c339d89a4`. The private continuation contains the scalar-ordering
descendant; no source under the active CI run was changed. Promote only the exact successful gated candidate.

### Next deliverables and full remaining scope

Finish the single targeted CI retry and promote the exact candidate only if green. Profile the guarded scalar-ordering descendant
(the paired measurement shows no overall win), then publish an appropriately gated disposition. Next implementation work should finish top-k,
complete atomic schema validation and background text/vector/trigram admission, and qualify IO/ownership under
the strengthened harness. The preference for explicit “indexing” versus a slow complete search fallback remains
unanswered; value-index work does not depend on it.

All unmet phase 3–7 requirements remain: the three substring/regex cases; realistic relevance/languages/typos and
no unbounded vocabulary scan; high-dimensional and approved real-vector recall/update/latency evidence; complete
app/run-history composition and storage descriptors; four host backup-format failures and validated populated
replacement/media rollback/recovery; logical conversion and maintenance; truthful real IO/commit-failure outcomes,
crash/checkpoint/long-reader/ownership qualification; Electron/CLI native packaging and supported-platform policy;
representative app/resource budgets, maintenance review and the adoption decision. No old synthetic report
certifies app latency, memory growth, a filesystem, production durability or realistic search/vector quality.
