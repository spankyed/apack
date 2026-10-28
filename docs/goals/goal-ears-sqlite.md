# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8; the integration survey includes committed
session/elmdb-next at a1b6603e5a. Inspect current source before using either baseline.
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

The canonical isolated `session/ears-sqlite` checkout is `monorepo-worktrees.noindex/sqlite-evaluation`, advanced
through source-entry checkpoint `03770eca67`, with the measured explain checkpoint following it. Saved prepared
files were byte-identical to `d93afe4190` and backed up under
`/private/tmp/ears-sqlite-primary-preintegration-c8glycsk` before advancing. No concurrent agent's dirty source was
copied. The committed integration input remains `a1b6603e5a`; the contract matrix maps that baseline.

Strict run `40636458325` passed every shard on corrected integration `d93afe4190`. Run `40637723256` covers structured
transport `9659ceb389`; its sole failed shard stopped during setup-node download before tests. Only that failed
shard was retried, and attempt 2 completed successfully across every shard. Neither proves acceptance of later SQLite changes; keep full validation
on pinned source and poll exact existing handles rather than restarting them on observation timeouts.

Implemented checkpoints: structured storage requests with native MessagePack confined to `src/lmdb/adapter.ts`;
SQLite transport avoids request/result serialization; shared scheduler selection; native SQL one-hop traversal,
batched BFS frontiers and relation hydration; cross-type graph watch membership tracking. Pinned-native probes
also corrected null-list matching, checked-write versus unchecked-repair behavior, requested-kind walk ordering
and explicit relation-end matching. Explicit ends can be trashed or missing; unconstrained adjacency needs a
reachable end. The graph tracking is conservative across declared types and still needs phase-3 load qualification.

The native baseline is engine `933aa19`. The matching macOS addon came from the recorded producer artifact into
private `elmdb-worktrees.noindex/sqlite-baseline`; Linux builds use its separate Docker volume. No Rust target was
copied or built directly on the daily-use Mac. Dependencies, generated output and database fixtures remain private.

Evidence: disposable Linux native package 221 passed, 13 SQLite-only cases skipped, no unhandled errors after watch
fixture cleanup. The graph checkpoint passed EARS typechecking and 21 shared relation cases; full SQLite passed
237 cases with only the known explain failure. The new graph regression fails with its membership fix removed.
API reports for the structured-port change were generated in Linux and reviewed. Raw results are retained in
[implementation evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/).

The candidate now uses `src/sqlite/values.ts` as its authoritative attribute layout. Entity catalog rows no longer
contain a whole-row payload or JSON document. Scalar predicates/projections read native slots and overflow values;
direct scalar list membership is derived per field. Updates read only changed attributes plus required metadata,
patch those values and maintain affected indexes. Search hit/recency hydration and pages fetch values in batches.
Replacement copies logical values in bounded row batches under one source snapshot, independent of physical slot
IDs, and rebuilds destination indexes while retaining matching embeddings. The adapter, query and search modules now live under `src/sqlite/`; the harness delegates to the same app-only
`@apackdev/ears/sqlite` entry. Normal production still selects elmdb.

Verification for the source-entry checkpoint: fresh normal dependencies install in Linux; EARS/CLI/repo typechecks,
EARS API check, 12 host bridge cases, 65 CLI rule cases, 21 selected import-boundary cases and all five published
trees pass. The later explain checkpoint passes 227 native EARS cases (29 SQLite-only skips) and all 256 SQLite
cases. The public factory's three cases cover read-only reopen, idempotent temporary cleanup/listener ownership
and closing the actual native connection on admission refusal. Native driver loading remains unqualified for
packaged Electron/Windows. Root import/pack guards cover both backend entries and native packages, including
self-package alias imports, under `database-imports` / `findDatabaseImports`.

`explain()` now discriminates the backend. Native stage counters remain intact. SQLite records actual successful
query SELECT calls, exact bindings, returned rows and statement timings, then obtains EXPLAIN QUERY PLAN under
the same snapshot. Query timing excludes subsequent diagnostic planning; returned rows are not VM steps or rows
visited internally. Only the first 256 statements are retained, with total statementCount showing truncation.
The console renders both forms. Disposable Linux verification includes EARS/SDK API checks, console build and Vue
typecheck, 84 selected pack cases, 10 CLI facade language-service cases, 14 published-any cases and all five package
trees. Negative proofs reject unbranded explanation IDs, an unknown backend and missing SQL plans. Evidence logs
are retained alongside prior checkpoints; historical explain-gap logs describe earlier source, not the current state.

The SQLite package entry and reviewed API report expose EarsDatabase construction, not implementation-specific
any types. Runtime dependencies are pinned in the normal workspace lockfile; the unused private extension manifests
are removed. The new constructor closes refused connections, and temporary factories retain no idle exit listener.
The partial-write, unknown-type and undefined-normalization proofs remain in the implementation evidence. No new
app performance claim is made, and the native-slot/inline limits remain provisional.

