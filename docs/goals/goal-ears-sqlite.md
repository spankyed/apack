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

Source: isolated `/private/tmp/ears-sqlite-query-integration`, pushed only to `session/ears-sqlite`,
draft PR [#286](https://github.com/spankyed/apack/pull/286). Integrated master remains `461f7bf2cb`;
elmdb pin is `f496470679a7bd9764398108b20f62a73333c701`. Production stays on elmdb. No merge,
release, adoption or daily-profile migration is authorized. Compiler/full validation remains disposable.

The user explicitly retains synchronous app search and accepts foreground responsiveness degradation
for completion of this experiment. Preserve original heartbeat misses as measured failures with an
approved disposition, not passes. No async search API is being implemented. Keyword-only usefulness
remains 24/25 on both backends; English hybrid is 25/25. The separate keyword disposition question is
pending; no waiver or answer is assumed. Other requirements below remain intact.

Latest demonstrated results:

- [Ordinary managed corpus at b9896d5205](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-b989/README.md):
  all 1,800 queries verify independent canonical-vector truth; minimum mean recall is 0.95671875,
  above 0.95 at all depths/scopes/families. All original 100/200 ms query-p95 limits pass. Eight
  heartbeat groups still miss 16 ms and retain the approved degradation disposition. Actual packaged
  Scalar models reach ready at 10k/99.9k, 29 safeguards pass, three reopen passes per cohort reproduce
  answers, and private/database scratch cleanup verifies. At 99.9k, load/admission take 68.96/42.52 s;
  recorded logical storage is 1.94 GB and process high-water RSS reaches 1,571,764 KiB, including
  fixture/reference/harness memory. These are not pure engine costs or instantaneous disk bounds.
- [Current-runtime relevance at b9896d5205](../references/evidence/ears-sqlite-implementation-2026-10-28/relevance-b989/README.md):
  both backends pass all 25 frozen English hybrid judgments. Keyword-only stays 24/25 with and
  without English stemming. Both maintained validators reproduce the downloaded receipts byte-for-byte;
  private/model/database scratch cleanup passes. This is one pinned model; 141/239 inputs truncate
  at 256 tokens, so broader search coverage and the keyword disposition remain open.
- [Source app at 26c291d031](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-26c/README.md):
  all 33 eligible cases pass once, one packaged-only exclusion, zero failures/flakes/retries. Ten
  main-window role-discovery cases and testing-workspace typecheck pass, with the unit report retained
  outside Playwright cleanup. Previous navigation and ENOTEMPTY
  failures remain preserved. The final replay qualifies `1d25cbf2af`: its code-surface test observes
  the exact terminal.CLOSED event before directory removal, without a retry or longer existing deadline.
- [Strict consumers at 81e8ab4fe5](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-81-consumers/README.md):
  all four integration/native consumers pass. Host completes 613 files in 518.61 seconds under 600,
  retaining only keyword failure; six independent Electron smoke cases pass. Later dependent chain
  stages remain unproven. [Three-platform host/readiness](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-81/README.md)
  and [actual history EIO refusal/preservation](../references/evidence/ears-sqlite-implementation-2026-10-28/history-ae9/README.md)
  include the latest database-runtime repair: ambiguous generic CORRUPT refuses without quarantining
  an intact incumbent; NOTADB retains the documented quarantine path.
- [Packaged Linux/Windows](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-eb/README.md)
  pass native/API probes. [Signed macOS at 3ec277e393](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-3ec-signed/README.md)
  passes strict signing, post-sign native smoke and all six installed cases without exclusions/retries.
  Cleanup is observed at command/step scope; no notarized distribution claim.
- [Cold/warm reopen](../references/evidence/ears-sqlite-implementation-2026-10-28/cold-27/README.md)
  passes 80 actual-residency trials on one Linux host. [Opposite-order startup](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-48b/README.md)
  does not reproduce the earlier 55.69% gap; runner/order/drift prevent causal attribution. SQLite seed
  import remains slower. [Sustained checkpoint capacity](../references/evidence/ears-sqlite-implementation-2026-10-28/wal-c471/README.md)
  passes four cohorts and shows 765 MB controlled logical overlap, not instantaneous peak or power-loss certification.

Live check: integrated strict/platform run
[41385303835](https://github.com/spankyed/apack/actions/runs/41385303835) at `c5d6f3ea66` is running.
Its producer and three platform jobs are active; consumers must receive verified producer outputs.
Final source-app run `41383516309` is terminal success, including the terminal-exit wait. Corpus/relevance
run `41382184193` is also terminal success, with diagnostic responsiveness misses preserved. Do not
cancel/restart for an observation timeout. Preserve minimized final strict receipts, then reconcile
every remaining requirement and finish the completion report. No new heavyweight run is needed
without a changed input, failed check or unresolved concern.

The strict audit identified a concrete gap: the retained keyword failure stops app/rest before
pack-unit, packaged-authoring, external-pack app and smoke stages complete. The current workflow
runs those named stages independently after an actual failure, using existing strict producer
freshness checks and retaining the failed job. Its SQLite witness lives outside Playwright cleanup.
This closes no requirement until disposable qualification succeeds; no test is skipped and no
original failure or deadline is relaxed.

The [completion assessment and invariant/dependency review](../plans/ears-sqlite-contracts.md#experiment-completion-report-qualification-in-progress)
recommends retaining elmdb; experimental completion is not yet proven. [Earlier detailed handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-completion-audit/README.md)
retains all preceding receipts, negative controls, runtime decisions and historical next actions.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The new `bench/sqlite/acquire-real-text.py` recipe prepares a private, full-shard-hash/row-ID verified join to that exact pinned source; the standalone join recipe remains unqualified, while the integrated full paired acquisition has passed. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current candidate runtime at b9896d5205; its original numeric receipts are linked in the current handoff. Text-only retrieval remains 24/25, including under the explicit stemming diagnostic; that judgment remains required. Complete language/search-feature coverage, production-provider and actual app-flow acceptance remain open.
3. Meet original admission/search/vector/resource budgets; the user explicitly accepts synchronous foreground responsiveness degradation for experiment completion. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The original 16ms heartbeat results remain recorded as misses with an approved degradation disposition; 100ms/200ms query targets and resource accounting remain required. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../references/evidence/ears-sqlite-implementation-2026-10-28/frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.
