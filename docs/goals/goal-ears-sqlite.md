# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master e3d1a37d5c
and its native pin 2441af4658; full combined acceptance remains pending. Inspect the current handoff and actual source before continuing.
Work in the isolated session/ears-sqlite checkout and preserve concurrent work.

Finished when the SQLite candidate runs the complete app data lifecycle, all required
contracts and recorded performance/relevance/recall budgets pass, full validation is
recorded on pinned source in disposable environments, and a draft PR is ready for
an adoption decision. Commit usable checkpoints. Do not silently drop requirements.
```

Status: active after user-verified OrbStack migration to Seagate, 2026-10-31; candidate qualification remains incomplete.
Branch: `session/ears-sqlite`. Authoritative source: `/private/tmp/ears-sqlite-query-integration`, published to `session/ears-sqlite` and
[draft PR #286](https://github.com/spankyed/apack/pull/286). Current runtime/test checkpoint is `d57021f70e`:
Windows API environment assignment is portable, native-owner reranking reuses already-filtered owners,
and an abrupt owner-process death regression is added. The clean detached publisher is
`monorepo-worktrees.noindex/integration-3AEBRl`; it may lag and must be inspected before use.
Canonical `sqlite-evaluation` remains an older checkout and is not the current source.

Source-app qualification at `9ec9` completes 33 actual cases with one intentionally installed-only skip;
signed installed macOS qualification at `3230` completes six actual cases without skips or retries.
These do not satisfy every app/resource/packaging gate. Two focused Linux regressions at `d570` pass
using read-only current source/test mounts over frozen `a9` dependencies; exact candidate platform
qualification remains required. The owner-reuse diagnostic records about 13% lower mean latency in
the tested updated 99.9k/10% cohort, with all 144 results preserved; original performance failures stay open.

Integrated master remains `e3d1a37d5c622bfebba7767a09452572284881dc`; native elmdb pin remains
`2441af4658d961f547c7094cd041c2ac246668c5`. Master has subsequently advanced; this candidate has not
yet integrated those newer graph changes. The [completed rebase](../references/evidence/ears-sqlite-implementation-2026-10-28/master-rebase-e3d1/README.md)
preserves checkpoint `353eb42255` except master's three documentation files. Frozen diagnostics retain
their original source revisions. Inspect actual Git/process/workflow state before continuing.

The candidate implements structured graph/query execution, typed authoritative values, live declarations,
transaction/watch identity, search/index generations, canonical embedding/model lifecycle, both managed app
stores, SDK fixtures, CLI maintenance, backup/import/recovery and explicit copied-profile conversion.
[The storage design](../plans/ears-sqlite-storage.md) owns implemented contracts;
[the contract matrix](../plans/ears-sqlite-contracts.md) owns required semantics. Implementation is not final
app, resource, physical-durability or adoption qualification.

| Current evidence | What it proves | Remaining boundary |
| --- | --- | --- |
| [Platform 41159890572](../references/evidence/ears-sqlite-implementation-2026-10-28/qualification-5569/README.md), source 5569 | Linux x64/Windows x64/macOS arm64 succeed; 735 native membership checks each; EARS Linux/macOS 762 passes, Windows 757 plus five named skips; host/CLI/conversion witnesses; four actual Ubuntu ENOSPC cases | CI hosts are not arbitrary filesystem certification; named skips and remaining physical/resource gates stay open |
| [Signed installed 41151681981](../references/evidence/ears-sqlite-implementation-2026-10-28/native-63c/README.md), runtime 63c | Six actual macOS arm64 executable cases, zero skips/retries; both stores/model claims; native smoke; refreshed inner-library provenance and Developer ID sealing | Broader installed/UI/CLI/SDK/pack flows and required architectures |
| [Full strict 41151679157](../references/evidence/ears-sqlite-implementation-2026-10-28/integration2-63c/README.md), runtime 63c | Eight required jobs pass; integration-2 fails its original 240000-ms diamond setup; six alternate jobs skip | **Overall failed.** Diagnose concurrent setup delay, then qualify affected and final exact-input full gates |
| [Focused diamond](../references/evidence/ears-sqlite-implementation-2026-10-28/diamond-linux-5569/README.md) and [Mac 41160571827](../references/evidence/ears-sqlite-implementation-2026-10-28/qualification-5569/README.md) | Five original assertions pass on each host; Mac setup about 103.6 s, selected file 180.15 s; actual hidden per-case JSON retained | Isolated passes do not explain the concurrent strict failure; no deadline/assertion/build weakened |
| [Source-app 41152805669](../references/evidence/ears-sqlite-implementation-2026-10-28/source-app-63c/README.md) and [SQLite diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-activation-e76/README.md) | Broad source app: 32 passes, one intended installed-only skip, one original five-second editor failure; focused: one failure/two passes, only host frontend bindings at failure | **Unresolved.** Not an established editor replacement rejection or native-query cause |
| [Elmdb editor control](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-elmdb-control-897/README.md) and [backend activation attribution](../references/evidence/ears-sqlite-implementation-2026-10-28/activation-profile-5569/README.md) | Mac elmdb control three actual passes; separate Linux backend-only profile SQLite 3.24 s/elmdb 5.34 s, SQLite 197 commit spans about 474 ms | Default acknowledgments differ; fixed order/cache effects and no renderer preclude a general speed ranking or causal fix |
| [Read-only mount](../references/evidence/ears-sqlite-implementation-2026-10-28/readonly-mount-aea/README.md) | Actual Linux kernel EROFS; published backup queries/write refusal; closed WAL without sidecars refuses; unchanged file hashes | Managed opens require writable claim metadata; live-WAL-on-mount, arbitrary filesystems and Windows physical durability remain unqualified |
| [Current native real-vector preflight](../references/evidence/ears-sqlite-implementation-2026-10-28/native-real-preflight-aea/README.md) | Exact 2441 artifacts, durable units, all 1000 canonical vectors verified twice through independent bounded dump frames; 2400 queries, minimum mean recall 0.999 | Protocol proof only; full 99900-row comparison and actual warm/cold/app resource evidence remain |

The selected native compact-IN implementation is runtime checkpoint `63c8267994`: generated C
`04043ede29b2998b2cd0e7735cc696dba2158554a0bf9036e2a77849dec0425a`, patch
`d76fba22be9c09fe5c7d865999e608b5896f051c19811d41fd0e547ce6efb3f5`.
[Full equivalence](../references/evidence/ears-sqlite-implementation-2026-10-28/direct-in-full-matrix/README.md)
completes 14400 initial/updated queries, all 7200 paired answers, canonical-vector verification and minimum
mean recall 0.973. **Original responsiveness still fails**, including timed-only gates. The
[COMMIT attribution](../references/evidence/ears-sqlite-implementation-2026-10-28/commit-responsiveness/README.md)
shows projection slices do not bound deferred native COMMIT work. Smaller ANN budgets fail recall;
[block-size](../references/evidence/ears-sqlite-implementation-2026-10-28/supported-large-blocks/README.md),
[scope-first](../references/evidence/ears-sqlite-implementation-2026-10-28/scope-driven-eligibility/README.md) and
[owner-projection](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-projection-query/README.md)
studies do not close the gates. No later private C/SQL rewrite, bitmap, ANN setting or block-size change is
selected. Preserve canonical bytes, FULL/default checkpoints and every original acceptance budget.

The [focused architecture review](../references/evidence/ears-sqlite-implementation-2026-10-28/architecture-review-1d7/README.md)
now maps invariant owners and the existing proof boundary. It identifies fixed-partition ANN scan growth,
whole-COMMIT latency, real I/O evidence and Windows directory durability as existing phase 3–7 concerns;
maintenance recommendations do not add mandatory refactors. No new ANN setting/library or product tradeoff
is selected, and this source review does not complete the phase-7 adoption audit.

Next deliverables, dependencies and closing checks:

- Diagnose actual frontend arrival under the unchanged editor predicate. Test-only lifecycle/resource/loader
  [timeline diagnostics](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-timeline-static/README.md)
  pass oxlint and complete tests types with cache disabled. [Actual macOS run 41163254193](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-timeline-0126/README.md)
  at source 0126 is terminal failure: one failed/two passed, zero skips/flaky/retries. At the original failed
  deadline, no PACK_ACTIVATED/LOAD_PACK_FRONTENDS has arrived and the loader is idle; backend activation
  itself takes about 4.48 seconds. Passing frontend loads accept about 331–336 ms after PACK_ACTIVATED.
  Resource arrays are empty even on passes, so they do not attribute fetching. Profile backend module/
  registration/content/actor-startup and event delivery before choosing a fix; no editor rebuild rejection
  or causal SQLite statement is established. The private sampled-stack observer first failed before API
  readiness at the unchanged 45-second bound; syntax and old/new preload import controls then passed.
  The [same-bound old/new API startup control](../references/evidence/ears-sqlite-implementation-2026-10-28/activation-startup-controls-after-migration/README.md)
  is terminal failure: both hooks reach readiness (28.53/32.27 seconds), then actual pack activation
  exceeds the unchanged 30-second observation bound. No completed CPU profile is produced; shutdown
  requires forced termination. Child samples show filesystem-related waits but establish no causal fix.
  V8 sampled stack time is not a CPU/wait or syscall decomposition. Do not repeat the broad suite merely
  to obtain green.
  [Hosted attribution41184048338](../references/evidence/ears-sqlite-implementation-2026-10-28/activation-profile-9db/README.md)
  is terminal success at9db369afa5: both real RPC activations and sampled-stack/SQL reports complete,
  after normal source checks and fresh package/API/pack builds. SQLite5358ms/native4258ms are diagnostic
  timings, not the renderer's five-second assertion. SQLite197 commits total421ms; about2.75s/2.57s
  inclusive sampled wall time is under settings compilation, including repeated meta-schema work.
  [Meta-schema reuse41185730370](../references/evidence/ears-sqlite-implementation-2026-10-28/activation-meta-reuse-778/README.md)
  is terminal success at7781b2de04:118SDK/117host cases, zero skips/failures, both typechecks and lint,
  normal builds and paired activation. SQLite1510ms/native1018ms, with197 SQLite commits retained and
  no meta-schema compilation sampled inside activation. The checker never registers pack schemas;
  fresh private compilers, cloned metadata/default validation and identifier isolation remain enforced.
  [Original editor41186295488](https://github.com/spankyed/apack/actions/runs/41186295488) targetsb7300724a0,
  three repeats at the unchanged five-second assertion. It is [terminal failure](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-meta-b730/README.md):
  two repeats pass all assertions; the third loses its execution context before editor mount or activation.
  The trace does not establish the cause. The current test-only readiness change awaits initial document
  load before imperative mounting and records frame/load/crash lifecycle events on failure, without retry,
  sleep or activation deadline changes. Closing checks are cache-disabled full E2E types/lint and the
  same original three-repeat case. Profile improvement does not close renderer acceptance, the strict
  concurrency failure, vector budgets or the complete goal.
  Current original-case owner is run41188031941 atd8ed64bcf7, pending behind the existing platform
  workflow. It includes full E2E types with incremental cache disabled and observer lint. Inspect this
  same run; do not replace it just because it is queued.

- The native baseline matrix is checkpointed and stopped for the migration. Session 88639 ended by
  requested SIGTERM (exit -15), not a product failure. It created 99900 rows and last logged 69632 embeddings;
  canonical initial/update validation and the 7200-query phase were not reached. The pinned native CLI saved
  a committed compacted snapshot and successfully inspected it before stopping. Persistent volume:
  `ears-electron-runtime-work`; snapshot: `/electron/.temp/ears-migration-checkpoint-20261031/native-db`.
  Its data.mdb is 1344454656 bytes, SHA-256
  `0fe282f82d18121c62f2828867099dedac26be67d30327b65f30b851ab5a1d00`.
  Verify bytes before opening after migration; lock.mdb can change on open. Preserve the incumbent and
  resume only with an explicit copy/protocol; the original fresh-run script is not automatically resumable.
  [Strict resumed-copy preflight](../references/evidence/ears-sqlite-implementation-2026-10-28/native-resume-canonical-refusal/README.md)
  fails canonical byte identity before any embedding writes. The [completed diagnosis](../references/evidence/ears-sqlite-implementation-2026-10-28/native-zero-sign-diagnostic/README.md)
  checks all72000 retained embeddings: exactly three -0→+0 components, no other changes, unchanged
  database hashes, with the actual MessagePack request codec independently reproducing the loss.
  27900 embeddings remain. A [separate preregistered diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/native-zero-sign-matrix-preregistration/README.md)
  may collect remaining timings/query evidence on the owned clone while recording that byte gate as
  failed; any nonzero component mismatch still stops. This does not replace strict qualification or
  authorize normalization, a production/native-pin change or a waiver of candidate canonical bytes.
  Diagnostic session98419 (admission PID86351), reports `/private/tmp/ears-native-zero-sign-matrix-results`,
  is RUNNING in the owned `ears-native-zero-sign-matrix` container at runtimea9c9340df7. It verifies
  the pristine original/copy hashes and all72000 retained vectors, records the three zero-sign failures,
  and continues the27900 remaining embeddings in original64-item durable batches. The last observed
  checkpoint has20480 added, no other component mismatch and no query cohorts yet. Inspect this same
  handle; do not duplicate it or copy newer worktree SDK/host files into its frozen source volume.
- Qualify the [prefix/typo implementation](../references/evidence/ears-sqlite-implementation-2026-10-28/prefix-rebase-validation/README.md).
  Pinned native passes36 shared judgments; the pre-fix candidate passes34 and fails exactly the two new
  prefix/typo judgments. The implementation passes all153 assertions in seven affected search files,
  EARS types/lint and all five package builds at runtime45180293a3. The full local run remains failure:
  684pass/7original30-second timeouts/75native skips. The private runner omitted EARS_VEC1_EXTENSION;
  skips are not coverage. The model-based file directly uses elmdb. Retained resource samples show noOOM
  and filesystem-related kernel waits, without a causal attribution. [Corrective run88910](../references/evidence/ears-sqlite-implementation-2026-10-28/prefix-followup/README.md)
  is terminal success: all75 native cases pass with zero skips using the verified normal artifact,
  and all14 query-cost paths pass at1k/10k/100k. At100k, prefix typo warm p50 is3.719ms,32-character
  typo11.193ms. The broad common-word path still reaches197ms warm and whole-sequence heartbeat329ms;
  this does not pass the16ms responsiveness criterion. The seven full-run timeouts remain unresolved;
  do not repeat the full run merely to obtain green.
  [Three-platform CI41181673785](../references/evidence/ears-sqlite-implementation-2026-10-28/qualification-487/README.md)
  is terminal success at487011c484: Linux/macOS766pass/0skip, Windows761pass/five named skips,
  all hosts735 native membership controls. Linux additionally passes1320SDK/four actual ENOSPC cases.
  All seven local timeout cases pass on Linux/macOS CI, without proving one causal storage fix.
  No new performance claim or complete goal qualification is established.
- The original private syscall-fault admission 59998 was cancelled before container creation. After user
  migration verification/resume, [actual syscall-fault validation](../references/evidence/ears-sqlite-implementation-2026-10-28/real-io-after-migration/README.md)
  is terminal success: eighteen actual EIO cases plus a disabled-injector refusal control, at frozen runtime
  1d7a3de090 (same behavior through 66e8531079 before the prefix prototype), FULL/default checkpoint.
  All sixteen mutation outcomes fence the uncertain handle, reopen to the incumbent, and permit a clean
  recovery write; both read faults preserve the main-file hash. All observed mutations roll back, so this
  does not qualify an actual surviving commit with lost acknowledgment or physical failing media/power loss.
  Active-worker/host publication and remaining phase-6 conditions are still required. The native checkpoint
  and pinned binary hashes match after migration. Prefix validation and the resumed-copy protocol are
  retained above; finish the matched native/SQLite query comparison on the new storage boundary; old internal-storage timings are not a matched
  comparison with the new Seagate boundary. No interrupted matrix is relabeled complete.
- [Targeted overlap41191053003](../references/evidence/ears-sqlite-implementation-2026-10-28/diamond-overlap-61f/README.md)
  passes51actualtests across eleven files, zero skips, at61f. All four real diamond builds execute in162.4s
  under the unchanged240s setup limit, overlapping seven other specs. Phase stdout, not the diamond JSON
  startTime after its hook, proves setup contention. This exercises the targeted current concurrency gap;
  the original strict failure remains unexplained and full exact-input strict acceptance remains required.
  Do not infer a compiler fix or dispatch a broad run solely to obtain green.

Still-required acceptance, without narrowing phases 3–7:

- Complete representative search usefulness: identifiers/camelCase, names, accents, typos, phrases, highlights,
  list/field restrictions, supported languages and mixed relevance/recency. Qualify vector/hybrid recall,
  multi-chunk owners, candidate/trash filtering before K, ties, large-K/exact fallbacks, unit/savepoint
  visibility and model/hash/generation freshness with readiness/watch settlement under real load.
- Resolve failed foreground/heartbeat/admission/COMMIT responsiveness within original budgets, or obtain an
  explicit approved product disposition. Qualify live admission, active worker shutdown and bounded retirement
  under load; bounded row counts alone do not prove latency, WAL or resource bounds. Missing native admission
  cursor indexes on populated stores require explicit offline preparation.
- Measure matched current-backend warm/cold/reopen app flows, sustained FULL writes/watches/streaming/large
  fields, corpus growth, peak memory, disk/WAL/checkpoints, long readers and busy writers. Preserve samples,
  variance, instrumentation/caching limits and acknowledgment policies. Primitive/synthetic ratios are not
  app acceptance and the synchronous API cannot silently become asynchronous.
- Finish native repair faults, physical-file/namespace recovery and interrupted admission/backup/import/reset
  coverage through supported managed ownership, including actual I/O/unknown-commit, corruption, permissions
  and resource failures. Directory claims do not exclude arbitrary external rename/delete, raw writers or
  mount aliases. Complete final identity/foreign-file/alias coverage without reopening already proven cases
  absent changed inputs. Real ENOSPC and the scoped read-only-mount observations do not close all phase 6.
- Qualify Windows directory publication durability, ACL assumptions and history-quarantine parent
  synchronization. [Raw Win32 observations](../references/evidence/ears-sqlite-implementation-2026-10-28/windows-directory-api-c707/README.md)
  pass under an administrator on NTFS/build26100; [actual Node23/libuv1.50 run41185908325](../references/evidence/ears-sqlite-implementation-2026-10-28/windows-node-directory-b730/README.md)
  confirms directory r+ open/fsync success before/after removal, versus EPERM for r. The current
  unqualified implementation removes the no-op from recovery/private-file barriers using that standard
  primitive. Private-file postpublication failure retains the installed file with NOT_DURABLE, original
  cause and publishedPath; refusal/cleanup errors are retained together. All six private-file cases,
  including named barrier/outcome/cleanup witnesses, are mandatory in the three-platform verifier.
  Run that affected platform suite before accepting the change. Unsupported barriers refuse; ordinary
  non-administrator/ACL and installed-runtime qualification remain open. No ordering/process-kill/API
  observation certifies physical power-loss durability or arbitrary filesystems.
  Current affected platform owner is41187209697 atf61c6d7ccc: Linux/macOS jobs have succeeded and
  Windows remains active at the retained observation. Verify actual final reports and six private-file
  cases on every host before accepting the implementation; do not dispatch a replacement run.
- Finish required installed Electron/renderer/CLI, executable-pack/SDK and OS/architecture coverage beyond
  the six signed macOS arm64 cases. Requalify provenance after inner-library signing and before app sealing
  when relevant inputs change. `asar:false` already keeps native files on disk; an unsigned/source build is
  not installed qualification. Optional Codex is absent from baseline API images; boot checks do not prove
  external inference or all pack capabilities.
- Pass final exact-input full strict and affected app/platform/packaging gates, complete owned-invariant,
  architecture/dependency/upgrade/maintenance review, reconcile public/reference docs and API reports, and
  produce the requirement-by-requirement adoption decision. Adoption requires removing obsolete production
  elmdb paths and temporary selection as phase 7 specifies; rejection must not leave a permanent second
  backend obligation. No cutover or daily-profile migration is authorized by this candidate work.

All broad/compiler work stays in disposable Linux/CI with private dependencies, source/artifacts and targets.
One owned heavy container uses two CPUs/six GiB/no swap, quiet admission and pauses only itself for another
build. Focused checks may use half a CPU/768 MiB. Never stop another agent's container. Private corpus/model/
database payloads, dependencies, targets and native binaries remain outside Git.

The [expanded previous handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/native-real-preflight-aea/prior-goal-handoff.md.gz),
[earlier handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-native-audit.md) and
[checkpoint history](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md) retain
historical source boundaries, baseline/harness/resource failures and fixes. They do not override this current
handoff, redefine the approved scope or waive unfinished acceptance.


Checkpoint after b6186cda70: [platform41187209697](../references/evidence/ears-sqlite-implementation-2026-10-28/qualification-f61/README.md)
is terminal success, with actual six private-file cases on all three hosts and1322 SDK cases on Linux.
The remaining inherited Windows logical archive barrier-failure skip is removed; the verifier now requires
all ten archive host cases everywhere. A new affected platform run must qualify this added requirement.
[Editor41188031941](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-load-d8/README.md)
passes all three original cases with zero retries/skips/flaky outcomes, plus E2E types/harness lint.
This supersedes the pending observations above without erasing earlier failures or closing full app/strict acceptance.
Native98419 remains the same live owner at frozen runtimea9; do not mutate its volume or duplicate it.

The [matched post-Seagate SQLite recipe](../references/evidence/ears-sqlite-implementation-2026-10-28/seagate-sqlite-matrix-preregistration/README.md)
is preregistered and syntax checked, not launched. It retains frozen runtimea9, the normal selected native
artifact, explicit offline cursor preparation on a copy, paired connection reopen boundaries,7200queries,
canonical byte checks and original gates. Native98419 must finish before quiet admission; never sync the
new SDK/host code into its live volume. Preparation is not a claimed result.

A follow-up disposable Windows probe uses a copied restricted token: administrator SID deny-only,
DISABLE_MAX_PRIVILEGE, verified non-administrator/same-user identity and enabled-privilege inventory.
It tests actual writable directory open/flush before/after deletion under an owner-only ACL, plus a
read-only-directory EACCES control. No account, existing profile ACL or machine setting is changed.
The Win32-only result does not qualify installed Node/Electron or physical power loss; observe the
existing windows-durability dispatcher run after publishing before claiming any result.

Review found the private recovery writer assumed one writeSync completed its entire UTF-8 payload.
It now advances a byte offset through bounded writes and refuses zero progress before publication.
Two negative regression witnesses exercise actual three-byte short writes with Unicode and a zero-byte
write retaining the incumbent; the platform verifier now requires all eight private-file cases.
This runtime change needs affected platform qualification and final exact-input acceptance; existing
six-case evidence does not qualify it. It does not alter the live matrix's frozen runtime.


[Platform41189469298](../references/evidence/ears-sqlite-implementation-2026-10-28/qualification-1297/README.md)
is terminal success: actual reports prove all ten logical archive host cases with no skips on Linux,
macOS and Windows, including the newly enabled Windows postpublication barrier failure. This predates
short-write runtimee5. Its affected platform owner is41190537998, dispatched once by session53394
only after restricted Windows probe41189779880 acquired the branch slot. The latter is now active;
inspect its actual restricted.json and negative controls before claiming non-admin ACL observations.
Native98419 has finished99900embeddings and3600initialqueries at the latest observation; the full
initial scan records four signed-zero losses and no other component changes. Updates/remaining3600
queries are live; original byte gate remains failed. MatchedSQLite22187 still waits for completion.

[Restricted Windows41189779880](../references/evidence/ears-sqlite-implementation-2026-10-28/windows-restricted-9219/README.md)
is terminal success at9219: actual same-user/non-admin and enabled-privilege controls pass; owner-only
writable directory flushes before/after deletion, while a read-only directory refuses the writable
handle with kernelerror5. This qualifies that scoped Win32 mechanism observation on NTFS/build26100,
not Node under impersonation, installed Electron, arbitrary ACLs/filesystems or physical power loss.
Short-write platform41190537998 at exact runtimee5 is now active; do not dispatch another run.

[Native diagnostic98419](../references/evidence/ears-sqlite-implementation-2026-10-28/native-zero-sign-matrix-completed/README.md)
is terminal/completed with7200actualqueries, all18cohorts and canonicalinitial/updated99900checks.
All mean-recall criteria pass (minimum.986);35of72passes fail heartbeat, with two also failing100k
latency. Query and canonical gates remain false. Full scans record four known zero-sign losses and
no other component changes; incumbent main hash is unchanged. The27900remaining durable embeddings
and999updates take4551833ms/269581ms; no complete fresh-ingestion or causalupdated-cost claim.
MatchedSQLite session22187 is now eligible for30-second quiet admission; observe the same owner.


The shipping architecture inventory is explicit in the[contract matrix](../plans/ears-sqlite-contracts.md#packaged-platform-qualification-boundary):
macOSarm64, Windowsx64 and Linuxx64. The new installed-platform dispatcher builds normal unsigned
Previews on the latter two and requires the existing actual packaged Electron/API native witness,
including4097-vector worker admission, ownership, FTS/regex and read-only reopen. It is not renderer,
installer/signature or physical power-loss qualification. Observe its exact run after publication;
never label pending native-runtime checks as passed installed app acceptance. Dispatch only after the
already queued overlap41191053003 acquires the branch slot, preserving that run.


[Short-write platform41190537998](../references/evidence/ears-sqlite-implementation-2026-10-28/qualification-e5/README.md)
is terminal success at runtimee5: actual eight private-file cases on every host, including Unicode
three-byte writes and zero-progress refusal retaining the incumbent. All ten logical archive cases
pass everywhere without skips; host totals208/208/195. Linux also passes1322SDK cases, four actual
ENOSPC cases and required host types/writer lint. No runtime source has changed since that input.
Overlap41191053003 at61f is now active; installed-platform41192007255 is dispatched once at125,
queued behind it. Keep both owners; original deadlines and all remaining acceptance are unchanged.
Matched SQLite88542 remains live in admission at frozena9, without a completed report or comparison.


[Matched post-Seagate matrix88542](../references/evidence/ears-sqlite-implementation-2026-10-28/paired-seagate-matrix/README.md)
is terminal success as an observation:7200actualqueries, strict canonical99900initial/updated byte checks,
normal artifact/base/incumbent hashes unchanged. Recall passes(minimum.973);49of72heartbeat passes and
four latency passes fail, so frozen acceptance remains false. Native counterpart fails35heartbeat/two
latency passes and its known byte gate. SQLite is slower in15of18pooled timed cohorts, but wins the
10k/1% cohorts and updated99.9k/10% cohort.999-owner durable updates take22.0s versus269.6s native.
Physical admission takes1002s:8.5sprojection and990.4scommit, demonstrating the4msslice does not bound
FULL commit latency on this storage. No fresh-ingestion, OS-cold, universal ratio or total-memory claim.
Retained copies support the next scoped read-only query/commit attribution before choosing a remedy.

Full source-app owner41193315293 at9ec is queued once behind active installed-platform41192007255.
It verifies shared readiness/setup and settings validation across the full app suite after the focused
editor3/3convergence. Observe actual cases, intentional installed-only skips and lifecycle attachments;
do not treat its pending status or a job label as app acceptance.


[Read-only attribution88658](../references/evidence/ears-sqlite-implementation-2026-10-28/query-attribution-a9/README.md)
completes48normal/24explained queries with exact stored answers and both main hashes unchanged.
Warmed CPU/wall are similar: SQLite candidate selection/eligibility/rerank SELECTs, not only transport,
account for substantial cost. Nested indexed-equality CROSS JOIN order is a concrete next plan hypothesis;
compare planner-led joins/statistics on a copy before a production change. This is not a replacement benchmark.
[Installed-platform41192007255](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-platform-125/README.md)
fails overall: Linux actual packaged Electron native/API-module witness passes; Windows stops before
packaging with spawn npm ENOENT. The preview orchestrator now uses Node plus npm_execpath for run/exec,
without a shell; normal arguments/no-publish/version isolation remain. The affected packaged workflow
preserves build evidence and checks preview unit cases, script types and lint. It needs a new affected
run; source-app411933 remains independent at9ec. No Windows module/renderer pass is inferred.

The same direct npm spawn also exists in build:runtime's four declared legs, reached by Preview builds;
it now resolves the npm JS entry through Node too. This preserves declared build commands, arguments,
core/heap budgets and deadlines; no shell or publishing/version-policy change is introduced.
Script types and existing preview contract cases run after normal output production in the affected
workflow. This build-orchestrator correction requires the next packaged-platform run; no source-app
runtime qualification is invalidated by a non-runtime tool-launch change.

[Full source-app41193315293](../references/evidence/ears-sqlite-implementation-2026-10-28/source-app-9ec/README.md)
is terminal success at9ec:33actualpasses, zero failures/flaky/retries, one named installed-only skip.
The original five-second editor case passes within the full suite; types/harness lint also pass.
Corrected Windows/Linux packaging owner41195143299 runs at323; renewed signed macOS owner41195510812
is queued at the same code input. No new release or adoption is authorized by these checks.

Completed evidence checkpoint: [signed installed macOS 323](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-signed-323/README.md) has six actual passes with no skips/retries; Windows packaging remains open. [Join/statistics diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/join-statistics-a9/README.md) preserves 144 matched queries on an owned copy and does not justify changing production join order. Existing performance and full-goal acceptance gaps remain open. The user separately authorized shared-fixes PR #299; that exception does not authorize SQLite adoption or merging #286.
