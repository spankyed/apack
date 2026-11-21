# PR 246 application and native acceptance

The user authorized fresh disposable macOS validation on 2026-10-20. No native/compiler or
Electron acceptance is run on the developer's Mac.

Current repair preserves compiler dependency observations and moves runner caches to `.apack/tests/vite`.
The temporary root-listing filter in the chronological checkpoints below was removed after diagnosis.

## Current coverage, 2026-10-20

**The requested application/native checks now pass.** The complete general/external app route passes
on `f5312107e`; smoke and packaged authoring pass on `c60b5e4ab`, a documentation-only descendant.
All 66 applicable integration files pass across the retained batches below, with two platform skips.
The complete unit pools passed on the earlier strict pin. No single all-green full strict run is
claimed: its failed reporter/facade/archive cases were repaired and verified in focused runs, retaining
completed evidence instead of replaying the entire gate. The packaged-beta host remains unavailable
because no suitable beta release is published. No release or production data was changed.

The [latest strict run `39450690425`](https://github.com/spankyed/apack/actions/runs/39450690425)
was pinned to `1dc65f096716afd79ec3e4064cb4cf5ff2bb0dce` and failed at the facade-report case below. Documentation
updates after that pin do not imply a newer source tree has passed.

| Boundary | Inspected evidence | Remaining limit |
|---|---|---|
| Static checks and both unit pools | `39450690425`: both complete pools pass; 55 build-leg/chain-graph cases pass after the scoped renderer heap change | Exact earlier unit pin retained; later app/runtime checks pass in `39477143294` |
| Integration file inventory | All 66 applicable files have passing results across `39450690425`, `39465321192`, `39468282848` and `39473740323` | Composed runs, not a single normal-suite/strict pass; two platform-specific skips |
| 7.2 actual step-owner service | `39477143294`: all 28 external app cases pass, including the actual brain/service path | None for this requested case |
| 8.1/8.2 actual LMDB import/rollback | `39477143294`: all six real cases pass again | None for these requested cases |
| 5.1/S.1/S.2 settings recovery | `39477143294`: complete general app suite passes 32/32; recovery/reopen and external multi-window cases pass | None for these requested cases |
| S.5 source host | `39477143294`: real CLI install, manifest rebuild, frontend acceptance and shutdown pass again | Packaged beta half lacks a suitable published release |
| Fork replacement/restoration | `39477143294`: complete external suite passes 28/28, including replacement/restoration | None for this requested case |
| Runtime, smoke and packaged authoring | `39482475492`: runtime, 5/5 smoke cases, tarball-only producer/harness and 2/2 pack app cases pass; offline CLI reads/exports pass | None for these requested cases |

## Runs

- [Strict acceptance 39387174436](https://github.com/spankyed/apack/actions/runs/39387174436):
  product checkpoint `1f92ce805c4d2c2168e08558ba0d050332eb11e1`, `--strict --all --cores 2`.
  Failed at the pack unit pool: four assertion failures in two files, not timeouts. Before that,
  all 486 host files passed (5,756 cases; seven skips), including all six real LMDB import/rollback
  cases and the API recovery boot case. All typecheck legs, lint, schema/API/facade/package checks and
  external fixture contracts/fork preparation passed. Integration and app gates were not reached.
  The four failures are stale refusal assertions, a mock import left unfinished after a failed
  assertion, and an undeclared-service access with no expected runtime refusal. The two affected
  files pass all 59 cases after focused repairs; product runtime behavior was not loosened.
- [Supplemental app run 39388281465](https://github.com/spankyed/apack/actions/runs/39388281465):
  checkpoint `faba06f60`; preparation failed before any app tests. The renderer's Vite build aborted
  at V8's approximately 2 GiB heap limit. This was an out-of-memory failure, not an assertion or timeout.
  Follow-up gives only the runtime build a 4 GiB heap and explicitly uses two build workers.
- [Supplemental follow-up 39390043545](https://github.com/spankyed/apack/actions/runs/39390043545):
  checkpoint `d1dc5c283`, failed. The real settings recovery/reopen case passed; the general app
  suite passed 25 cases and failed seven. The external pack suite refused its prebuilt compiler
  startup input (`["entries", ""]`); its default-fork case also lacked preparation. The source CLI
  scenario reached its 60-second initial readiness deadline. Failure inventory and focused repair
  remain pending. All six native LMDB cases passed again. Preparation, including the renderer build
  with the bounded larger heap, passed.

## Coverage boundaries

- **7.2:** the external stamp step now calls a service owned only by its pack. The app test makes its
  flow the root, sends a trigger through the real brain, and observes the service's database write.
  It restores the original root afterward. A runner-owned service factory cannot resolve that service.
- **8.1/8.2:** `packages/apack-host/tests/backup/import.spec.ts` opens real LMDB files and injects
  hydration/reopen failures. Assertions cover incumbent disk and memory restoration and a readable
  retained rollback copy when restoration fails. The app suite separately exercises normal backup
  export/import over the running app's settings/database UI.
- **5.1/S.1/S.2:** the added app case seeds invalid app/feature overrides into real LMDB, repairs
  through the recovery UI, reloads the window, checks unavailable-owner preferences survive, and
  reopens the app to verify normal pack frontend acceptance. Existing boot tests separately prove
  external modules are not imported and pack mutation is refused during recovery.
- **S.5:** the standalone source-host scenario runs the actual CLI/watcher, observes a manifest
  change become a different accepted frontend runtime, and checks the installed declaration.
  Individual startup/rebuild waits remain bounded; cleanup signals only the owned supervisor.
- **Beta:** the user renamed the repository to `spankyed/apack` on 2026-10-20. The former and
  canonical endpoints resolve to the same repository ID (`973469181`), and `origin` now uses the
  canonical URL. The CLI's release endpoint is reachable after the rename and returns no published
  prereleases. The packaged half of S.5 (install while stopped, restart after a backend rebuild)
  remains unproven. No release is created, metadata changed, or source host substituted for it.

No pending item above is claimed passed until its runner evidence is inspected.

## Focused repair checkpoint, 2026-10-20

The seven general-app failures were: two navigation event waits (Library and Logs), two settings
update assertion waits against the removed `SETTINGS.UPDATE` event, one assertion on removed surface
settings metadata, one reset-button locator wait against its old title, and one offline-database
assertion assuming declarative defaults create a stored Settings row. No cleanup failure was reported.
Tests now await the relevant pack surface, use real preference forms and the rendered settings catalog,
and save an explicit override before querying offline. The reset assertion uses the current form action.

External-pack cases refused before app launch; these were setup failures, not native execution hangs.
A private filesystem regression reproduces invalidation of a recorded root listing when a test runner
first creates `node_modules`. Authored directory listings now omit that dependency directory while
explicit dependency reads/listings remain tracked. The regression failed before the repair; the seven
applicable compiler-file-view checks pass after it (the Windows-only case is skipped on macOS).
Runner confirmation remains pending; directory refusals now show recorded and observed entries.
The supplemental workflow also prepares the default fork through its actual producer.

The source pack-dev scenario hit its composed initial-readiness deadline, not an observed child exit.
Its 60s covered cold compilation, frontend compiler startup, app launch, install and watcher readiness;
the same fixture's cold build in the saved run took 153s. Initial setup now has a bounded 300s allowance;
the separate 60s rebuild, 30s runtime acceptance, 15s connection and 15s cleanup limits are retained.
Its child output is streamed as well as retained so the phase reached is visible during execution.

Host and E2E typechecks and focused correctness lint pass. App validation remains pending on a
disposable runner; this checkpoint does not mark any unrun acceptance case complete.

The follow-up audit also found that the reload E2E edited compiled content without renewing its
integrity seal. This no longer models a completed build: reload admission correctly refuses altered
output. The fixture now seals the changed output through the normal build helper and restores content,
manifest and integrity bytes after every outcome. E2E typechecking and focused lint pass; its running-app
confirmation remains pending. App run `39396277423` is pinned to the preceding repair checkpoint
`103e62df1`, so it does not include this subsequent fixture correction.

The remaining static audit corrected the CLI-path case's save acknowledgment: CLI Providers owns its
save state, so the containing General form cannot display that request's success. The test now waits
for the accepted override in the Code actor, then remounts the Settings canvas and checks its value.
Twenty-four additional pure file-view/input-record checks pass across three affected files. No native
compiler or app execution ran on the developer Mac.

## Follow-up run 39396277423

[Disposable run](https://github.com/spankyed/apack/actions/runs/39396277423), source `103e62df1`:
shipped build, runtime, fixture contracts and fork preparation passed. General app results are **30/32**;
the two failures are exactly the later sealed-reload fixture repair (`405487108`, assertion 500 vs 200)
and CLI-save acknowledgment repair (`a611eee3b`, 5s event/UI wait). Recovery/reopen and the other five
previously failing app cases now pass. All six real LMDB cases passed again.

External cases still refused before launch, now at the explicit missing `node_modules` namespace probe
rather than the authored root listing. Vitest's native results cache creates that directory after build.
Move its cache into `.apack/tests/vite`; do not weaken or discard the negative dependency observation.
A private filesystem regression using the actual helper configuration reproduces the runner refusal
before the change and passes afterward; creating an actual dependency namespace still refuses. That
regression and all six prebuilt-pack cases pass, as do the testing/E2E typechecks and correctness lint.

Source `pack dev` successfully built, launched, installed and reached watcher readiness after 256s.
The retained compiler's preceding complete build took 109s. The requested manifest edit triggered
another build (changed entries, content and backend output are logged), so this was a **composed
build/delivery timeout**, not a demonstrated missed rebuild: the old 60s wait expired during compilation.
The scenario now separately bounds rebuild/install at 180s and frontend acknowledgment at 30s;
connection, initial runtime and cleanup limits remain unchanged. No cleanup failure was reported.

Saved evidence: `/private/tmp/apack-app-39396277423.log` and
`/private/tmp/apack-app-39396277423/`. No beta release exists for packaged-host acceptance.
The next runner check must exercise the external suite and source CLI with these repairs and the two
already committed app fixture corrections; the final strict gate is still pending.

### Keep the repair at the output owner

The explicit namespace refusal establishes that the compiler correctly observed the missing dependency
directory. Moving runner output is sufficient; hiding a subsequently appearing `node_modules` entry
from an explicitly captured root listing is unnecessary and could change dependency discovery. Remove
the earlier directory-filter relaxation and its permissive expectation. Keep the richer refusal details.
The runner-cache regression now proves that `.apack` output preserves the complete recorded inputs,
while both the original directory listing and the explicit negative dependency probe still detect an
actual dependency-directory appearance. This replaces the earlier proposed listing exclusion above.

The remaining reload assertion audit found two external cases accepting a temporarily absent frontend
runtime as "different". They now require a present, different accepted runtime, matching the source CLI
case. Fixture typechecking and correctness lint pass. Their stronger assertions belong to the final
committed-source acceptance, rather than being claimed from the already running earlier checkpoint.

## Complete inventory: run 39400009119

[Disposable run](https://github.com/spankyed/apack/actions/runs/39400009119), `387cc62f6`:
**25/28 external cases and 31/32 general app cases passed**. The external step's own service was
executed through the actual brain. All six LMDB cases passed again; the running-app backup test also
completed real export/import and restored its saved values before its later frontend-form wait failed.
The cache-location repair resolved prebuilt admission; no cache refusal remained.

| Failure | Classification | Evidence / repair |
| --- | --- | --- |
| Built-in content reload | Assertion (500 vs 200) | Sealing with the parsed snapshot normalized declaration key order. Preserve the original authored manifest when resealing. A passive local comparison confirms authored and parsed serialization differ while the original sealed manifest equals source. |
| Default-fork replacement | Individual frontend/UI wait (5s) | Backend accepted the fork, but the old label remained when the default assertion deadline expired. Await a present, changed accepted runtime in both windows before checking labels; apply the same boundary to reload; retain the restoration assertion's existing bound. Keep value assertions at their existing limits and retain traces for any remaining frontend refusal. |
| Backup settings ownership | Individual frontend/UI wait (5s) | Import and data assertions completed. After reactivating the companion, its custom form was not present yet. Await its new accepted frontend runtime before asserting the restored form value. |
| Dependency credentials | Whole-case deadline (60s) | The case also compiles a cold pack and checks its generated types before testing authority and two activation cycles. It expired as the re-enabled backend registered. Bound the backend-only build at 180s, typecheck at 20s, and complete case at 240s (40s for credential/lifecycle checks); retain existing individual event waits. |
| Source pack dev | Composed startup deadline (300s) | The initial build completed at 159s, then app/server startup completed. The watcher performs a second initial publication; it was still compiling when the old combined deadline expired. Bound each complete backend/frontend build at 300s (180s + 120s), separately bound app/server startup at 60s, then retain the 30s runtime acknowledgment and 15s connection/cleanup bounds. |

No cleanup failure was reported. The default-fork case composes two 30s frontend publications plus
90s for its windows/UI/restoration (150s overall); both windows' publication waits run together.
The final restoration assertion retains its original 5s bound. These changes do
not alter the default suite/test deadlines or skip value, ownership, refusal, integrity or delivery checks.
Frontend waits remain unproven until the corrected running-app cases pass; they are not diagnosed as
mere slowness from a timeout alone.

Evidence is retained in `/private/tmp/apack-app-39400009119.log`,
`/private/tmp/apack-app-39400009119/`, and its earlier `-suites` download.

Focused follow-up selects only the four failed Playwright cases plus the real source CLI scenario.
The dispatch now explicitly selects `app_acceptance_suite=all|app|external`; an optional
`app_acceptance_test` filters Playwright case names. `all` retains CLI/native acceptance even when its
Playwright cases are filtered. Empty patterns retain the complete selected suite; no default gate is
removed. Both the external fixture and the root app retain failure traces.

## Focused run 39405960363: app report inspected while CLI continues

Source `fe42a10b1`, four selected Playwright cases. The built-in content reload passes with the authored
manifest repair. Both settings-ownership cases pass: real backup import updates the independent window
and restored companion form, and the cold-build/typecheck/credential/reload scenario completes with its
individual operation bounds intact.

The default-fork trace proves replacement in both windows, its visible fork component, actual reload,
user ownership and preserved personal preferences all pass. Its only failed test step is the final 5s
restoration label check ("Fork Notes" instead of "Notes"). The backend accepted the restoration near
that deadline. Restoration now waits for a changed accepted frontend, like replacement/reload, before
retaining the original 5s label assertion. If the source frontend was already current following a refused
candidate, no new runtime is required; this avoids obscuring a primary failure with an unnecessary
cleanup generation requirement. Process cleanup limits are unchanged. The complete fork scenario's
150s allowance covers three 30s publications and 60s for windows/UI.

Early evidence: `/private/tmp/apack-app-39405960363-suites/`. The source CLI result and final strict gate
are still pending; the trace does not claim restoration complete.

## Completed focused run 39405960363

The source CLI's initial installation, manifest-triggered rebuild, installation and changed frontend
acknowledgment all passed. Its remaining failure is **cleanup**, not a build or delivery timeout:
the supervisor's inherited output had not closed within 15s after SIGTERM. The log does not yet
distinguish a live supervisor from a surviving pipe owner. It also shows a further checkout-package
freshness invocation around shutdown; that is evidence to investigate, not proof of the cause.
All six real LMDB import/rollback cases passed again.

Retain the existing cleanup bound. A focused `cli` dispatch avoids rebuilding the default fork or
rerunning unrelated app cases and captures a one-second stack sample of the owned supervisor if it is
still alive ten seconds into cleanup. The sample has its own three-second process limit and remains
inside the runner evidence directory. No compiler/native workload runs on the developer's machine.
The restoration synchronization fix is committed as `e86fcb3ba`; final strict acceptance remains pending.

## Focused shutdown diagnostic 39411189367

Source `6676b9b1a`, CLI-only disposable run: initial install, manifest rebuild and new accepted frontend
runtime pass again. Cleanup again exceeds 15s. The retained `/usr/bin/sample` capture proves the
supervisor is alive ten seconds after SIGTERM and executing synchronous filesystem reads/directory
walks inside a promise microtask; this is not merely an already-exited supervisor's inherited pipe.
The capture does not resolve optimized JavaScript frames to individual source functions.
Evidence: `/private/tmp/apack-cli-39411189367.log` and
`/private/tmp/apack-cli-39411189367/.apack/tests/results/pack-dev.log.shutdown.txt`.

The builder's serialized operations previously began immediately as promise reactions, letting another
expensive compiler-input scan run before pending shutdown signals. Yield once to the event loop at
that queue boundary, then recheck cancellation before preflight. This does not change input selection,
capture, publication, disposal ordering or any timeout. A pure regression schedules cancellation before
queued build preflight: it fails before the repair (preflight runs), passes afterward (original
cancellation reason retained, no package refresh or compiler capture). Twelve adjacent dev-hold and
mocked cancellation cases pass; CLI typecheck and focused correctness lint pass. The full builder
lifecycle fixture and real CLI scenario still require the next disposable check.

## Source CLI acceptance passed: 39414905716

[Disposable acceptance](https://github.com/spankyed/apack/actions/runs/39414905716), source
`f9fdbdef4971b4355b1f8e9ab3ac2c7275ebd99e`: all fourteen builder lifecycle cases pass; the real CLI
initially installs, publishes the manifest edit, receives a different accepted frontend runtime, and
exits within the unchanged 15s shutdown limit. No shutdown sample was needed. Fixture contracts pass
(38 external harness cases). Saved logs and reports: `/private/tmp/apack-cli-39414905716.log` and
`/private/tmp/apack-cli-39414905716/`. This is source-host evidence, not packaged beta acceptance.

## Strict run 39416637186: fork producer aggregate timeout

[Strict gate](https://github.com/spankyed/apack/actions/runs/39416637186), same source: 21 completed steps
pass, including typechecks, lint, schema/API/facade/package validation, the shipped build and fixture
contracts. The fork producer reaches `Output: dist/`, then its **whole-step 600s deadline** kills the
process group. That marker precedes compiler disposal and archiving, so it does not prove either finished.
No assertion failure is reported; unit/integration/app acceptance are not reached. Evidence is retained
in `/private/tmp/apack-strict-39416637186/` and its `.log`.

The producer allotted 600s separately to build and archive but also only 600s to their parent. Correct
this one composition using the existing 900s scenario class: retain the build's 600s cap, narrow archive
from 600s to 180s, and reserve 120s for package freshness, copy, verification and owned-tree cleanup.
Prior completed archive paths took 35s and 57s after the build output marker (including remaining build
cleanup), so the archive limit has measured headroom. Phase start/end logs distinguish those operations
on the next runner. No global timeout class or compiler implementation changes.

A regression checks the sum of the producer's actual operation bounds against its chain deadline; it
fails before the repair (1,320s of phases under 600s), passes afterward (900s under 900s). All 68 graph
and scheduler cases pass, as do scripts/internal-repo-checks typechecking and focused correctness lint. Before
another strict run, validate this producer and the restored-fork app case together on disposable macOS.

## Fork acceptance passed: 39420977378

[Focused disposable run](https://github.com/spankyed/apack/actions/runs/39420977378), source
`f34d4c60764f39b7182941d198f061c01fe75177`: fixture contracts pass; the fork build completes in 401.4s,
archive in 30.8s, and the complete fork replacement/reload/restoration case passes in 48.9s. The
restoration synchronization repair is now exercised in the real app. Evidence is retained under
`/private/tmp/apack-fork-39420977378/` and its `.log`.

## Strict run 39424852985: cold shipped-build operation timeout

[Strict gate](https://github.com/spankyed/apack/actions/runs/39424852985), same source, stops at
`build:default-setup`'s own 600s bound. Backend/frontend bundling has reported output, but `Output: dist/`
was not reached. No assertion failure is reported; downstream acceptance is not reached. The retained
per-step log cannot distinguish module teardown, final source checks, compiler-input recording, output
sealing or read-tree disposal. This is a different boundary from the repaired fork aggregate timeout.
Evidence: `/private/tmp/apack-strict-39424852985/` and its `.log`.

Do not repeat a full gate or change its deadline without identifying this phase. Add finalization phase
timings to the existing build progress, then select a build-only disposable diagnostic. It uses the
strict run's 4GiB Node heap and two-core budget, with a **diagnostic-only 900s bound**, retaining its
streamed build log. Normal strict builds keep their 600s bound. Runtime builds, fixture suites and app
launches are skipped. CLI typechecking, correctness lint and workflow YAML/shell syntax pass.

## Cold-build diagnostic completed: 39427595920

[Isolated disposable build](https://github.com/spankyed/apack/actions/runs/39427595920), source
`b77c2e64b4bf52826aa1d1455c1d4fb7f01c89c2`, completes and publishes verified output. Finalization reports
source validation 49.7s, compiler-input recording 125.4s, output verification 0.3s and input cleanup 0.0s.
This diagnostic demonstrates completed finalization, rather than a deadlock or failed cleanup. It does
not prove exactly where the previous killed run stopped, nor does one completed run guarantee a
machine-independent duration. Evidence: `/private/tmp/apack-build-39427595920.log` and its download.

Classify **only the cold shipped-pack pipeline** as the existing 900s scenario: compiler capture,
codegen, serial declaration/content/backend/frontend bundles, then independent final source and input
verification. Keep all checks and native-worker/event/cleanup handling. No global timeout class is
changed; the separately verified fork's build still keeps its 600s cap, archive 180s and parent 900s.
The diagnostic already exercises this same 900s aggregate limit. Its 600s strict predecessor was too
close to the completed cold pipeline to accommodate the observed runner variation.

Correction to earlier budget prose: the CLI does **not** enforce independent backend-180s/frontend-120s
compiler deadlines. Those figures described earlier test allowances and should not have been called
public compiler limits. The source CLI acceptance test retains its existing 300s **whole fixture build**
wait per build, along with separate startup/runtime/delivery/cleanup bounds; its misleading comment is
corrected. None of those test waits is changed by this shipped-pack chain classification.

## Strict run 39430263642: completed preparation and host units

[Strict gate](https://github.com/spankyed/apack/actions/runs/39430263642), source
`cadc8994e58cb7fab842654fc668833e1f82e5d9`: shipped build passes in 522.2s, fixture contracts in 316.6s,
and fork preparation in 528.5s. All typecheck, lint, schema/API/facade/package checks pass. Host units
reach 486 passing files and 5,769 passing cases (seven skips); the sole failure is an **assertion in the
repository's arbitrary-wait guard**, reporting a 20ms sleep in the pack-claim regression introduced by
`c65a66e8a`. Pack units, normal integration and app gates are not reached. Evidence is retained in
`/private/tmp/apack-strict-39430263642/` and its `.log`.

The regression already holds the bus's teardown callback explicitly. Replace its arbitrary 20ms
delay with one event-loop turn, allowing queued promise continuations to settle while that completion
remains held. Assertions still require both registration and operation claim to survive until bus
completion, and both to release afterward. No runtime behavior, deadline or guard exclusion changes.
All 60 pack-system cases and all four wait-guard cases pass locally; host typechecking and correctness
lint pass. A broader local tooling audit passes 953 cases, with two environmental refusals: stale local
published-package output and sandbox-denied `ps` in a private packaged-app fixture. Those files passed
in the disposable host pool; no product change or local rebuild is needed for those environment limits.

## Strict run 39436045862: unit pools pass; reporter metatest times out

[Strict gate](https://github.com/spankyed/apack/actions/runs/39436045862), source
`98d9a562be1fea76bf6b4ec74a4e5016a4464135`: all preparation and static checks pass; both complete unit
pools pass (487 host files and 121 pack files). Normal integration passes 553 cases across thirteen
files before failing fast on `spec-durations-reporter.integration.spec.ts`'s integration-config case
at its **individual 60s test deadline**. The integration aggregate itself did not time out. The normal
integration output preserves those passes; remaining files and the app gates are not claimed complete.
Evidence: `/private/tmp/apack-strict-39436045862/` and its `.log`.

The reporter test selected the “cheapest” whole package by integration-file count. That count does not
bound execution cost: it launched another package's entire integration half inside the reporter test.
Its child had a 600s allowance against a 60s parent and did not assert its exit status.

Replace that workload with owned tiny workspace fixtures that invoke **real Vitest and both real
reporters** in all three existing command/config shapes. Preserve duration equality, overhead and
workspace attribution; additionally assert exact passed files, a skipped module and child success.
Children use one worker, a 15s bound and file-owned cancellation/draining. Their `node_modules` directory
is private, linking only dependencies/binaries so Vite's config-loader output and caches cannot write
through a shared directory alias. No runtime or deadline increase. The other nested Vitest tests were
reviewed: harness/setup cases exercise their actual authoring boundary and already use owned fixtures;
they do not select arbitrary product suites for a generic reporter assertion.

All eleven reporter cases pass in 3.4s of test time locally, including actual npm/node/npx invocations.
internal-repo-checks typechecking and correctness lint pass. All fifteen wait/subprocess-guard cases pass separately
before another normal/strict acceptance run. The required remaining coverage is the rest of normal
integration and the smoke, external-app and packaged-authoring gates; completed results remain retained.

## Strict run 39450690425: preserved integration passes; redundant facade build

The strict run passes all preparation/static checks and both unit pools again. Integration passes
684 cases across 27 files (including all eleven repaired reporter cases), with two platform-specific
files skipped, before a facade-report case reaches its **individual 60s deadline**. The parent
integration aggregate does not time out. A separate Vitest `onTaskUpdate` RPC timeout is also reported;
this is not an assertion or a cleanup failure. Runtime/smoke and application gates are not reached.
Full logs and all 26 step logs are preserved under `/private/tmp/apack-strict-39450690425/`.

The case removes the report and recompiles only to assert that no missing-report warning is printed.
The required initial setup already builds this same real pack without a report. Capture that successful
build's output and assert its absent-report state before subsequent tests author a report. Keep all
other actual build/report operations and assertions, all eleven cases and existing deadlines. This
removes one redundant native/compiler capture, not coverage of the build's missing-report behavior.

Local CLI typechecking, correctness lint, YAML parsing and workflow shell syntax pass. All 96 focused
wait/deadline/chain-table guards pass. The real facade file still requires disposable macOS verification.
The existing acceptance workflow gains explicit integration-file selection with the same two-worker
limits and project test deadlines; it skips unrelated runtime and fork builds. This enables focused
verification and the 39 uncompleted files without restarting all 27 already-passing files. Two of the
41 files without a pass are intentionally platform-skipped on macOS. No full-gate pass is claimed.

## Focused facade acceptance passes; finish the remaining inventory

[Run `39465321192`](https://github.com/spankyed/apack/actions/runs/39465321192), pinned to
`77a7efecd`, passes all eleven facade-report cases with unchanged test deadlines. The setup build's
no-report output is asserted before a report exists. The passive-build check takes 26.2s and the real
stale-report build 22.5s; no RPC error is reported. Preparation also passes. The inspected JSON and logs
are preserved under `/private/tmp/apack-facade-39465321192/` and its `.log`.

[Run `39468282848`](https://github.com/spankyed/apack/actions/runs/39468282848) selects the 38 remaining
applicable integration files explicitly, retaining two workers and the project-specific deadlines.
The 27 earlier passing files and this focused facade pass are retained. The ELF and PE native library
files intentionally skip on macOS. This is composed integration evidence, not a single normal-suite
or strict-gate pass.

To complete the app gates without replaying the unit/integration pools, the existing acceptance
workflow also offers a `packaged` selection: build the runtime, run smoke, then the existing separately
bounded packaged-authoring producer and app consumer. It uses the same disposable runner, two-core
budget and 45-minute job bound. The normal `all` selection remains unchanged. YAML parsing and every
workflow shell block pass syntax checks. These app gates and the complete app/external selection are
still pending execution; no result is inferred from merely adding the route.

## Remaining integration inventory: 35 more passing files, one composed archive deadline

[Run `39468282848`](https://github.com/spankyed/apack/actions/runs/39468282848), source `77a7efecd`,
passes 35 files and 98 cases before failing `default-pack-archive.integration.spec.ts` at its individual
60s case deadline (67.9s observed). No assertion, aggregate or cleanup failure is reported. The two
facade type-data/published-layout files were collected but did not execute after fail-fast; their empty
JSON assertion lists must not be mistaken for passes. Evidence is retained under
`/private/tmp/apack-integration-39468282848/` and its `.log`.

Archive production performs input replay before and after staging/compression; extraction and integrity
verification follow. Move production into its own setup hook with the existing fork producer's 180s
archive-operation allowance. Keep extraction/assertions and cleanup on their separate ordinary limits.
No product change, compiler redesign, global timeout increase or assertion removal. All 46 deadline/wait
guards, CLI typechecking and correctness lint pass. The next disposable run selects only that archive
file and the two unexecuted facade files. The prior 27 + 35 file passes and focused facade-report result
remain preserved; a single complete normal-suite/strict pass is still not claimed.

## Complete applicable integration inventory; application acceptance next

[Run `39473740323`](https://github.com/spankyed/apack/actions/runs/39473740323), source
`f5312107eb9e9b329cd3d4d163c0c3e1c5b546d4`, passes all three selected files and 33 cases. The archive
file completes in 42.9s including production; extraction and assertions take 295ms. Both previously
unexecuted facade files pass their actual producer/consumer builds, published-package typing and
language-service completion cases. No deadline, RPC or cleanup error is reported. Evidence is retained
under `/private/tmp/apack-integration-39473740323/` and its `.log`.

All 66 applicable integration files now have an inspected passing result: 27 in the strict run,
one focused facade-report file, 35 in the remainder and these final three. The two ELF/PE files
intentionally skip on macOS. This completes the file inventory through composed evidence, not a fresh
single normal-suite or full strict pass. Tests and fixture preparation were repaired; product input
validation and native admission were not loosened.

[Application acceptance `39477143294`](https://github.com/spankyed/apack/actions/runs/39477143294)
is dispatched on the same source for the complete general and external app suites, source CLI lifecycle
and real LMDB cases. Runtime/smoke and the two packaged-authoring halves remain required; the explicit
`packaged` route will cover smoke/authoring separately. No application result is inferred yet.

## Complete app acceptance passes on repaired source

[Run `39477143294`](https://github.com/spankyed/apack/actions/runs/39477143294), source
`f5312107eb9e9b329cd3d4d163c0c3e1c5b546d4`, passes the complete application route in 32m43s:

- 28/28 external-pack app cases, including step-owner service execution through the actual brain,
  multi-window settings ownership, cold credential reload and shipped-pack fork replacement/restoration.
- 32/32 general app cases, including settings admission/recovery, explicit relaunch and normal reopened
  pack acceptance. This supersedes the earlier composed 31 + focused 1 result.
- Actual source CLI initial install, manifest edit, new accepted frontend runtime and owned shutdown.
- All six real LMDB backup import, failed hydration/reopen and rollback cases.
- Shipped pack, app runtime, fixture contracts and fork preparation. The renderer-only 4 GiB build
  ceiling also works in the real runtime build; 55 focused runtime-leg/chain-graph cases passed locally.

No assertion, deadline or cleanup failure is reported. Logs and app/CLI evidence are retained under
`/private/tmp/apack-app-39477143294/` and its `.log`. A fresh read-only release listing still shows
v0.3.14 as latest and no suitable beta host, so packaged-beta S.5 remains untested without publishing.

[Run `39482475492`](https://github.com/spankyed/apack/actions/runs/39482475492) is now executing the
remaining runtime smoke and packaged-authoring producer/consumer route. It is pinned to documentation
checkpoint `c60b5e4ab`, with runtime/test source identical to the accepted app pin above. Results remain
pending inspection. No full strict-gate pass is claimed from these separately scoped runs.

## Final smoke and packaged authoring acceptance passes

[Run `39482475492`](https://github.com/spankyed/apack/actions/runs/39482475492), pinned to
`c60b5e4ab` (runtime/test source unchanged from `f5312107e`), passes in 14m2s:

- Shipped pack and app runtime build, then all five runtime smoke cases.
- Tarball-only external authoring: install the packed CLI/SDK/UI/testing packages outside the checkout,
  scaffold a pack and feature, build real content and runtime output, pass seven harness cases across
  five files, typecheck the published testing declarations, and produce a verified local archive.
- The author half's archive installs into an isolated profile; both app-consumer cases pass. The app's
  installed integrity matches the archive, and the packed offline CLI queries and exports its data.

Both separately bounded authoring halves pass without assertion, operation/scenario timeout or cleanup
failure. Evidence is retained under `/private/tmp/apack-packaged-39482475492/` and its `.log`, and in
the linked run's uploaded reports. This closes the previously unrun smoke and packaged-authoring gates.

The exact integration source pins remain recorded rather than being rewritten to claim one full-suite
pass. General app (32), external app (28), source CLI and real LMDB (6) pass together on `f5312107e`;
smoke (5) and tarball-only authoring/app consumption pass on its documentation-only descendant.
Packaged-beta S.5 remains explicitly unverified until a suitable release exists. Deferred review
findings and the documented physical-watch-path limitation remain as recorded in the review; this
validation does not silently close them or claim a new all-green strict run.
