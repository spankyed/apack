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

The user confirms the OrbStack move to Seagate is complete and verified and explicitly resumes work.
No configuration change or reinstall is needed. At the user’s subsequent request the candidate is rebased
onto master e3d1a37d5c. Post-move read-only hashes match the preserved
committed database snapshot and pinned native binding/CLI. Durable preservation notes and the pre-resume
source patch remain at `/Users/spankyed/Develop/Projects/apack/ears-migration-preservation-20261031/README.md`.
The complete goal is active; all original acceptance criteria remain required. [Draft PR #286](https://github.com/spankyed/apack/pull/286) targets
`session/ears-sqlite`; production stays elmdb. No master merge, release, adoption, implicit daily-profile
conversion, new PR or version-only PR is authorized. All phases and original budgets above remain required.

Authoritative source: `/private/tmp/ears-sqlite-query-integration`. The clean detached publisher is
`monorepo-worktrees.noindex/integration-3AEBRl`. Canonical `sqlite-evaluation` remains at older `6cf6c8349e`
and is not the current source. Latest runtime checkpoint is `45180293a3`, including the prefix implementation with partial local qualification; platform CI487011c484 validates that runtime.
SDK meta-schema reuse passes235 affected SDK/host cases plus types/lint and hosted attribution;
renderer acceptance remains open after two passes and one pre-mount context failure. The original editor test-diagnostic
checkpoint is `0126eda005`. Integrated master is
`e3d1a37d5c622bfebba7767a09452572284881dc`; native elmdb pin remains
`2441af4658d961f547c7094cd041c2ac246668c5`. The [completed rebase](../references/evidence/ears-sqlite-implementation-2026-10-28/master-rebase-e3d1/README.md)
preserves checkpoint `353eb42255` exactly except master's three documentation files. Source packages
subtree IDs match. Frozen diagnostics retain their original source revisions. Inspect actual Git/process/
workflow state before continuing.

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
- Close the current strict-shard concurrency gap without removing builds/assertions or changing deadlines.
  The phase markers and isolated results above are available; reproduce the relevant overlap before a fix,
  then run the affected suite. Do not dispatch another broad run solely to obtain green.

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
