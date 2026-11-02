# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master 461f7bf2cb
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

The [pre-keyword input-equivalence audit](../references/evidence/ears-sqlite-implementation-2026-10-28/final-runtime-inputs/README.md)
remains dated evidence for its recorded tip. The new compound-query correction changes shipped
runtime input `src/sqlite/text.ts`; earlier integration/corpus/installed results retain their original
source and do not qualify this changed execution. Requalify the affected search and app behavior.

Current checkpoint: complete original keyword acceptance without changing its query, expected answer or top-five threshold. Passage-only source `373bf288c6` passes SQLite unstemmed 25/25 but regresses English to 24/25 (case 6 rank 13). [Preserved terminal failure](../references/evidence/ears-sqlite-implementation-2026-10-28/passages-373/README.md). It passed the production EARS build, then the hard gate stopped execution; no following contracts or inference ran.

Runtime `a91c0b0d5c` keeps independently normalized bounded leading passages (256 UTF-16 units, whitespace boundary, weight 3) beside each full source. It adds an unstemmed external-content FTS companion only for English indexes, sharing source bodies instead of storing them twice. For positive unquoted compound tokens, literal compound coverage ranks before Porter-only matches, with monotonic BM25 within each tier and recency afterward. Membership, phrase boundaries, scopes and winner-only highlight fetching remain native. No fixture-specific constants, raw-body scan, JS ranking or vocabulary transfer is introduced. Explicit empty field selection now searches no fields.

Derived text revision 3 admits replacement generations on writable reopen; obsolete read-only opens refuse with INDEX_BUILDING. Lifecycle changes cover companion insertion, removal before shared-content deletion, clearing, bounded retirement and reset. The private-snapshot audit compares companion postings against original stored text using native external-content integrity checking. Primary values and logical commit identity remain authoritative and unchanged by regeneration.

