# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master 5e81dda7c2
and its native pin 95615ed8d4; full combined acceptance remains pending. Inspect the current handoff and actual source before continuing.
Work in the isolated session/ears-sqlite checkout and preserve concurrent work.

Finished when the SQLite candidate runs the complete app data lifecycle, all required
contracts and recorded performance/relevance/recall budgets pass, full validation is
recorded on pinned source in disposable environments, and a draft PR is ready for
an adoption decision. Commit usable checkpoints. Do not silently drop requirements.
```

Status: active candidate integration and qualification, 2026-10-30.
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

The full goal remains active; scope, phases and every acceptance gate above remain required. The deliverable
is existing [draft PR #286](https://github.com/spankyed/apack/pull/286), branch `session/ears-sqlite`.
No master merge, release, production adoption or version-only PR is authorized. Production remains elmdb.
Source work stays isolated in `/private/tmp/ears-sqlite-query-integration`; the clean publisher is
`monorepo-worktrees.noindex/integration-3AEBRl`. Canonical `sqlite-evaluation` remains at its earlier
full-strict-green checkpoint `6cf6c8349e`; do not infer it contains later published work.

The integrated base is committed master `5e81dda7c2055a7fd10d4d7ee2bd94311473ac9d` and native pin
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. Preceding `95515e6463` passes the complete strict chain
including every required native/integration/app shard and all three SQLite hosts in
[41040846758](https://github.com/spankyed/apack/actions/runs/41040846758). Physical refresh preserves a ready
incumbent through training/private projection, atomically publishes physical identities and retires old
models in bounded batches. [Retained exact-source receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/physical-model-refresh/platform-41040846758/README.md)
qualify that source, not subsequent changes or arbitrary filesystems.

Published live-maintenance checkpoint `4903c50a4a39bba91c8dff495d54764e1472ff18` retains kernel claims while
workers actually drain across reset/import, acceptance and restoration, keeping logical readiness usable.
Offline scopes claim without starting trainers. Canonical reset/replacement invalidates the old native
corpus epoch; rollback restores it. Recovery/settings cleanup failures preserve prepared incumbent copies,
report installed state truthfully and close both stores without success announcements. Quarantined handles
allow cleanup ownership while all data operations still refuse. [Local evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/live-model-maintenance/README.md)
passes 665 EARS, 1898 host (one Windows-only skip), 141 API, affected types/static/API checks and four negative
controls. [All three SQLite platform jobs now pass](../references/evidence/ears-sqlite-implementation-2026-10-28/live-model-maintenance/platform-41050219130/README.md)
at that exact source. Full strict [41050219130](https://github.com/spankyed/apack/actions/runs/41050219130)
is terminal with only the bundled-editor app assertion failing; every other required job passes.
The original failure remains an unresolved intermittent case, not evidence of data-store failure.

Checkpoint `212b819db6` adds [native audit and owned rebuild](../references/evidence/ears-sqlite-implementation-2026-10-28/native-audit-rebuild/README.md)
on that published parent. Audit checks native page integrity, model hashes, exact trigger SQL, canonical
vectors/owners/visibility, ready membership, building prefixes and catalog/table ownership on private
snapshots. Public rebuild suspends actual training, retains ownership, invalidates native models with fresh
logical generations, waits for logical readiness and retires invalidated groups before resuming/releasing.
Canonical bytes and logical commit identity are preserved. Private Linux passes all 676 EARS cases with
zero skips, 98 host backup/import cases, seven API lifecycle cases, affected types/static/API checks and
three negative controls. The old failed-logical-generation assertion now allows finite native retirement;
its original failures and 81-batch progress diagnostic remain recorded. A row bound does not establish
latency. Final combined/platform/installed and performance qualification remains required.

Current [native derived repair](../references/evidence/ears-sqlite-implementation-2026-10-28/native-derived-repair/README.md)
adds diagnosis and transactional removal of verified damaged/orphaned groups during owned rebuild. Audit
checks raw shadow schema/model identity before native integrity. Primary bytes/commit identity survive repair,
refused commits and rollback after DROP; unacknowledged committed repair quarantines until reopen. I/O does
not authorize deletion; unsafe identities and foreign tables refuse. Private Linux passes 690 EARS cases with
zero skips, 98 host backup/import cases, seven API lifecycle cases, affected types/static/API checks, then all
25 native maintenance cases including an additional malformed-model witness and four negative controls.
This qualifies source overlays, not final combined/platform/installed behavior or performance.

Exact-source full strict [41052678824](https://github.com/spankyed/apack/actions/runs/41052678824) is
terminal green at `212b819db6`, including all required shards and all three SQLite hosts; see
[retained receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/native-audit-rebuild/platform-41052678824/README.md).
Repair checkpoint `3333361c3c` is running full strict [41056724109](https://github.com/spankyed/apack/actions/runs/41056724109):
all three SQLite platforms pass; remaining shards are still running. Preserve this handle.
Focused bundled-editor [41056522146](https://github.com/spankyed/apack/actions/runs/41056522146) passes once.
That does not establish the cause or fix of the earlier failure; assertions and timeouts remain unchanged.

Published validation checkpoint `ff16d3b946` adds [native Electron runtime evidence and installed-app coverage](../references/evidence/ears-sqlite-implementation-2026-10-28/native-electron-runtime/README.md).
Identical Node-API addon bytes pass actual Node and Electron SQLite component checks without extra ABI rebuilds.
Installed run [41066985563](https://github.com/spankyed/apack/actions/runs/41066985563) fails before packaging:
redundant early contract generation precedes SDK dependency preparation. Preview/production now use the normal
pack build's correctly ordered generation. Ten unchanged editor repetitions remain live in
[41067062738](https://github.com/spankyed/apack/actions/runs/41067062738); preserve that handle.

The current [native signing checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/native-mac-signing/README.md)
finalizes binary hashes after inner signing and before outer app sealing. It preserves signing options/retries
and refuses skipped libraries, mismatched unsigned provenance, concurrent manifest changes and escaping paths.
Twelve isolated signing/Preview tests, tooling types, lint, workflow/shell syntax and three assertion-verified
mutation controls pass. The new `installed-signed` suite must qualify the actual cold build, strict signatures,
native smoke and signed executable on macOS after publication. Linux doubles do not establish signing validity.
Final exact-source strict, required architectures, responsiveness and all remaining acceptance stay required.

Next deliverables and their closing checks, without narrowing phases 3–7:

- Qualify native repair faults on the final platforms, complete physical publication/deletion authority and
  physical-file recovery, and verify interruption/reopen outcomes under cooperating ownership.
  Claims inside a database directory do not authorize arbitrary rename/delete or noncooperating writers.
- Finalize native provenance after inner-library signing and before app sealing; qualify installed
  Electron/renderer/CLI, executable-pack/SDK flows and required OS/architectures. `asar:false` already keeps
  the native files on disk. Ordinary source/unsigned package builds do not prove installed/signing behavior.
- Resolve the existing failed responsiveness gate. Latest recorded 99,900-vector admission takes 20.77 s
  with heartbeat p99 48.14 ms against 16 ms. Projection batching improves throughput but does not prove a
  heartbeat win. In a later 0.5-CPU diagnostic 81 retirement batches removed 2592 rows in five seconds;
  bounded native deletion still needs latency/WAL/resource qualification. FULL writes, canonical bytes,
  default checkpoints and original budgets remain unchanged. Do not relax gates around these results.
- Complete representative search usefulness (language/identifier/typo/phrases/highlights/field restrictions),
  vector/hybrid recall, multi-chunk owners, candidate/trash filtering before K, ties, large-K/exact fallbacks,
  unit/savepoint visibility, model/hash/generation freshness and readiness/watch settlement under real load.
- Qualify representative app warm/cold/reopen flows, sustained FULL writes/watches/streaming/large fields,
  live admission/cleanup, corpus growth, peak memory, disk/WAL/checkpoints, long readers/busy writers and
  matched current elmdb/SQLite latency/resource budgets. Primitive/synthetic timings are not app acceptance.
- Qualify disk-full/I/O/unknown-commit, killed processes, interrupted admission/backup/import, physical/resource
  faults, corruption, permissions/read-only mounts, Windows ACL/directory durability and filesystem refusals.
  CI hosts certify their runs, not arbitrary local/network filesystems.
- Pass final exact-input full strict plus architecture/native dependency/maintenance review, reconcile public
  docs/API reports, and produce a requirement-by-requirement evidence-based adoption decision. Do not silently
  migrate daily profiles. If adopted, remove the temporary second-backend obligation as phase 7 requires.

Preserve canonical Float32 bytes and original failures. Synchronous EARS contracts cannot silently become
asynchronous. Missing native cursor indexes on populated stores require explicit offline preparation.
Private corpus/model payloads, dependencies, compiler targets and binaries stay outside Git. The optional
Codex executable is absent in baseline API images, so boot checks do not certify external inference or all
pack capabilities. All broad/compiler checks remain in disposable Linux/CI with private artifacts.

[Prior handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-native-audit.md),
[earlier checkpoint history](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md)
and the linked evidence preserve historical source boundaries and original failures.
