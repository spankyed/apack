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

The complete Scope, Decisions, Phases and Validation above remain required. Deliverable is [draft PR #286](https://github.com/spankyed/apack/pull/286), still unqualified. Production remains on elmdb. No candidate adoption/merge, release or daily-profile migration is authorized. Historical handoffs and passing subsets never remove unmet requirements.

### Source and current corrections

Use `/private/tmp/ears-sqlite-query-integration`, detached HEAD published to `session/ears-sqlite`. Integrated master is `984f1b4aca6d99719a323ec779808def5b2d1c9b`, pinned elmdb `f496470679a7bd9764398108b20f62a73333c701`; the requested 2026-11-01 rebase check was already up to date. Preserve the other agent's checkout/builds and private publisher. The pre-rebase history remains at `checkpoint/ears-sqlite-before-master-7eca-20261101` (`28e4aa13e4`); [rebase evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-984f/README.md) records its exact preservation and conflict resolution.

Latest product-runtime corrections are ordinary relation candidate streaming (`208227ac0c`) and private audit candidate grouping (`9ac1f748d3`). [Actual-driver qualification at 66c](../references/evidence/ears-sqlite-implementation-2026-10-28/focused-66c/README.md) passes all five new cursor/grouping/duplicate/collision/cleanup/codec witnesses and shared models on Linux. The spool narrows candidates with a structural fingerprint but retains existing equality as authority; two prepared statements and an 8MiB cache setting do not imply a total memory or adversarial collision-independent CPU bound. Ordinary absent-key lookup/repeated insertion still scans endpoint groups. High-multiplicity maintenance resource qualification is next, not completed by semantic controls.

Earlier correctness work includes relation-key/null/Map semantics and duplicate refusal, canonical empty-rank admission with nonempty named-rank refusal, single-field inline/overflow projection, source-close-before-replacement-commit and truthful ambiguous-commit quarantine. Current focused reports retain their named witnesses. The implementation/dependency/complexity inventory is in [contracts](../plans/ears-sqlite-contracts.md); source changes do not qualify themselves.

### Live validation and next closing checks

The source/test/type/API relation run [41296507159](../references/evidence/ears-sqlite-implementation-2026-10-28/focused-66c/README.md) is terminal with complete reports preserved. [Resource-extended run 41298970894](../references/evidence/ears-sqlite-implementation-2026-10-28/audit-resource-da4-partial/README.md), source `da41ac4d0d`, is terminal failure: one 50k-key child succeeds (1.641s audit, source/commit unchanged, 14.1MB observed spool, clean exit/removal), but the parent wrongly requires a specific addon basename. Source now verifies canonical package ownership with both opaque layouts covered. All required correctness/type/API/conversion checks pass apart from the retained keyword judgment. [Fixed-source run 41301810718](https://github.com/spankyed/apack/actions/runs/41301810718), source `44155b34ca`, is in progress and must complete all six fresh trials and exercises [the built-package audit protocol](../references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-resource-protocol/README.md): three fresh children each for 50k small-key and 10k large-info fixtures, enforced 2 CPU/6 GiB/no swap, source relation-byte/commit checks, phase memory/CPU/provenance, independent observed disk/spool peaks, natural close and scratch removal. Pure orchestration controls pass six-child completeness for prebuild/release layouts and ten failure/cleanup cases; actual resource execution remains pending.

A metadata-only trusted vec1 CPU-backend probe is also prepared, and future corpus receipts retain runtime/worker versions. The source suggests the current generic x64 build may miss upstream AVX2 paths; actual runtime mode and any performance effect are not established. No SIMD build, hardware baseline or ANN policy changes are made.

Rechecked remote master `984f1b4aca` and rebased again for the requested elmdb revision: already up to date, with `vendor/elmdb.rev` at `f496470679a7bd9764398108b20f62a73333c701`. No candidate source or pin changes were necessary.

Observe the actual dispatched handle; do not cancel/restart on polling timeouts or displace a pending app-acceptance workflow. Preserve terminal raw reports/exclusions and fix diagnosed failures before broader reruns. Once corrections converge, final-source strict, platform, source-app, installed/signing, API and operational/resource gates still have to run. An isolated model pass is not a full-suite or app-load timing result.

The original keyword-only top-five requirement remains 25/25. It is currently 24/25 on both engines under none/English stemming; `generate-entries` misses the expected Generated files guide. The clarification about judging that navigation through hybrid remains unanswered. Do not infer a waiver from elapsed time, existing hybrid passes or this document.

### Completed evidence and retained failures

- [Focused 66c / 41296507159](../references/evidence/ears-sqlite-implementation-2026-10-28/focused-66c/README.md): SQLite 413 pass/one retained keyword failure/no skips; native 262 pass/one failure/151 SQLite-only exclusions. All new relation witnesses and existing required model/watch/value/schema/graph cases pass. Source/test typechecks, package/API with empty patch, native routing, both persisted-WAL error/acknowledgement regimes and all five matching-producer conversion groups pass. This is Linux runtime correctness, not large maintenance resources or final all-platform adoption acceptance.
- [Platform 4cc / 41294379000](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-4cc/README.md): Linux/macOS 894 EARS pass/no skips; Windows 890 pass/four FIFO exclusions. Only retained keyword relevance fails per OS. All seven worker ownership/corruption/repair cases, four Library/five Thread cases, five conversion groups and five process-death/publication points pass per OS. Windows full-suite random/watch models pass 22.964/24.625s under original 30s deadlines; the old a8 timeout is closed at this source, without a causal diagnosis. Linux converted API boots/restart/three live pack updates, SDK 1,330, API startup seven and recorded filesystem gates pass. This predates the later relation runtime changes. Library uses fake inference with manifest dimensions/model, not production-provider semantics or UI usefulness.
- [Managed corpus cd4 / 41293093217](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-cd4/README.md): all 21 safeguards and 1,800 independent-reference cases/recall means pass (minimum 0.95765625). Query-p95 meets 100ms at 10k and 200ms at 99.9k. The unchanged 16ms heartbeat fails all six 99.9k and three 10k groups. Three sampled read-only reopen passes preserve answers at each size; OS cache is uncontrolled and 99.9k reopened queries still reach 110.13ms. Phase snapshots retain process/reference/native-model costs, about 1,528 MiB cumulative pre-diagnostic peak at 99.9k and 1.939GB sampled logical open files including WAL. These are not isolated engine memory or peak allocated disk. All private/database scratch is removed. No causal total speedup or full resource acceptance follows.
- [Matched built-package f55 / 41288646196](../references/evidence/ears-sqlite-implementation-2026-10-28/remeasure-built-f55/README.md): three fresh processes per backend/OFF/FULL cohort; SQLite/native single-field ratios improve from 4.43x to 2.60/2.47x with three rather than four instrumented calls. Pages remain about 2.2x and small exact vectors about 9x slower. CPU models differ across current OFF/FULL and were absent from the prior receipt; no absolute cross-run or durability-overhead claim is justified. Keep the projection on qualified correctness/relative benefit, not a storage-speed win.
- [Hybrid/language cd4](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-cd4/README.md): both engines again pass all 25 frozen hybrid judgments/highlights with one English MiniLM model; keyword-only remains 24/25. The 214-section fixture and judgments stay frozen. Literal multilingual/feature tests and fake Library inference do not close supported-language, production-provider, actual UI/flow or model-variance usefulness requirements.
- Ordinary admission at 4ded: [value](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-value-4ded/README.md) OFF and [search](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-search-4ded/README.md) OFF/FULL pass six trials each; value FULL fails heartbeat in five of six. The [df0 trace](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-value-trace-df0/README.md) neither reproduces nor clears those failures. Latest-source sustained streaming/write/watch/admission and complete memory/disk/WAL/contention acceptance is still open.
- [Strict 7298 / 41251408078](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-partial-7298/README.md) retains the integration-2 dependency setup timeout at the original 240s and the keyword failure; the dependent assertions do not execute. [Focused 32d](../references/evidence/ears-sqlite-implementation-2026-10-28/dependency-focused-32d/README.md) passes the original five assertions with 101.897s setup but does not diagnose contention or close concurrent full-shard acceptance. Do not raise deadlines or substitute that isolated pass for final strict.
- [Source app 4a4b / 41257036820](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-984f/README.md) passes 33 scenarios with one packaged-only exclusion and no retries/flakes, including actual SQLite storage, API restart and pack/settings/reference flows; it predates rebase corrections. Earlier [signed macOS](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-455-signed-e2/README.md), [installed Windows/Linux](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-graph-eb74/README.md) and [Linux lifecycle](../references/evidence/ears-sqlite-implementation-2026-10-28/linux-lifecycle-cda/README.md) keep their original source/limits. Shared fixes landed in #299/#301; none qualifies later source by implication.

Keep the production ANN policy (32 probes, adaptive owner targets, bounded BQ fallback and exact supported fallbacks); no lower probes, projection shortcuts, opening-text/passage/per-field ranking changes or catalog-layout experiments are promoted. [WITHOUT ROWID](../references/evidence/ears-sqlite-implementation-2026-10-28/catalog-layout-control/README.md) and [sequence-rowid](../references/evidence/ears-sqlite-implementation-2026-10-28/catalog-sequence-control/README.md) controls show tradeoffs, not a runtime decision.

Recovery evidence covers explicit process termination, successful-sync/lost-acknowledgement regimes, kernel/application/driver readonly refusal and Linux CI-host filesystems at their documented scope. It does not certify physical power loss or arbitrary network/external filesystems. Broader active-worker I/O/corruption/resource/storage extremes remain open; the new real-worker malformed projections are a specific qualified regime. The approved Windows interactive VM diagnostic path was unavailable (Azure authentication refusal, SSH timeout); no security/VM state was changed.

[Previous handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-relation-resources/README.md) preserves all intermediate receipts and diagnosed failures; it is history, not another work plan or a scope waiver. The full unresolved requirements remain below.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The new `bench/sqlite/acquire-real-text.py` recipe prepares a private, full-shard-hash/row-ID verified join to that exact pinned source; the standalone join recipe remains unqualified, while the integrated full paired acquisition has passed. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current production source at 49ae. Text-only retrieval remains 24/25, including under the explicit stemming diagnostic; that judgment remains required. Complete language/search-feature coverage, production-provider and actual app-flow acceptance remain open.
3. Meet original foreground/admission/search/vector/resource budgets. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The 16ms/100ms/200ms budgets are unchanged. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../references/evidence/ears-sqlite-implementation-2026-10-28/frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.
