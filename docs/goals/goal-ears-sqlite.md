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

The full Scope, Decisions, Phases and Validation above remain required. Deliverable is [draft PR #286](https://github.com/spankyed/apack/pull/286), still unqualified. No adoption, candidate merge, release or daily-profile migration is authorized. Production remains on elmdb.

### Source and current corrections

Use `/private/tmp/ears-sqlite-query-integration`, detached HEAD published to `session/ears-sqlite`. The integration base is master `984f1b4aca6d99719a323ec779808def5b2d1c9b`, native pin `f496470679a7bd9764398108b20f62a73333c701`. [Rebase receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-984f/README.md) records preserved original history, the private-file conflict resolution and new relation-key reconciliation. Focused native-driver acceptance at c27 is recorded below; final combined acceptance remains pending. Rechecked remote master and rebased on 2026-11-01: already up to date at the same base and native pin; no source or dependency change resulted. Preserve the other agent's checkout, private publisher and frozen databases. The complete pre-rebase candidate is at `checkpoint/ears-sqlite-before-master-7eca-20261101` (`28e4aa13e4`); earlier checkpoints remain historical.

- Master relation-key reconciliation replaces relation `unique`, merges relinks by ends/key, preserves omitted info/weight and refuses duplicate updates. Moved edges take their new position. New byte/map/scalar-info and schema refusal regressions join master's shared/model contracts. The audit also reports unchecked duplicate identities and invalid keyed info using streamed endpoint-pair scans; a composite between index supports both writes and audit. Focused matching CI is the next closing check.

- Weighted master integration preserves the shared-method builder and structured transport. Weight validation, idempotent links, raw/dormant logical round trips, weighted rank seeds/PageRank/Leiden, schema and watch behavior have source-pinned focused/platform evidence. This is not complete acceptance of later source.
- Replacement closes its source before destination commit and retains primary/cleanup outcomes, including COMMIT_UNKNOWN and thrown undefined. [Actual-driver qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/replacement-focused-77c/README.md) passes all 13 commit-outcome cases at `77cbd28f38`, including watch/rollback and fresh reopen of committed/refused replacement outcomes.
- FTS execution-order hints count bounded global postings; actual matches retain candidate scope. Corrected scope regressions pass on Linux/macOS. The d027 corpus records the three sampled counts at 0.513ms combined, versus 35.317ms in the earlier scoped-hint receipt. Separate runs do not isolate an overall causal speedup.
- Scoped vector eligibility streams distinct members into indexed chunk/entity lookup before the 4,097-chunk threshold. [Old/new SQL controls](../references/evidence/ears-sqlite-implementation-2026-10-28/scoped-vector-probe/README.md) preserve exclusions, prefix limits, duplicate and empty sets. Current-source corpus preflight passes the actual driver safeguard files, including this regression, before acquisition; the completed c802 corpus receipt below retains latency and unresolved heartbeat results.
- Production vector targets remain 256 owners through K=32, 1,024 through K=40 and 2,048 through K=64, with 32 probes, exact small/unsupported/large-K paths and raw BQ target 256. Lower probes, owner-projection shortcuts and scratch opening-text/passage ranking changes are not promoted. [Negative ranking results](../references/evidence/ears-sqlite-implementation-2026-10-28/text-leading-diagnostic/README.md) retain all frozen judgments.
- The named graph verifier fixes its stale five-versus-six count. Independent recovery/app-smoke steps run after contract failures without waiving them; admission suites exclude unrelated generic app builds. Full corrected-source platform/app qualification remains required.

### Live validation and next closing checks

- New actual-worker corruption tests inject one-byte and valid-sized two-dimension derived normalized vectors into a 128-dimension generation, require native SQL refusal without canonical/commit/index mutation, repair from canonical bytes and retry the drained trainer. All seven training cases are named requirements in the next full platform receipt, replacing the stale exact-five count. They are source-only and not executed yet; broader worker I/O/storage/resource fault acceptance remains open. Current corpus source and measurement inputs are unchanged.

- Managed corpus run [41293093217](https://github.com/spankyed/apack/actions/runs/41293093217), source `cd4aaa8bfa`, is live with the corrected streaming safeguard and three sampled reopen passes. It retains production ANN settings, all original 1,800 reference cases and 16ms/100ms/200ms budgets. Observe this handle; preserve complete safeguards, timing/recall/resource/reopen and cleanup receipts before further dispatch. New preflight/reopen execution is not yet qualified.

- [Corpus run 41292503955](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-ed7-preflight/README.md), source `ed7a3cb3fc`, is terminal failure before private acquisition: 20 preflight cases pass, one order-dependent vector assertion fails (4,097 observed versus 4,098 assumed). Source now counts whether the excluded random owner was actually visited, retaining exactly 4,097 eligible chunks and adding an ordered-prefix exclusion answer check. The independent job again passes all 25 hybrid judgments on both engines; text-only remains 24/25 in all configurations, without waiver. No corpus timing/resource result exists for this run. Rerun after qualifying the corrected safeguard and new sampled-reopen harness; final current-source platform/strict/app/resource acceptance remains open.

- The next corpus harness now adds three sampled read-only reopen passes after its original warm measurements/diagnostics. Each must preserve warm IDs/scores for eighteen declared cases and records open/query/heartbeat/resources without exposing private answers. Protocol negative controls pass; actual execution is pending and is absent from live `ed7a3cb3fc`. This is uncontrolled OS cache, not cold-disk evidence or repeated full-corpus variance acceptance.
- [Corpus resource protocol](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-resource-protocol/README.md) now samples process/files after admission, after queries plus independent-reference work, and after diagnostics, with CPU provenance. Query memory attribution no longer includes later diagnostic/hash allocations. Pure protocol controls pass; representative current-run snapshots are still pending, and cumulative process peaks/sampled logical files do not qualify full app resources.
- [Multi-clause text prefix reuse](../references/evidence/ears-sqlite-implementation-2026-10-28/text-scope-reuse/README.md) now shares candidate-prefix evaluation in a statement-local materialized SQL CTE. Actual old/new generated SQL agrees on twenty-four scoped/global/empty, boolean, field, phrase, prefix, recency, parameter-order, limit and highlight cases; the two-clause observer drops from 52 to 26 visits. The actual-driver regression requires one prefix visit per candidate and is a named focused-CI witness. This is not a latency or heartbeat result: current-source driver qualification and representative time/memory/spill measurement are required before claiming improvement. [Focused actual-driver/type/API run 41291638787](../references/evidence/ears-sqlite-implementation-2026-10-28/focused-263/README.md), source `2636d7ec8e`, is terminal failure only on the retained keyword judgment on both backends. SQLite 408 pass/no skips; native 262 pass/146 SQLite-only exclusions. The strengthened scope witness, all required model/value/schema/graph witnesses, type/API checks with empty patch, WAL controls and all five matching-producer conversion groups pass. Representative corpus remeasurement remains required before claiming a performance benefit.

- [Completed corpus 41256553252](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-c802/README.md), `c80289641c`: 18 driver safeguards and 1,800 recall cases pass; query-p95 targets pass, but all 99.9k and both 10k all-live heartbeat groups fail. Private/database scratch is removed. This predates the rebase.
- [Completed source app 41257036820](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-984f/README.md), `4a4b7df5e5`: 33 pass, one packaged-only skip, no failures/flaky/retries; the real SQLite storage witness and lifecycle scenarios pass. This predates the rebase.
- [Focused 41283414283](../references/evidence/ears-sqlite-implementation-2026-10-28/relation-focused-091/README.md) is terminal failure at `0912810daf`: SQLite 299 pass/one retained relevance failure/no skips; elmdb 195 pass/two failures/103 SQLite-only skips. The extra failure exposed null optional-info semantics, now corrected in source. Package/API patch is empty; native routing and both WAL modes pass. Review found previous model harnesses always selected elmdb, so old model reports do not qualify SQLite. Current source selects/witnesses both real backends with independent bootstrap copies and requires fresh random/watch qualification alongside the later audit/index change. The prepared `sqlite-bench` dispatch measures matched fresh-process OFF/FULL cohorts only after those contracts converge; broader final-source strict/platform/app/packaging/resource gates remain required.
- [Completed focused 41284087723](../references/evidence/ears-sqlite-implementation-2026-10-28/relation-model-63e/README.md), `63e10f342f`: actual SQLite random and watch models, backend/isolation, optional-info, schema and relation audit witnesses all pass, under unchanged test budgets. SQLite 302 pass/one retained relevance failure/no skips; elmdb 198 pass/one failure/104 SQLite-only skips. Typechecking and package/API (empty patch), routing/graph and WAL controls pass. This closes the model-selection gap on this runtime source, not the full goal. Subsequent benchmark-only changes execute built JavaScript with selected-backend imports and matching typechecks; [protocol controls](../references/evidence/ears-sqlite-implementation-2026-10-28/benchmark-protocol-20261101/README.md) are not speed results.
- [Per-field FTS diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/text-field-normalization/README.md) still passes 24/25 with the original judgments. The unchanged top-five IDs do not support promoting separate per-field statistics; production ranking stays unchanged. The matched built-package benchmark below is now complete; the original text-only judgment remains required pending an explicit user decision. No answer has been inferred from the clarification question.
- [Matched built-package benchmark 41284740871](../references/evidence/ears-sqlite-implementation-2026-10-28/matched-built-470/README.md) is terminal success at `470c12dfdd`, all three processes per backend in each capped OFF/FULL cohort. Elmdb is faster on every timed task: SQLite field reads are 4.43x, 50-row pages about 2.25x, exact 1k-vector queries 8.79–9.20x, and settled watches 1.02–1.07x. SQLite sampled process RSS is lower, while WAL-inclusive open files are larger. Raw samples, variance/provenance and scope limits are preserved. This does not support adoption for speed on that fixture or waive app/heartbeat requirements. The later test-only checkpoint prepares actual read-only bind-mount/cross-process WAL qualification in Linux platform CI; parser and pure verifier negative controls pass, but the filesystem probe is not executed yet.
- [Terminal platform 41285552485](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a8/README.md), `a8fea73a34`: Linux/macOS each 881 EARS pass/four failures/no skips; Windows 876 pass/five failures/four FIFO exclusions. Common failures are relevance and three index-name-only assertions. Windows additionally times out in the actual random-model case at 32.575s against unchanged 30s; watch model passes. Do not reduce workloads/assertions or change its deadline. All three conversions reject native canonical ranks; source corrections and actual-producer focused validation are required before broad reruns. Linux real read-only mount and listed SDK/API/host/crash/CLI checks pass at their retained scope. Approved-VM power-state lookup is blocked by Azure authentication security defaults; no VM or auth settings were changed. Later projection/Map/schema fixes are not qualified by this older source.
- The subsequent single-field projection change joins only the requested overflow cell into its inline query, preserving the existing snapshot/schema/watch path. [Actual old/new generated SQL controls](../references/evidence/ears-sqlite-implementation-2026-10-28/projection-join-controls/README.md) pass eight projection shapes and corruption refusals; Node-driver/model/type qualification and performance remeasurement remain pending. Do not use the live platform run's older source to qualify this change.
- [Map boundary fixes](../references/evidence/ears-sqlite-implementation-2026-10-28/map-value-boundary/README.md) follow source-method controls reproducing Map relation-key collisions and invalid nested-value bypasses. Ordinary string-keyed Maps now canonicalize recursively, and ordinary relation infos are validated before identity lookup. Shared atomicity/value regressions await focused native/SQLite CI; unchecked relation repair loads retain their native semantics.
- [Completed focused 41287444996](../references/evidence/ears-sqlite-implementation-2026-10-28/focused-c27/README.md), `c27df5bb50`: SQLite 408 pass/one retained relevance failure/no skips; native 262 pass/one failure/146 SQLite-only exclusions. All real model/watch, projection/corruption, Map atomicity, graph access and canonical-rank witnesses pass. Matching-producer actual copied-profile conversion passes all five check groups; type/API checks pass with empty patch and WAL/routing/graph controls pass. This closes those diagnosed correctness/conversion failures on Linux, not Windows timing or the skipped downstream platform gates. Next remeasure the projection change before further optimization; original keyword/heartbeat/resource requirements remain.
- [Remeasurement 41288646196](../references/evidence/ears-sqlite-implementation-2026-10-28/remeasure-built-f55/README.md), `f55ecc3390`, completes both OFF/FULL cohorts. Single-field SQLite/native ratios improve from 4.43x to 2.60/2.47x; three driver calls replace four. Other gaps remain: pages about 2.2x, small exact vectors about 9x. CPU models differ between current OFF/FULL and were absent from the old receipt; preserve hardware/causality limitations. The field join is retained with correctness and measured relative benefit, without claiming SQLite now wins those reads.
- [Model seed preparation](../references/evidence/ears-sqlite-implementation-2026-10-28/model-wal-seed/README.md) now completes VACUUM backup journal setup once before copies, preserving empty data/logical sequence and all 120/40 workloads and 30s deadlines. The exact cause of Windows a8's timeout remains unproven. [Focused Windows-only run 41290696363](../references/evidence/ears-sqlite-implementation-2026-10-28/model-windows-592/README.md), source `592c1efac7`, is terminal success: all three original cases pass without skips; random model 13.833s and watch model 25.219s remain within original 30s deadlines. Complete reports/input hashes are preserved. This closes isolated Windows model qualification at that source, not full-suite concurrency or later text-prefix source qualification. VM Azure authentication is refused and pinned SSH times out, so no interactive VM changes were made.
- [Stable-sequence catalog control](../references/evidence/ears-sqlite-implementation-2026-10-28/catalog-sequence-control/README.md) tests reusing the existing sparse sequence as integer rowid without runtime changes. Small Python-only results reduce catalog bytes and owner lookup work but regress sampled page timing; they do not justify promotion or qualify app resources. Keep runtime fixed during current corpus measurement.
- [Catalog layout control](../references/evidence/ears-sqlite-implementation-2026-10-28/catalog-layout-control/README.md) shows a lookup/storage tradeoff and is not promoted. Do not change application layout based on this small Python-only probe.
- A subsequent test-only platform change explicitly includes the four existing Library search-index repository/SDK lifecycle cases alongside the five Thread query-work cases, with separate named required witnesses that also permit additional passing cases. They use fake inference with the actual manifest model/dimensions and cannot establish provider semantic/UI/scale acceptance. Their explicit current-source platform execution remains pending.

Do not dispatch another app-acceptance workflow while one is pending: the shared concurrency group can displace it. Poll live handles; do not cancel/restart them for observation timeouts. Fix actual failures and qualify affected cases before broadening. Keep the original budgets, assertions and scope. Once fixes converge, run the required final-source strict/platform/app/packaging/API/resource/operational gates; an isolated fixture pass or report replay does not replace them.

### Completed evidence and retained failures

- [Terminal strict 41251408078](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-partial-7298/README.md), `729867e787`: producer, both native shards and integration shard 1 pass. Integration 1 has 242 pass/no skips; native shards have 26 pass/two Linux ELF exclusions and 47 pass/26 Windows PE exclusions. Integration 2 exceeds the unchanged 240s dependency-graph setup deadline; its five assertions do not execute. App/rest is 6,919 pass/one retained relevance failure/84 skips. Linux/macOS EARS is 870 pass/one relevance failure; Windows is 866 pass/one failure/four POSIX FIFO exclusions. The old graph-count guard also fails. No strict consumers remain live.
- [Focused fixture 41254213388](../references/evidence/ears-sqlite-implementation-2026-10-28/dependency-focused-32d/README.md), `32d88574da`: all five original dependency-graph assertions pass without skips/retry; setup totals 101.897s versus 241.873s in strict, under the unchanged 240s deadline. No compiler/deadline change was made. This does not explain the contention or close concurrent full-shard acceptance; do not diagnose it with another broad retry.
- [Focused replacement 41255361459](../references/evidence/ears-sqlite-implementation-2026-10-28/replacement-focused-77c/README.md), `77cbd28f38`: SQLite 244 pass/one retained relevance failure/no skips; elmdb 195 pass/one failure/49 SQLite-only skips. All 13 commit-outcome cases, package/API with zero-byte patch, native-routing witness, graph probe and 78 inventory cases pass. Both real WAL modes pass write/unit/bulk/schema and disabled-injector controls; no physical power-loss or arbitrary-filesystem certification follows.
- [Current-master corpus 41253616659](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-d027/README.md), `d027345169`: all 1,800 independent Float64-reference cases and mean recall targets pass, minimum 0.96015625. Query p95 meets size targets; heartbeat fails every 99.9k group and both 10k all-live groups. Actual routing metadata identifies 20 sampled eight-probe K=64 BQ fallbacks; none of the sampled 32-probe cases falls back. All private/database scratch is removed. One warm model/pass is not cold/reopen/model variance, actual app load or complete resource acceptance.
- [Current-master usefulness](../references/evidence/ears-sqlite-implementation-2026-10-28/semantic-d027/README.md): all 25 frozen hybrid judgments/highlights pass on both engines with one pinned English MiniLM model. Text-only remains 24/25 with and without English stemming; the judgment is unchanged. Notes UI still uses title substring filtering, and these EARS results do not qualify production-provider/UI behavior.
- Ordinary [value](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-value-4ded/README.md)/[search](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-search-4ded/README.md) admission at `4ded696f79`: all six trials pass for value OFF, search OFF and search FULL under verified 2 CPU/6 GiB/no swap. Value FULL misses heartbeat in five of six. The [instrumented FULL trace](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-value-trace-df0/README.md) does not reproduce its long pauses, explain their cause or clear ordinary latency failures. Synthetic pending-vector admission is not managed-model or app-streaming load.
- Earlier [signed macOS](../references/evidence/ears-sqlite-implementation-2026-10-28/rebase-455-signed-e2/README.md), [packaged Windows/Linux](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-graph-eb74/README.md), [Linux conversion/API lifecycle](../references/evidence/ears-sqlite-implementation-2026-10-28/linux-lifecycle-cda/README.md) and [downstream report replay](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-report-replay-7298/README.md) receipts retain their exact tested source and limits. Shared fixes landed in #299/#301. None qualifies later source by implication.

The [contract/invariant and dependency review](../plans/ears-sqlite-contracts.md) records owned responsibilities and remaining proof. [Historical checkpoint details](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-scope-c802/README.md) preserve older receipts and failures; they are not another work plan or a waiver.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The new `bench/sqlite/acquire-real-text.py` recipe prepares a private, full-shard-hash/row-ID verified join to that exact pinned source; the standalone join recipe remains unqualified, while the integrated full paired acquisition has passed. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current production source at 49ae. Text-only retrieval remains 24/25, including under the explicit stemming diagnostic; that judgment remains required. Complete language/search-feature coverage, production-provider and actual app-flow acceptance remain open.
3. Meet original foreground/admission/search/vector/resource budgets. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The 16ms/100ms/200ms budgets are unchanged. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../references/evidence/ears-sqlite-implementation-2026-10-28/frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.
