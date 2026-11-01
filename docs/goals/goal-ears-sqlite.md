# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master 984f1b4aca
and its native pin f496470679a7bd9764398108b20f62a73333c701; full combined acceptance remains pending. Inspect the current handoff and actual source before continuing.
Work in the isolated session/ears-sqlite checkout and preserve concurrent work.

Finished when the SQLite candidate runs the complete app data lifecycle, all required
contracts and recorded performance/relevance/recall budgets pass, full validation is
recorded on pinned source in disposable environments, and a draft PR is ready for
an adoption decision. Commit usable checkpoints. Do not silently drop requirements.
```

Status: active after user-verified OrbStack migration to Seagate, 2026-10-31; candidate qualification remains incomplete.
Branch: `session/ears-sqlite`. Authoritative source: `/private/tmp/ears-sqlite-query-integration`;
`monorepo-worktrees.noindex/sqlite-evaluation` preserves an earlier session checkpoint.
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

All Scope, Decisions, Phases and Validation above and all unmet requirements below remain required. Deliverable is [draft PR #286](https://github.com/spankyed/apack/pull/286), still unqualified. Production remains on elmdb; no candidate adoption/merge, release or daily-profile migration is authorized.

### Source and current corrections

Work only in `/private/tmp/ears-sqlite-query-integration`, detached HEAD published to `session/ears-sqlite`. Integrated master is `461f7bf2cb`, pinned elmdb `f496470679a7bd9764398108b20f62a73333c701` (unchanged on master). The requested rebase replays all 127 candidate commits; its sole conflict preserves both master’s thread-readiness identity and the candidate’s storage-format identity in `tests/performance/scenario.ts`. Pre-rebase source remains available at `ce0b2fe0b6`; rebased candidate tip before this checkpoint is `782943e787`. Preserve the other agent’s checkout/builds. The original history is checkpointed at `checkpoint/ears-sqlite-before-master-7eca-20261101` (`28e4aa13e4`); [rebase evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-984f/README.md) records preservation and conflict resolution.

Latest product corrections:

- `126d5a9dff` avoids a full numeric-order type-discovery scan only when the pipeline already guarantees one admitted type. A first-member probe preserves empty-scope short circuiting; actual cell validation, stable numeric ordering and mixed/unknown-type discovery remain intact. Inline/overflow, typed-destination and mixed traversal controls are added, and focused CI now collects `query-cost.spec.ts`. [Focused qualification 41344051810](../references/evidence/ears-sqlite-implementation-2026-10-28/ordering-126/README.md) passes all 28 query-cost and 114 host cases, source/test types and zero API diff. Shared SQLite/native retain only the keyword failure, with 452/262 passes and 0/190 SQLite-only exclusions. Source-mutation negative-control execution and relevant remeasurement remain required; no speedup or budget pass is inferred. Existing f61/bd4/2d runtime receipts precede this correction.

- `9b77497124` admits prospective declarations before publishing pack replacements, binds one writable database owner, preserves definite refusals and routes fresh ambiguous/committed outcomes through readiness. The [baseline real-peer regression](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-refusal-ae9/README.md) reproduces restored files with incorrect replacement authority; the [fixed focused run](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-9b7/README.md) passes all 112 host cases, host/EARS types and zero API diff. Both additional native/SQLite real-write-unit refusal cases now pass on Linux/macOS in the integrated run below.

- `3bc228d580` rechecks relevant accepted owner bindings/declarations after scoped readiness, including immediately-ready continuations, without cancelling unrelated changes. Dependency discovery is iterative with indexed lookup. [Actual focused qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-3bc/README.md) passes all 97 host cases, including five owner-race scenarios and the real installed-pack SQLite retained-failure fixture; full host/EARS types and zero API diff pass. This predates the schema-admission correction above and does not establish latest-source platform/installed/app/resource acceptance.

- `382ccf5c6e` additionally distinguishes explicit null counter metadata from a missing key, so a corrupt nil cannot silently restart numbering. [Focused runtime qualification 41320427099](../references/evidence/ears-sqlite-implementation-2026-10-28/counter-382/README.md) passes all nineteen commit cases (SQLite 421 pass/one keyword failure/no skips); its metadata gate initially fails because Vitest quotes object-case titles. `a9027400bf` corrects the exact names without relaxing assertions; the actual corrected gates pass on unchanged raw reports plus six missing/duplicate/skipped negative controls. Runtime-info/resource steps skipped in the original run are not counted as passes. The predecessor-source queued run `41320203788` was cancelled before execution for the diagnosed null correction, not an observation timeout.
- `29fcddfb3e` guards representable commit/schema identities. Exhausted valid counters refuse with NUMBERS_EXHAUSTED; schema/recovery checks happen under writer ownership before catalog mutation, and unit/import failures roll back. Four new mandatory cases and all thirteen older commit-outcome cases pass in [focused qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/counter-29f/README.md). Its earlier TypeScript setup refusal is [preserved](../references/evidence/ears-sqlite-implementation-2026-10-28/counter-0f7-setup/README.md), not counted as runtime evidence.
- `71ef19b1ee` selects existing vec1 cosine only on a connection with a trusted loaded extension; fallback stores retain sqlite-vec. Canonical bytes, normalization, owner aggregation, membership, ANN budgets and ordinary builds stay intact. [Actual public SQL/numeric witnesses](../references/evidence/ears-sqlite-implementation-2026-10-28/public-scorer-71e/README.md) pass on both artifacts; [platform qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-613/README.md) passes all seven numeric regimes on Linux/macOS/Windows. These precede the counter guard.
- `b992897bde` repairs strict independent app-smoke preparation: explicitly build runtime from verified producer prerequisites after a failed contract step, and launch only after successful preparation. Earlier failures still keep the job red. Its [actual independent app witness](../references/evidence/ears-sqlite-implementation-2026-10-28/app-smoke-613/README.md) now passes all six cases without skips/retries after the verified build.
- Earlier hybrid formatting fetches only final lexical-winner details in the same read snapshot, preserving RRF scores; both formatting and independent-writer snapshot cases pass. Relation identity lookup streams candidates; audit groups fingerprints in a private indexed spool while keeping existing equality authoritative. Ordinary absent-key scans and adversarial collision work remain. Their [resource evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/audit-resource-441/README.md) does not imply total-memory bounds. Replacement cleanup retains primary/secondary failures and honest uncertain-commit outcomes.

### Live validation and next closing checks

Rebase checkpoint: the existing run `41345726834` has passed the actual numeric-order source-mutation control and is executing its original sustained trials; retain its original source identity. Comparing original strict progress streams finds 612 completed baseline files versus 517 before the f61 deadline, with 517 common files. Common-file cumulative body/collection/preparation times rise 13.9%/19.1%/23.9% across unrelated workspaces. These overlapping worker totals are diagnostic, not wall-clock or exclusive CPU. The baseline’s sole failed module is the retained search-relevance fixture. This supports investigating broad runner/workload variance rather than claiming a proven new hang; the original 600-second gate and full suite remain required. Requalify the rebased source without deadline or scope changes.

[Known-type ordering focused run 41344051810](../references/evidence/ears-sqlite-implementation-2026-10-28/ordering-126/README.md) is terminal at `126d5a9dff`, with all 28 cost cases and 114 host cases passing, source/test types and an empty API diff. The later metadata gate replays against its original report and refuses twelve missing/skipped/duplicate/replaced-witness controls. [Actual source-mutation control and repeated remeasurement 41345726834](https://github.com/spankyed/apack/actions/runs/41345726834) is started at `1cf08f7ec0`: it must pass ordinary cost tests, remove the type hint only in disposable Linux CI, require the intended old-discovery assertion to fail, restore source byte-for-byte/clean git diff, and then run the unchanged twelve-cohort durable workload. Owned test process trees use the maintained bounded runner. Inspect actual outcomes and hardware/provenance before claiming an improvement. The earlier app-flow/sustained measurements remain pre-correction baselines.

[Real app-flow qualification 41341760226](../references/evidence/ears-sqlite-implementation-2026-10-28/app-flows-50c/README.md), source `50cf9d6980d417fbb17eacf5ede17eb9798e68e7`, is terminal success: script/test types and storage-provenance tooling controls pass; all six maintained thread-open/search/deterministic-streaming runs pass full immutable-trial/capture admission. This records 120 measured actions plus 30 warmups on fresh per-backend/scenario profiles, with both actual store markers verified. Observed native/SQLite medians are thread open 430.20/546.55 ms, search 16.15/27.70 ms and streaming completion 786.10/847.20 ms; first-visible stream medians 144.3/218.0 ms. Original admission/manifests/indices and derived scalar/resource/progress samples with raw-trial hashes are preserved; spans/profiles/configuration/trace payloads are omitted. One warm process per backend/scenario, fixed native-before-SQLite order, default durability differences and one three-CPU/7-GiB macOS runner prevent causal engine-only, tail/device or bounded Linux/corpus claims. This is a pre-numeric-order-correction baseline and clears no retained keyword, corpus/admission or full host-suite failure.

[Sustained write/watch qualification 41340220925](../references/evidence/ears-sqlite-implementation-2026-10-28/sustained-bd4/README.md), source `bd4e6f9506d6eee29a64158794cbe4b876d58489`, is terminal success for all twelve fresh-process 60-second/20,000-task trials using matched durable units and alternating backend/mode order. All views converge. Median closed-view throughput is SQLite/native 3,813/2,841 commits/s; open-view throughput 2,466/2,712. SQLite heartbeat p99 passes 16 ms in all six cohorts; native misses all six. SQLite ordered reads average 32.76–41.09 ms versus native 10.69–14.19 ms and acknowledgment p95 is higher. Maximum SQLite stalls still reach 146.51 ms, and process CPU is higher. Raw heartbeats/provenance/resources are retained under actual 2 CPU/6 GiB/no-swap limits. This workload-specific result does not qualify actual renderer/search/provider flows, cold/device variance, peak disk/WAL, or clear the retained corpus/admission misses.

Current-source packaged gates target `2d1307c672fd3b86aaa4f1667d739e337d68031d`: [Windows/Linux packaged Electron 41338576161](https://github.com/spankyed/apack/actions/runs/41338576161) completes both jobs successfully. The [Linux](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-2d-linux/README.md) and [Windows](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-2d-windows/README.md) reports verify actual Electron 37.2.4, native/graph provenance and four passing Preview contract tests each. This is unpacked unsigned native/API runtime scope, not renderer/installer/signature/performance acceptance. [Signed macOS installed Electron 41338613335](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-2d-signed/README.md) passes signing/deep strict verification/post-sign native smoke and all six installed cases without exclusions/flakes/retries. Its temporary signing keychain is removed. This private test signing has no timestamp/notarization and is not distribution qualification. These existing workflows build private Preview copies and perform no release publication. Preserve exact handles rather than restarting for observation timeouts or later documentation edits.

[Chunk-skew resource/focused qualification 41336691997](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-resources-045/README.md), source `045a9e76d74d8a7e2d78e611cb9a486739c81af6`, is terminal. All 114 host cases pass with no exclusions; shared SQLite/native retain only the keyword failure, with 424/262 passes and 0/162 exclusions; generated API diff is empty. Three built-package fallback cohorts hold 4,608 owners/1,536 dimensions fixed and vary one owner's chunks across 1/1,024/16,384. Correctness and scratch cleanup pass; query p95 is 6.37/9.68/80.47 ms, heartbeat p99 5.98/9.27/91.44 ms against 16 ms. The heavy cohort fails that original budget. These synthetic low-rank serial warm trials include fallback scan and canonical reranking; they do not isolate costs or qualify managed-model/representative app requirements. The [ownership/complexity review](../plans/ears-sqlite-contracts.md#candidate-invariant-and-maintenance-review) covers pre-publication schema ownership and whole-registry projection cost. The [current adoption assessment](../plans/ears-sqlite-contracts.md#current-adoption-assessment) maps every original phase to evidence/open requirements and retains the unapproved foreground execution decision. [Predecessor macOS/Windows receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/readiness-163-platforms/README.md) and a [limited keyword-ranking diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/keyword-ranking-diagnostic/README.md) remain bounded evidence.

[Terminal strict-consumer evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-f61-consumers/README.md): the producer and all four integration/native consumers pass: integration 242/580 passes (zero/one Windows-only exclusion), native 26/47 passes (two Linux ELF/26 Windows PE exclusions). All four consumer logs report changed inputs and no reusable cache stamp. App-and-rest hits its original 600-second host unit-suite ceiling (602 seconds observed), with 517 ended files and two newly queued unfinished files near the deadline. A pinned-source collection-candidate audit finds 93 additional tracked `.spec.ts` candidates absent from the stream; it is not actual Vitest discovery, and targeting only two files cannot close full host-suite acceptance. Its independent verified build and six Electron smoke cases pass once. No timeout/coverage waiver follows from this failure; preserve the failed attempt, inspect the remaining consumers and diagnose aggregate cost before choosing requalification.

Current integrated checks target `f61acd3c7db33ffcc6c4f313efbf7a9a9be60173`: [full strict/platform 41336141230](https://github.com/spankyed/apack/actions/runs/41336141230) is terminal failure, retaining the host unit timeout and platform keyword judgment. Its [completed platform reports](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-f61-platforms/README.md) each pass all 312 host cases, including both real-write-unit cases, and retain only the keyword judgment among EARS failures (919 pass/one fail/no exclusions). Windows passes 309 host cases with six explicit exclusions and 915 EARS cases with the retained keyword failure/four FIFO exclusions; both write-unit cases pass. Its separate crash suite has two passes/ten POSIX exclusions. Both Linux old-global-readiness controls fail their exact intended EARS/actual-host case, then restore the source. [Complete SQLite source-app 41336143714](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-f61/README.md) passes all 33 selected cases once, one packaged-only exclusion and no unexpected failures/flakes/retries. Strengthened write-unit named-case guards replay against both original host reports with twelve missing/skipped/duplicate negative controls; those metadata edits are later than the tested source. The requested additional rebase completed unchanged against fetched master `984f1b4aca`; no other checkout was modified. Do not restart these pinned runs for later evidence-only commits.

[Full strict 41316192751](https://github.com/spankyed/apack/actions/runs/41316192751), source `6135b37f5c`, is terminal: producer/full types/API/lint and all four integration/native consumers pass, retaining their platform exclusions. All three platform suites fail only the original keyword judgment (Linux/macOS 910 pass/one fail/no skips, Windows 906 pass/one fail/four FIFO exclusions), including seven passing public cosine regimes each. The repaired independent source-app build and six smoke cases pass; app-and-rest remains failure on the original host-unit keyword judgment and cannot establish later chain steps. This source predates counter guards. [Latest strict 41322492680](https://github.com/spankyed/apack/actions/runs/41322492680), source `a9027400bf`, has completed all three platform jobs: [actual receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a902/README.md) show Linux/macOS 916 passes/one retained keyword failure/no exclusions and Windows 912 passes/one failure/four FIFO exclusions. All nineteen commit cases and seven cosine regimes pass on each; all four integration/native consumers pass, and app-and-rest completes with the retained host keyword failure but six independent built Electron smoke passes. The run is terminal failure solely on the retained keyword judgment. This predates scoped readiness.

[Corrected counter run 41318244145](../references/evidence/ears-sqlite-implementation-2026-10-28/counter-29f/README.md), source `29fcddfb3e`, completes with SQLite 419 passing/one keyword failure/no skips; native 262 passing/one failure/157 SQLite-only exclusions. All seventeen commit cases, package/source/test types, targeted lint, zero-byte API patch, WAL, model/relation/hybrid/audit safeguards, six maintenance resource trials and five copied-profile conversion groups pass. The separate relevance gate skips after the shared contract failure. Once the current broad run converges, final-source full strict/platform/app/installed/signing/API and operational gates remain required; focused checks cannot replace them.

[Managed scorer corpus 41315957504](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-b99/README.md), source `b992897bde`, completes all 23 safeguards and 1800 independent-reference cases. Recall means (minimum 0.9596875), 100/200ms query-p95 targets, three sampled read-only reopens per size and scratch cleanup pass. The original 16ms heartbeat still fails eight groups: both 10k all-live groups and every 99.9k group. At 99.9k, query p95 is 51.99–53.44ms all-live, 16.20–16.76ms at 1%, and 76.32–76.38ms at 10%. CPU is EPYC 9V45 versus EPYC 7763 in e793, with independent models/cache state; lower observations are not a causal speedup. Full provider/UI/language/model/resource/app qualification remains open.

[Ordinary admission 41312905554](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-80c/README.md), source `80c289ca62`, completes all 24 uninstrumented fresh trials: 23 pass. Value/OFF and search/OFF/FULL each pass six; value/FULL has one 100k heartbeat miss at 16.39ms against 16ms and passes every other original budget. Cohort CPUs differ, so no causal cross-cohort/history comparison follows. Healthy [instrumented attribution](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-trace-5eb/README.md) does not clear the ordinary miss. [Matched checkpoint diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-5db/README.md) passes six trials but 128 pages trades lower WAL/GC-batch p99 for slower total work and mixed heartbeat results. Keep production checkpoint/durability defaults. The cancelled obsolete probe and diagnosed addon metadata correction remain recorded in [protocol history](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-protocol/README.md).

[Full source-app 41321045556](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-a56/README.md), source `a5656e223f`, now passes 33 cases with one packaged-only exclusion and no retries/flakes, configured for SQLite. It includes the malformed-counter implementation; the later name-gate fix changes CI metadata only. [Fallback corpus 41322494663](../references/evidence/ears-sqlite-implementation-2026-10-28/fallback-a902/README.md), source `a9027400bf`, completed: 1,800 independent-Float64-reference queries pass mean recall (minimum 0.97390625) and query p95 targets; eight groups fail the unchanged 16 ms heartbeat target. Workflow success is diagnostic completion, not acceptance. The older 6cf fallback used a same-engine exact reference; its passing recall is not substituted for this stronger current qualification.

[Scoped readiness 41324900434](../references/evidence/ears-sqlite-implementation-2026-10-28/readiness-644/README.md), source `64447ffb60`, completes with 91 host passes/no exclusions, SQLite 424 passes/one retained keyword failure/no exclusions, native 262 passes/one failure/162 SQLite-only exclusions. All three new mandatory real-store readiness cases and nineteen commit-outcome cases pass. Matching package/API generation and EARS source/test types/lint pass; the reviewed generated one-line optional type-scope report is applied verbatim. Six audit resource trials and five conversion groups also pass. Added inactive-dependency/fatal-owner assertions and the Linux old-global-behavior mutation control need final-source validation.

[Readiness strict 41326246856](https://github.com/spankyed/apack/actions/runs/41326246856), source `16378a24db`, is terminal failure; producer and all four integration/native consumers pass, while platform/app jobs fail. It predates the schema-owner repair. It began after the preserved earlier strict run finished. It includes the committed generated API report, mandatory host readiness witnesses, admitted-inactive-dependency/fatal-owner assertions and Linux old-global-behavior regression control. [Complete source-app 41326301171](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-163/README.md) passes all 33 selected cases once, with one packaged-only exclusion and no retries/flakes, explicitly SQLite at `16378a24db`. This predates the added retained-failure host fixture and dependency-owner correction. [Real host fixture 41327060096](../references/evidence/ears-sqlite-implementation-2026-10-28/real-host-d9c/README.md), source `d9c4ccfce5`, now passes all 92 host cases, including actual retained-failure installation/activation, full host/EARS types and a zero-byte API patch; [Owner-race qualification 41328067375](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-3bc/README.md), source `3bc228d580`, now passes all 97 host cases, including the five new ownership-race cases, complete host/EARS types and a zero-byte API patch. Do not replace these handles for observation timeouts. Later documentation-only checkpoints do not change these tested implementation/workflow inputs.

Next closing work:

- The [paired managed Scalar/AVX2 corpus](../references/evidence/ears-sqlite-implementation-2026-10-28/paired-scorer-3ba/README.md) is terminal: 1,800 independent-reference queries per variant pass recall and query-p95 limits; heartbeat misses nine generic and eight dispatch groups against 16 ms. No consistent foreground remedy or production artifact change follows. An explicit asynchronous app-search option has been proposed to the user; no answer or acceptance-path waiver has been received. Preserve synchronous requirements until a decision.
- Diagnose and repair full host-unit suite cost/scheduling without dropping coverage or raising its ceiling; all four strict integration/native outcomes and all three platform reports are now preserved, including exclusions and cache-stamp warnings. The sustained and real app-flow runs are complete; inspect the live ordering-focused run and remeasure changed execution before choosing further qualification. Both new real-write-unit cases and complete source-app behavior now pass at f61, but do not close the remaining operational/fault/installed requirements.
- After corrections converge, qualify full latest-source strict/platform/app/installed/signing/API behavior, including the newer real installed-pack mutation control. The [Linux 163 control](../references/evidence/ears-sqlite-implementation-2026-10-28/readiness-163-linux/README.md) already proves that reverting the database type scope fails the EARS isolation regression for the injected unrelated index error and restores source byte-for-byte; it retains 919 ordinary EARS passes/one keyword failure and 289 host passes. Initial scoped readiness, actual installed activation and owner-race regressions pass, but are not complete lifecycle/fault qualification. Boot/restore waits remain global.
- Measure realistic sustained streaming/read/write/watch/app responsiveness, warm/cold/reopen variance and memory/disk/WAL/contention. Synthetic passes do not close those requirements. Retain all original failures and the requirement-by-requirement final adoption review.

Do not restart live jobs for observation timeouts or displace pending work. No budget, recall, candidate, assertion, deadline or retry waiver is authorized.

The original keyword-only top-five requirement is still 25/25. Current none/en keyword retrieval is 24/25 on both engines: `generate-entries` misses the predeclared Generated files overview. Frozen hybrid is 25/25 on both with one pinned English MiniLM model; that is not a keyword/language/provider waiver. The earlier clarification about judging this navigation through hybrid remains unanswered.

### Completed evidence and retained failures

- [Completed strict predecessor 03c](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-03c-complete/README.md): complete producer and all four integration/native consumers pass. Integration shards have 242 and 580 passes (one Windows-only exclusion); all five formerly timed-out dependency cases pass in the full shard. Native shards have 26 and 47 passes (two Linux ELF and 26 Windows PE exclusions on macOS). App-and-rest has 6973 unit passes/one original keyword failure/88 exclusions; its independent app witness has [six missing-build setup refusals](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-03c-app-setup/README.md), not actual app passes. Later fixes need their own qualification.
- [Cleanup/core 8165](../references/evidence/ears-sqlite-implementation-2026-10-28/cleanup-8165/README.md), [worker/checkpoint dcc](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-checkpoint-dcc/README.md), [cross-model compatibility](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-model-015/README.md), [paired Scalar/AVX2 corpus](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-pair-b9/README.md) and [bounded cosine timings](../references/evidence/ears-sqlite-implementation-2026-10-28/distance-8165/README.md) retain actual source/scope/exclusions. None qualifies current app-wide responsiveness, all faults/platforms or a default AVX2 build.
- [Earlier handoff snapshot](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-counter-qualification/README.md) preserves all intermediate receipts, the f55 matched built-package comparison, prior app/installed/signing checks and their unresolved conditions. It is dated history, not another work plan. Archive/detail consolidation removes no unmet requirement.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The new `bench/sqlite/acquire-real-text.py` recipe prepares a private, full-shard-hash/row-ID verified join to that exact pinned source; the standalone join recipe remains unqualified, while the integrated full paired acquisition has passed. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current production source at 49ae. Text-only retrieval remains 24/25, including under the explicit stemming diagnostic; that judgment remains required. Complete language/search-feature coverage, production-provider and actual app-flow acceptance remain open.
3. Meet original foreground/admission/search/vector/resource budgets. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The 16ms/100ms/200ms budgets are unchanged. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../references/evidence/ears-sqlite-implementation-2026-10-28/frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.
