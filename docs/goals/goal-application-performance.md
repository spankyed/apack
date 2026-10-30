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
  stopped/reloaded generation are ignored. Root backend and surface actor logic restore explicitly carried queued events through a public ActorLogic adapter; internal untagged events are not claimed as covered.
- Initial view reads/deliveries have spans and EARS ancestry. Coalesced re-reads are parentless and link their affected commit contexts (up to 32); unknown and dropped causes remain explicit. Trace `complete` describes capture
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
- Full local `npm run chain -- --no-native` passed on the implementation checkpoint, including
  integration, host/pack test pools, app smoke, external-pack and packaged-authoring checks. The
  provenance collector's intentional untracked-only Git query is documented in the existing rule
  mechanism. Successful run evidence:
  `node_modules/.cache/apack-chain/runs/2026-10-30T18-29-45Z-3915` (865.6 seconds, 19/31 cached).
  Native acceptance remains the bounded Linux run and the separately dispatched strict CI; this
  local command deliberately excludes the native pool.
- Thread-open has a passing built-app contract run; overhead/comparison acceptance is still pending. The Linux app now
  builds and connects after correcting API declaration portability and guarding macOS-only window
  controls. Three warmups completed with intact recording reports; the fourth failed the view
  correctness predicate. Reports are preserved under `.apack/performance/linux-evidence/` locally.
  Structured requested/observed message counts now distinguish page-bound violations from other
  readiness failures. Do not treat these warmups as qualified latency measurements.
- On `82ac63c954`, five warmups and one measured trial passed with clean source/native provenance.
  The default-length rerun reproduced `page-bound` on warmup 4: requestedMessages=100,
  observedMessages=50, both recorders complete. Evidence is preserved in local run
  `thread-open-lightweight-1793384389930`. Initial chat positioning now suppresses automatic paging
  until its animation frames settle and cancels stale frames across thread changes/unmount. Seven
  focused pack tests and pack typechecking pass; the built-app verification is recorded below. This is a
  correctness/work-bound fix, with no latency improvement claim.
- Built-app verification on `1bc6afe750` passed all five warmups plus twenty measured thread opens.
  Every trial requested/displayed fifty messages; renderer/backend capture reports were complete and
  both source manifests were clean. Raw evidence remains local in
  `thread-open-lightweight-1793384628617`. This establishes the scenario's work/readiness contract for
  this run, not an A/B latency improvement or recorder-overhead qualification.
- Docker is restored with about 25 GiB free. Check for another expensive owner before launching;
  do not interfere with another session's containers/processes. The owned image includes Xvfb/xauth.
- Linux runner bookkeeping files are declared by their owner and recorded as explicit untracked
  exclusions in source/native manifests. Tracked edits and unrelated untracked source still mark a
  run dirty; focused tests cover both. No native source or dependency pin is changed.
- Next functional run: `npm run test:linux -- bash -lc 'npm run build:runtime -- --cores 1 && APACK_PERFORMANCE_TRIALS=1 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts'`.
  This is a contract/debug run, not statistical qualification. Generated Linux reports stay in its work
  volume; copy only owned reports back through a read-only helper container if needed.

## Search checkpoint

- `APACK_PERFORMANCE_SCENARIO=search` selects a separate invocation/profile, preventing corpora from
  leaking between scenarios. Thread-open remains the default. Its fixture and original measurements
  are unchanged; the shared browser interface is type-only.
- `522c8d3c35` passed five warmups and twenty measured searches in the prescribed Linux runner.
  The corpus contains 1,200 large messages across twelve threads, exactly twenty matches per query.
  Each action supersedes another query; completion requires the current query's correlated delivery,
  full expected timestamp/thread set, unique rows and laid-out snippets. It excludes input debounce
  and does not independently certify a forced late response or truncated-set ranking.
- Raw successful evidence: local `search-lightweight-1793386293574`, with clean app/native source and
  twenty expected/observed rows in every trial. A disposable Linux-copy mutation changed expected
  timestamps while preserving the count: `search-lightweight-1793386368805` correctly retained a
  failed `result-correctness` trial. Host authored source was unchanged. That counterfactual overlapped
  another session's native build and supplies correctness evidence only, never timing qualification.
- Tests-root typecheck and focused lint pass. No broad local gate is claimed for the new scenario yet;
  the previously green full-chain checkpoint precedes it. Strict CI run `41109512527` was dispatched
  for `c72035b90f` and was still queued at the last authoritative check.

## Streaming and startup checkpoint

- Streaming uses the real default-setup Claude Code chat flow and CLI process service. A fixture
  executable is configured through the existing Settings UI; the existing code navigation event
  selects its owned working directory. No inference override, new application test API or external
  provider is used. Each trial starts with a separate twenty-message conversation.
