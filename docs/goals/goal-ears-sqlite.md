# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master 8b1a479b96
and native fix 8ab7088f9a; combined acceptance is pending. Inspect the current handoff and actual source before continuing.
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

The goal remains active; all scope, phases and acceptance above remain required. The deliverable is the
existing [draft PR #286](https://github.com/spankyed/apack/pull/286), branch `session/ears-sqlite`.
No master merge, release, production adoption or version-only PR is authorized. Production remains elmdb.
Active integration checkout: `/private/tmp/ears-sqlite-master-integration`. The preceding checkpoint is
preserved at `/private/tmp/ears-sqlite-diagnosis-evidence`, `68cf78a2f4`.

Current checkpoint: qualify the candidate on the newly merged app/native baseline. A detached merge
`330efa68e6` combines exact candidate `68cf78a2f4` with committed master `8b1a479b96` (PR #287).
It brings app query-efficiency behavior/tests, the SDK testing `testCalls` export and native
`4d558a27543a74e2ea4c131aff1cb32455708994`. No source branch or other-agent checkout was merged/reset.
The draft branch publishes this candidate for CI review; publication does not establish combined acceptance.
Closing checks are matching native source/build, complete platform and full Strict gates, new app-query/SDK
contracts, unchanged primary data/units/watches and final exact-input/clean-checkout verification.
[Integration evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/master-query-integration/README.md)
now records a clean matching Linux native build and real SDK/pack coverage at `e8750da8c6`:
1,319 SQLite SDK cases pass with one built-prerequisite skip; that case passes separately after
pack build. Both SDK fixture stores and four current repository cases pass on both backends;
forced native fallback fails the candidate marker. Exact platform run
[40977802135](https://github.com/spankyed/apack/actions/runs/40977802135) is now green
on Linux/macOS/Windows at `d28e2de39c`; Linux executes all 1,320 prepared SDK cases
with no skips. All hosts execute both fixture stores and four built-pack repository cases.
The unchanged own-unit embedding assertion fails on exact native `4d558a2754` and
passes with the isolated journal-overlay fix, now committed/published as
`8ab7088f9a583202f9ccc766381a31e39d19851f` and pinned by this candidate. All required
Linux native checks pass, including 348 Rust cases, applicable binding tests and a
negative control restoring the old implementation. Exact cross-platform native
[CI 40982141666](https://github.com/spankyed/elmdb/actions/runs/40982141666) is now green
on all required platform jobs.
The original app assertion passes on recorded base-plus-patch artifacts; exact combined
CI remains required. Native fix checkout is `/private/tmp/ears-native-unit-fix`,
independent of the working agent, with no shared target or main edits.

Older full Strict `40974548264` failed native unit visibility and the CLI refused-replacement
case. Native visibility is fixed as above; the latter case also passes full Strict at 93.541 s
under its unchanged 200 s deadline. Exact
[Strict 40982500877](https://github.com/spankyed/apack/actions/runs/40982500877), on `dd5d7da67e`,
is terminal failure with **new** findings: packed/workspace facade equality resolves Ajv 6
instead of EARS' private Ajv 8, and the host suite exceeds its unchanged 600 s deadline.
Its other seven jobs pass. The packed fixture now retains owning packages' private external
dependencies; six focused cases and a control restoring the flattened fixture prove the fix.
[Evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/packed-dependencies/README.md)
retains exact logs and source hashes. The host timeout remains unexplained; collect file/phase
progress before changing implementation. Do not relax its deadline or treat a partial run as green.

Canonical `monorepo-worktrees.noindex/sqlite-evaluation` remains at `6cf6c8349e`, exact
[Strict 40861662941](https://github.com/spankyed/apack/actions/runs/40861662941), all nine jobs green.
Advance it only after a new exact full Strict green. The native assertion now passes with the recorded fix;
a pin change alone does not complete exact combined qualification.

Implemented candidate behavior and evidence:

- Typed structured EARS operations, SQLite-selective queries, scalar/overflow primary values, relations, units,
  committed watches and dynamic declarations; persistent derived-generation scheduling and bounded retirement.
- Lossless canonical Float32 embeddings with rebuildable projections; logical archive streaming/verification,
  private staging/rebuild/audit, coordinated import/rollback/recovery, CLI maintenance and explicit stopped-profile
  conversion. Actual starter-pack/API live updates and restart are covered on isolated converted profiles.
- Internal trusted native generation storage and read-only training workers. Durable attempt/model states share
  the scheduler; claims commit before launch, responses are acknowledged after persistence COMMIT, restart
  recovery is explicit under exclusive ownership, projection is bounded and stop drains actual worker exit.
  Ready attached models feed EARS owner candidates and canonical all-chunk reranking. Normal app composition
  does not activate this service; native C cancellation is not guaranteed immediate.
- At `25668da288`, 625 EARS, 135 affected host/storage and seventeen native cases pass, with builds/types/API/
  static and four mutation controls. A scope witness rejects the previous duplicate count/exact evaluation.
  [Projection/scope evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-projection-scope/README.md)
  preserves the initial nondeterministic fixture failure, its deterministic-ID correction and all profiles.
- [Platform 40969207041](https://github.com/spankyed/apack/actions/runs/40969207041) passed Linux/macOS/Windows
  at `ae156ce242`: seventeen native cases, native-producer conversion, five process-kill cases per host and final
  verification. Linux additionally covers actual baseline/converted API boot/live-pack/restart. Windows has
  explicit POSIX/directory-sync omissions. [40974011649](https://github.com/spankyed/apack/actions/runs/40974011649)
  validates the later projection/scope checkpoint at `68cf78a2f4`; inspect its actual state. Neither qualifies
  the newer combined baseline. Exact receipts and failed Windows linker attempts remain in
  [scheduler evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-model-scheduler/README.md).

Performance remains failed, with original budgets intact. The
[frozen fresh oracle](../references/evidence/ears-sqlite-implementation-2026-10-28/fresh-vector-oracle/README.md)
contains eighteen cohorts, 101 excluded ordinals and 54 scalar checks. The
[actual fresh EARS matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/fresh-native-ears/README.md)
at `71810414e8` passes every mean-recall group (minimum 0.972) but misses responsiveness. Broad 100k timed
p95 is roughly 19 ms; large filtered groups are 139–149 ms. Admission heartbeat p99 is 24.34 ms. The
independent verifier rejects those gates and corrupted evidence. Profiles identify native filtered SQL at
121–124 ms and COMMIT as 20.05 of 27.84 s of admission, maximum 385.69 ms. Model installation/observed
GC are small. Automatic checkpoints versus fsync still need separate causal measurement.

Owner-only projection removes redundant payload/distance work without material sampled speedup. Shared
bounded count/exact eligibility reduces a sampled 10k/10% exact query from 20.91 to 16.72 ms, while broad
samples are worse and large filtered queries remain 134–143 ms. No overall improvement or acceptance follows.
Next consolidate remaining scope/count/rerank work in one SQL execution frame, qualify native membership/
distribution and test off-thread SQLite PASSIVE checkpoints with FULL logical durability, bounded WAL,
error reporting and explicit drain. The candidate now owns a pinned native source builder and integer-membership
patch at `native/vectors/`: sorted membership covers sparse int32 and full-width integer metadata without
an ID-range bitmap. All 625 SQLite EARS cases, 555 independent SQL comparisons, a mask-corruption
mutation, allocation-site `SQLITE_NOMEM` refusal and ASan/UBSan comparisons pass in Linux.
[Evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-membership/README.md)
retains exact inputs and the missing-prerequisite static-check attempt. CI requires the same builder
and 555 comparisons on every host. Platform `40985909864` passes Linux/macOS; Windows executes
its cases but fails source-byte verification because Git converts generated C to CRLF. Canonical LF
before compilation reproduces/fixes that exact failure without changing the required hash or C code;
new exact platform validation is required. Older scratch bitmap/text patches are not used.

The complete [fresh membership matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/native-membership/fresh/README.md)
on `1860dd2eb1` now passes all patched query-latency and mean-recall gates (minimum 0.974), but still
fails query/admission heartbeat. Initial 10k broad timed p95 is 52.64–52.99 ms versus upstream
145.10–146.05 ms; broad 99,900 remains 20.13–20.26 ms and admission heartbeat p99 is 30.02 ms.
Models differ and order is fixed; this is not paired same-model causal speedup evidence. All raw
answers and failed original-budget verifications remain retained. Scope/count/rerank consolidation,
native cost and FULL checkpoint scheduling remain the next performance work. Normal app model
ownership/loading, packaging and physical failure qualification remain required. Do not retune frozen
ANN settings or loosen thresholds.

Still required, without narrowing phases 3–7:

- Automatic model eligibility admission, incumbent-preserving physical refresh, host drain before file replacement/
  deletion, complete native audit/rebuild/restore/retirement ownership, normal native loading/distribution/signing.
- Final candidate/trash filtering before K, multi-chunk scoring, ties, large-K/exact fallbacks, own-unit/savepoint
  reads, model/generation/hash freshness, readiness/watch delivery and representative recall/update qualification.
- Admission/cleanup and vector responsiveness; FULL writes, streaming/watch load, large fields, growth, peak
  memory, disk/WAL/checkpoint behavior, long readers/busy writers and warm/cold/reopen app budgets.
- Representative language/identifier/typo/relevance usefulness, vector/hybrid workloads and matched current
  elmdb/SQLite comparisons. Old fixtures, primitive timings or functional witnesses are not app acceptance.
- Electron/renderer, executable-pack/SDK flows and installed/signed CLI/app OS/architecture coverage.
- Disk-full/I/O/unknown commit, interrupted admission/import/backup, physical/resource faults, corruption,
  permissions/read-only mounts, Windows ACL/directory durability and unmanaged writers. CI hosts do not
  certify arbitrary filesystems; explicit unsupported-filesystem refusals remain required.
- Final full Strict on exact inputs, architecture/native dependency/maintenance review, current public/API docs
  and an evidence-based adoption decision. No implicit migration of daily profiles is authorized.

Preserve canonical Float32 bytes and original failures. Synchronous EARS contracts cannot silently become
asynchronous. Missing native cursor indexes on populated stores require explicit offline preparation. Private
corpus, publisher source IDs and trained model payloads stay outside Git. Optional Codex is missing in both
baseline API images, so earlier boot checks do not certify external inference or complete pack health.

Historical detail and older evidence links are preserved in the
[previous handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-master-integration.md)
and [checkpoint history](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md).
