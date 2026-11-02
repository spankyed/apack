# Historical handoff before native audit/rebuild

This is the handoff retained before the next implementation checkpoint; it is not current status.

## Current handoff

The goal remains active; all scope, phases and acceptance above remain required. The deliverable is the
existing [draft PR #286](https://github.com/spankyed/apack/pull/286), branch `session/ears-sqlite`.
No master merge, release, production adoption or version-only PR is authorized. Production remains elmdb.
Active integration checkout: `/private/tmp/ears-sqlite-query-integration`. The preceding checkpoint is
preserved at `/private/tmp/ears-sqlite-diagnosis-evidence`, `68cf78a2f4`.

Current checkpoint: qualify incumbent-preserving physical model refresh on committed master `5e81dda7c2`
and native `95615ed8d4`, then complete live replacement suspension and resolve admission responsiveness.
Detached merge `61b287bcd7` combines verified candidate `9fc0e5e19b` with that master snapshot: batched folder
queries/paths, selective flow removal, native graph/reader/watch fixes and the corresponding facade report.
The preceding candidate passes 652 EARS, 18 host and 7 API cases on native `006d6cec88`; those results do
not qualify the later merge. Exact-source combined acceptance remains pending. The preceding detached
merge `edf17cd0dc` integrated master’s runner cleanup and native pin into `23a1e941c7`. The preceding merge `399c4765f0` combines
candidate `fbd3c1c441` with master `debeddc3a6a`,
retaining SQLite explanations/backend assertions, master reverse-traversal clarification and all
**five** current thread-query cases. The new master adds the Message status index, queued-message
relocation and batched library queries. No source branch or other-agent checkout was merged/reset.
The previous `330efa68e6` integration of `68cf78a2f4` and master `8b1a479b96` is historical.
The draft branch publishes candidates for CI review; publication does not establish full combined acceptance.
Checkpoint `3cccc4dfa9` now passes [all three platform hosts](../../evidence/ears-sqlite-implementation-2026-10-28/model-readiness-activation/platform-41034695900/README.md),
including managed startup, current SDK/app queries and actual converted-profile API restart. Full strict
run `41034746897` is still running and has an integration-1 failure: the published SDK inventory test
counted installation-added dependency directories as shipped files. Its assertions now inspect npm's
actual tarball inventory; [all 10 consumer cases, types, lint and the reverted control pass](../../evidence/ears-sqlite-implementation-2026-10-28/published-inventory/README.md). Inspect the
remaining exact run handles; the newer fix and refresh still require a fresh full strict run.
Exact base `1efad34246` is now all-platform green in `41013324901`, including ordinary package loading,
the then-current app queries and native pin `006d6cec88`. Ownership checkpoint `1d16d85c81` also passes
all three platform hosts in run `41019274148`; neither result qualifies the newer activation/master merge. Full Strict and the complete adoption/performance criteria remain required.
Closing checks are matching native source/build, complete platform and full Strict gates, all five
current app-query/SDK contracts, unchanged primary data/units/watches and exact-input verification.
[Integration evidence](../../evidence/ears-sqlite-implementation-2026-10-28/master-query-integration/README.md)
now records a clean matching Linux native build and real SDK/pack coverage at `e8750da8c6`:
1,319 SQLite SDK cases pass with one built-prerequisite skip; that case passes separately after
pack build. Both SDK fixture stores and four current repository cases pass on both backends;
forced native fallback fails the candidate marker. Exact platform run
[40977802135](https://github.com/spankyed/apack/actions/runs/40977802135) is now green
on Linux/macOS/Windows at `d28e2de39c`; Linux executes all 1,320 prepared SDK cases
with no skips. All hosts execute both fixture stores and four built-pack repository cases.
The unchanged own-unit embedding assertion fails on exact native `4d558a2754` and
passes with the isolated journal-overlay fix, now committed/published as
`8ab7088f9a583202f9ccc766381a31e39d19851f`, the preceding tested native pin. The preceding pin
`006d6cec880471e7ccc83899cd9c8704288b04e0` descends from that fix; old artifact receipts do not qualify this newer pin. All required
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
[Evidence](../../evidence/ears-sqlite-implementation-2026-10-28/packed-dependencies/README.md)
retains exact logs and source hashes. The macOS host timeout remains unexplained. The next isolated Linux diagnostic retains
552 module completions before the unchanged 600 s deadline; its effective pool has one worker
inside a two-CPU container, so it does not reproduce macOS concurrency. A missing native-source
chain input is fixed; 112 focused repository cases pass after preparing the UI declaration prerequisite.
Five current query cases pass on **both** backends, and fifteen reporter cases verify separate optional
per-file progress. A 62-assertion counterbalanced scratch probe measures modest eager SQLite import
cost, without establishing the cause of the whole-suite miss or selecting a loader change.
[Current integration and diagnostics](../../evidence/ears-sqlite-implementation-2026-10-28/current-query-integration/README.md)
retain exact inputs, interrupted evidence and failed/unsupported scratch prerequisites.
Strict CI now preserves progress artifacts without altering completed verdicts. Do not relax its deadline
or treat a partial run as green. Base platform source is qualified below. Use macOS per-file evidence
to resolve the host gate, and qualify later implementation edits when their focused checks converge;
a broad retry without diagnosis is not an acceptance result.

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
  does not activate this service; native C cancellation is not guaranteed immediate. Attached owners now
  automatically admit initial eligible generations through generation-specific committed dependencies and
  bounded metadata scans. App creation/loading and incumbent-preserving physical refresh remain open.
- At `25668da288`, 625 EARS, 135 affected host/storage and seventeen native cases pass, with builds/types/API/
  static and four mutation controls. A scope witness rejects the previous duplicate count/exact evaluation.
  [Projection/scope evidence](../../evidence/ears-sqlite-implementation-2026-10-28/vector-projection-scope/README.md)
  preserves the initial nondeterministic fixture failure, its deterministic-ID correction and all profiles.
- [Platform 40969207041](https://github.com/spankyed/apack/actions/runs/40969207041) passed Linux/macOS/Windows
  at `ae156ce242`: seventeen native cases, native-producer conversion, five process-kill cases per host and final
  verification. Linux additionally covers actual baseline/converted API boot/live-pack/restart. Windows has
  explicit POSIX/directory-sync omissions. [40974011649](https://github.com/spankyed/apack/actions/runs/40974011649)
  validates the later projection/scope checkpoint at `68cf78a2f4`; inspect its actual state. Neither qualifies
  the newer combined baseline. Exact receipts and failed Windows linker attempts remain in
  [scheduler evidence](../../evidence/ears-sqlite-implementation-2026-10-28/native-model-scheduler/README.md).

Performance remains failed, with original budgets intact. The
[frozen fresh oracle](../../evidence/ears-sqlite-implementation-2026-10-28/fresh-vector-oracle/README.md)
contains eighteen cohorts, 101 excluded ordinals and 54 scalar checks. The
[actual fresh EARS matrix](../../evidence/ears-sqlite-implementation-2026-10-28/fresh-native-ears/README.md)
at `71810414e8` passes every mean-recall group (minimum 0.972) but misses responsiveness. Broad 100k timed
p95 is roughly 19 ms; large filtered groups are 139–149 ms. Admission heartbeat p99 is 24.34 ms. The
independent verifier rejects those gates and corrupted evidence. Profiles identify native filtered SQL at
121–124 ms and COMMIT as 20.05 of 27.84 s of admission, maximum 385.69 ms. Model installation/observed
GC are small. The subsequent admission-only checkpoint control shows that disabling automatic
checkpoints is insufficient: FULL COMMIT still consumes about 30.24 of 39.35 s, heartbeat p99 is
55.52 ms and WAL grows to 2.16 GB before a 4.56 s final checkpoint. This does not isolate syscall-level
fsync cost; no production checkpoint or durability policy is changed.

Owner-only projection removes redundant payload/distance work without material sampled speedup. Shared
bounded count/exact eligibility reduces a sampled 10k/10% exact query from 20.91 to 16.72 ms, while broad
samples are worse and large filtered queries remain 134–143 ms. No overall improvement or acceptance follows.
Next consolidate remaining scope/count/rerank work in one SQL execution frame, qualify native membership/
distribution and test off-thread SQLite PASSIVE checkpoints with FULL logical durability, bounded WAL,
error reporting and explicit drain. The candidate now owns a pinned native source builder and integer-membership
patch at `native/vectors/`: sorted membership covers sparse int32 and full-width integer metadata without
an ID-range bitmap. All 625 SQLite EARS cases, 555 independent SQL comparisons, a mask-corruption
mutation, allocation-site `SQLITE_NOMEM` refusal and ASan/UBSan comparisons pass in Linux.
[Evidence](../../evidence/ears-sqlite-implementation-2026-10-28/native-membership/README.md)
retains exact inputs and the missing-prerequisite static-check attempt. CI requires the same builder
and 555 comparisons on every host. Platform `40985909864` passes Linux/macOS; Windows executes
its cases but fails source-byte verification because Git converts generated C to CRLF. Canonical LF
before compilation reproduces/fixes that exact failure without changing the required hash or C code;
exact [platform 40996488761](https://github.com/spankyed/apack/actions/runs/40996488761) on
`2d0a0e7d48` is now green on all three hosts. [Retained artifacts](../../evidence/ears-sqlite-implementation-2026-10-28/platform-current/README.md)
verify all 555 comparisons and canonical source bytes per host, five current query cases and both SDK
stores. Linux runs all 1,320 prepared SDK cases with zero skips and the converted API lifecycle.
This qualifies that source, not later edits or full Strict. Older scratch bitmap/text patches are not used.

The complete [fresh membership matrix](../../evidence/ears-sqlite-implementation-2026-10-28/native-membership/fresh/README.md)
on `1860dd2eb1` now passes all patched query-latency and mean-recall gates (minimum 0.974), but still
fails query/admission heartbeat. Initial 10k broad timed p95 is 52.64–52.99 ms versus upstream
145.10–146.05 ms; broad 99,900 remains 20.13–20.26 ms and admission heartbeat p99 is 30.02 ms.
Models differ and order is fixed; this is not paired same-model causal speedup evidence. All raw
answers and failed original-budget verifications remain retained. Scope/count/rerank consolidation,
native cost and FULL checkpoint scheduling remain the next performance work. Normal app model
ownership/loading, packaging and physical failure qualification remain required. Do not retune frozen
ANN settings or loosen thresholds.

The [admission batching checkpoint](../../evidence/ears-sqlite-implementation-2026-10-28/admission-commit-batching/README.md)
now uses the scheduler's four-millisecond work target with at most 128 ordered projection rows, committing
only the processed cursor. All 626 SQLite EARS cases, types/lint and the old-implementation failure control
pass. Two sliced 99,900-vector admissions take 17.74–18.26 s versus 26.57–46.19 s for fixed 32-row batches,
with FULL/default automatic checkpoints unchanged. Commit counts drop from 3,126 to 1,075–1,185.
Heartbeat remains failed and is not consistently better; the 1k tail also regresses. Original data, fixed
chronology and independent models are retained. This is throughput progress, not acceptance or a reason to
repeat broad gates before the remaining implementation converges. Resolve foreground commit cost and
bounded writer/checkpoint ownership, and requalify complete frozen query/recall/app requirements.

[Automatic initial admission](../../evidence/ears-sqlite-implementation-2026-10-28/automatic-model-admission/README.md)
now runs inside an attached owner without external enqueue calls. Committed generation-specific dependencies,
128-reference pages, at most 256 remembered owners, rollback-safe progress, external-version observation and
failed-generation refusal are implemented. Final runtime passes all 633 EARS cases; a later test-only owner-floor
strengthening passes all fourteen model cases. Five controls fail their intended assertions. The real corpus
stays exact at 1k; at 99,900 vectors it automatically enqueues once, trains 20,000 samples, publishes and serves
an actual native EARS query. FULL/default checkpoints and primary bytes are preserved. Admission is 20.77 s
and heartbeat p99 **48.14 ms**, still failed; this admission-only probe does not establish full query/recall,
live-training write contention or app budgets. The intermediate host/storage run retains one 15 s child timeout;
a quiet reproduction and instrumented concurrent 32-case run pass, with no demonstrated cause or fix.
Next create normal app owners, finish signed/installed artifact qualification and implement incumbent-preserving
physical refresh plus full maintenance/drain ownership.
[Empty-store cursor preparation](../../evidence/ears-sqlite-implementation-2026-10-28/native-cursor-preparation/README.md)
now runs before ordinary/stage ingestion. Populated native attachment reuses it without cursor DDL, while
missing populated indexes retain the explicit maintenance refusal. All 635 SQLite EARS cases, types and lint
pass, with a reverted-code control. Those focused SQLite checks use the recorded older native binding,
so current master/native combined platform/full Strict qualification remains pending.
Keep the unresolved Strict/heartbeat/physical/application gates; no production composition changes here.

[Trusted connection loading](../../evidence/ears-sqlite-implementation-2026-10-28/native-connections/README.md)
now accepts an app-owned absolute extension path before schema/data writes. Independent read-only and writable
handles share ready native candidate selection without creating trainers; internal export/audit/replacement
connections inherit the trusted loader from their owner. All 637 SQLite EARS cases, types, boundaries, lint,
normal package build and generated API checks pass; two reverted-code controls reject missing loader paths.
Normal host artifact resolution/owner creation, signing, physical refresh and maintenance/drain remain open.
The new checks do not certify unconfigured writers, exhaustive native integrity, installed app loading, current
native-pin combined CI or performance acceptance.

Graceful API shutdown now awaits host-managed write exclusion, terminal worker drain and close for both
stores before process exit. Repeated signals share one attempt, hooks run once, failures aggregate and report
an unsuccessful exit. SQLite refuses new writes once terminal drain begins; reads and repeat drains remain
available. Live import suspend/resume, replacement/deletion authority, forced termination and installed
process coverage are still required; terminal drain cannot resume the same scheduler. Qualification is recorded
in [shutdown ownership](../../evidence/ears-sqlite-implementation-2026-10-28/shutdown-ownership/README.md):
637 SQLite cases, four host and eighteen affected API cases, types/boundaries/package/API checks, and two
negative controls pass. The API signal boundary is controlled, not installed-process qualification.

[Offline native package production](../../evidence/ears-sqlite-implementation-2026-10-28/native-package-distribution/README.md)
now vendors the pinned upstream C, compiles during ordinary EARS package builds and ships only the library,
stable provenance and license. Public app-only opens resolve and hash-check their package copy by default;
no runtime build/download is added. Offline builds and an independent build match the earlier Linux ARM64
binary; 555 comparisons and an extracted npm artifact pass. All 642 SQLite EARS cases pass before a test-only
private-helper correction; the five corrected artifact cases, EARS/host/script types and 78 build-coverage
cases pass afterwards. Current platform CI must qualify Windows/macOS build flags and exact complete inputs.
The first current-source platform run, `41012481990`, retains a Windows setup failure: early MSVC
activation makes rustc resolve Git's unrelated `link.exe` in bash. Shared setup now pins the absolute
Microsoft linker before native dependency compilation; exact run `41013324901` is now green on all three
CI hosts. [Downloaded package/platform evidence](../../evidence/ears-sqlite-implementation-2026-10-28/native-package-distribution/platform-41013324901/README.md)
verifies the new artifact cases, native binary equality and all current app queries. The
[retained failure](../../evidence/ears-sqlite-implementation-2026-10-28/native-package-distribution/windows-linker/README.md)
qualifies no package/contract tests on that failed host. The corrected exact run supplies the subsequent qualification;
source `38aecfe554` also completes Linux/macOS successfully.
Signing must finalize native binary hashes after library signing and before app/installer sealing. Normal
app owner creation/recovery, live replacement and physical refresh remain separate; no adoption is implied.

[Cross-process model ownership](../../evidence/ears-sqlite-implementation-2026-10-28/native-model-ownership/README.md)
now uses pinned `fs-native-extensions` 1.5.2 with a persistent per-store inode. File ownership excludes
independent handles/processes and survives a handled termination signal until workers exit; process death
releases it. Idle services release synchronously. Final ordinary package builds, all 646 SQLite EARS cases,
types/boundaries/lint and two negative controls pass in private Linux. Exact checkpoint `1d16d85c81`
is now green on all three CI hosts: [retained ownership qualification](../../evidence/ears-sqlite-implementation-2026-10-28/native-model-ownership/platform-41019274148/README.md).
All three execute the kernel-claim and worker-drain cases with the pinned dependency; this does not
qualify the subsequent readiness/activation edits or signed installed applications.

Logical/native readiness separation and managed app activation are implemented and all-platform qualified
at `3cccc4dfa9`, with [focused and integrated evidence](../../evidence/ears-sqlite-implementation-2026-10-28/model-readiness-activation/README.md).
`indexesReady()` waits for declared logical generations; app-only `waitForNativeModels()` includes native work.
The managed API starts claimed services on both writable stores, recovers abandoned attempts under that
claim and drains both stores if startup fails. Forensic/offline opens do not start services. The exact
prior-base overlay passes 652 EARS cases, 18 host cases, 7 API cases, EARS/host/API types, regenerated API
reports, boundaries and lint. Subsequent run `41034695900` qualifies the master/native integration and
managed startup on all three platform hosts. Signed installed startup and full performance gates remain open.

[Physical model refresh](../../evidence/ears-sqlite-implementation-2026-10-28/physical-model-refresh/README.md)
now preserves a ready incumbent while training and projecting a separate physical model. Publication and
trigger retirement are atomic; cleanup is bounded, and interrupted projection resumes without removing the
incumbent. The current-pin Linux overlay passes 657 EARS cases, 18 host cases, 7 API cases, types and static
checks, plus five focused cases and three negative controls. The subsequent exact-source [full strict and all-platform run 41040846758](../../evidence/ears-sqlite-implementation-2026-10-28/physical-model-refresh/platform-41040846758/README.md)
passes at `95515e6463`; installed/performance qualification remains open.

[Live native maintenance](../../evidence/ears-sqlite-implementation-2026-10-28/live-model-maintenance/README.md)
now drains workers while retaining kernel ownership across live reset/import, acceptance and restoration.
Logical backfill remains usable; offline scopes claim without starting services. Canonical reset/replacement
invalidates physical models atomically and rollback restores the incumbent. Native recovery finishes before
success announcements; recovery/settings cleanup failures retain prepared copies and close both stores.
Quarantined handles allow cleanup ownership without enabling data access. Private Linux passes all 665 EARS,
1898 host (one existing Windows-only skip) and 141 API cases, all affected types/static/API checks, plus four
negative controls. Final integrated/platform/installed and performance qualification remain required.

Still required, without narrowing phases 3–7:

- Qualify remaining model freshness/retirement and live-maintenance cases on the final integrated candidate;
  complete native audit/rebuild/restore/retirement and physical deletion/publication ownership, installed loading/signing.
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
[previous handoff](../../evidence/ears-sqlite-implementation-2026-10-28/handoff-before-master-integration.md)
and [checkpoint history](../../evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md).
