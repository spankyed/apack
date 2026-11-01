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

Rebase check on 2026-11-01: fetched `origin/master` remains `461f7bf2cb`; `git rebase origin/master` reports up to date. Both master and candidate pin elmdb `f496470679a7bd9764398108b20f62a73333c701`; newer standalone elmdb commits have not been adopted by master. No pin bump was invented.

Deliverable is [draft PR #286](https://github.com/spankyed/apack/pull/286), still unqualified for adoption. Production remains on elmdb; no candidate merge/adoption, release or daily-profile migration is authorized. Every original Scope, Decision, Phase, Validation and unmet requirement remains in force.

### Source and isolation

Work only in `/private/tmp/ears-sqlite-query-integration`, detached HEAD published only to `session/ears-sqlite`. Integrated master is `461f7bf2cb`; elmdb remains pinned to `f496470679a7bd9764398108b20f62a73333c701`. The requested rebase preserves both master’s thread-readiness identity and the candidate’s storage-format identity. Other agents’ checkouts/builds are read-only. Local checks remain lightweight; compiler/full/native/app validation runs in disposable CI. Do not restart live jobs for observation timeouts or displace pending runs.

Latest implementation/test-control qualification is at `a4ad65f135`; later commits preserve evidence and add the unqualified CI-only worker read-error recipe below; production runtime remains unchanged. [Earlier detailed handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-projection-qualification.md) retains all previous sources, commands, failures and control receipts. Original pre-integration history remains at `checkpoint/ears-sqlite-before-master-7eca-20261101` (`28e4aa13e4`). Consolidating history changes no requirement.

### Current runtime corrections and proof

- Projected search hits hydrate final selected rows in one batch, with selective per-type reads, instead of one row-query/hydration cycle per hit. Returned entities are registered as dependencies so graph-ranked hit watches refresh after a title-only update. [Combined qualification 41350080975](../references/evidence/ears-sqlite-implementation-2026-10-28/projection-a4a/README.md) at `a4ad65f135` passes all 29 SQLite cost cases, the shared new watch case on both engines, all 114 host cases, EARS source/test types and zero API diff. Shared SQLite/native have 454/263 passes and only the original keyword failure, with zero/191 SQLite-only exclusions. Both real source-reversion controls fail their intended assertions and restore authored bytes/hash with clean git diff. Earlier [fixture failures](../references/evidence/ears-sqlite-implementation-2026-10-28/projection-233-fixture/README.md) and [abbreviated diagnostic rejection](../references/evidence/ears-sqlite-implementation-2026-10-28/projection-fef-control/README.md) remain preserved. No full latest-source acceptance is inferred.
- Known-single-type numeric ordering avoids redundant type discovery, preserves empty scope and actual cell/corruption validation, and retains discovery for mixed/unknown pipelines. [Focused ordering qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/ordering-126/README.md), [actual source mutation and repeated workload](../references/evidence/ears-sqlite-implementation-2026-10-28/sustained-1cf/README.md), and [rebased platform receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-470/README.md) verify its typed/mixed traversal and cost witnesses. Timing improvement is not isolated causally.
- Schema admission binds one writable owner and admits prospective declarations before registry/binding publication. Definite refusals preserve incumbent authority/files; fresh NOT_DURABLE/COMMIT_UNKNOWN preserves accepted identity and fails readiness. Scoped waits recheck relevant pack/dependency owners; boot/restore stay global. Real-peer refusal, actual installed-host, owner-race, native/SQLite write-unit and source-reversion witnesses are preserved in the history and [platform receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-f61-platforms/README.md).
- Earlier counter bounds, malformed metadata, canonical vector distance, relation identity/audit streaming, schema/recovery and subprocess ownership corrections remain implemented and source-pinned in the history and [contract/ownership review](../plans/ears-sqlite-contracts.md). Their older receipts do not qualify later code automatically.

### Full validation and operational evidence

[Current-runtime strict host/app receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-5cd-consumers/README.md) at `5cde3fc26d` completes all 612 host files in 304.7 seconds under the unchanged 600-second gate: 7,010 passes, the retained keyword failure and 95 exclusions. API/package/facade/external-pack-fork and the independent verified runtime build plus six Electron smoke cases pass. Later dependent chain steps remain unproven; integration-2 passes 580 cases/31 files with one Windows-only exclusion and a changed-input/no-stamp warning (chain 1,241.4 seconds); native-2 also passes 47 cases with 26 Windows PE exclusions/one excluded file and the same no-stamp warning (chain 1,404.0 seconds); integration-1/native-1 also pass (chain 1,995.5/1,714.2 seconds); all four shards are terminal. Timing differences across attempts are not a causal speedup.

[Current-runtime packaged Linux/Windows receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-b7b/README.md) pass at `b7bfb36671`: actual Electron 37.2.4, six native addons, SQLite 3.53.4 and all four Preview contract cases per platform without exclusions. This is unpacked unsigned native/API runtime, not renderer/installer/signature/performance acceptance. Only the goal handoff differs between `b7bfb36671` and `5cde3fc26d`; implementation/test inputs are identical.

[Completed current-runtime platform receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-5cd/README.md) at `5cde3fc26d`: Linux/macOS each pass 922 EARS cases (only the retained keyword failure), 312 host and 12 recovery cases, zero exclusions. Windows has 918 EARS passes/the same failure/four FIFO exclusions, host 309/six exclusions and recovery two/ten POSIX exclusions. Both new projection/watch regressions and all 29 cost cases pass everywhere. The producer passes; full strict consumers remain separate pending/live gates. These reports do not qualify the later CI-only fault/startup recipes or installed/resource requirements.

Latest combined-source validation targets `5cde3fc26de94a4e6bc2e5910e425aaa2190b735`: [full strict/platform 41351404379](https://github.com/spankyed/apack/actions/runs/41351404379) is terminal: all four integration/native shards pass, with the retained keyword judgment keeping the overall result failed, and [complete SQLite source-app 41351406783](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-5cd/README.md) passes all 33 cases once with one packaged-only exclusion, no unexpected failures/flakes/retries. These source-pinned jobs include the projected-hit fixes and corrected real control harness. [Packaged Linux/Windows 41351504768](https://github.com/spankyed/apack/actions/runs/41351504768) passes both platforms at `b7bfb36671` (only the goal handoff differs from `5cde3fc26d`; implementation and test inputs are identical). [Signed macOS 41353996620](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d2e-signed/README.md) passes at `d2e6f5f74e`: deep/strict signature verification, post-sign native smoke and all six installed cases pass once; the temporary-keychain cleanup step succeeds. Startup is now running after the corrected-fault run finished; concurrent admission/watch execution has completed with the native readiness limitation documented below. Keep the exact handles; later documentation-only checkpoints do not justify restarting them.

[Strict/platform run 41346286188](https://github.com/spankyed/apack/actions/runs/41346286188), source `4701bd839d`, predates projected-hit corrections. It is terminal failure only on the retained keyword judgment; its producer and all four integration/native consumers pass. [All three platform receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-470/README.md) retain only the keyword judgment: Linux/macOS each have 920 EARS passes/no exclusions, 312 host and 12 crash/recovery passes; Windows has 916 EARS passes/four FIFO exclusions, 309 host/six exclusions and two crash/recovery passes/ten POSIX exclusions. All 28 then-current ordering cases pass on each.

[Completed strict consumer receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-470-consumers/README.md): all 612 host files finish in 504.7 seconds under the unchanged 600-second ceiling (7,008 passes, one retained keyword failure, 95 exclusions). API/package/facade/external-pack-fork pass first; later dependent chain steps remain unproven. Its independent verified runtime build and all six Electron smoke cases pass once without exclusions/flakes/retries. The earlier f61 timeout does not reproduce, without a controlled causal explanation. Integration-2 passes 580 cases/31 files with one Windows-only exclusion. Native shards pass 26/two Linux ELF exclusions and 47/26 Windows PE exclusions. Integration-1 also passes all 242 cases/31 files without exclusions (chain 2,344.9 seconds). All four passing shards retain changed-input/no-reusable-stamp warnings. The older run is complete; preserve its receipts and inspect the newer combined-source handle.

The [complete source-app baseline](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-f61/README.md) passes 33 selected cases once at f61, one packaged-only exclusion, no unexpected failures/flakes/retries. [Packaged Linux](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-2d-linux/README.md), [Windows](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-2d-windows/README.md) and [private signed macOS](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-2d-signed/README.md) pass at `2d1307c672`, before numeric/projection corrections and the rebase. Private signing is without timestamp/notarization and is not distribution, renderer/resource or final-source qualification. Temporary signing keychain removal is verified.

### Performance, usefulness and retained failures

- [Real app-flow baseline](../references/evidence/ears-sqlite-implementation-2026-10-28/app-flows-50c/README.md), `50cf9d6980`: all 120 measured actions plus 30 warmups admit across both actual stores. Native/SQLite medians are 430.20/546.55 ms thread opening, 16.15/27.70 ms search and 786.10/847.20 ms deterministic streaming, with first-visible stream 144.3/218.0 ms. One warm native-first macOS process per scenario and different default durability prevent engine-only/tail/device/cold claims. This predates later runtime corrections.
- [Repeated durable write/watch](../references/evidence/ears-sqlite-implementation-2026-10-28/sustained-1cf/README.md), `1cf08f7ec0`: twelve fresh-process 60-second/20k-task cohorts under actual 2 CPU/6 GiB/no swap all converge. Closed-view medians are SQLite/native 4,463/2,812 commits/s; open-view 2,825/2,841. Ordered means are about 28.6/9.7 ms. SQLite heartbeat p99 passes all three closed cohorts but only one open cohort (14.70/16.12/27.88 ms against 16 ms); native passes open cohorts and misses closed ones. Maximum SQLite/native stalls reach 125.78/170.83 ms. The [prior baseline](../references/evidence/ears-sqlite-implementation-2026-10-28/sustained-bd4/README.md) has different rankings; cross-run timings do not isolate causal speedup. Preserve both current SQLite misses and all original budgets.
- [WAL/contention diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/wal-bd3/README.md), `bd3176dd25`: both 512-write FULL cohorts pass snapshot/current visibility, competing-writer refusal/reuse, checkpoint reclamation, reopen integrity and cleanup. Retaining a reader grows WAL to 59,843,032 bytes and blocks truncation; release truncates to zero. Sampled total logical peaks are released/retained 37,630,056/60,166,616 bytes. Heartbeat p99 is 3.61/0.90 ms, write p95 0.97/1.07 ms. Sub-half-second loops do not qualify long-duration/device, intra-commit peaks or physical power-loss behavior. The unintended extra general app-build job passed; future routing is fixed.
- [Paired managed Scalar/AVX2 corpus](../references/evidence/ears-sqlite-implementation-2026-10-28/paired-scorer-3ba/README.md) passes independent recall/query-p95 targets but misses nine/eight heartbeat groups against 16 ms. [Chunk-skew fallback](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-resources-045/README.md) preserves the winning last chunk but reaches 91.44 ms heartbeat p99 at 16,384 chunks. Owner caps do not bound canonical chunk work. Ordinary admission retains a 16.39-ms miss among 24 trials. No SIMD, recall, chunk, candidate, durability or budget waiver follows.
- Original keyword usefulness remains 24/25 on both engines: `generate-entries` misses its predeclared Generated files overview. English hybrid is 25/25 with one pinned MiniLM model; it does not replace the keyword/language/provider requirement. The clarification about hybrid judgment and proposed explicit asynchronous app-search acceptance path are unanswered. Do not implement that product change or relabel synchronous 16-ms failures as passing without approval.

A further existing fault requirement is now prepared as a focused CI-only checkpoint: `worker-read-fault.c` injects a descriptor-matched native worker `pread` EIO while excluding the foreground thread; the built-package probe must preserve canonical bytes/commit identity, refuse model publication, drain and retry successfully. Dependencies are CI-built packages, the trusted vector extension and Linux x64 preload execution. Closing checks require an actual recorded syscall/error, verified retry/foreground reuse and scratch cleanup. It uses the maintained `scenario` process bound; syntax alone proves no fault outcome. This adds no production code and does not supersede the live current-runtime gates or broaden physical-safety claims. Its [first focused qualification 41352778422](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-e165-compile/README.md), source `e1652e2fb4`, fails at test-shim compilation because fortified inline libc wrappers conflict with exported ABI interposition. No runtime or syscall fault executes. The correction disables those wrappers only in this test translation unit. [Second worker-I/O qualification 41354720706](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-b44-code/README.md), source `b44d338111`, compiles and executes but fails its incorrect IOERR/IOERR_READ expectation when SQLite returns IOERR_CORRUPTFS. Original diagnostics were captured too late to retain the syscall witness; preservation/retry assertions do not execute. The corrected probe captures diagnostics first and requires SQLite Unix VFS’s exact EIO mapping plus all original preservation/retry conditions. [Corrected worker runtime qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-0cc/README.md) at `0cc749e7f3` now passes: actual non-main-thread EIO on the 100-byte database header read, unchanged canonical bytes/commit identity, no publication, successful 512-sample retry, foreground reuse and scratch cleanup. This is open-time read failure, not a mid-training or complete worker/resource witness; preserve both failed attempts. A two-phase CI-only extension is prepared: checkpoint the fixture before injection, select the canonical embedding table's actual root-page offset, and require a descriptor-matched non-main-thread read at that page after successful reads. It runs the original header case in a separate process too and retains all canonical/no-publication/retry/foreground/cleanup assertions. Syntax checks alone do not prove this new page-read case, and it cannot attribute failure to vector compute or certify physical/storage regimes. Its focused execution is now queued at the exact handle below, after corrected startup was confirmed running.

The existing populated-startup controller is prepared for an additional `sqlite-startup` CI checkpoint: both actual store identities are verified in seed/per-launch manifests, and the controller keeps its five warmups/twenty fresh-process copied-profile trials per backend. Dependencies are the normal disposable app build, existing provenance helper and maintained capture/invocation admission. Closing checks require complete admitted raw runs, verified storage labels and minimized numeric reports. These are warm-filesystem reopening measurements, not cold-disk/device or a new budget. Execution is live at the exact handle below; retain the completed worker-I/O witness. Production runtime is unchanged.

[Concurrent admission/watch qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-watch-a538/README.md), run `41357469774` at `a53808db08`, completes all six capped 60-second/20k-task views-on cohorts with final convergence/latest-rank lookup. SQLite logical readiness takes 1.85–2.03 seconds with 625 intervening durable foreground writes per trial; phase heartbeat p99 is 10.11–12.14 ms, maxima 69.79–81.79 ms. Native adapter `indexesReady` is currently an immediate Promise, so its reported ready times do not prove physical backfill completion/overlap and must not be compared as admission speed. A native-adapter repair is implemented but not CI-qualified: explicit waits poll native `indexStatus` asynchronously, scope failures/declarations by type, and settle on open-unit refusal, supersession, reset/replacement or close. Adapter regressions exercise the former immediate-resolution hole and cleanup; a lightweight dependency-free helper check passes, while matching types/native/shared and repeated real admission measurement remain required. Matching-source full strict/platform qualification [41359584043](https://github.com/spankyed/apack/actions/runs/41359584043) at `790acc5a33` remains live. Its [completed three-platform receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-790/README.md) passes all eight new adapter cases, matching types/API, 930 EARS cases/one retained keyword failure/no exclusions, 312 host, 1,330 SDK and 12 recovery cases. The verifier still refuses the retained relevance failure; Both Linux and macOS pass all eight readiness cases, 930 EARS cases/the retained keyword failure, 312 host and 12 recovery cases; Windows also passes all eight readiness cases, with 926 EARS passes/the same relevance failure/four FIFO exclusions, host 309/six exclusions and recovery two/ten POSIX exclusions. All platform jobs are terminal; strict consumers and real builder admission remain separate gates. Qualify this repair before comparing build completion; the signed/packaged/runtime receipts above predate this native-adapter correction. This discovered evidence gap does not invalidate the final correctness witness or waive any requirement.

Corrected worker-I/O/API [41358564039](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-0cc/README.md) is terminal at `0cc749e7f3`: the worker probe passes; only the retained shared keyword judgment fails. [Initial startup qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-10d/README.md) at `10d46d09af` is terminal: native five warmups/twenty measured trials admit (median 5,390.25 ms), while SQLite seed import hits the five-second assertion poll with zero observed threads; zero SQLite trials run. Seed setup now uses the existing search/import page-completion wait and records setup import duration outside startup measurement; successful SQLite import remains unproven until rerun. Automatic review rejected a later admission dispatch while startup remained queued; no dispatch occurred then. After authoritative status showed startup actually running on its runner, repaired-adapter admission [41359882808](https://github.com/spankyed/apack/actions/runs/41359882808) was safely queued at `00924f39fc` and is now terminal; its measured result is recorded below. Corrected startup [41361438525](https://github.com/spankyed/apack/actions/runs/41361438525) is queued at `37463f9422` after verifying that slot was free; it also includes the native-readiness repair. Corrected startup is now confirmed running; the free pending slot safely holds two-phase worker/API qualification [41362252572](https://github.com/spankyed/apack/actions/runs/41362252572) at `2c70e523e7`. No run was displaced. Preserve these exact handles; source/runtime acceptance still depends on the repair's matching strict/platform run and actual new measurements.

[Repaired native admission comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-watch-009/README.md), run `41359882808` at `00924f39fc`, is terminal with all six cohorts converged and both builders completing during foreground writes. SQLite observed readiness is 0.84–0.93 seconds with 625 intervening durable writes; native actual status is observed in 20.70–21.68 ms with 33–34 writes, including its 10 ms polling delay. SQLite admission-phase/whole-run heartbeat p99 meets 16 ms in all three cohorts; native phase samples are short and its whole-run p99 misses in all three. Ordered-read means remain SQLite 30.96–31.11/native 9.62–9.80 ms. This repairs the earlier comparison's readiness evidence, not all foreground/resource criteria. [Current strict integration-2](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-790-consumers/README.md) passes 580 tests/31 files with one exclusion and a changed-input/no-stamp warning; native-1 also passes 26 cases/eight files with two Linux ELF exclusions/one excluded file (chain 1,097.3 seconds), retaining the same no-stamp warning. Native-2, integration-1 and app-and-rest remain live.

### Next closing work

1. Preserve the now-complete original strict receipts, including integration-1. Qualify combined corrected source with full strict/platform and complete source-app gates; then current installed/signing/API behavior. Do not count narrow controls or older source receipts as final-source acceptance.
2. Meet original usefulness/recall/responsiveness budgets and finish representative language/provider/model/UI coverage. The execution decision remains open; pursue only authorized semantics-preserving changes until it is resolved.
3. Finish cold/reopen/update/device variance, sustained admission/read/write/watch/app contention, peak memory/disk/WAL/ingestion and remaining active-worker/storage fault extremes. Process death and injected I/O errors do not certify physical power loss or arbitrary filesystems.
4. Reconcile the [phase/invariant/adoption review](../plans/ears-sqlite-contracts.md) against actual final evidence, preserving every requirement below. Production terminal-service natural-exit cleanup remains a separate unresolved concern. Keep draft status and production on elmdb until complete review and an explicit adoption decision.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The new `bench/sqlite/acquire-real-text.py` recipe prepares a private, full-shard-hash/row-ID verified join to that exact pinned source; the standalone join recipe remains unqualified, while the integrated full paired acquisition has passed. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current production source at 49ae. Text-only retrieval remains 24/25, including under the explicit stemming diagnostic; that judgment remains required. Complete language/search-feature coverage, production-provider and actual app-flow acceptance remain open.
3. Meet original foreground/admission/search/vector/resource budgets. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The 16ms/100ms/200ms budgets are unchanged. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../references/evidence/ears-sqlite-implementation-2026-10-28/frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.