- On `62828d1f1e`, all five warmups plus twenty measured replies passed with clean application/native
  source and complete renderer/backend recordings. Each emitted twenty-four deterministic chunks,
  produced nine visible progress samples, and ended with the complete text and response timestamp in
  a database-backed message view and its laid-out DOM. Raw local evidence:
  `streaming-lightweight-1793387765976`. Reports include first-visible and maximum visible-update gap
  durations; these do not measure provider-to-database backlog or establish measurement overhead.
- The first attempt correctly failed because raw settings writes lack host-issued access; the
  scenario now uses the normal UI and verifies the accepted CLI path. That failed report remains
  local as `streaming-lightweight-1793387340430`.
- Linux runner now preserves its platform-owned app outputs and uses the existing chain producer
  checks during setup. The subsequent real run reused pack/app builds: each producer check completed
  in 0.4 seconds. No new cache protocol was added.
- Startup lifecycle implementation is underway: a test-only early backend recorder covers admission,
  the authenticated window adopts it once, and the renderer starts recording before its application
  actor. The shared fixture exposes its actual parent-process monotonic launch boundary. Six API and
  five renderer lifecycle tests, affected typechecks and focused lint pass. The populated-profile
  startup driver and built-app proof are still required; do not claim startup acceptance yet.
- Strict CI `41109512527` has passed its producers job; downstream jobs were still running at the
  last authoritative check. It checks the earlier `c72035b90f` checkpoint, not this new source.

## Integrated qualification checkpoint

- Strict CI run `41109512527` completed successfully for `c72035b90f`. It does not validate later commits.
- `e65d84bb98` adds affected-commit links to coalesced view reads, including explicit unknown/lost
  causes. Fifty Linux tests passed, including a real native view linked to two distinct write traces.
- `876b7b6cac` restores queued root-actor context using the public ActorLogic protocol. A controlled
  overlapping-event test and 104 Linux host bus/shell/actor tests passed.
- The thread full-read counterfactual failed as required: `thread-open-lightweight-1793389512933`
  displayed the correct fifty rows but returned 533,752 read bytes against the declared 164,809-byte
  action-window budget. This is aggregate window work, not precise causal attribution.
- Startup's original 25-trial run passed, but review found its visible-title predicate could accept a
  recent-thread shortcut. The stronger main-list predicate correctly exposed incomplete seed
  onboarding. Inspection established that chatStart restores a recent chat and openThread deliberately selects
  the dashboard, regardless of a saved list preference. Preparation completes onboarding and opens
  a declared fixture chat; acceptance now requires its exact fifty full message bodies laid out, plus
  the corpus view and matching chat revision. This tests the real initial usable view; verification is
  ongoing. The weaker run is not startup acceptance evidence.
- Linux qualification now freezes native source at the unchanged `vendor/elmdb.rev`
  (`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`) in
  `/private/tmp/apack-performance-elmdb-pinned`, selected with `APACK_LINUX_ELMDB_ROOT`. This avoids
  concurrent edits in the live native checkout. All four scenarios need an integrated run on this pin.

- On `c2c487ffe0`, all four integrated contracts passed against the frozen native pin, each with five
  warmups and one measured trial. Startup's six fresh launches verified exact restored chat content,
  page size, corpus and matching chat revision. All captures were complete. Retained local evidence:
  `populated-startup-lightweight-1793392442047`, `thread-open-lightweight-1793392510435`,
  `search-lightweight-1793392521893`, `streaming-lightweight-1793392532322`.
  These focused contract runs do not establish 20-trial variability or overhead.
- The built-app `search-supersession` counterfactual passed on that source: an actual old-query result
  is deliberately delivered to the actor after supersession and cancellation. The actor retains current
  results/empty cancelled state. This proves its query guard; transport generations are separately tested.
- Node recording now has aggregate CPU, sampled RSS/heap maxima, GC and event-loop observations using
  constant memory. Disabled mode starts no sampler. Timers/observers stop with recording; failed samples
  remain explicit and make capture incomplete. Host lifecycle/fault tests and portable-schema roundtrip
  pass, as do affected host/testing/API/test-root types. Built-app integration of these totals is pending.

## Required remaining work

Remaining application counterfactuals/overhead and independent late-search fault injection; strong
populated-startup verification and integrated four-scenario qualification; cross-revision orchestration and full manifest/
trial consistency checks; detailed profiles/renderer resource observations, streaming backlog and overhead qualification;
full repository and strict acceptance; dependent reviewable PRs.
Keep PR #293 a draft until its slice is qualified. Do not treat the recorder, authored scenarios,
passing unit tests, or capture-integrity flags as completion of the approved goal.
