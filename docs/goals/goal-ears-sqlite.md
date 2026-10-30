# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master dc67febcce
and its native pin 2441af4658; full combined acceptance remains pending. Inspect the current handoff and actual source before continuing.
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

The full goal remains active; all phases and original acceptance budgets still apply. Deliverable:
[draft PR #286](https://github.com/spankyed/apack/pull/286), `session/ears-sqlite`. Production stays elmdb.
No master merge, release, adoption, implicit daily-profile conversion or version-only PR is authorized.

Source work is `/private/tmp/ears-sqlite-query-integration`; detached publisher:
`monorepo-worktrees.noindex/integration-3AEBRl`. Canonical `sqlite-evaluation` remains earlier `6cf6c8349e`;
it does not contain later published work. Current committed master baseline is `dc67febcce` and native pin
`2441af4658d961f547c7094cd041c2ac246668c5`. Inspect actual Git/workflow state before continuing.

The candidate includes the structured graph/query port, native query execution, identity/atomic bootstrap and
foreign-WAL preservation, canonical signing recognition, managed directory claims, file/sidecar admission,
logical recovery/conversion and model/index lifecycle. [Native integration](../references/evidence/ears-sqlite-implementation-2026-10-28/native-2441-integration/README.md),
[identity/signing](../references/evidence/ears-sqlite-implementation-2026-10-28/format-identity/README.md) and
[file ownership](../references/evidence/ears-sqlite-implementation-2026-10-28/file-ownership/README.md) retain their
source-bound evidence. The EARS ownership checkpoint passes 762 SQLite-selected cases (zero skips).

The [reset/quarantine checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/reset-quarantine/README.md)
excludes history handles before primary reset, verifies unrelated sibling identities even when history is
absent, and syncs POSIX quarantine/replacement parent publication. Failed publication preserves the original
refusal, sync/cleanup errors, forensic path and uncertain directory authority. Tests prove held-handle refusal,
new-open exclusion, cleanup and actual killed-process reset recovery. Windows directory flushing remains
unimplemented in the shared helper; passing ordering/fault tests there do not prove physical durability.
Local host/CLI types, lint, syntax, 106 focused host cases, seven SQLite CLI cases, five package builds,
shipped-pack build, nine reset integration cases and 1953 full host cases
(1 existing platform skip) pass. Baseline failures, reverted guard, restored source and
initial test-development failures are retained. Nine actual-report controls protect the new named platform
witnesses. The original assertions/deadlines were not relaxed. Broad/compiler work stays in private
Linux/CI, capped at two CPUs/six GiB/no swap with a quiet admission window; focused checks use half a CPU/768 MiB.

[Platform run 41112243866](https://github.com/spankyed/apack/actions/runs/41112243866) passes all three hosts
at `9fbea37d0d`, before the native/ownership/reset changes. Current runtime `a95039a8c7` passes
[signed installed Preview 41120611981](https://github.com/spankyed/apack/actions/runs/41120611981), including
both store identities, and Linux/macOS SQLite qualification in [strict run 41120604961](https://github.com/spankyed/apack/actions/runs/41120604961).
That strict run is a terminal failure: producers, both native and both integration shards pass; the app/unit
shard fails only its subprocess inventory (three sites recorded versus four). The
[inventory correction](../references/evidence/ears-sqlite-implementation-2026-10-28/reset-subprocess-inventory/README.md)
records the actual killed-reset process with its isolation reason; all 14 detector/control cases pass.
Windows fails the original CLI backup reservation with EPERM. The first attempted correction at `2a641ce102`
passes Linux but [platform run 41125212261](https://github.com/spankyed/apack/actions/runs/41125212261) proves
its direct Windows rename replaces competing files and dangling symlinks. Linux/macOS pass that run;
Windows fails two preservation assertions. The [exclusive-publication correction](../references/evidence/ears-sqlite-implementation-2026-10-28/windows-backup-exclusive/README.md)
uses the system Windows Directory.Move operation with paths passed as data and retains all race assertions.
All 29 platform CLI cases pass on Linux, including twelve focused profile cases and a literal metacharacter
path; actual Windows qualification remains required. All five backup invariants are required by name in the
platform verifier, with fourteen real-report omission/skip/duplicate/path controls passing. Host types pass with an explicit 512 MiB heap; CLI types exhaust that heap and require the
larger disposable budget or CI. These resource failures are retained, not counted as passing checks.
The [backup cleanup correction](../references/evidence/ears-sqlite-implementation-2026-10-28/backup-cleanup/README.md)
preserves the original publication outcome alongside staging/lock cleanup errors, still attempts lock release,
and reports a retained `publishedPath` after successful publication. Three exact-source baseline failures
become passing cases; all 32 platform CLI cases, lint, syntax and twenty required-witness controls pass on
Linux. CLI types/package builds and final integrated qualification remain pending. Platform run
[41130505526](https://github.com/spankyed/apack/actions/runs/41130505526) is live at the preceding exclusive-move
checkpoint `58ae8a7b0e`; it does not qualify the later cleanup changes.
The [CLI close-wrapper correction](../references/evidence/ears-sqlite-implementation-2026-10-28/cli-close-outcomes/README.md)
refuses thrown `undefined`, retains both command/close failures and preserves machine-readable commit/recovery
outcomes. Five reproduced failures pass after correction; all 41 expanded platform CLI cases pass on Linux,
along with lint, syntax, fourteen command-outcome controls and the preceding twenty backup controls.
The platform workflow now includes the wrapper cases. Types, package builds and final integrated/platform
qualification of these later inputs remain required; no live earlier run is restarted.
The earlier full strict run 41106571398 failed its old verifier and a 200-second CLI integration case.
The verifier is fixed; that case passes in 28.6 seconds on isolated Linux, but the earlier macOS timeout
remains unexplained. The older editor intermittent also remains unexplained despite ten unchanged repeats.
Neither partial/source checks nor six installed smokes complete app/performance acceptance. The
[prior handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/reset-quarantine/prior-handoff.md)
preserves historical sources, CI boundaries and failures.

Next checkpoint: qualify exclusive Windows backup publication through the existing platform witness,
complete pending source checks, and continue responsiveness, real-corpus and full app/operational requirements below.
No evidence here certifies arbitrary filesystems or completes the goal.

Next deliverables and their closing checks, without narrowing phases 3–7:

- Qualify native repair faults on the final platforms, complete physical publication/deletion authority and
  physical-file recovery, and verify interruption/reopen outcomes under cooperating ownership.
  Claims inside a database directory do not authorize arbitrary rename/delete or noncooperating writers.
- Qualify final native provenance after inner-library signing and before app sealing; qualify installed
  Electron/renderer/CLI, executable-pack/SDK flows and required OS/architectures. `asar:false` already keeps
  the native files on disk. Ordinary source/unsigned package builds do not prove installed/signing behavior.
- Close remaining filesystem/format ownership work: qualify ordinary unaliased data files and foreign
  valid SQLite refusal/positive persisted identity on final platforms, and synchronize/qualify
  history-quarantine parent publication, including Windows directory flushing. Reset exclusion before
  primary mutation and held-handle/interruption cases are implemented; final platform qualification remains.
  Test active worker shutdown and namespace operations through the supported managed lifecycle. Directory
  claims cannot exclude noncooperating raw SQLite writers or arbitrary mount aliases; data-file admission is
  a separate guard. These remain phases 2/5/6, not completed requirements.
- Resolve the existing failed responsiveness gate. Latest recorded 99,900-vector admission takes 20.77 s
  with heartbeat p99 48.14 ms against 16 ms. Projection batching improves throughput but does not prove a
  heartbeat win. A [current-source attribution run](../references/evidence/ears-sqlite-implementation-2026-10-28/commit-responsiveness/README.md)
  still fails at p99 31.05 ms: 11.32 seconds of COMMIT wall time includes deferred vec1 work and substantial
  blocked time, with no cgroup throttling. The projection slice alone does not bound its transaction. This is
  not a speedup comparison or acceptance. Next measure supported physical allocation controls on a fixed model
  before adding native storage or writer coordination. In a later 0.5-CPU diagnostic 81 retirement batches removed 2592 rows in five seconds;
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