`src/storage.ts` now owns explicit mutation, read, load, query-plan and result unions. Facade, connection, native
adapter and SQLite query execution consume those types; native explanations receive their backend tag at the
adapter. SQLite result tags and pending-index metadata now match the contract, including count-only groups.
Disposable Linux passes EARS/SDK/host/CLI/testing typechecks, API checks and all five published trees. Both full
backend suites pass (257 SQLite; 228 native plus 29 SQLite-only skips); an additional shared direct-port case passes
on both drivers. Three disposable mutations prove weakening write requests, read requests or results fails the
actual port type assertions. The first direct-port assertion incorrectly excluded an optional diagnostic field;
its failure and corrected passing run are retained in the evidence directory.

The first pinned actual-facade comparisons and their raw three-trial cohorts are recorded in
[the slice evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/facade-slice.md). They exposed a
large-value physical-layout regression. Isolated correction `df99b9d579` uses a rowid overflow table; all 258
SQLite cases pass, and identical repeats cut projected large-row reads from ~14.3 ms to ~0.27 ms. Ordinary reads
remain roughly 1.6–3× slower than the native baseline here, numeric sorting ~29× and the low-rank synthetic vector
case ~13×. Measurements do not establish app budgets or realistic relevance/recall. Driver spans group binding,
SQL execution and marshalling; more precise native/allocator attribution remains open.

Draft [PR #286](https://github.com/spankyed/apack/pull/286) is open with the measured vertical slice and the full
remaining acceptance scope. The following rollback checkpoint stages changes per successful batch and open
savepoint; failed batches and rolled-back descendants no longer pollute SQLite commit dependencies. Releasing a
savepoint merges only its delta, and final commit includes still-open descendants. Shared direct-port cases cover
both backends, preserving native's documented conservative rollback invalidation while requiring precise SQLite
deltas. Linux passes 260 SQLite cases and 231 native cases (29 SQLite-only skips); two mutations fail those exact
assertions. The change avoids copying all accumulated outer changes on each write. Future benchmark runs now
fingerprint the binaries actually loaded, including v13 prebuilds; its zero-trial provenance self-check passed.

The first background-admission slice now covers value indexes. Persistent generations/cursors advance in yielding
transactions on the owning foreground connection. Ordinary writes maintain the admitted generation; incomplete
and failed indexes use authoritative-value fallbacks. Removed generations receive bounded indexed cleanup.
Read-only reopen, busy writers, stale owners, failed batches and real killed-process recovery are covered. Cache
state is prepared before schema commit and accepted afterward without IO; rollback failure stops the builder.
Single-type fallback pages now stream in sequence order rather than sorting a constant group key. Mixed indexed
queries retain primary entities whose types are not currently declared.

Disposable Linux passes EARS typechecking, 270 SQLite cases and 232 native cases (38 SQLite-only skips). Four
mutations fail the intended readiness, intervening-write, premature-publication and atomic-rollback assertions.
The preliminary 10k/53-watch sample improved from 9.07 ms to 1.50 ms fallback lookup p99 after removing its global
sort; timer-stall p99 fell from 9.95 ms to 2.80 ms. These smoke samples precede the final error-hardening checkpoint
and are not the pinned qualification cohorts. The harness now runs separate sync-disabled and FULL/durable loads
at 10k/100k; targets were recorded before those measurements in the storage plan. Current candidate files follow
the format-one policy; use fresh/copied logical fixtures rather than treating previous SQLite trial files as stable.

Pinned admission cohorts for `8220a11d70` are recorded in
[the qualification report](../references/evidence/ears-sqlite-implementation-2026-10-28/value-index-admission-8220a11d70/README.md).
All six sync-disabled 10k/100k trials pass their recorded correctness, foreground/watch and WAL/file budgets.
The first durable/FULL 10k trial fails the 16 ms foreground-operation and timer-stall p99 targets (16.79/19.39 ms).
The runner saved it and stopped; remaining durable trials were not run. Targets were not relaxed. The durable
schedule/IO/checkpoint cause still needs diagnosis and a real fix or approved disposition before qualification.

A deliberate survey found concurrent work merged into master at `98386b36a18d244c19ffb501830b990ed49f7653`, beyond
the previously integrated `a1b6603e5a`: substring/regex query contracts and schemas, watch settlement/close fixes,
a list-of-any coercion fix and native pin `6ab2f69fa13289ed4f02952253c58b4d41922c98`. No dirty files were copied.
Next: combine that exact committed snapshot through a detached integration and disposable gates, reconcile its
new contracts, then complete background text/vector admission, schema validation and durable-load qualification. The product preference for explicit “indexing”
versus a potentially slow complete search fallback was asked asynchronously; value-index work does not depend on
that answer. Strict run `40655434334` on typed checkpoint `5985709142` was externally cancelled after producers,
integration-1/2 and native-1 passed; app-and-rest/native-2 were cancelled. It is not a completed green gate and
will not be restarted as acceptance for obsolete inputs. Run a fresh pinned gate for the integrated source.
All phase 3–7 requirements remain where not explicitly evidenced, including useful search/realistic vectors,
four host backup-format failures, complete app composition, operational/platform qualification and adoption budgets.
Normal production still uses elmdb.
