# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master 62f1798c9b
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

The full goal remains active, with all phases and original acceptance budgets required. Deliverable:
[draft PR #286](https://github.com/spankyed/apack/pull/286), `session/ears-sqlite`. Production stays elmdb.
No master merge, release, production adoption, implicit daily-profile conversion or version-only PR is authorized.

Source work stays in `/private/tmp/ears-sqlite-query-integration`; the clean publisher is
`monorepo-worktrees.noindex/integration-3AEBRl`. Canonical `sqlite-evaluation` remains at earlier green
`6cf6c8349e`; do not infer it contains later published work. The integrated committed master snapshot is
`62f1798c9bec2c013ded929d7080b65d1083049e`, retaining native pin
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. Inspect actual Git and workflow state before continuing.

The published [graph checkpoint `836d3d1d1f`](../references/evidence/ears-sqlite-implementation-2026-10-28/graph-contract-62f1798c9b/README.md)
implements master's graph contract in the structured port and SQLite. It includes managed directory-lifetime
claims for writable/read-only handles, scoped quarantine/recovery, stale-publication refusal and retained
claims when failed opens cannot close. [Strict CI 41095887025](https://github.com/spankyed/apack/actions/runs/41095887025)
is terminal failure with only the app shard failing the signing unit's canonical-path assertion. Producers,
both integration shards, both native shards and all three SQLite platforms pass. Its original failure is
retained; this is not whole-run success. [Signed installed Preview 41095894244](https://github.com/spankyed/apack/actions/runs/41095894244)
passes on `836d3d1d1f`: cold build, unsigned/signed native smoke, strict Developer ID bundle verification and
all six actual executable cases including the two-store/model-ownership witness. That qualifies macOS ARM64
at that parent, before the following changes.

The [current identity/signing checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/format-identity/README.md)
refuses foreign/mismatched SQLite identities before initialization, preserves foreign committed WALs through
read-only inspection, atomically publishes new identity/primary storage, and refuses missing primary tables.
Probe cleanup preserves uncertain-connection authority. It fixes the signing fixture and the independently
reproduced outer-app alias defect. The installed witness now requires persisted EARS identity in both stores;
that additional witness is typechecked but not yet run in a packaged app at this source.

Current local gates pass 720 native-enabled EARS cases with zero skips, 1,929 host cases with one existing
Windows-only skip, 38 storage cases, matching five normal package builds, three API reports, EARS/host and
exact scripts/repo/publish/E2E types, changed lint, three reverted safeguards/restored 19 identity cases and
10 signing cases. The resource-paused failed host run and unchanged-source successful rerun are both retained.
No assertion or deadline was relaxed. Compiler/full checks stay in private disposable environments capped at
two CPU/six GiB/no swap with dropped capabilities; focused checks use half a CPU/768 MiB. A quiet admission
window avoids starting a broad suite between the other agent's builds. Published checkpoint `f731a4a549`
now runs [full strict CI 41106571398](https://github.com/spankyed/apack/actions/runs/41106571398) and
[signed installed Preview 41106578424](https://github.com/spankyed/apack/actions/runs/41106578424).
Signed installed acceptance passes on `f731a4a549`, including both persisted-identity assertions. Strict
runtime steps complete on all three SQLite hosts, but their final case verifier fails; Linux exposes its
stale 27-case count. Other strict shards remain live at the retained snapshot. The
[named-inventory fix](../references/evidence/ears-sqlite-implementation-2026-10-28/format-identity/verification-inventory/README.md)
requires all 29 publication and 19 identity cases and passes eight real-report positive/negative controls.
No passing additional case can mask a missing/skipped invariant. New verifier publication/CI is pending;
no previous result certifies arbitrary filesystems or completes the remaining goal.

Earlier [full strict 41056724109](https://github.com/spankyed/apack/actions/runs/41056724109) is green at
`3333361c3c`, including every required shard and all three SQLite hosts. Retained native audit/repair receipts
verify all 25 maintenance cases per host at that source. The original bundled-editor intermittent failure
remains unexplained despite ten later unchanged repetitions passing. This handoff's history and prior source
boundaries are preserved in the [prior snapshot](../references/evidence/ears-sqlite-implementation-2026-10-28/format-identity/prior-handoff.md),
[earlier checkpoints](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md) and
linked evidence. Source checks, partial CI and smoke cases are not whole-app or performance acceptance.

Next deliverables and their closing checks, without narrowing phases 3–7:

- Qualify native repair faults on the final platforms, complete physical publication/deletion authority and
  physical-file recovery, and verify interruption/reopen outcomes under cooperating ownership.
  Claims inside a database directory do not authorize arbitrary rename/delete or noncooperating writers.
- Qualify final native provenance after inner-library signing and before app sealing; qualify installed
  Electron/renderer/CLI, executable-pack/SDK flows and required OS/architectures. `asar:false` already keeps
  the native files on disk. Ordinary source/unsigned package builds do not prove installed/signing behavior.
- Close remaining filesystem/format ownership work: enforce ordinary unaliased data files, qualify foreign
  valid SQLite refusal and positive persisted format identity before initialization, and synchronize/qualify
  history-quarantine parent publication. Acquire store-scoped exclusion before `db reset` deletes history,
  before clearing primary data, and test held handles/refusal/interruption. Test active worker shutdown and namespace operations through the
  supported managed lifecycle. Raw constructors, hard-linked files and arbitrary mount aliases are not
  excluded by a managed profile's directory claims. These remain phases 2/5/6, not completed requirements.
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
