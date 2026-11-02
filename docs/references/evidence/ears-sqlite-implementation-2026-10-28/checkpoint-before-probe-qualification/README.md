# Superseded handoff before the 64-bucket qualification

Captured from goal source `a380d17ca6`. These chronological queue statuses and earlier claims retain their original scope; they are not current instructions or completion claims. [The active goal](../../../../goals/goal-ears-sqlite.md#current-handoff) owns current state and all original requirements. Goal bytes before this move have SHA-256 `26d4b966601ccab4230ea806dcab1c09a53a44e554c1688ac196b8cad56c08fb`. Relative links are relocated without changing their targets.

## Current handoff

Source: isolated `/private/tmp/ears-sqlite-query-integration`, pushed only to `session/ears-sqlite`,
draft PR [#286](https://github.com/spankyed/apack/pull/286). Integrated master remains `461f7bf2cb`;
elmdb pin is `f496470679a7bd9764398108b20f62a73333c701`. Production stays on elmdb. No merge,
release, adoption or daily-profile migration is authorized. Compiler/full validation remains disposable.

The [pre-keyword input-equivalence audit](../final-runtime-inputs/README.md)
remains dated evidence for its recorded tip. The new compound-query correction changes shipped
runtime inputs in the SQLite text, storage lifecycle and audit modules; earlier integration/corpus/installed results retain their original
source and do not qualify this changed execution. Requalify the affected search and app behavior.

Current checkpoint: finish the full candidate after fixing the original keyword gate. Runtime `34ced96b43` passes all 25 original SQLite keyword judgments in both language configurations; fixture/query/targets/top-five threshold are unchanged. [Run and preserved disposition](../literal-34/README.md). EARS production build and source/test typecheck pass; 122 selected contracts pass and three new English audit cases fail at native integrity-check over a virtual content source. Counterfactuals and inference were skipped. These failures remain explicit.

Focused passing runtime `7ffa2a7ca5` uses revision 4 ordinary shared document content: primary FTS and the English-literal companion read the same stored source strings. This resolves SQLite 3.53.4's integrity scan restriction (FTS5_STMT_SCAN uses SQLITE_PREPARE_NO_VTAB) without storing another body copy. Prior contentful generations remain collectible. Writable reopen admits replacement generations; obsolete read-only opens refuse INDEX_BUILDING. Native semantic integrity, reconstruction from authoritative fields, clear/reuse, both layout upgrades and retirement are tested. Primary data and logical commit identity remain unchanged during regeneration.

Ranking retains independently normalized bounded leading passages (256 UTF-16 units, whitespace boundary, weight 3) beside complete source strings. For English positive unquoted compounds, literal compound coverage precedes Porter-only matches, with monotonic BM25 within each tier and recency afterward. Matching, phrase boundaries, scopes and winner-only highlights remain native. No fixture-specific rule, raw-body scan or JS ranker is introduced. Explicit empty field selection searches no fields.

[Focused run 41480349250](https://github.com/spankyed/apack/actions/runs/41480349250) succeeds at `7ffa2a7ca5`: both SQLite keyword configurations 25/25, all 125 search contracts without exclusions, four required old-source AssertionErrors with source restoration, and hybrid 25/25 on both backends. The EARS package producer and full source/test typecheck pass. Both maintained pure validators independently reproduce the summaries byte-for-byte. [Preserved evidence](../literal-shared-7ffa/README.md).

Before the probe correction, production-code tip was `a8500818f6`: its only runtime change after focused 7ffa success is a statically equivalent delimiter class required by lint; a recovery fixture now damages the actual `_idx` shadow. All 65,536 UTF-16 delimiter decisions match; text revision stays 4. [Corrected strict/platform 41483924153](https://github.com/spankyed/apack/actions/runs/41483924153) has a successful producer and all three platform jobs successful: Linux/macOS each 946 EARS, 313 host, 12 recovery and 41 CLI passes without exclusions; Windows 942 EARS/four existing POSIX FIFO exclusions, 310 host/six exclusions, two supported crash cases/ten exclusions, and 41 CLI passes. All explicit final verification guards pass. [Original final-code reports](../platform-a850/README.md). The complete strict run is now terminal success, all nine jobs successful. [Consumer evidence](../strict-a850-consumers/README.md) verifies all 31 repository files per integration shard, both native shards, host 7,040 passes/95 existing exclusions, pack 989/two exclusions, authoring seven/two, external app 32, smoke five and six explicit SQLite app/storage witnesses. Host pool time is 585.1 s under the unchanged 600 s limit. The previously timed-out dependency-publication file passes in 158.56 s with its 200-second test deadline unchanged; no stable timing guarantee or causal fix is inferred. The predecessor's lint/obsolete fixture failures remain preserved, not relabeled.

[Managed corpus/relevance 41481261106](https://github.com/spankyed/apack/actions/runs/41481261106) succeeds at `c28f067c96` (documentation-only descendant of 7ffa). All 1,800 queries/18 groups pass recall/query-p95, minimum mean recall 0.959375; nine original heartbeat misses retain accepted degradation. All 29 safeguards, three reopens per size, full private pairing and cleanup pass. [Original reports and independent validation](../corpus-text-c28/README.md); ten summary means differ locally by at most 4.44e-16, with other fields/gate outcomes identical. No causal speedup/isolated memory claim is made. The later equivalent delimiter rewrite is not falsely attributed to this earlier-source run.

[Packaged Linux/Windows 41481703814](https://github.com/spankyed/apack/actions/runs/41481703814) is terminal success at `ddc52ade72`: four Preview tests and six loaded native addons per OS, actual Electron 37.2.4/Node 22.17.1 and SQLite 3.53.4. [Original reports](../installed-ddc/README.md) preserve unsigned/unpacked/native/API scope. [Signed macOS 41487346823](https://github.com/spankyed/apack/actions/runs/41487346823) is terminal success at `f6d938d190` (a850 production code): strict Developer ID/hardened-runtime signing, six post-sign addons and all six installed lifecycle cases pass once, no exclusions/failures/retries/flakes. [Preserved minimized signing evidence](../installed-f6-signed/README.md). No notarization/distribution or independent keychain-absence claim follows. The earlier automatic-review concern is resolved by waiting for packaging to finish and verifying the free workflow slot before dispatch; no user approval is pending.

[Current-code operational/API fault requalification 41487611128](https://github.com/spankyed/apack/actions/runs/41487611128) is TERMINAL FAILURE solely in the both-backend contract step. [Original passing reports and minimized fault/comparison evidence](../operational-f6/README.md) independently show SQLite 460/460 with no exclusions; native 268 passes/one unchanged frozen-keyword comparison miss/191 SQLite-only exclusions. All named operational controls pass, including read/history faults, actual full/I/O cases, model allocation/WAL-reader release/retry, eight successful-WAL-sync/process-death cases and two injector-disabled controls. Both fault reports' 68 source hashes match current files. The four actual post-sync EIO cases return COMMIT_UNKNOWN/SQLITE_IOERR_FSYNC and fence before death; fresh reopen sees exactly one commit and supports reuse. Parent failure is preserved, not relabeled success or silently treated as a candidate failure. Copied-profile conversion and required model/key/projection witnesses pass after the failed comparison step.

[Current-code app flows/controls 41490418115](https://github.com/spankyed/apack/actions/runs/41490418115) is TERMINAL SUCCESS at `1deae98517` (a850 code). [Original/derived evidence](../app-flows-1de/README.md) independently verifies 120 ordinary measured passes/30 warmups, all 58 cases in ten retained reports, four controls and 200 raw-trial hashes/sizes. Both negative capture indexes stay failed (40 measured/50 total intentionally incomplete captures) with correct UI results. Thread/search/streaming native versus SQLite medians are 761.30/670.40, 28.80/25.95 and 849.50/978.05 ms. They are one warm native-first Mac cohort with differing default durability, not causal engine rankings or universal tail/resource guarantees.

[Full SQLite app suite 41494039628](https://github.com/spankyed/apack/actions/runs/41494039628) is TERMINAL SUCCESS at `6d0903e455`: 33 cases pass once with zero failures/flakes/retries, one packaged-only exclusion is covered by the signed run, and all ten window-discovery cases pass. [Original evidence](../full-app-6d/README.md).

[Final a850-code corpus/relevance 41500524060](https://github.com/spankyed/apack/actions/runs/41500524060) is TERMINAL FAILURE: keyword 25/25 both SQLite modes, hybrid 25/25 both backends and 125 contracts pass, but one corpus mean recall@64 is 0.94890625 below 0.95. All query-p95 limits pass. [Preserved failure and independent validation](../final-3fea/README.md). This is an unmet requirement, not accepted responsiveness degradation. The next correction probes all 64 trained native buckets instead of 32, keeping existing owner/chunk caps and canonical exact reranking. Required closing checks are actual-driver option coverage, changed-source strict/platform tests and a full managed corpus with unchanged recall/latency targets. Corrected source is `93ed37e67f`: [managed corpus/relevance 41503539981](https://github.com/spankyed/apack/actions/runs/41503539981) and [whole strict/platform 41503546216](https://github.com/spankyed/apack/actions/runs/41503546216) are live. The app workflow slot was empty before dispatch. The platform workflow is reusable (no manual-dispatch trigger) and runs through strict; the rejected redundant dispatch created no run. Earlier a850 evidence retains its source scope. Do not rerun unchanged models until one happens to pass.

Closing checks: unchanged original 25/25 SQLite keyword gate in both none/English configurations; original frozen shared spec and existing search contracts; generic leading-passage ranking and truncation safety; compound literal/stem ordering with recency, updates and deletion; both storage upgrade paths; leading and companion corruption/rebuild; and exact-old-source assertion failures with verified source restoration. The hard keyword measurement precedes expensive inference. The relevance job builds the normal EARS native assets. Full strict/app/platform/corpus qualification remains required for changed runtime; earlier receipts preserve their original source scope. Local checks are syntax/metadata only; compiler/native/runtime tests remain disposable. No acceptance waiver or completion claim follows from an active run.

A minimal two-file elmdb written-word fuzzy patch is prepared in
`/private/tmp/ears-native-written-fuzzy.patch` against f496, with source hashes in the adjacent
JSON and recipe `/private/tmp/ears-prepare-native-keyword-patch.py`. It is not applied, compiled,
committed or pushed to elmdb; the shared checkout is unchanged. It addresses the distinct English
baseline typo via the existing pruned written-word dictionary, not the unstemmed ranking miss.
No stop/waiver decision is pending; the user explicitly requires completing the original goal.

The user explicitly retains synchronous app search and accepts foreground responsiveness degradation
for completion of this experiment. Preserve original heartbeat misses as measured failures with an
approved disposition, not passes. No async search API is being implemented. Historical keyword-only receipts record 24/25; runtime 34ced96b43 now passes SQLite 25/25 in both language configurations. The native comparison remains 24/25. Current shared-content qualification and broader acceptance remain required. Other requirements
below remain intact.

**Watch correction:** the newly exercised pack-unit stage at c5d6f3ea66 exposed three unnecessary
open-thread view reruns (988 passes, one failure, two exclusions). [Original failure evidence](../pack-scope-c5d-failure/README.md)
is preserved. Correction `cd8b413fa8` scopes ID/type/typed-hop dependencies and preserves untyped/deep
reachability. [Its actual Linux control](../watch-scope-cd8/README.md)
passes all 31 watch and six real thread-view cases on each backend, including the original metric
case. Four precision guards fail against the exact old c5d6f3ea66 module; both source blob hashes
and byte-for-byte restoration verify. [Corrected three-platform EARS](../platform-cd8/README.md)
now pass 935 cases on Linux/macOS and 931 on Windows, retaining only keyword failure and the four
original Windows exclusions. [Integrated qualification](../strict-061-consumers/README.md) now passes all 989 eligible pack units with two original exclusions, including the actual thread-view file; all five remaining stages pass. This closes the demonstrated watch regression without hiding the retained keyword failure or new integration timeout.

Latest demonstrated results:

- [Corrected-source packed authoring](../packaged-061/README.md)
  at 06106d18dd succeeds: public tarballs build and typecheck outside the workspace, seven producer
  harness cases and two app cases pass, actual installed archive identity matches, and packed CLI
  offline query/export verifies written data under explicit SQLite selection. This is source-host
  packed tooling/archive integration; installed/signed app distribution keeps its separate scope.
- [Ordinary managed corpus at b9896d5205](../corpus-b989/README.md):
  all 1,800 queries verify independent canonical-vector truth; minimum mean recall is 0.95671875,
  above 0.95 at all depths/scopes/families. All original 100/200 ms query-p95 limits pass. Eight
  heartbeat groups still miss 16 ms and retain the approved degradation disposition. Actual packaged
  Scalar models reach ready at 10k/99.9k, 29 safeguards pass, three reopen passes per cohort reproduce
  answers, and private/database scratch cleanup verifies. At 99.9k, load/admission take 68.96/42.52 s;
  recorded logical storage is 1.94 GB and process high-water RSS reaches 1,571,764 KiB, including
  fixture/reference/harness memory. These are not pure engine costs or instantaneous disk bounds.
- [Current-runtime relevance at b9896d5205](../relevance-b989/README.md):
  both backends pass all 25 frozen English hybrid judgments. Keyword-only stays 24/25 with and
  without English stemming. Both maintained validators reproduce the downloaded receipts byte-for-byte;
  private/model/database scratch cleanup passes. This is one pinned model; 141/239 inputs truncate
  at 256 tokens, so broader search coverage and the keyword disposition remain open.
- [Source app at d2684393ec](../full-app-d268/README.md):
  all 33 eligible cases pass once, one packaged-only exclusion, zero failures/flakes/retries. Ten
  main-window role-discovery cases and testing-workspace typecheck pass, with the unit report retained
  outside Playwright cleanup. Previous navigation and ENOTEMPTY
  failures remain preserved. The final replay qualifies `1d25cbf2af`: its code-surface test observes
  the exact terminal.CLOSED event before directory removal, without a retry or longer existing deadline.
- [Corrected-source integrated strict](../strict-061-consumers/README.md) at 06106d18dd:
  producer, both native shards and integration-2 pass. Host completes 613 files in 482.66 seconds
  under 600, with 7,029 passes, one keyword failure and 95 exclusions. Integration-1 reports 199 passes
  and one 200 s dependency-publication timeout in attempt 1, leaving three files uncompleted. [Attempt-2 full replay](../integration-061-replay/README.md) now passes all 242 tests/31 files on the unchanged source, including the formerly timed-out case in 130.719 s. The original failure and its unexplained timing variance remain recorded.
  All five separately executed remaining stages pass: pack 989/two exclusions, authoring producer seven,
  authoring app two, external-pack/fork 32 passing executions and smoke five. Six independent explicit
  SQLite Electron/storage cases pass, and their report survives later output cleanup.
  [Matching three-platform results](../platform-061/README.md) retain only keyword failure and
  original Windows exclusions. [Actual history EIO refusal/preservation](../history-ae9/README.md)
  separately proves intact-incumbent refusal/reopen; routing tests alone do not prove syscall outcomes.
- [Packaged Linux/Windows at d795901191](../installed-d795/README.md)
  pass native/API probes. [Signed macOS at d795901191](../installed-d795-signed/README.md)
  passes strict signing, post-sign native smoke and all six installed cases without exclusions/retries.
  Cleanup is observed at command/step scope; no notarized distribution claim.
- [Cold/warm reopen](../cold-27/README.md)
  passes 80 actual-residency trials on one Linux host. [Opposite-order startup](../startup-48b/README.md)
  does not reproduce the earlier 55.69% gap; runner/order/drift prevent causal attribution. SQLite seed
  import remains slower. [Sustained checkpoint capacity](../wal-c471/README.md)
  passes four cohorts and shows 765 MB controlled logical overlap, not instantaneous peak or power-loss certification.

The corrected-source [app-flow/UI checkpoint](../app-flows-275/README.md) now succeeds:
six cohorts admit 120 measured actions/30 warmups; ten retained Playwright report files hold 58
passing app cases (streaming has 25 parameterized cases per store). All four search controls pass
once on verified stores, without exclusions/flakes/retries. The two renderer-refusal capture indexes
remain failed: forty measured/fifty total intentionally incomplete captures, with correct UI results.
The original 200 raw trial hashes/sizes are independently verified; scalar/resources and source/build
metadata are retained without private profiles/traces/configuration. Script/test typechecks and
provenance checks pass. This qualifies the named UI flows and controls, not broad provider/model
usefulness or every resource/fault regime; no responsiveness gate is relabelled as passing.

The native allocation/refusal checkpoint is now qualified in its selected Linux/glibc scope.
The [populated-WAL receipt](../allocation-5cf/README.md)
proves actual vec1TrainFinal worker ENOMEM/SQLITE_NOMEM, a 57,712-byte blocked WAL followed by
zero-byte reclamation after worker exit, unchanged canonical bytes, only the explicitly intended
foreground commits, no failed-attempt model publication, 512-sample retry, reuse and cleanup.
Original header/page/history fault phases still pass. No ordinary native artifact or production
API changed. This serves the phase-6 selected active-worker resource-failure requirement; it is
not OS/cgroup OOM, arbitrary/mid-kmeans failure, total-memory bounds or physical power-loss proof.

The independent ordinary managed corpus repetition is now complete in its recorded scope.
The [original reports and reproducible comparison](../corpus-repeat-94cf/README.md)
verify all 1,800 queries/18 groups, minimum mean recall 0.95203125 against 0.95 and all original
query-p95 limits. Eight heartbeat groups retain the accepted degradation. Sealed payload/native/
Node/policy identities match b989; model hashes differ, and oracle report hashes also differ.
This provides a second observed model/run result, not controlled causality or general variance
certification. Load/admission, resource snapshots, three reopens per size, 29 safeguards and
private cleanup are recorded. The keyword judgment is closed by literal-shared-7ffa; broader affected-source acceptance remains open.

Current validation handles and results (older entries retain their recorded source scope):

- [Audited shared text and original keyword gate 41480349250](https://github.com/spankyed/apack/actions/runs/41480349250)
  is terminal success at `7ffa2a7ca5`: SQLite keyword 25/25 in each configuration, 125 contracts,
  four effective assertion controls/restoration, hybrid 25/25 per backend. Original reports and
  independently reproduced summaries are in `literal-shared-7ffa`.
- Strict/platform 41481255377 and managed corpus/relevance 41481261106 are active on `c28f067c96`;
  packaged Linux/Windows 41481703814 is pending on `ddc52ade72`. Both are documentation-only
  descendants of the passing runtime; inspect actual status before another app dispatch.

- [Independent prefix-passage ranking and original keyword hard gate 41473096670](https://github.com/spankyed/apack/actions/runs/41473096670)
  is terminal failure at `373bf288c6`: unstemmed 25/25, English 24/25 (case 6 rank 13).
  The hard gate skipped later checks. This dated failure is preserved in `passages-373`;
  it is superseded by the focused passing shared-content source above, not relabeled successful.

- [Bounded leading-text ranking and original keyword hard gate 41469187700](https://github.com/spankyed/apack/actions/runs/41469187700)
  is terminal failure at `a9e415aad4`: original unstemmed keyword remains 24/25, case 6 rank 7;
  English SQLite is 25/25. [Original reports](../lead-column-a9/README.md)
  preserve the hard failure. Safety/contracts/counterfactual/inference stages were skipped afterward.
  The next source revision uses independent bounded-passage normalization, with unchanged cap/weight.

- [Compound/Unicode correction and pinned old-source control 41464298033](https://github.com/spankyed/apack/actions/runs/41464298033)
  is terminal success at `cf5d7b4800`. [Verified reports](../compound-cf5/README.md)
  prove 93 ordinary search passes and both exact old-source failures/restoration. SQLite English
  keyword usefulness is 25/25; the original unstemmed gate remains 24/25 (case 6 rank 12). Hybrid
  remains 25/25 on each backend. No original query/target/threshold changed.

- [Compound-query fix and original relevance qualification 41462773196](https://github.com/spankyed/apack/actions/runs/41462773196)
  is terminal failure at `eed73e4071`: typecheck and all 92 selected search contracts pass,
  including both new compound regressions. The counterfactual never ran: its historical commit
  was absent from the shallow checkout. Relevance was skipped. [Original report and failure disposition](../compound-eed-control-failure/README.md)
  retain this limitation. The workflow now fetches the exact commit before source replacement.

- [Original keyword ranking diagnostics 41460757710](https://github.com/spankyed/apack/actions/runs/41460757710)
  is terminal success at `4566270bf78e8d9290c92ff46f197e4fbdbeca25`. The frozen fixture is unchanged.
  Numeric failure diagnostics compare limited/unlimited ranks, scores and highlight positions on
  both backends and both stemming modes; no query, target or top-five threshold was relaxed.

- [Independent ordinary managed corpus repetition 41413055256](https://github.com/spankyed/apack/actions/runs/41413055256)
  is terminal success at `94cf2eeac6`. Packaged/managed/production inputs are explicit; no diagnostic override.
  [Verified corpus reports](../corpus-repeat-94cf/README.md)
  retain passing recall/query-p95, accepted heartbeat misses and independently trained model outcomes.
  The separate relevance job succeeds: [verified original receipts](../relevance-94cf/README.md)
  repeat hybrid 25/25 on each backend and keyword 24/25 in all four backend/stemming groups.
  Fixture/vector/model identities match b989; both validators reproduce original summaries byte-for-byte.

- [Populated-WAL allocation/refusal check 41411063927](https://github.com/spankyed/apack/actions/runs/41411063927)
  is terminal at `5cf602ce3b0c6b0323ef1db56c277c895b7314f4`: allocation/WAL and all other named
  operational steps pass. Shared suites retain only the keyword judgment failure on each backend.
  [Original reports and verified receipt](../allocation-5cf/README.md)
  preserve the exact failures, commit accounting and reader-release evidence.

- [Native allocation/refusal and existing API fault checks 41408228347](https://github.com/spankyed/apack/actions/runs/41408228347)
  at `517bd80dc5` are terminal. The allocation, header/page and history fault steps pass; the
  shared-suite step retains only the known keyword failures (SQLite 459 passes, elmdb 268 passes).
  [Original allocation evidence](../allocation-517/README.md)
  proves SQLITE_NOMEM, preservation and retry. Its empty-WAL checkpoint does not independently
  prove reader release. Protocol v2 holds the actual native worker, commits one foreground row,
  requires populated WAL reclamation to be busy before refusal and successful afterward, and
  accounts for that foreground commit separately. No production/native artifact was changed.
- Final database-runtime packaged qualification at `d795901191` (program identical to cd8):
  [signed macOS 41399250308](../installed-d795-signed/README.md) and
  [Windows/Linux 41399303818](../installed-d795/README.md) succeed.
  macOS passes strict signing, post-sign native smoke and six installed lifecycle cases; both x64
  probes pass actual packaged Electron/native/API execution and four preview contracts per OS.
  Source/native/provenance and original reports are retained. No local build, signing or compiler run.
- [Corrected-source app flows and UI controls 41401869473](https://github.com/spankyed/apack/actions/runs/41401869473)
  at `275b6fac3d` succeed, with the independently checked receipt above. Earlier handles, including the original keyword diagnostics, are terminal; the corrected compound/Unicode qualification above is also terminal; leading-text ranking is now active. Strict still retains the unwaived keyword failure.
- [Integrated strict 41391989615](https://github.com/spankyed/apack/actions/runs/41391989615)
  at `06106d18dd`: attempt 1 is terminal failure with the exact independent successes/failures above.
  [Attempt 2](../integration-061-replay/README.md) reruns only integration-1 on the same source and passes all 242 tests/31 files. All other job outcomes remain retained; root keyword failures still keep the overall workflow red.
- [Focused unchanged integration test 41397716324](https://github.com/spankyed/apack/actions/runs/41397716324)
  at `733294618a` is terminal success: [the unchanged case passes in 61.06 s](../integration-733-focused/README.md), under the original 200 s deadline. Git verifies documentation-only differences from the failed source. This does not establish the timeout cause; the separately retained attempt-2 full shard above now passes.
- [Explicit SQLite packaged authoring 41392105607](https://github.com/spankyed/apack/actions/runs/41392105607)
  at `06106d18dd` and [full app 41395988057](https://github.com/spankyed/apack/actions/runs/41395988057)
  at `d2684393ec` are terminal success, with their separate receipts above. Both include cd8's correction.

Previous integrated run `41385303835` at c5d6f3ea66 is terminal: producer and all four integration/native
consumers pass; host retains keyword failure and the independent SQLite witness passes; pack units
expose the now-focused-corrected watch regression and stop later authoring/app stages. Its original
three-platform results retain only keyword failure. [Explicit SQLite external-pack run](../external-bb35/README.md)
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

The [completion assessment and invariant/dependency review](../../../../plans/ears-sqlite-contracts.md#experiment-completion-report-qualification-in-progress)
recommends retaining elmdb; experimental completion is not yet proven. [Earlier detailed handoff](../handoff-before-completion-audit/README.md)
retains all preceding receipts, negative controls, runtime decisions and historical next actions.

The [commit-outcome audit](../commit-outcome-audit/README.md)
now source-verifies 69 platform refusal/rollback/ambiguity test executions and eight actual WAL
sync/process-death cases, plus two disabled-injector controls. All four post-sync EIO-return
families report COMMIT_UNKNOWN, fence reads, and reopen with the committed result. The broader
storage-error requirement below remains open; process death is not physical power-loss proof.

### Unmet acceptance work

1. Qualify all current-master contracts and the exact final source, including shared/native models, full strict, app lifecycle, platform packaging/signing, API freshness and meaningful negative controls. Reconcile later relevant master changes deliberately.
2. Expand the existing curated search fixtures to representative real app/repository text with pre-recorded usefulness judgments, supported languages, identifiers, typos, lists, phrases, highlights, recency and hybrid retrieval. Full corresponding text pairing is now qualified in the private acquisition job; its payload is deliberately deleted after qualification. The exercised `bench/sqlite/acquire-real-vectors.py --with-text` path emits text, identities and vectors together; its full pairing validator checks every identity and all four original sealed file digests. The unused standalone re-download/join helper was removed instead of maintaining an unqualified second acquisition format. This does not waive any pairing, usefulness or performance requirement. The frozen snapshot contains 214 real repository-guide/shipped-content sections and 25 predeclared top-five usefulness judgments. Pinned local English hybrid retrieval now passes all 25 on both backends, repeated on current candidate runtime at b9896d5205; its original numeric receipts are linked in the current handoff. The original text-only SQLite gate is now 25/25 in both none/English configurations at 7ffa2a7ca5, with 125 contracts and four effective old-source controls; full current-source qualification continues. Native comparison remains explicitly 24/25. [The current three-platform search feature audit](../search-features-061/README.md) verifies 80 named passing SQLite contracts per OS, including literal multilingual highlights, identifiers/phrases/lists/fields/boolean/recency/prefix, bounded typos and unsupported language/analyzer refusals. This proves those declared feature cases; broad multilingual semantic usefulness, production-provider/model variance and broader semantic/provider-specific UI acceptance remain open. The current-query thread search, actor supersession/cancellation and capture-refusal UI paths now pass the app-flow checkpoint above.
3. Meet original admission/search/vector/resource budgets; the user explicitly accepts synchronous foreground responsiveness degradation for experiment completion. Historical matched real-vector trials retain heartbeat/latency failures. The current adaptive SQLite warm hybrid run meets 100/200ms query p95 but fails heartbeat; this does not establish a current matched-engine speedup or complete resource acceptance. The original 16ms heartbeat results remain recorded as misses with an approved degradation disposition; 100ms/200ms query targets and resource accounting remain required. Measure warm/cold/reopen, realistic streaming/write/watch flows, sustained background work, variance, peak memory, disk/WAL growth, checkpoint contention and large-corpus ingestion.
4. Finish physical/error-outcome evidence beyond the now-qualified successful-sync/lost-acknowledgement process-death cases: active worker I/O/corruption/resource extremes, broader ambiguous COMMIT/storage failure regimes beyond the now-observed injected post-sync error cases, busy writers/long readers and required filesystem/read-only behavior. Existing injected EIO cases mostly prove rollback; process-kill boundaries do not prove physical power-loss safety.
5. Complete owned-invariant, complexity, maintenance/native-dependency and upgrade/recovery review, then produce the requirement-by-requirement adoption recommendation. A green suite alone does not close the goal. Production terminal-service natural-exit cleanup is a separate unresolved concern; the shared probe cleanup does not fix it.

Compiler/full validation stays disposable. Admit only owned heavy Docker validation after the agreed quiet window, at 2 CPUs/6 GiB without swap, and pause only our container if another agent starts one. Frozen original source/data are never rebuilt or replaced; verify the original 1602 hashes and remove only proven empty owned overlay mountpoints. [Frozen cleanup now completes](../frozen-cleanup-ea/README.md): all original 1602 hashes match before and after removing the eight proven empty owned mountpoints. Inspect Docker and current receipts before further work.

[Earlier detailed handoff history](../handoff-before-graph-resume/README.md) is preserved as dated evidence, not an alternative scope or a waiver of any unmet requirement.

### Keyword correction continuation: literal compounds

Run [41473096670](https://github.com/spankyed/apack/actions/runs/41473096670) is terminal failure: SQLite unstemmed now passes 25/25, English 24/25 (case 6 rank 13). No fixture or acceptance threshold changed. Contracts and inference were skipped by the hard gate; earlier receipts do not qualify this runtime. Preserved evidence: `docs/references/evidence/ears-sqlite-implementation-2026-10-28/passages-373/`.

The current implementation adds an external-content unstemmed FTS companion for English indexes: stored bodies are shared, native postings distinguish literal unquoted compounds from stem-only matches. Literal compound coverage precedes BM25 within each tier; recency applies afterward. Matching, explicit phrase membership, scope and winner-only highlights retain their existing execution. Text storage revision 3 triggers writable generation replacement; retirement remains version-aware. Index deletion/reset, native semantic integrity checks and regressions accompany the change. This revision remains unqualified until CI runs the original hard gate and all following checks. Foreground responsiveness misses remain explicitly accepted degradations; the keyword gate is not waived.

Active qualification: [41477975796](https://github.com/spankyed/apack/actions/runs/41477975796), runtime `a91c0b0d5c`. Previous passage-only run is terminal failure, not active. Await original keyword, contracts, counterfactual and hybrid results before broader runtime qualification.

Additional closing regressions construct the actual English revision-2 passage layout without a companion, prove read-only refusal does not change the database file, and verify writable reconstruction, unchanged logical sequence and retired-object cleanup. The old-source counterfactual now also requires the literal-ranking assertion to fail (four named assertion failures total), with source restoration verified. These additions require their own CI execution.

Run 41477975796 failed before keyword execution: package compilation found the obsolete private `SqliteSearch.table` helper unused after clear delegation (TS6133). No keyword/contracts/inference result exists for that run, and its artifact step had no reports to upload. Strict 41478591499 on the same runtime was cancelled as superseded by this deterministic compile correction, not retried for a timeout. The helper is removed; requalification remains required.

### Keyword gate passes; native audit layout correction

[Run 41478710010](https://github.com/spankyed/apack/actions/runs/41478710010) passes the unchanged SQLite keyword gate 25/25 in both language configurations, builds EARS and typechecks source/tests. Of 125 selected contracts, 122 pass; three new English audit/upgrade/lifecycle cases fail at native integrity-check over virtual content. Counterfactuals and inference are skipped. [Preserved disposition](../literal-34/README.md).

SQLite 3.53.4's FTS5_STMT_SCAN uses SQLITE_PREPARE_NO_VTAB. Revision 4 moves shared source strings to an ordinary document table: both primary and English-literal FTS indexes use that single external content source, enabling native semantic integrity without body duplication. Ranking policy is unchanged. Retirement recognizes prior contentful generations. The corruption tests distinguish missing postings from self-consistent derived content that differs from authoritative primary fields; neither check is waived. Strict 41479016465 and corpus 41479389479 were cancelled as superseded by this deterministic audit correction. Qualification remains active and requires a fresh corrected-source run.

### Broader qualification: lint and obsolete damage fixture

Strict/platform run 41481255377 exposed two concrete issues after focused relevance passed: the producer rejects the ASCII separator regex under no-control-regex, and Linux EARS has 945 passes/one failure because the damage fixture still drops the removed contentful `_content` table. The suite's continue-on-error step allowed independent recovery checks to run; advancing steps did not mean the suite passed. Its actual guard correctly preserves failure. The delimiter expression is rewritten as an equivalent negated ASCII-alphanumeric/non-ASCII character class; static enumeration confirms identical decisions for all 65,536 UTF-16 code units. No analyzer/layout revision is needed. The fixture now removes the actual text `_idx` shadow; the existing `_docs` case already covers the new ordinary content table. Read-only refusal, reconstruction, logical identity and primary-data assertions remain unchanged. Other platform jobs and current corpus remain running; no old receipt is relabeled green.

Current strict retry after concrete fixes: [41483924153](https://github.com/spankyed/apack/actions/runs/41483924153), source `a8500818f6`, pending behind predecessor platform completion. [Preserved completed Linux/producer evidence](../strict-c28-lint-fixture/README.md). Corpus 41481261106 remains active; packaged 41481703814 remains the single pending app run. Inspect actual status before another dispatch; no extra app run has been queued.

Latest verified checkpoint: predecessor strict/platform 41481255377 is terminal failure, with the same obsolete `_content` setup failure on all three OSes and producer lint already corrected. Strict/platform 41483924153 is now active at a8500818f6 (producer job 125415113216; platform Windows 125415113103, Linux 125415113135, macOS 125415113768). Packaged 41481703814 has Linux success ([retained original reports](../installed-ddc/README.md)); Windows job 125409999249 remains active. Wait for this app run to finish before dispatching signed macOS, following the safe sequencing after automatic approval rejection. No signed run exists yet. Corpus 41481261106 remains terminal success.

Post-layout requirement audit: [backup-contract-audit.json](../strict-c28-lint-fixture/backup-contract-audit.json) verifies all 27 storage and ten SQLite logical-archive cases on each OS at c28f067c96 (111 executions, zero exclusions), with original archived report hashes and unchanged fixture bytes through a8500818f6. Source factories open real primary/run-history stores, populated incumbents and media; mock import ordering is not substituted. This closes that named post-layout evidence cross-check, while the overall strict/platform retry and installed/app scopes remain separate.

Latest signed/operational handoff: packaged 41481703814 terminal success is now fully preserved for both OSes; signing 41487346823 active and operational/API 41487611128 pending at f6d938d190 (a8500818f6 production code). The prior automatic-approval concern is resolved by the completed packaged run and explicit zero-pending check; no user permission is outstanding. Current strict/platform 41483924153 continues independently.

Final-code platform progress: [platform-a850](../platform-a850/README.md) preserves completed Linux and macOS successes at a8500818f6: each 946 EARS, 313 host, 12 crash/recovery and 41 CLI passes, no exclusions; Linux also SDK 1,330 and its API/package/repository checks. Explicit final guards pass. Strict producer passes lint/types/build/other producer checks and has published artifacts; five consumers are now live/queued (native-1 125425066885, native-2 125425066966, integration-1 125425067019, app-and-rest 125425067248, integration-2 125425067289). Windows platform job 125415113103 remains live. Do not infer EARS success from its continue-on-error API step conclusion: the predecessor demonstrates API conclusion success even when its raw suite failed. Require final guard plus original reports. Signed 41487346823 remains active, operational 41487611128 is the sole pending app run.

All three corrected-source platform jobs in 41483924153 are now terminal success at a8500818f6 ([original reports](../platform-a850/README.md)). Windows has 942 EARS passes/four existing POSIX FIFO exclusions, host 310/six exclusions, crash two/ten exclusions and CLI 41/no exclusions. Linux/macOS remain 946 EARS passes each with no exclusions. All explicit final guards pass. Producer is terminal success; native-1/native-2/integration-1/app-and-rest remain live and integration-2 queued. Signed 41487346823 has reached inner signing/provenance verification; operational 41487611128 remains the only pending app run. No overall strict/signing or goal completion is claimed.

Current operational evidence is now preserved at operational-f6: 460 candidate contracts and every named fault/control pass, with only the expected unchanged native keyword comparison causing the workflow failure. Current-source hash claims are now actual 68-file checks in each fresh fault report, not merely extrapolated from c9898f31. App-flow job 125436648022 is queued and protected; no extra app workflow has been dispatched over it.

Latest queue checkpoint: app flows 41490418115 is confirmed ACTIVE (job 125436648022); full app 41494039628 is the ONLY PENDING app workflow, queued with explicit no-pending and active-flow guards. Do not displace it. Operational/API 41487611128 is terminal failure solely at the native comparison, with the full scoped proof archived. Native-2 job 125425066966 and integration-2 job 125425067289 have terminal success; obtain original consumer reports before quoting counts. Other three strict consumers remain live.

Latest current-code app-flow proof is committed at app-flows-1de: 120 measured passes/30 warmups, ten report files/58 app cases, four controls, 200 raw hashes verified, negative controls still incomplete. Full app 41494039628 is queued (125451823784) and protected. Whole strict 41483924153 is terminal green with all nine jobs, archived at strict-a850-consumers. Next safe dispatch is final-code managed corpus only after full app is confirmed active and pending count zero.

Final validation queue: full SQLite app 41494039628 is confirmed ACTIVE (check 125451823784); exact-final-code ordinary managed corpus/relevance 41500524060 is the ONLY PENDING app workflow, queued with active-full-app and zero-pending guards. Preserve it. Entire strict, signed/native loading, current operational controls and real app flows are now independently archived and passing in their stated scopes; full app and final performance/relevance are still unproven.