[Run 41477975796](https://github.com/spankyed/apack/actions/runs/41477975796) qualifies runtime `a91c0b0d5c`; inspect its actual status before dispatching another app workflow. Test-only descendant `cded08de00` additionally constructs the real English revision-2 passage layout without a companion, verifies read-only nonmutation/writable upgrade and retirement, and extends the exact-old-source counterfactual from three to four required named assertion failures. These added checks are not executed by the earlier run and need current-source qualification.

Closing checks: unchanged original 25/25 SQLite keyword gate in both none/English configurations; original frozen shared spec and existing search contracts; generic leading-passage ranking and truncation safety; compound literal/stem ordering with recency, updates and deletion; both storage upgrade paths; leading and companion corruption/rebuild; and exact-old-source assertion failures with verified source restoration. The hard keyword measurement precedes expensive inference. The relevance job builds the normal EARS native assets. Full strict/app/platform/corpus qualification remains required for changed runtime; earlier receipts preserve their original source scope. Local checks are syntax/metadata only; compiler/native/runtime tests remain disposable. No acceptance waiver or completion claim follows from an active run.

A minimal two-file elmdb written-word fuzzy patch is prepared in
`/private/tmp/ears-native-written-fuzzy.patch` against f496, with source hashes in the adjacent
JSON and recipe `/private/tmp/ears-prepare-native-keyword-patch.py`. It is not applied, compiled,
committed or pushed to elmdb; the shared checkout is unchanged. It addresses the distinct English
baseline typo via the existing pruned written-word dictionary, not the unstemmed ranking miss.
No stop/waiver decision is pending; the user explicitly requires completing the original goal.

The user explicitly retains synchronous app search and accepts foreground responsiveness degradation
for completion of this experiment. Preserve original heartbeat misses as measured failures with an
approved disposition, not passes. No async search API is being implemented. Keyword-only usefulness
remains 24/25 on both backends; English hybrid is 25/25. The user requires fixing the original keyword judgment; it remains required. Other requirements
below remain intact.

**Watch correction:** the newly exercised pack-unit stage at c5d6f3ea66 exposed three unnecessary
open-thread view reruns (988 passes, one failure, two exclusions). [Original failure evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/pack-scope-c5d-failure/README.md)
is preserved. Correction `cd8b413fa8` scopes ID/type/typed-hop dependencies and preserves untyped/deep
reachability. [Its actual Linux control](../references/evidence/ears-sqlite-implementation-2026-10-28/watch-scope-cd8/README.md)
passes all 31 watch and six real thread-view cases on each backend, including the original metric
case. Four precision guards fail against the exact old c5d6f3ea66 module; both source blob hashes
and byte-for-byte restoration verify. [Corrected three-platform EARS](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-cd8/README.md)
now pass 935 cases on Linux/macOS and 931 on Windows, retaining only keyword failure and the four
original Windows exclusions. [Integrated qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-061-consumers/README.md) now passes all 989 eligible pack units with two original exclusions, including the actual thread-view file; all five remaining stages pass. This closes the demonstrated watch regression without hiding the retained keyword failure or new integration timeout.

Latest demonstrated results:

- [Corrected-source packed authoring](../references/evidence/ears-sqlite-implementation-2026-10-28/packaged-061/README.md)
  at 06106d18dd succeeds: public tarballs build and typecheck outside the workspace, seven producer
  harness cases and two app cases pass, actual installed archive identity matches, and packed CLI
  offline query/export verifies written data under explicit SQLite selection. This is source-host
  packed tooling/archive integration; installed/signed app distribution keeps its separate scope.
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
- [Source app at d2684393ec](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-d268/README.md):
  all 33 eligible cases pass once, one packaged-only exclusion, zero failures/flakes/retries. Ten
  main-window role-discovery cases and testing-workspace typecheck pass, with the unit report retained
  outside Playwright cleanup. Previous navigation and ENOTEMPTY
  failures remain preserved. The final replay qualifies `1d25cbf2af`: its code-surface test observes
  the exact terminal.CLOSED event before directory removal, without a retry or longer existing deadline.
- [Corrected-source integrated strict](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-061-consumers/README.md) at 06106d18dd:
  producer, both native shards and integration-2 pass. Host completes 613 files in 482.66 seconds
  under 600, with 7,029 passes, one keyword failure and 95 exclusions. Integration-1 reports 199 passes
  and one 200 s dependency-publication timeout in attempt 1, leaving three files uncompleted. [Attempt-2 full replay](../references/evidence/ears-sqlite-implementation-2026-10-28/integration-061-replay/README.md) now passes all 242 tests/31 files on the unchanged source, including the formerly timed-out case in 130.719 s. The original failure and its unexplained timing variance remain recorded.
  All five separately executed remaining stages pass: pack 989/two exclusions, authoring producer seven,
  authoring app two, external-pack/fork 32 passing executions and smoke five. Six independent explicit
  SQLite Electron/storage cases pass, and their report survives later output cleanup.
  [Matching three-platform results](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-061/README.md) retain only keyword failure and
  original Windows exclusions. [Actual history EIO refusal/preservation](../references/evidence/ears-sqlite-implementation-2026-10-28/history-ae9/README.md)
  separately proves intact-incumbent refusal/reopen; routing tests alone do not prove syscall outcomes.
- [Packaged Linux/Windows at d795901191](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d795/README.md)
  pass native/API probes. [Signed macOS at d795901191](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d795-signed/README.md)
  passes strict signing, post-sign native smoke and all six installed cases without exclusions/retries.
  Cleanup is observed at command/step scope; no notarized distribution claim.
- [Cold/warm reopen](../references/evidence/ears-sqlite-implementation-2026-10-28/cold-27/README.md)
  passes 80 actual-residency trials on one Linux host. [Opposite-order startup](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-48b/README.md)
  does not reproduce the earlier 55.69% gap; runner/order/drift prevent causal attribution. SQLite seed
  import remains slower. [Sustained checkpoint capacity](../references/evidence/ears-sqlite-implementation-2026-10-28/wal-c471/README.md)
  passes four cohorts and shows 765 MB controlled logical overlap, not instantaneous peak or power-loss certification.

The corrected-source [app-flow/UI checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/app-flows-275/README.md) now succeeds:
six cohorts admit 120 measured actions/30 warmups; ten retained Playwright report files hold 58
passing app cases (streaming has 25 parameterized cases per store). All four search controls pass
once on verified stores, without exclusions/flakes/retries. The two renderer-refusal capture indexes
remain failed: forty measured/fifty total intentionally incomplete captures, with correct UI results.
The original 200 raw trial hashes/sizes are independently verified; scalar/resources and source/build
metadata are retained without private profiles/traces/configuration. Script/test typechecks and
provenance checks pass. This qualifies the named UI flows and controls, not broad provider/model
usefulness or every resource/fault regime; no responsiveness gate is relabelled as passing.

The native allocation/refusal checkpoint is now qualified in its selected Linux/glibc scope.
The [populated-WAL receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/allocation-5cf/README.md)
proves actual vec1TrainFinal worker ENOMEM/SQLITE_NOMEM, a 57,712-byte blocked WAL followed by
zero-byte reclamation after worker exit, unchanged canonical bytes, only the explicitly intended
foreground commits, no failed-attempt model publication, 512-sample retry, reuse and cleanup.
Original header/page/history fault phases still pass. No ordinary native artifact or production
API changed. This serves the phase-6 selected active-worker resource-failure requirement; it is
not OS/cgroup OOM, arbitrary/mid-kmeans failure, total-memory bounds or physical power-loss proof.

The independent ordinary managed corpus repetition is now complete in its recorded scope.
The [original reports and reproducible comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-repeat-94cf/README.md)
verify all 1,800 queries/18 groups, minimum mean recall 0.95203125 against 0.95 and all original
query-p95 limits. Eight heartbeat groups retain the accepted degradation. Sealed payload/native/
Node/policy identities match b989; model hashes differ, and oracle report hashes also differ.
This provides a second observed model/run result, not controlled causality or general variance
certification. Load/admission, resource snapshots, three reopens per size, 29 safeguards and
private cleanup are recorded. The frozen keyword judgment and broader acceptance remain open.

Current validation handles and results:

- [Independent prefix-passage ranking and original keyword hard gate 41473096670](https://github.com/spankyed/apack/actions/runs/41473096670)
  is active at `373bf288c6`. Text revision 2 uses at most one separately normalized prefix per
  long source string, with the unchanged 256-unit cap and weight 3. Full sources preserve phrase
  semantics, audit compares portions, and old layouts require writable regeneration. No current
  keyword/safety pass is inferred from the failed leading-column attempt.

- [Bounded leading-text ranking and original keyword hard gate 41469187700](https://github.com/spankyed/apack/actions/runs/41469187700)
  is terminal failure at `a9e415aad4`: original unstemmed keyword remains 24/25, case 6 rank 7;
  English SQLite is 25/25. [Original reports](../references/evidence/ears-sqlite-implementation-2026-10-28/lead-column-a9/README.md)
  preserve the hard failure. Safety/contracts/counterfactual/inference stages were skipped afterward.
  The next source revision uses independent bounded-passage normalization, with unchanged cap/weight.

- [Compound/Unicode correction and pinned old-source control 41464298033](https://github.com/spankyed/apack/actions/runs/41464298033)
  is terminal success at `cf5d7b4800`. [Verified reports](../references/evidence/ears-sqlite-implementation-2026-10-28/compound-cf5/README.md)
  prove 93 ordinary search passes and both exact old-source failures/restoration. SQLite English
  keyword usefulness is 25/25; the original unstemmed gate remains 24/25 (case 6 rank 12). Hybrid
  remains 25/25 on each backend. No original query/target/threshold changed.

- [Compound-query fix and original relevance qualification 41462773196](https://github.com/spankyed/apack/actions/runs/41462773196)
  is terminal failure at `eed73e4071`: typecheck and all 92 selected search contracts pass,
  including both new compound regressions. The counterfactual never ran: its historical commit
  was absent from the shallow checkout. Relevance was skipped. [Original report and failure disposition](../references/evidence/ears-sqlite-implementation-2026-10-28/compound-eed-control-failure/README.md)
  retain this limitation. The workflow now fetches the exact commit before source replacement.

- [Original keyword ranking diagnostics 41460757710](https://github.com/spankyed/apack/actions/runs/41460757710)
  is terminal success at `4566270bf78e8d9290c92ff46f197e4fbdbeca25`. The frozen fixture is unchanged.
  Numeric failure diagnostics compare limited/unlimited ranks, scores and highlight positions on
  both backends and both stemming modes; no query, target or top-five threshold was relaxed.

- [Independent ordinary managed corpus repetition 41413055256](https://github.com/spankyed/apack/actions/runs/41413055256)
  is terminal success at `94cf2eeac6`. Packaged/managed/production inputs are explicit; no diagnostic override.
  [Verified corpus reports](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-repeat-94cf/README.md)
  retain passing recall/query-p95, accepted heartbeat misses and independently trained model outcomes.
  The separate relevance job succeeds: [verified original receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/relevance-94cf/README.md)
  repeat hybrid 25/25 on each backend and keyword 24/25 in all four backend/stemming groups.
  Fixture/vector/model identities match b989; both validators reproduce original summaries byte-for-byte.

- [Populated-WAL allocation/refusal check 41411063927](https://github.com/spankyed/apack/actions/runs/41411063927)
  is terminal at `5cf602ce3b0c6b0323ef1db56c277c895b7314f4`: allocation/WAL and all other named
  operational steps pass. Shared suites retain only the keyword judgment failure on each backend.
  [Original reports and verified receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/allocation-5cf/README.md)
  preserve the exact failures, commit accounting and reader-release evidence.

- [Native allocation/refusal and existing API fault checks 41408228347](https://github.com/spankyed/apack/actions/runs/41408228347)
  at `517bd80dc5` are terminal. The allocation, header/page and history fault steps pass; the
  shared-suite step retains only the known keyword failures (SQLite 459 passes, elmdb 268 passes).
  [Original allocation evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/allocation-517/README.md)
  proves SQLITE_NOMEM, preservation and retry. Its empty-WAL checkpoint does not independently
  prove reader release. Protocol v2 holds the actual native worker, commits one foreground row,
  requires populated WAL reclamation to be busy before refusal and successful afterward, and
  accounts for that foreground commit separately. No production/native artifact was changed.
- Final database-runtime packaged qualification at `d795901191` (program identical to cd8):
  [signed macOS 41399250308](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d795-signed/README.md) and
  [Windows/Linux 41399303818](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d795/README.md) succeed.
  macOS passes strict signing, post-sign native smoke and six installed lifecycle cases; both x64
  probes pass actual packaged Electron/native/API execution and four preview contracts per OS.
  Source/native/provenance and original reports are retained. No local build, signing or compiler run.
- [Corrected-source app flows and UI controls 41401869473](https://github.com/spankyed/apack/actions/runs/41401869473)
  at `275b6fac3d` succeed, with the independently checked receipt above. Earlier handles, including the original keyword diagnostics, are terminal; the corrected compound/Unicode qualification above is also terminal; leading-text ranking is now active. Strict still retains the unwaived keyword failure.
- [Integrated strict 41391989615](https://github.com/spankyed/apack/actions/runs/41391989615)
  at `06106d18dd`: attempt 1 is terminal failure with the exact independent successes/failures above.
  [Attempt 2](../references/evidence/ears-sqlite-implementation-2026-10-28/integration-061-replay/README.md) reruns only integration-1 on the same source and passes all 242 tests/31 files. All other job outcomes remain retained; root keyword failures still keep the overall workflow red.
- [Focused unchanged integration test 41397716324](https://github.com/spankyed/apack/actions/runs/41397716324)
  at `733294618a` is terminal success: [the unchanged case passes in 61.06 s](../references/evidence/ears-sqlite-implementation-2026-10-28/integration-733-focused/README.md), under the original 200 s deadline. Git verifies documentation-only differences from the failed source. This does not establish the timeout cause; the separately retained attempt-2 full shard above now passes.
- [Explicit SQLite packaged authoring 41392105607](https://github.com/spankyed/apack/actions/runs/41392105607)
  at `06106d18dd` and [full app 41395988057](https://github.com/spankyed/apack/actions/runs/41395988057)
  at `d2684393ec` are terminal success, with their separate receipts above. Both include cd8's correction.

Previous integrated run `41385303835` at c5d6f3ea66 is terminal: producer and all four integration/native
consumers pass; host retains keyword failure and the independent SQLite witness passes; pack units
expose the now-focused-corrected watch regression and stop later authoring/app stages. Its original
three-platform results retain only keyword failure. [Explicit SQLite external-pack run](../references/evidence/ears-sqlite-implementation-2026-10-28/external-bb35/README.md)
passes all 28 cases at bb35e86c7f, before this dependency correction. No source-app, corpus or installed
receipt is silently promoted to execution of a later revision.

Do not cancel/restart an existing handle for observation timeout. Inspect actual live steps before
adding any pending app run. Collect corrected-source results and reconcile every remaining requirement
before experimental completion; only foreground responsiveness has an approved degradation disposition.

The strict audit identified a concrete gap: the retained keyword failure stopped app/rest before
pack-unit, packaged-authoring, external-pack app and smoke stages complete. The current workflow
runs those named stages independently after an actual failure, using existing strict producer
freshness checks and retaining the failed job. Its SQLite witness lives outside Playwright cleanup.
Disposable run 41391989615 now qualifies these stages; the full integrated chain retains its original
keyword failure; the separate integration timeout has a passing unchanged full-shard replay.
The original timeout and its unresolved cause remain recorded. No failure or deadline is relaxed.

The [completion assessment and invariant/dependency review](../plans/ears-sqlite-contracts.md#experiment-completion-report-qualification-in-progress)
recommends retaining elmdb; experimental completion is not yet proven. [Earlier detailed handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-completion-audit/README.md)
retains all preceding receipts, negative controls, runtime decisions and historical next actions.

The [commit-outcome audit](../references/evidence/ears-sqlite-implementation-2026-10-28/commit-outcome-audit/README.md)
now source-verifies 69 platform refusal/rollback/ambiguity test executions and eight actual WAL
sync/process-death cases, plus two disabled-injector controls. All four post-sync EIO-return
families report COMMIT_UNKNOWN, fence reads, and reopen with the committed result. The broader
storage-error requirement below remains open; process death is not physical power-loss proof.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The exercised `bench/sqlite/acquire-real-vectors.py --with-text` path emits text, identities and vectors together; its full pairing validator checks every identity and all four original sealed file digests. The unused standalone re-download/join helper was removed instead of maintaining an unqualified second acquisition format. This does not waive any pairing, usefulness or performance requirement. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current candidate runtime at b9896d5205; its original numeric receipts are linked in the current handoff. Text-only retrieval remains 24/25, including under the explicit stemming diagnostic; that judgment remains required. [The current three-platform search feature audit](../references/evidence/ears-sqlite-implementation-2026-10-28/search-features-061/README.md) verifies 80 named passing SQLite contracts per OS, including literal multilingual highlights, identifiers/phrases/lists/fields/boolean/recency/prefix, bounded typos and unsupported language/analyzer refusals. This proves those declared feature cases; broad multilingual semantic usefulness, production-provider/model variance and broader semantic/provider-specific UI acceptance remain open. The current-query thread search, actor supersession/cancellation and capture-refusal UI paths now pass the app-flow checkpoint above.
3. Meet original admission/search/vector/resource budgets; the user explicitly accepts synchronous foreground responsiveness degradation for experiment completion. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The original 16ms heartbeat results remain recorded as misses with an approved degradation disposition; 100ms/200ms query targets and resource accounting remain required. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../references/evidence/ears-sqlite-implementation-2026-10-28/frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.

### Keyword correction continuation: literal compounds

Run [41473096670](https://github.com/spankyed/apack/actions/runs/41473096670) is terminal failure: SQLite unstemmed now passes 25/25, English 24/25 (case 6 rank 13). No fixture or acceptance threshold changed. Contracts and inference were skipped by the hard gate; earlier receipts do not qualify this runtime. Preserved evidence: `docs/references/evidence/ears-sqlite-implementation-2026-10-28/passages-373/`.

The current implementation adds an external-content unstemmed FTS companion for English indexes: stored bodies are shared, native postings distinguish literal unquoted compounds from stem-only matches. Literal compound coverage precedes BM25 within each tier; recency applies afterward. Matching, explicit phrase membership, scope and winner-only highlights retain their existing execution. Text storage revision 3 triggers writable generation replacement; retirement remains version-aware. Index deletion/reset, native semantic integrity checks and regressions accompany the change. This revision remains unqualified until CI runs the original hard gate and all following checks. Foreground responsiveness misses remain explicitly accepted degradations; the keyword gate is not waived.

Active qualification: [41477975796](https://github.com/spankyed/apack/actions/runs/41477975796), runtime `a91c0b0d5c`. Previous passage-only run is terminal failure, not active. Await original keyword, contracts, counterfactual and hybrid results before broader runtime qualification.

Additional closing regressions construct the actual English revision-2 passage layout without a companion, prove read-only refusal does not change the database file, and verify writable reconstruction, unchanged logical sequence and retired-object cleanup. The old-source counterfactual now also requires the literal-ranking assertion to fail (four named assertion failures total), with source restoration verified. These additions require their own CI execution.

Run 41477975796 failed before keyword execution: package compilation found the obsolete private `SqliteSearch.table` helper unused after clear delegation (TS6133). No keyword/contracts/inference result exists for that run, and its artifact step had no reports to upload. Strict 41478591499 on the same runtime was cancelled as superseded by this deterministic compile correction, not retried for a timeout. The helper is removed; requalification remains required.

### Keyword gate passes; native audit layout correction

[Run 41478710010](https://github.com/spankyed/apack/actions/runs/41478710010) passes the unchanged SQLite keyword gate 25/25 in both language configurations, builds EARS and typechecks source/tests. Of 125 selected contracts, 122 pass; three new English audit/upgrade/lifecycle cases fail at native integrity-check over virtual content. Counterfactuals and inference are skipped. [Preserved disposition](../references/evidence/ears-sqlite-implementation-2026-10-28/literal-34/README.md).

SQLite 3.53.4's FTS5_STMT_SCAN uses SQLITE_PREPARE_NO_VTAB. Revision 4 moves shared source strings to an ordinary document table: both primary and English-literal FTS indexes use that single external content source, enabling native semantic integrity without body duplication. Ranking policy is unchanged. Retirement recognizes prior contentful generations. The corruption tests distinguish missing postings from self-consistent derived content that differs from authoritative primary fields; neither check is waived. Strict 41479016465 and corpus 41479389479 were cancelled as superseded by this deterministic audit correction. Qualification remains active and requires a fresh corrected-source run.
