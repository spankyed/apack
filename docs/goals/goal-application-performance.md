# Application performance implementation

Status: active. Branch `session/application-performance`, isolated worktree
`/private/tmp/apack-application-performance`, initial source `62f1798c9b`.
Draft PR: https://github.com/spankyed/apack/pull/293. Main checkout remains untouched.

## Acceptance

Implement the approved application-performance plan for all four actions: thread opening,
scripted streaming reply, search and populated startup. Recording is development/test opt-in.
Include bounded OpenTelemetry recording, EARS observation, cross-process/actor propagation,
correct view-ready milestones, source-identified reports and comparison, counterfactual and
overhead qualification, then one evidence-backed application optimization if supported.
Deliver dependent reviewable PR checkpoints and required repository validation. No version
changes, release, automatic CI enablement or speculative engine features. Preserve concurrent work.
The detailed design remains `docs/plans/application-performance.md`; implementation acceptance
also declares 10,000 observations/16 MiB per process, 20 measured trials per revision in ABBA
order, and a 5% lightweight instrumentation median-overhead budget. All four actions remain in
scope even though thread opening is the first vertical implementation slice.

## Current implementation

- Isolated dependencies and outputs. EARS observer/host recorder foundation committed as
  `90fcca9287`; app transport/composition as `d6b9886df3`, with lifecycle fixes in subsequent commits.
  Host uses API ^1.10, sdk-trace/context-async-hooks/core ^3. No global provider is installed.
- EARS `admin.observe` reports encoded request/result byte counts, watch/unit flags and available
  sequence metadata for reads/writes/loads/units. Observer failures, metadata getters and reentrant
  reads preserve application outcomes. Native NOT_DURABLE is classified using sequence advancement;
  sequence is not claimed to identify a read snapshot. Observer registration snapshots are covered.
- Host recording bounds encoded spans, active starts, event context and links; excludes payloads and
  error messages; preserves unknown/malformed/dropped/incomplete observations as loss counters.
  Disabled mode neither initializes a provider/context manager nor enumerates supplied attributes.
  Finished local action contexts cannot leak into later async work.
- Stable controller ports attach/detach observers only during recording. Node uses an owned ALS
  context manager; browser callbacks restore explicit carriers synchronously. Backend admission is
  development/test only, over the authenticated socket, and recording ownership lasts through cleanup.
  Renderer tracing loads only after admission. Stop, disconnect, failed listeners and overlapping
  start/stop are covered. Diagnostic context is separate from synchronous reply-address scope.
- W3C context travels on message/view envelopes, never in persisted business events or view keys.
  Incoming, replies, broadcasts and local surface delivery carry it; handlers can restore queued
  event context. View delivery includes subscription identity and ordinal; stale callbacks from a
  stopped/reloaded generation are ignored. Full raw-XState actor queue coverage is still outstanding.
- Initial view reads/deliveries have spans and EARS ancestry. Coalesced re-reads deliberately have no
  action parent until contributing commit links are implemented. Trace `complete` describes capture
  integrity, not completeness of instrumentation coverage.
- The manual suite is `tests/performance/`, using `definePerformanceConfig` from the shared test
  toolkit. Reusable schemas, identity, summaries, comparison-order/compatibility and Chrome Trace
  conversion live in `@apackdev/testing/performance`, with its own tests/API report and direct Zod
  dependency. Public package entries/build metadata and chain source inputs include the new tooling.
- Thread fixture: two synthetic threads, 100 messages each, fixed timestamps and large bodies.
  Import is outside measurement; default five warmups/twenty measured trials alternate threads in
  one warm process. Start includes action-span creation and renderer surface-event dispatch.
  Completion requires the requested thread, a correlated delivery, the complete correct last page of
  fifty laid-out message bodies and Vue flush. It is view readiness, not paint or physical-input timing.
  Reports preserve failures and actual build/native hashes, native checkout/pin, fixture distributions,
  runtime/machine/cache identities. Comparisons reject dirty or incompatible conditions/native outputs.

## Validation and execution state

- Focused diagnostics/EARS/transport/renderer/report tests and changed-source typechecks pass.
  Disposable mutations proved the byte-budget guard and observer-error preservation fail when removed;
  tracked source was untouched. Generated SDK and testing API reports were regenerated/reviewed.
- Full local `chain --no-native` is not yet green. Initial renderer mock typing and two lint findings
  were fixed and their focused checks passed without widening timeouts. The latest broad run passed
  5,983 tests and failed nine repo-integration assertions (layout/config helper/input coverage/docs/wait/
  export policy). Their integration is now corrected; all 219 focused cases across the affected suites
  pass. Remaining broad checks still require completion. Evidence of that broad run:
  `node_modules/.cache/apack-chain/runs/2026-10-30T16-57-46Z-38340`.
- No complete built-app performance scenario or overhead/timing acceptance yet. The Linux app now
  builds and connects after correcting API declaration portability and guarding macOS-only window
  controls. Three warmups completed with intact recording reports; the fourth failed the view
  correctness predicate. Reports are preserved under `.apack/performance/linux-evidence/` locally.
  Structured requested/observed message counts now distinguish page-bound violations from other
  readiness failures. Do not treat these warmups as qualified latency measurements.
- Docker is restored with about 25 GiB free. Check for another expensive owner before launching;
  do not interfere with another session's containers/processes. The owned image includes Xvfb/xauth.
- Linux runner bookkeeping files are declared by their owner and recorded as explicit untracked
  exclusions in source/native manifests. Tracked edits and unrelated untracked source still mark a
  run dirty; focused tests cover both. No native source or dependency pin is changed.
- Next functional run: `npm run test:linux -- bash -lc 'npm run build:runtime -- --cores 1 && APACK_PERFORMANCE_TRIALS=1 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts'`.
  This is a contract/debug run, not statistical qualification. Generated Linux reports stay in its work
  volume; copy only owned reports back through a read-only helper container if needed.

## Required remaining work

Successful thread-open slice and counterfactuals; raw actor queue context and coalesced-watch causal
links; streaming/search/populated-startup scenarios; cross-revision orchestration and full manifest/
trial consistency checks; detailed profiles/process statistics and overhead qualification; one
supported application optimization; full repository and strict acceptance; dependent reviewable PRs.
Keep PR #293 a draft until its slice is qualified. Do not treat the recorder, authored scenarios,
passing unit tests, or capture-integrity flags as completion of the approved goal.
