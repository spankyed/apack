> Completed 2026-10-19. See [Outcome](#outcome-2026-10-19) for final scope and acceptance.
> The startup prompt and dated checkpoint ledger below are historical.

> Written 2026-10-12 in the settings/discovery planning session.

```text
# Goal: complete settings and discoverable pack contracts

Implement docs/archive/goals/goal-settings-and-pack-contracts.md. Read CLAUDE.md, Background, Decisions,
Working setup and checkpoint workflow, Phases and Constraints first. The updated base is 3d389b9c8 on
session/naming-contracts, which completes naming. Start from a committed state containing that work
and this goal; master is suitable only once it contains both.
Continue on session/settings-pack-contracts in the main checkout: the user promoted this work out
of its initial worktree. Preserve unrelated changes. Use further isolation only if requested or clearly
necessary; never share dependencies, generated output or the index between worktrees.

Follow the linked subsystem plans without duplicating their designs here. This goal owns execution,
checkpoints and completion; manifest-maturity owns the roadmap and subsystem plans own contracts.
Audit actual code before implementation. Record evidence-based corrections in the owning plan.

Naming conventions are complete. Verify that completed baseline once at kickoff; do not poll or merge
the naming branch after each checkpoint. Follow Working setup and checkpoint workflow. Commit each
validated implementation checkpoint before beginning the next; apply the settled naming conventions
to new APIs without reopening the completed naming project.

Finished when:
- Phases 0–7 meet their Done when conditions, including restored manifest-consolidation M1–M6 and all three Phase 6 workstreams.
- Host, pack and feature settings use the common declarative contract and current-format stored data.
- Every supported contribution is discoverable without executable pack/dependency activation;
  generated bindings, catalog identities, updates and source-build freshness agree.
- Entity navigation, frontend boundaries, supported consumed APIs, dependency provenance and
  explicit shipped-pack replacement satisfy their linked plans and external-pack checks.
- The completed naming baseline is included and recorded; no naming integration remains outstanding.
- Changed public schemas, API reports, templates and docs agree; final validation passes.
- External authoring uses real packed CLI/SDK packages and isolated host data; distinguish local
  archive/runtime acceptance from release preflight and public distribution, as specified below.
- Record outcomes, corrections and validation, then archive this goal and completed subsystem plans
  with repaired links. Deferred work remains deferred.

Commit as you go, including any required kickoff integration resolution. Do not push, tag, open/merge PRs, publish,
trigger release workflows or edit release/version metadata unless separately requested. Follow the
Constraints for isolated test data, typed EARS, migrations and validation. No compatibility shims.
```

# Complete settings and discoverable pack contracts

Status: completed 2026-10-19 on `session/settings-pack-contracts`. The Outcome below owns closure;
the execution ledger preserves dated checkpoint history. Lazy activation remains deferred.

## Outcome (2026-10-19)

Completed settings ownership, the full manifest redesign and static discovery, canonical entity
navigation, frontend failure boundaries, consumed APIs, dependency provenance and shipped-pack
replacement. Naming baseline **`3d389b9c8`** is included. The
[final source/requirement audit](../references/evidence/settings-and-pack-contracts.md#final-requirement-and-source-audit--2026-10-19)
accounts for Phases 0–7, all 17 manifest decisions and both naming questions, current implementation,
actual external/runtime evidence, public contracts and final source deltas.

| Phase / requirement | Disposition and evidence |
|---|---|
| 0: checkout and naming | Complete; naming baseline included, work promoted to main checkout by request; unrelated work/stashes preserved |
| 1: foundation and manifest redesign | Complete; shared catalog and normalized declarations, M1–M6 and both naming outcomes audited in the consolidation plan and final source review |
| 2: settings | Complete; host/pack/feature ownership, JSON Schema, trusted shared/restricted access, custom forms, current-document validation and real multi-window/host-only checks |
| 3: discovery and build inputs | Complete; every supported declaration kind and cold consumer, checked bindings, poisoned/source-free inspection, ownership/publication/freshness and bounded native platform matrix |
| 4: navigation | Complete; canonical references, declared destinations, readiness/cancellation and attributed refusal with actual Electron delivery |
| 5: frontend boundaries | Complete; pane/form containment and retired-instance retry checks; backend process isolation remains deferred |
| 6: APIs, provenance, replacement | All three complete; A1–A5, explicit consumer contracts, retired credentials, exact origin/content, fork restart/reload, disable/remove/restore and failure retention |
| 7: review and acceptance | Complete under the user's revised acceptance decision: current normal integration and prerequisites pass, prior/focused evidence maps to remaining unchanged behavior, public/schema/API/docs agree |

Normal unfiltered [39333769307](https://github.com/spankyed/apack/actions/runs/39333769307)
passes on workflow-only **`06638811d`**, matching main **`1ba85b976`** except its workflow:
**831 tests passed, zero failures, 29 platform skips, 66 passed files and two skipped files of 68**,
exit 0, 4896.31s. All normal prerequisites pass, with no unhandled reporting or cleanup error.
[The complete report](../references/evidence/integration-deadline-inventory.md#normal-unfiltered-integration-accepted--2026-10-19)
attributes skips to their preserved Windows/Linux acceptance. The eight-file reporting/watch repair
also passes 56/56 bodies. Later commits change only owning documentation.

The user explicitly waived a repeated complete strict gate after this normal pass (**`2c790624d`**).
Earlier strict runs remain partial/failed; this closure does not claim a green full strict aggregate.
The final audit identifies no additional uncovered implementation check. Current behavior is maintained
in the public manifest/features/content/CLI guides and reference settings/declarative-contribution docs.

Archive this goal and the six completed subsystem plans, repairing incoming/outgoing links. Keep
manifest maturity as the maintained roadmap; lazy activation, security/process isolation, storage,
release readiness and separate validation/orchestration proposals retain their existing owners.
No production data, installed apps, security settings, release versions, tags or PRs are changed.

## Live execution ledger (reconciled 2026-10-16)

**Final acceptance decision, 2026-10-19:** the user approved omitting another complete strict-chain
rerun if the current normal integration gate passes. Complete the requirement/evidence audit, reuse
accepted checks whose covered behavior is unchanged, and run only genuinely uncovered affected
checks. Record exact source and evidence, then close the documentation. This supersedes older
instructions below and in linked subsystem plans to repeat final strict `--all` for this goal; it
does not claim that an earlier failed or partial strict run passed, waive behavior requirements, or
change the repository's general validation policy. Do not dispatch another broad strict gate.

Current checkpoint: watcher operation correction **`fa21a17ba`** and measured reporting repair
**`19c1c9716`** are committed/pushed. Focused acceptance
[39329992884](https://github.com/spankyed/apack/actions/runs/39329992884) on workflow-only
**`3ca1a45fc`** accepts **56/56 bodies in all eight files**, zero pending, **exit 0**, 1267.88s,
with no unhandled reporting/cleanup error. Feature-validation/output-swap worker gaps fall from
69.7/90.3s to **30.9/36.6s**; the largest sampled test-worker gap is 36.6s. All six actual watcher
consumers complete on the consistent operation bound. Preserve exact logs and samples; no broad gate
is implied. Published package/default-setup preparation is separately bounded; unrelated prerequisites
are omitted only from this focused run. Normal unfiltered integration
[39333769307](https://github.com/spankyed/apack/actions/runs/39333769307) is now dispatched
on workflow-only **`06638811d`**, directly containing main **`1ba85b976`**: all normal prerequisites,
`npm run test:integration -- --all`, two cores, no filters/probe or case overrides. Await this same
run, then the evidence audit and documentation closure under the acceptance decision above.
No second broad run is concurrent.

Earlier focused [39311095507](https://github.com/spankyed/apack/actions/runs/39311095507)
accepts **29/29 scaffold/add-extension bodies**, zero failed/pending, **exit 0**, 604.571s, with no
unhandled reporting or cleanup error. Workflow-only **`4dc9c393d`** contains source **`14de022f8`**.
All previously blocked scaffold cases execute and pass. Full public builds take **75/95/179 seconds**,
confirming the need for the existing backend/frontend command composition instead of the former 120s
backend-only selection. The unchanged DSL body separately passes in **71.572s** (`39309152812`);
its former inherited 60s deadline was insufficient. Preserve both evidence sets.

Source **`7c24806e7`** owns the asynchronous CLI/nested-runner boundary, cancellation, awaited closure,
and timeout/refusal distinction; **`14de022f8`** corrects full public build composition. Eight mocked
lifecycle cases, 53 policy/inventory checks, CLI types and lint pass. No product/compiler redesign is
introduced. Earlier normal **39297729330** retains 507 passes but failed scaffold scenario/reporting
and is not a passing gate.

**Normal unfiltered integration [39312954386](https://github.com/spankyed/apack/actions/runs/39312954386)**
failed after 3610.59s with **741 passing bodies, one watched-build operation timeout, 29 skipped bodies
and two unhandled `onTaskUpdate` reporting errors**. All preparation passes and all 11 scaffold bodies
pass. Bail leaves remaining bodies unexecuted; this is not full integration acceptance. Workflow-only
**`cc0ae42b4`** is directly based on main **`f0405e436`**. Preserve its complete log and pool report.
The flow-module watcher starts its rebuild and emits backend/frontend output before its 60s build
deadline aborts; neither a missing watch event nor a whole-scenario timeout is demonstrated. Reporting
errors remain unattributed. Focused diagnostic [39325170997](https://github.com/spankyed/apack/actions/runs/39325170997)
on workflow-only **`e3956518c`**, containing main **`5ce394268`**, selects only module freshness,
output swap, feature authoring/validation and database integration. Two workers, unchanged per-test
deadlines and the existing event-loop probe must distinguish operation cost from worker reporting
starvation. No broad rerun until the demonstrated failures are repaired and affected checks pass.
Source inspection identifies an unjustified first/subsequent build split: every watch request uses a
fresh worker through verified publication. The helper now consistently uses its existing 120s build
bound instead of reducing later builds to 60s; request, notification and cleanup bounds remain 20s.
Seven mocked watcher cases, 53 policy/inventory checks, CLI types and lint pass. The diagnostic keeps
the old bound for immutable evidence. It finishes **93/93 bodies passing**, zero pending, but exits 1
with one unhandled reporting error. Loop measurements identify **69.7s feature-validation and 90.3s
output-swap worker blocks spanning consecutive synchronous cases**; the coordinator stays responsive.
Both files now yield once after their existing cleanup, matching neighboring toolchain tests. No
database change, assertion change or RPC/deadline increase is needed. Policy/inventory checks, CLI
types and lint pass. Accept both reporting files plus all six actual watcher-helper consumers before
normal integration; the eight-file focused check needs only published packages/default-setup output.
Then pass normal unfiltered integration and run final committed-source strict
`--all`, finish the full requirement audit and archive only completed work. The separate validation-
budget/Nx/Wireit proposals remain outside this goal. A concurrent final-source audit finds one stale
`surface.default` schema description claiming registration-order selection; runtime and public docs
already use deterministic catalog selection. The help-only source/generated-schema correction passes
61 existing editor/schema checks, generation check and lint. Final strict must include it; the current
normal run stays immutable. See [source audit](../references/evidence/settings-and-pack-contracts.md#final-source-audit-default-surface-schema-guidance--2026-10-19)
and [accepted focused evidence](../references/evidence/integration-deadline-inventory.md#complete-scaffold-files-accepted--2026-10-19).

Focused configuration acceptance **39296758415** succeeds on workflow-only `952a6dd02`,
containing repair **`d29612b7a`**: all **15/15** cases pass, zero pending, exit 0, 239.315s.
All four transient-edit variants complete; declarations takes 26.195s. No unhandled reporting or
cleanup error is reported. Resume normal unfiltered integration, then final committed-source strict
`--all`. See [complete affected-file evidence](../references/evidence/integration-deadline-inventory.md#complete-esbuild-configuration-file-accepted--2026-10-19).

Previous normal **39289719265** finishes with 493 actual passes, one whole-scenario 60s declaration
case timeout and one separate `onTaskUpdate` error. Its full-build scenario family and reporting
boundary repair is `d29612b7a`; assertions and production code are unchanged. Unreached cases remain
unaccepted until the normal gate finishes.

Focused trigger-scaffold acceptance **39288218287** succeeds on workflow-only `36ea8055a`,
containing repair **`d07ccae99`**: all 18 scaffold cases and two facade typecheck controls pass
(20 actual passes, exit 0, 377.704s; two workers). The repaired trigger case takes 27.020s;
eight other facade cases are intentionally filtered, not accepted by this focused run. No reported
cleanup/runtime error. Resume normal unfiltered integration, then final committed-source strict
`--all`. See [focused evidence](../references/evidence/integration-deadline-inventory.md#trigger-scaffold-file-and-facade-controls-accepted--2026-10-19).

Previous normal **39281108805** finishes with 505 actual passes, one trigger whole-scenario timeout,
and 26 Windows skips; all 41 native/worker bodies pass. Its unreached cases remain unaccepted.

Latest normal **39269209929** finishes with 425 actual passes and a native-thread **whole-scenario
120s timeout**. All 16 worker bodies now pass, including three previously inherited-60s scenarios
that take 62.879s, 61.599s and 78.318s. Native thread refusal/cleanup completes at 126.668s; no value,
cleanup or reporting failure is reported. Correct the enclosing budget from its three separately
bounded attempts and cover the remaining cold OS-admission baseline. See
[native composition evidence](../references/evidence/integration-deadline-inventory.md#normal-gate-compose-native-capture-and-refusal-attempts--2026-10-19).
Repair **`f17d2e286`** is pushed. Run **39275701481** on workflow-only `449aac628` publishes
41/41 passes, exit 0, 1199.532s, including both complete native/worker files and their cleanup checks.
The downloaded log records completed upload/final runner cleanup, while GitHub's status API still
reports the test step running. Preserve that unresolved finalization separately; do not change the
working deadline implementation from the stale phase label. The acceptance command is complete:
resume normal integration on its own disposable runner, then final strict `--all`. See the
[verified report and status discrepancy](../references/evidence/integration-deadline-inventory.md#complete-native-and-worker-commands-accepted-github-status-unresolved).

Latest normal run **39262109257** finishes with 409 passing tests and one inherited-60s worker
observation-refusal scenario timeout; all preparation passes. Its cancellation and earlier passing
controls are preserved. The same-file audit repairs the remaining four cold-build scenario budgets
and bounds their operations without changing production code or assertions. See the
[classification and repair](../references/evidence/integration-deadline-inventory.md#normal-gate-worker-observation-refusal-deadline--2026-10-19).
Repair **`f93015282`** is pushed; focused run **39267061814** succeeds on workflow-only
`25f51cf98`: all 16 worker cases plus four native controls pass (20/20, exit 0, 611.202s; two workers).
No cleanup/reporting error. Normal run **39269209929** is now dispatched on workflow-only
`e8c813028` containing main `d45a03faf`; it retains the ordinary unfiltered command and two cores.
Await its result, then final committed-source strict `--all`.
The [focused result](../references/evidence/integration-deadline-inventory.md#remaining-worker-cold-build-cases-accepted)
records exact durations and preserved evidence.

Runtime identity/publisher-policy repair is committed as **`7ce19661f`**, with focused acceptance
recorded below. Earlier app/compiler implementation checkpoint **`3827993ba`** is pushed. Windows real Electron
backend/frontend build and archive pass on that source; OS-assembly/copy/manifest-freshness
acceptance is `b2972112d`. Evidence remains in the owning records; these accepted paths need no
reassurance repeats. All useful Windows overlays/exports are preserved.

[Strict run `39182963669`](https://github.com/spankyed/apack/actions/runs/39182963669) finished
on **`bc0a4e91c`** after 1748.1s. The external contract (400.3s), fork producer (537.5s), pack typecheck
(37.9s), schema/API/exports and other reached gates pass. All **5,654 host tests** pass (477 files;
7 declared skips), but the pool fails on one obsolete LMDB `@slow` annotation. Source **`31a8e5a24`**
removes only that seven-line header; all imports and test bodies remain byte-identical. The 70 marker
scanner/placement checks and actual scan pass; the unchanged 48 LMDB cases passed in the hosted run.
See [gate evidence](../references/evidence/settings-and-pack-contracts.md#strict-host-tests-accepted-obsolete-annotation-removed--2026-10-19).
The packaged author half, pack unit pool, integration/runtime/app halves were not reached. Authoring's
new two-core reservation therefore still needs real acceptance. No deadline, assertion or gate changes.

Complete direct Electron content-compiler/build/archive acceptance now passes on source
**`f37315483`**: signed macOS ARM64 [39182253220](https://github.com/spankyed/apack/actions/runs/39182253220)
(133.956s) and Linux x64 [39182255120](https://github.com/spankyed/apack/actions/runs/39182255120)
(71.738s). Both prove actual Electron 37.2.4 / Node 22.17.1 execution, owned-runtime retirement,
verified backend/Vue output and Node 23.11.1 archive without compiler-function invocation. See
[direct runtime evidence](../references/evidence/build-input-snapshot-proof.md#direct-electron-content-compiler-and-passive-archive-accepted--2026-10-19).
The invocation receipt complements existing passive-reader/poisoned-import checks. Signed-runtime
environment filtering remains intact. No repeat of these accepted runtime paths is needed.
Strict convergence run [39191666077](https://github.com/spankyed/apack/actions/runs/39191666077)
finished on `945e80c15` after **1877.8s**. All **5,657 host** and **889 pack** tests pass, as do
API/schema/exports/types/lint, the external contract, fork producer and pack typecheck. Integration
stops at one macOS native-watch recovery case's unchanged **120s** limit after 410 assertions pass.
The repair rebuild starts; whether its late stage is slow or stuck is unproven. No authoring/runtime/
smoke/app acceptance is claimed for unreached stages. Logs and next action are recorded in
[terminal gate evidence](../references/evidence/settings-and-pack-contracts.md#strict-convergence-reaches-pack-tests-native-watch-recovery-timeout--2026-10-19).
Focused run [39194487906](https://github.com/spankyed/apack/actions/runs/39194487906) also
fails at 120s on `b51556f8e`: initial watch readiness takes 72.453s, and dependency repair begins at
93.507s. The final rebuild starts; its completion remains unproven. An isolated diagnostic on `146bc2b6e` completes every assertion in
**239.827s** ([39195118565](https://github.com/spankyed/apack/actions/runs/39195118565)); the
last owner-close checkpoint is 238.580s. It proves completed recovery, rather than a missed event or
stalled repair, on that control. Main checkpoint **`bc53fed70`** assigns only this sequential scenario
**300s**, preserves both 20s event waits and all value/incumbent/publication/retirement assertions,
and adds idempotent `onTestFinished` teardown through the existing owners. All 53 timeout/inventory
checks, CLI types and lint pass. The diagnostic branch/worktree remains preserved; it is not merged
wholesale. No production watcher/compiler logic or general suite deadline changes.
Current-source strict run [39196299955](https://github.com/spankyed/apack/actions/runs/39196299955)
finishes on **`55c9e1f54`** after **2039.2s**. All **5,667 host** and **889 pack** tests pass;
schema/API/exports/types/lint, external contract and fork checks pass. Native-watch recovery now passes
in **113.668s**, including owner closure. Integration stops after 420 passing assertions at the next
case, `captures native preload libraries and retains the incumbent after outside-library refusal`,
which reaches its unchanged **60s** outer limit. Its first build completes; later phase completion is
unproven. The authoring/runtime/app halves remain unreached. Preserve [terminal evidence](../references/evidence/settings-and-pack-contracts.md#strict-watch-recovery-accepted-next-preload-case-times-out--2026-10-19).
Isolated diagnostic [39199301017](https://github.com/spankyed/apack/actions/runs/39199301017)
on **`9414d4f4e`** executes and passes both preload/thread cases in **44.652s/53.334s**, including
all initialization, freshness/restoration, refusal, incumbent and teardown assertions. It establishes
completion; the broad run's slowdown remains unattributed. Main **`24dc840c1`** gives only this
three-attempt scenario **120s**, retaining the phase timings and idempotent cleanup. All 53 tooling
checks, CLI types and lint pass. The diagnostic branch/worktree remains preserved and isolated.
Run [39199767205](https://github.com/spankyed/apack/actions/runs/39199767205) passes **all ten
selected cases** on that exact main checkpoint, including the repaired pair and previously unreached
native tail. Main preload/thread cases take **36.625s/45.141s**. No additional native defect is identified.
The complete 68-file integration pool remains unaccepted. Isolated execution-only probe
[39200409842](https://github.com/spankyed/apack/actions/runs/39200409842) runs its normal
two-core command and existing suite deadline after building required pack output. It fails at a probe
setup omission: dependency-read coverage requires records from `npm run typecheck`, which was not run.
This is not a demonstrated product defect or a reason to change the test. Corrected probe
[39201821813](https://github.com/spankyed/apack/actions/runs/39201821813), source **`c51408d15`**,
supplies `npm run typecheck -- --cores 2` first. Its job envelope is 30m because measured cold pack
preparation takes 9m55s before the unchanged 10m suite; no test/suite deadline is changed. The probe
still differs from main `6dcbfdd88` only in its workflow; no product or test code differs.
Run `39201821813` then fails the real standalone coordinator's `facade:check`: npm gives generation
and report different lifecycle metadata, which correctly participates in compiler identity. Source
**`25a15d3de`** launches these two existing CLI phases directly from one parent environment and
explicit workspace, preserving freshness checks rather than filtering environment inputs. A real inert
subprocess regression fails with the old npm wrappers and passes with the repair; all **127** focused
checks, scripts/repo types and lint pass. See [handoff evidence](../references/evidence/settings-and-pack-contracts.md#standalone-typecheck-compiler-context-handoff--2026-10-19).
Updated probe [39203080601](https://github.com/spankyed/apack/actions/runs/39203080601),
source **`40a5b8e1f`**, includes that exact main repair and differs from it only in the isolated workflow.
It stops before the report phase: generation exceeds its existing 60s reader-leg budget (62.0s
including termination). The separate bounded generation/report control
[39203581047](https://github.com/spankyed/apack/actions/runs/39203581047), on **`b83e7c2c5`**,
passes both actual commands in **59.688s/25.191s**, preserving the compiler-context check. Source
**`8f81806a6`** classifies only the captured pack-generation prerequisite as `suite`, leaving individual
reader legs and every test deadline unchanged. All 127 focused tooling checks, scripts types and lint
pass. Updated isolated probe [39203941398](https://github.com/spankyed/apack/actions/runs/39203941398),
source **`28b06add1`**, accepts generation in **88.0s** and all reached reader legs but stops at the
source facade report's inherited 60s passive-check limit. Inspection distinguishes the standalone
declaration bundle from the chain's `--from-build` reader. Source **`ec5943f65`** lets that different
mode declare `suite`, leaving the chain's passive check unchanged; 24 affected tooling tests, scripts
types and lint pass. Coordinator-only [39204669699](https://github.com/spankyed/apack/actions/runs/39204669699)
on **`2bf51ac08`** passes the entire real standalone coordinator: generation **76.3s**, source facade
bundle **68.2s**, pack types **48.4s**, API reports **21.3s**, and all other required legs. Complete
integration [39205345266](https://github.com/spankyed/apack/actions/runs/39205345266)
on **`4bafbdcad`** accepts prerequisites and 398 integration assertions, then stops at two timed
operations: the real Electron control's 120s build-command bound and the repeated-build scenario's
120s outer bound after its first build. There is no failed value/identity assertion; completed later
phases remain unproven. Observability-only **`cfa489dc7`** emits existing repeated-build checkpoints
on all platforms and retains aborted Electron child output. CLI types/lint pass; main deadlines stay
unchanged. Narrow two-worker [39206807491](https://github.com/spankyed/apack/actions/runs/39206807491)
on isolated **`5f4bedfd5`** passes exactly both cases: repeated-build completion at **111.034s**;
Electron init/add/build/archive **28.761/18.270/85.716/8.683s**, complete case **142.149s**.
Every identity/cache/output/retirement assertion passes; the earlier broad slowdown remains
unattributed. Main **`27e9e4109`** applies the existing 360s Windows repeated-build budget to the same
scenario on all platforms and changes only the Electron build-command bound to 180s; its 300s outer
and other command bounds stay unchanged. All 53 timeout/inventory checks, CLI types and lint pass.
Complete integration [39207375977](https://github.com/spankyed/apack/actions/runs/39207375977)
on workflow-only **`b552b950a`** accepts both repaired controls (repeat **90.799s**, Electron control
**106.523s**) and 419 assertions, then stops at the exit-handler candidate-mutation case's 60s
default. Fifteen actual native cases complete, including recovery and preload refusal; the file's
25-test header does not establish execution of its fail-fast remainder. No mutation/refusal assertion
result is available for the timed-out worker case. Isolated **`428014c11`** runs the complete 16-case
worker file in [39209331600](https://github.com/spankyed/apack/actions/runs/39209331600), with
a private 180s default observation window and all existing explicit/inner bounds unchanged. This
covers the currently unreached lifecycle cases together and passes **all 16** in **333.405s**.
Exit-mutation refusal/incumbent checks pass in **22.030s**; frontend read identities, parent loss and
all four public cancellation/cleanup states pass. This does not attribute the pool's 60s timeout;
main's default remains unchanged. One deliberate full-coverage diagnostic
[39210359774](https://github.com/spankyed/apack/actions/runs/39210359774), isolated **`4d4014241`**,
collects all 68 files with two workers, unchanged assertions/inner and explicit bounds, a private
180s CLI default and 20m aggregate observation bound. It disables fail-fast only in that private
control and retains JSON timings, avoiding another partial coverage inventory. Inspect every
failure and completed duration before selecting named repairs; do not merge diagnostic limits or
claim a normal/final gate from this control. That run reaches its 1,200s aggregate limit after
**495 actual passes in eight files**, plus one Windows-only skipped file; **59 files remain unproven**.
The completed native file alone takes **906.983s**, exceeding main's 600s aggregate. No test
assertion, individual-operation or cleanup failure is reported before termination; the driver's
exit-code assertion is consequential. The [deadline inventory](../references/evidence/integration-deadline-inventory.md)
owns the full per-file coverage and failure classification. All 59 remaining file reports are collected from six sequential batches in
[39214676663](https://github.com/spankyed/apack/actions/runs/39214676663), workflow-only
**`32ec489cf`** on main `1a6304827`. Every batch completed within 900s with two workers and unchanged
main per-test deadlines: **251 passed, 38 failed, 50 pending**. Failed setup hooks blocked 47 pending
bodies; three are declared platform/configuration skips. Preserve the eight earlier passing files.
The complete [failure inventory](../references/evidence/integration-deadline-inventory.md#completed-six-batch-inventory-2026-10-19)
classifies every case failure, additional setup failures, one cleanup failure and five Vitest reporting
timeouts. The six complete invocations total 2,942.322s excluding shared preparation; this failed-run
measurement does not certify a completed normal-suite budget.
Next make one evidence-based repair pass: compose multistep/setup deadlines while preserving inner
limits; diagnose execution-input, facade-freshness, HMR and watcher assertions; repair demonstrated
abandoned-operation cleanup. Repair normal grouping and its own aggregate budget from the inventory.
Validate affected cases, pass normal integration, then final strict acceptance. No broad diagnostic
rerun or outer timeout increases to hide assertion/event/cleanup failures. Full integration,
authoring/runtime/app acceptance and final main strict `--all` remain required.
Inventory checkpoint **`89898080c`** preserves every batch and failure classification. Source
**`1e6e7aea7`** repairs the three execution-option failures: direct compilation rechecks ambient
execution identity while owned workers retain their captured startup identity. Three inert Node/tsx
controls prove invalidation, changed identities and exact restoration for conditions, preload order
and execution flags; CLI types and focused lint pass. No native/captured-runtime execution ran locally.
Existing integration assertions are unchanged; affected-suite and full acceptance remain pending.
Source **`ac45e89a5`** declares generated fixture inputs for repository integration, restoring the
producer dependency required by the HMR graph check while leaving fast guards independent. It also
publishes the facade fixture after recording its authored report before read-only inspection. All 105
graph/input checks, scripts/repo/CLI types and focused lint pass. Actual HMR/facade acceptance joins
the affected cases after the complete repair pass; freshness checks and final obligations remain intact.
Source **`401ec05be`** connects frontend/package/publication watcher fixtures to test cancellation and
drains retained startup before deleting inputs. The pending-startup regression and all 19 mocked
watcher lifecycle cases pass, as do five coalescing cases, CLI types and lint. No deadline changes or
new remote run. Real fixture/event-wait acceptance remains pending alongside the composition repair.
Source **`b57d81cc1`** completes the inspected case/setup composition pass without changing global
defaults or event waits. It also makes facade-comparison commands asynchronous and bounded, yields
between completed in-process compiler operations, and awaits actual Electron command closure with
two-second abort escalation. An inert old/current Node control proves the early-rejection defect and
repair; no captured runtime/addon runs locally. All 57 policy/inventory/wait checks, CLI/repo types and
focused lint pass. The [inventory](../references/evidence/integration-deadline-inventory.md#repair-boundaries-and-next-action)
records scope and proof limits. Next validate the affected files and changed native/worker cases on
one prepared disposable runner, then settle normal grouping/aggregate allowance, pass normal integration
and run final strict `--all`. No requirement or gate is waived by these focused repairs.
Affected acceptance [39227491937](https://github.com/spankyed/apack/actions/runs/39227491937) is terminal failure,
workflow-only **`8036d3014`** on exact main **`1f31d38fd`**. It prepares records/default-setup/external
fixtures once, runs the 24 failed files in three eight-file batches, then selected changed native and
worker controls, all with two workers and committed test limits. It retains every group even on failure.
All 24 files report **127 passed, 24 failed, zero pending**; six native controls and five worker controls
pass. The complete [classification](../references/evidence/integration-deadline-inventory.md#affected-acceptance-result--2026-10-19)
identifies four remaining 60s scenario timeouts, eight shared facade type assertions and twelve unchanged
20s event waits, plus one retained-workspace cleanup failure and two runner reporting timeouts.
No setup or aggregate cutoff blocked bodies. Next correct the shared undeclared service consumption,
compose the four omitted multistep cases, and run a small disposable watch proof to distinguish missed
events from slow builds/publication. Trace the cleanup/reporting owners; preserve inner wait limits.
Do not launch another broad diagnostic. This is neither normal integration nor strict acceptance.
Source **`6e0e52f23`** repairs the shared facade fixture's missing `base-pack/search` consumption,
preserving all generated-type assertions and strict provider selection. Sixteen selection checks pass;
an inert control reads the actual two fixture declarations and proves the old manifest excludes search
while the declared consumption selects it. CLI types/lint pass; the eight real typechecks still need
focused remote acceptance. Source **`55ebfc7bc`** composes the four missed timeout cases plus three
additional sequential cases found by auditing default-bound callbacks in all 24 affected files. It
changes six named declarations and their reasons, preserving all assertions and wait calls. All 57
policy/inventory/wait checks, CLI/repo types and lint pass. Next diagnose two representative watcher
cases on one disposable runner with phase timestamps; do not enlarge their event waits. Cleanup and
runner-reporting ownership remain open, followed by focused repair acceptance and both final gates.
The two-case watch diagnostic is [39237809409](https://github.com/spankyed/apack/actions/runs/39237809409),
private **`2fcf5fe85`** on main `39f525b4d`. Only its workflow and temporary watcher timestamp logging
differ. It selects backend flow-module and external CSS-asset rebuilds with two workers, unchanged
20s waits and a seven-minute aggregate. It prepares published packages and typechecks the diagnostic
source without building the unrelated shipped pack. Logs/JSON/status are retained on failure. This
is diagnosis, not normal integration or strict acceptance; no tracing is added to the goal branch.
It is terminal: one case passes, one reaches the original 20s completion wait while its worker is still
building. Both edits are received promptly. Follow-up [39239365441](https://github.com/spankyed/apack/actions/runs/39239365441),
private **`6b204e94d`**, retains that original failure while observing the running backend to completion.
It proves retained compiler/generation reuse and successful delivery **34.373s** after the edit request;
the hot worker takes **22.099s**, compiler-current checking **4.570s**, and final watcher refresh **3.893s**.
This is a full-build completion wait misclassified as a missing-event wait, not demonstrated lost
subscriptions. The same runner executes 13 selected repaired cases: **all 13 assertions pass**, including
workspace bundler/node16 service types and the four timed-out scenarios, but a Vitest `onTaskUpdate`
reporting timeout keeps its command and the run failed. No normal/strict gate is claimed.

Source **`a2a5a057a`** moves the retained frontend input/cache workspace from file teardown to worker
exit, matching Tailwind's process-retained Jiti cache. An ordinary-Node Jiti control proves deleting that
directory while its loader lives causes a subsequent load to refuse `ENOENT`; types/lint pass. The
specific concurrent writer behind the prior `ENOTEMPTY` is unproven, and real cleanup acceptance remains.
Source **`ca68206b6`** introduces the real-builder test helper; **`4f63277f0`** migrates the affected
watch scenarios to separate 20s request, 60s compiler, original 20s notification, and 20s cleanup bounds.
Initial capture remains 120s. Existing output/incumbent/error assertions and `vi.waitFor` predicates
and limits are AST-checked unchanged across all six watcher specs. Seven helper boundary tests plus
the existing retry/policy/inventory/wait checks pass (**83 total**); CLI/repo types and lint pass.
No production watcher/compiler contract or validation is relaxed. Real phase/cleanup acceptance is next.
Source **`22aeef628`** routes the long migration-scaffold command sequence through the existing
`callCli` helper so completed commands yield before the next synchronous generation. Its 144s direct
sequence previously had no deliberate loop turn before the final typecheck. Existing migration
assertions remain, with command-success guards added; types/lint pass. The reporting repair requires
focused concurrency acceptance before normal integration. Update the prepared normal source with all
validated repairs; it remains undispatched, and final main strict `--all` remains required.
Source **`7110c2632`** extends that yielding CLI path to all scaffold commands in the affected file,
with explicit pack roots and unchanged generated-code/refusal assertions. Focused acceptance
[39243953202](https://github.com/spankyed/apack/actions/runs/39243953202) is terminal on
workflow-only `99ffd7bfa` over that exact source: 19 watcher/cache cases, then the entire 18-case
scaffold file and two dependency typechecks, two workers per sequential group. Each group saves its
evidence immediately. This is acceptance of the demonstrated repairs, not another broad diagnostic;
normal integration and final main strict `--all` still follow only after convergence. The watcher group
reports 18 passes and one compiler-operation timeout; no cleanup or reporting error. The independent
scaffold/dependency group passes all 20 cases with exit 0, accepting the CLI sequencing repair. Preserve
those 38 passes. Isolated two-case [39247182439](https://github.com/spankyed/apack/actions/runs/39247182439)
on `b6b3de3e0` now diagnoses only the timed publication rebuild beside CSS recovery. Its bounded
completion observer retains failure against the original 60s allowance; temporary tracing and extended
observation are not main source changes. See the [classified results](../references/evidence/integration-deadline-inventory.md#committed-repair-acceptance-dispatched--2026-10-19).
Source `dbba1429f` adds pack/allowance/cause attribution to the helper's generic timeout; its seven
mocked checks, CLI types and correctness lint pass. Main deadline values and cancellation stay unchanged.
The two-case phase control `39247182439` passes with exit 0 and zero original-deadline crossings:
publication rebuilds complete in 43.465s/38.742s and expected refusal in 10.712s, retaining the
compiler generation. CSS recovery also passes. The earlier abort's slowdown remains unattributed;
no compiler/performance fix or main timeout increase is claimed. Preserve that failed evidence.
Focused behavior now has passing evidence under the original limits; proceed to required normal
integration for full-queue/remaining-variant acceptance, then final main strict `--all`.
Normal integration [39248035810](https://github.com/spankyed/apack/actions/runs/39248035810)
is dispatched on workflow-only `41b9a6c8e` over exact main `f1c1052ce`: normal unfiltered
`npm run test:integration -- --all`, two cores, original source deadlines, with required typecheck,
pack and external-output preparation. No diagnostic source is merged. Final main strict acceptance
and the complete requirement audit/archival remain outstanding.
That normal run is now terminal and failed: all preparation passes, then integration stops after
350 reported passes at the captured-Electron control's nested 30s driver deadline. Capture, 15s
launch, verification and retirement share that parent; no value/cleanup/aggregate failure is reported.
This missed nested boundary requires focused phase composition and real Electron/database concurrency
acceptance before another normal gate. Preserve the earlier 38 focused passes and successful
publication control; final strict `--all` and all remaining completion requirements stay open.
Source `646abdd3a` composes only that Electron driver: capture 60s, unchanged launch 15s,
verification/retirement 20s, with a 120s complete case. Asynchronous `execFile` preserves runner
updates; completion phases and original identity/disposal assertions remain. All 53 policy/inventory
checks, CLI types, correctness lint and embedded-driver syntax pass. Focused
[39250994872](https://github.com/spankyed/apack/actions/runs/39250994872), workflow-only
`5ead60321`, now verifies the actual driver beside all 64 database cases on two workers before another
normal gate. No production compiler/runtime or blanket deadline changes.
That first focused workflow omitted default-setup's build: Electron passes in 5.357s, but 59 database
fixture assertions fail for missing `dist`; five metadata cases pass. This is not accepted concurrency.
Corrected [39251438405](https://github.com/spankyed/apack/actions/runs/39251438405), workflow-only
`0e7ac97da`, adds the actual pack prerequisite and refuses to run acceptance if it fails. Source
`646abdd3a` is unchanged. Preserve the setup failure and require all 65 cases before another normal run.
Corrected `39251438405` now **passes 65/65 with exit 0** after the actual pack prerequisite succeeds:
Electron control plus all 64 database cases on two workers. The Electron control takes 4.174s and
verifies identity/currentness/retirement without RPC or cleanup errors. The prior 30s slowdown remains
unattributed; the composed driver repair is accepted, not a claimed performance fix. Resume required
normal unfiltered integration with this committed source, then final main strict `--all`.
Normal [39253013877](https://github.com/spankyed/apack/actions/runs/39253013877) is now dispatched
on workflow-only `92fe30ef6` over exact main `9783f52e2`, retaining required preparation, unfiltered
repository command and two-core budget. Final strict, requirement audit and completed-only archival
remain required; no diagnostic source is merged.
That normal run is terminal and failed after 408 reported passes: one 60s whole-scenario timeout in
the worker-thread external-input case. Both Electron controls pass, including actual build/archive;
global bail leaves later cases unaccepted despite the native file's “25 tests” declaration label.
Source `f9cb91f38` bounds the cold thread build at 120s plus 20s verification, registers/drains fixture
build owners on cancellation and preserves every content/input assertion. Other case deadlines stay.
All 53 policy/inventory checks, CLI types and correctness lint pass. Focused
[39257458780](https://github.com/spankyed/apack/actions/runs/39257458780), workflow-only
`3412e646b`, now runs all 16 worker cases beside four native/Electron counterparts on two workers,
without bail, before another normal gate. Required strict and complete closure remain outstanding.
That complete affected run reports 18 passes and two individual-operation timeouts, all 20 bodies
executed. The repaired thread case passes in 107.986s, including build at 89.190s and verification at
107.952s; no cleanup/reporting error. Remaining failures are full watch readiness at 60s and real
Electron backend/frontend build at 180s, after backend output is produced. Source `4f20bab39`
separates full readiness (120s) from compiler entry (unchanged 60s), and composes Electron backend
plus cold frontend in only that command (300s); other command/shutdown/cleanup bounds remain.
All 53 policy/inventory checks, CLI types and correctness lint pass. Focused
[39260287200](https://github.com/spankyed/apack/actions/runs/39260287200), workflow-only
`bbb5e06b8`, now runs exactly the two failures on two workers. Preserve the 18 passes; no broad gate
until these converge, and no compiler-performance fix is claimed.
Both cases in `39260287200` now pass with exit 0: full readiness 88.967s and real Electron build/archive
170.275s. Preserve the previous 18 passes; these are scoped behavioral acceptance, not a whole-suite
pass. A static audit of remaining default-bound direct build/capture cases identifies one additional
untracked declaration-fixture build whose timeout can race fixture deletion. Source `526255eee`
registers/drains its builder, propagates cancellation and composes cold build plus source-free/runtime
inspection without changing assertions. All 53 policy/inventory checks, CLI types and lint pass.
Focused [39261544678](https://github.com/spankyed/apack/actions/runs/39261544678), workflow-only
`b1e703d18`, checks that fixture with concurrent compiler-thread capture before another normal gate.
That acceptance now passes 2/2 with exit 0: own-declaration source-free/runtime case 32.033s and
concurrent thread-input case 38.328s, without cleanup/reporting errors. All focused repairs have
passing behavioral evidence; resume normal unfiltered integration on their combined committed
source, then final main strict `--all` and complete requirement audit/archival. Do not turn these
focused passes into a whole-suite completion claim.
Normal [39262109257](https://github.com/spankyed/apack/actions/runs/39262109257) is now dispatched
on workflow-only `8d7776bc1` over exact main `a5e0d89ee`, with all accepted repairs, complete
prerequisites and the unfiltered two-core repository command. Final strict and full closure remain
required; no diagnostic source or private deadline overrides are present.
Source **`21ed07fe7`** gives complete integration its own 120-minute aggregate class. The pool runner
reads its owning chain step's deadline; ordinary unit pools remain at 600s. The measured file work
already exceeds 53 minutes at an ideal two-worker balance, without blocked setup/preparation, so the
former ten-minute aggregate cannot accommodate this workload. Retain one two-worker queue: the longest
file does not exceed half the observed total, so splitting it is not justified by the current evidence.
The strict job envelope is 180 minutes for preparation, acceptance and app checks. This is an aggregate
backstop, not a healthy-run measurement or an increase to operation/event/cleanup limits. All 167 focused
graph/pool/input checks, scripts/repo types, lint and workflow YAML parsing pass. One earlier chain-table
metadata-import check reaches the compiler-runner guard on this daily-use Mac; leave that check for
disposable CI rather than bypassing the guard. Normal integration and final strict gates remain required.
Follow-up source **`4750ad766`** bounds the pool's package preparation independently with the existing
`packages:ensure` deadline (600s). It replaces an unbounded synchronous subprocess with the existing
bounded process owner; the 120-minute integration aggregate does not become its hang limit. All 121
graph/pool/orchestrator checks, four existing ordinary-Node process-lifecycle checks, script types and
lint pass. An inert timed-termination control returns code 124 after its 1s allowance plus 2s cleanup.
The prepared normal gate is workflow-only **`2769be3cc`** against exact main source `4750ad766`, on
`session/integration-normal-acceptance`; it is not dispatched. Update it with the validated remaining
repairs before using the normal pool with declared prerequisites and two-core budget, followed by main
strict `--all`. The current affected reports above keep both gates open.
None of these probes is a strict-chain result, despite using the existing `strict_chain` dispatch route. Main's
full strict command is unchanged and remains required after integration converges. See
[measured acceptance](../references/evidence/settings-and-pack-contracts.md#sequential-preloadthread-completion-and-scoped-budget--2026-10-19).
The bound-only refusal boundary is user-approved and repaired separately below.
Earlier broad run `39191666077` predates `31ed0dcad` and `eb552cf65`; run `39196299955` includes
both repairs. Final accepted source must additionally include the later bound-only repair below.

Windows **Node 23.11.1** also archives the retained Electron-built pack successfully (20.599s), with
the exact previous archive checksum. The first private 60s control timed out; the diagnostic verifier
then accepted all 40,731 observations in about 55s. A measured 180s private control completed in
20.599s; no repository deadline or production source changed. See [Windows consumer evidence](../references/evidence/build-input-snapshot-proof.md#windows-node-consumer-of-the-retained-electron-build--2026-10-19).
The VM has no remaining compiler processes; its evidence is exported and Azure confirms it is deallocated.

The publisher-policy fixture is now valid: process-owned signing and the documented SDK/cache APIs
install, query and remove its unique identities. Its real DLL changes 11→22 after policy installation.
The helper matches that selection, but the original observation record incorrectly stays valid.
The committed helper repair records policy-store membership and policy/catalog bytes; the same
reproducer now invalidates. Batched directory attributes retain the existing five-second query bound.

The durable regression exposes a separate identity-contract boundary: source/copy files and owned
directories are identical, but Windows runs the original executable with DLL v1 and the fresh copy
with v2. The current `runtime.hash` combines distribution integrity with effective OS binding state.
The existing accepted [native boundary ADR](../../references/adr/native-compiler-input-boundary.md)
already requires normal OS resolution for the actual fresh process, distinct from the supervisor's
loaded libraries. The earlier request for a new user choice was unnecessary; no exclusion or narrowed
contract is introduced. The implementation candidate separates copied distribution integrity from
executable-specific selection, records the fresh runtime in the compiler identity and includes OS
namespace membership in reuse freshness. Original and copied selection baselines remain independent.
The durable regression retains its stale-record and actual selected-DLL assertions; its copy check
now compares distribution integrity. See [identity evidence](../references/evidence/build-input-snapshot-proof.md#publisher-policy-freshness-and-runtime-identity-boundary--2026-10-19).
The [runtime-identity caller audit](../references/evidence/build-input-snapshot-proof.md#runtime-identity-caller-audit--2026-10-19)
identified a reuse gap: capture did not retain selection observations, and its hash omitted directory
listings. The repair closes direct reuse with OS listing hashes and separate runtime baselines;
preserve common-record replay too. Frontend readiness echoes the generation hash and is not an
independent DLL-selection proof.
The existing Node/Electron native proofs remain separate; this new ordinary-loader case does not
replace them. The repair is source checkpoint `7ce19661f`; its earlier WIP has been committed. Earlier evidence accepted 69 pure PE cases,
11 subprocess checks, CLI types and focused lint, and diagnosed the durable failure at combined-hash
equality. The new separation now passes 76 pure cases (two declared platform skips), all 11 subprocess checks,
CLI types and correctness lint. On the exact seven-file Windows overlay, Common Controls passes in
5.228s and publisher-policy invalidation/copy selection in 9.255s (17.32s total). Evidence is exported
as `/private/tmp/apack-runtime-selection-evidence-365d3ae15.zip`; all seven file hashes match this
checkout, no compiler processes remain, and Azure confirms the VM is deallocated. The first Common Controls query timed out at the unchanged
five-second helper limit; isolated timings and the subsequent focused pass are preserved without
claiming that startup variability is fixed. No deadline/assertion or native support boundary changed.
This is focused source acceptance, not converged B6 or final strict acceptance.

Frontend CJS preload capture/reporting is accounted for through the existing owner, with no
production repair needed. Source **`387555312`** proves real preload/dependency reads are retained,
reported as watch probes, rejected on edits and accepted after byte restoration; authored reads after
startup remain live. All five owner tests, CLI types and lint pass. This in-process proof complements,
not replaces, existing real frontend/native/HMR acceptance. See [preload evidence](../references/evidence/build-input-snapshot-proof.md#frontend-javascript-preload-ownership-audit--2026-10-19).

**Bound-only Windows import decision: approved by the user on 2026-10-18.** Native compiler imports
containing only bound addresses, without recoverable import names or ordinals, are unsupported and
must receive an attributed refusal. Ordinary imports and bound imports retaining lookup information
remain supported. The [native-boundary ADR](../../references/adr/native-compiler-input-boundary.md#decision)
owns the contract; the [decision evidence](../references/evidence/build-input-snapshot-proof.md#bound-only-pe-support-decision--2026-10-18)
retains the rationale and proof limits. Source **`12447893a`** moves refusal before dependency
resolution, closing OS-library and missing-target bypasses. All 68 focused CLI and 22 loader-hook
checks pass, including requester/dependency attribution and prevention of the native loader call.
Existing Windows normal/bound-lookup and failed-candidate incumbent proofs remain applicable through
the unchanged publication owner; see [focused acceptance](../references/evidence/build-input-snapshot-proof.md#bound-only-refusal-before-resolution--2026-10-19).
Converged/final acceptance must include this repair; run `39196299955` predates it.
Do not restart address-recovery research or invalid fixture
construction. Revisit only for a real required dependency with an independently Windows-loadable
reproducer. This approval closes the support decision, not B6 or final validation.
Remaining native requirements, B6 and every Phase 7 obligation remain required. The broad gates and
native-watch/preload reproducers and native-tail acceptance are terminal; the full integration probe
is identified above. Complete integration acceptance and the required committed-source gate.
No native execution runs on the daily-use Mac.

Completion review finds and repairs an authoring ownership defect in **`31ed0dcad`**: valid
`constructor` declarations no longer collide with inherited properties, inherited features cannot
receive services, and refused feature-service scaffolding writes no source files. All nine focused
authoring/writer checks, CLI types and lint pass. The first manifest/settings source review is recorded
[here](../references/evidence/settings-and-pack-contracts.md#completion-review-manifest-and-settings-source-contracts--2026-10-19);
no whole-goal completion, final runtime acceptance or requirement exclusion is claimed.

Phase 6 source review repairs nested service-array semantics in **`eb552cf65`** while preserving
caller/provider retirement, private receivers and ordinary result/stream settlement. All 46 focused
binding/cache/replacement cases, host types and lint pass. Current provenance publication and shipped
ownership review identifies no additional demonstrated implementation gap. See [Phase 6 review](../references/evidence/settings-and-pack-contracts.md#completion-review-consumed-apis-provenance-and-shipped-ownership--2026-10-19).
The completed strict run predates both review repairs; final committed-source and external-runtime acceptance
remain required, and no unresolved requirement is waived.

Completion source review on `eb552cf65` also rechecks Phase 3–5 boundaries: catalog metadata is
separate from executable availability; typed field inventories cover current registration contracts;
entity delivery rechecks destination/binding/actor readiness; frontend retry requires the current
owner identity. No additional demonstrated defect is found in those inspected paths. This does not
replace poisoned/source-free discovery, navigation races or actual pane/window acceptance in the
existing evidence and final gates. Primary PE documentation and preserved ordinary-loader failures
do not prove all bound-only binaries invalid. The user has since approved the narrow refusal boundary
recorded above; no guessed symbol recovery or broader native-support exclusion is authorized. The completed focused reproducer and current
strict gate are identified above.

This ledger owns current execution status and ordering. The phases below retain all completion
requirements; subsystem plans retain detailed contracts and acceptance cases. Dated checkpoint notes
are historical evidence, not additional live backlogs. Their old “next,” “remaining” and prerequisite
statements do not override this ledger. Where a subsystem plan still requires the entire freshness
workstream before every discovery migration, use the per-deliverable dependencies below instead.
No requirement is waived by this reconciliation, and no final acceptance is claimed.

“Implemented” means source checkpoints exist; it does not mean final committed-source acceptance is
complete. “Partial” identifies implementation still required. Final verification is tracked separately
so completed implementation is not repeatedly scheduled as new work.

| Deliverable | Implementation status and source evidence | Remaining implementation / exit condition |
|---|---|---|
| Naming and checkout baseline (Phase 0) | Complete: `3d389b9c8`; promoted checkout recorded below | No naming integration or repeated baseline project. |
| Shared declaration/catalog foundation (Phase 1) | Implemented foundation; current registration-field classification closed in `031e3a521` | Retain native/authored, source-free and checked-binding coverage for final all-kind acceptance; no new catalog or unclassified registration field. |
| Settings (Phase 2) | Implemented: catalog integration `f3416ad2f` and subsequent settings checkpoints in the evidence record | Final three-owner, policy, reset/import, disabled/failed owner, custom-form and multiple-window acceptance; no new extraction. |
| Manifest consolidation M1–M6 | Implemented and checkpoint-validated through `0994ae787`; own-key preservation `29f0cc556` | Preserve all 17 reconciled decisions, both naming outcomes and generated EARS/content behavior in final acceptance; do not restart consolidation. |
| Settings/help/info/reference/step/command discovery (Phase 3) | Implemented reader migrations: `2169d29f8`, `6c876c9ba`, `20ab75efe`, `c776d1c5d`, `76df2f0e5`, `71fad4013`, `8ec5285ed`, `f7d63434c`, command catalog `ff48438cd` | Final all-kind acceptance, including source-free inspection, inactive owners and checked runtime eligibility. |
| Live editor composition (Phase 3) | Implemented in `8863043a6`; real cold-worker/typed replacement/shared lifetime acceptance `d1c38bc58`, no-activation marker `9b7d112cf` | Preserve the five real host-only window cases and locally accepted five-build DSL case `3913fe196` for final acceptance; do not restart composition. |
| Remaining discovery consumers (Phase 3) | Implemented reader/admission slices recorded below and in the discovery plan; current field/reader classification closed in `031e3a521` | Flow external/source-free acceptance `415228f0c` and real DSL worker acceptance `d1c38bc58` are locally closed. Preserve native/viewer/content/migration/endpoint/navigation/asset checks for final all-kind and window/loader acceptance. Build-input ownership remains separately open under B1/B3/B6. No additional reader implementation gap is identified by the current audit. |
| Build input/publication and freshness (Phase 3) | B2, B4 and B5 implemented and locally accepted; generation-cache ownership repaired in `caf57cb0e`; B1/B3 closure and B6 outstanding | Close remaining native/platform/thread ownership acceptance and converged checks; preserve the common record and four migrated passive consumers. Installed discovery must remain source-free and activation-free. |
| Entity navigation (Phase 4) | Implemented with local handler/runtime acceptance through `95ff95ab3`, following producer `94148c9e0`, catalog/admission `479c75e01`, routing `cd9c57de6` and feature repair `831221020` | Preserve six-handler, cancellation and stored-message acceptance through final strict validation; retain build/publication and strict-gate acceptance for B6. No further navigation implementation is currently identified. |
| Frontend boundaries (Phase 5) | Implemented and locally accepted: `713a6c1fd`, including the real external-pack window | Preserve pane/form containment, attributed nonfatal diagnostics and retired-instance refusal through final committed-source strict acceptance. |
| Consumed APIs (Phase 6) | A1–A4 implemented through `bb6df4a45`; A5 authoring/harness `45f2a3458` / `1fbc1e223`, complete external app/fork acceptance on `031e3a521`, and schema/API/export agreement on `b62da5c72` locally accepted. See [A4–A5 evidence](../plans/declared-capabilities.md#bounded-implementation-checkpoints). | Preserve accepted selection, lifetimes, content-target checks, settings policy and typed/untyped EARS through final producer/app convergence and strict acceptance. The [current-source settings/API review](../references/evidence/settings-and-pack-contracts.md#settingsapi-current-source-review-and-callable-service-repair-2026-10-18) repairs callable-service retirement bypasses through the existing owner; all 14 binding and 81 focused settings checks, host types and lint pass. Preserve this repair through the final gate. No separate unexecuted local app migration is identified. Declaration availability remains distinct from executable readiness. |
| Dependency provenance (Phase 6) | Cache/admission `ff4358588` and inspection `d6fa2c6dc`; current reader/producer audit confirms exact origin/version/content and read-only reuse acceptance | Local provenance acceptance closed by the existing real producer/consumer proof and current passing cache/resolution/inspection cases. Preserve through the final gate. Compiler input/output freshness remains separately owned by B1–B6; frozen resolution stays conditional on a distribution requirement. |
| Shipped-pack replacement (Phase 6) | Implemented ownership/suppression/replacement/source updates; refreshed complete external app and normal fork lifecycle acceptance passes | Local restart/reload, two-window fork preservation, disable/remove/restore and settings preservation are accepted on current source. Preserve existing managed-update and failure-retention cases for the final gate; no replacement redesign remains identified. |
| Final review/acceptance (Phase 7) | Outstanding | Audit every phase and reconciled manifest requirement on committed source, run final strict `--all`, record evidence and archive only completed work. |

Current-source review `dcf2493e5` repairs [content declaration existence](../references/evidence/settings-and-pack-contracts.md#explicit-content-declarations-in-schema-and-resolution-2026-10-18)
in both schema validation and local/dependency resolution. Inherited object names cannot masquerade as
formats/dependencies or cause false source/dataset collisions; explicitly declared names remain valid.
All 72 focused declaration/resolution checks, the existing codegen consumer, SDK types, schema check
and lint pass. The user explicitly authorized pushing; checkpoint `a74bbd88a` is pushed and
[strict run `39163655338`](https://github.com/spankyed/apack/actions/runs/39163655338)
failed after 411.1s at external authoring: its declared inputs omitted the selected host pack's built
snapshot, allowing authoring before that producer. Source `268533807` declares `PACK_OUTPUTS` as
inputs, restoring ordering and cache invalidation through the existing graph. The new regression
fails before the repair; all 68 focused authoring/graph/scheduler cases, repo/scripts types and lint
pass afterward. See [checkpoint evidence](../references/evidence/settings-and-pack-contracts.md#external-authoring-host-build-dependency-2026-10-18).
Push authorization is resolved. [Strict run `39166185325`](https://github.com/spankyed/apack/actions/runs/39166185325)
tested exact checkpoint `31cb54f4d` and stopped at the facade's unchanged 60s budget; the concurrent
external-contract consumer refused changed generated-directory observations after 38 passing cases.
Source `ccf86ad3a` makes the chain facade check a verified current-build reader through the existing
input record, removing regeneration beside consumers. All 115 focused facade/graph/input cases,
CLI/scripts/repo types and lint pass. [Evidence and remaining acceptance](../references/evidence/settings-and-pack-contracts.md#read-only-facade-verification-after-publication-2026-10-18)
retain the exact failure boundaries. Hosted acceptance of that source, remaining native/platform
obligations and Phase 7 stay open. [Strict run `39167659691`](https://github.com/spankyed/apack/actions/runs/39167659691)
tested exact checkpoint `fcb037442`: the facade passes in 27.7s under its unchanged 60s bound, and
the full packaged-authoring author half passes in 690.1s. The external-contract suite instead reaches
its unchanged 600s bound while building the default-pack fork, after both ordinary fixture builds and
38 memo cases pass. Its remaining cause is unproven. Preserve [hosted acceptance and failure evidence](../references/evidence/settings-and-pack-contracts.md#hosted-facade-and-author-half-acceptance-2026-10-18);
do not repeat broad gates or raise deadlines to diagnose it.
The app half and final strict acceptance remain open. A [bounded Windows profile](../references/evidence/build-input-snapshot-proof.md#bounded-windows-build-profile-2026-10-18)
retained only supervisor samples. A [short follow-up](../references/evidence/build-input-snapshot-proof.md#short-windows-diagnostic-cleanup--2026-10-18)
perturbed shutdown through its inspector helper and was intentionally stopped; it is not compiler-defect
or hotspot evidence. All owned work stopped, evidence is exported and the VM is confirmed deallocated.
Do not repeat that helper or start another compiler-performance project from these inconclusive profiles.

Checkpoint `d0ab6dd6b` separates default-fork preparation from fixture contracts in the existing chain.
The two producers publish independent outputs; app acceptance requires both. Existing build/archive
integrity and freshness checks, per-operation suite deadlines and the final strict gate remain required.
This corrects producer/cache and aggregate-budget ownership; it does not establish that a standalone
fork build fits its unchanged limit or that compiler performance is resolved. All 120 focused graph/input/scheduler cases,
scripts/repo/E2E types, tiers, lint and shell checks pass; the regression rejects the restored combined
producer. See [producer evidence](../references/evidence/settings-and-pack-contracts.md#independent-default-fork-producer--2026-10-18).
Checkpoint `e24103ebf` gives fork preparation the full pack build's existing two-core reservation; the initial split
incorrectly inherited the one-core default. All 84 scheduler/graph/budget cases and scripts/repo types
pass; the new regression reproduces the old one-core reservation and proves serialization at two cores.
See [reservation evidence](../references/evidence/settings-and-pack-contracts.md#fork-producer-core-reservation--2026-10-18). The required hosted
strict gate must exercise the independent producers and exact archive/app handoff. If the standalone
fork still fails, use its retained phase output; do not restart broad runs without a demonstrated repair.
[Strict run `39172886664`](https://github.com/spankyed/apack/actions/runs/39172886664) finished on
exact source `d0ab6dd6b`: both fixture contracts (340.6s) and fork build/archive (497.2s) pass under their
unchanged suite bounds; packaged authoring's author half passes in 431.6s. Host units then fail on the
already-repaired helper expectation plus eager host validation during driver/session imports and a
real-checkout-dependent spawning unit. The latter repair defers host validation to actual fixture setup
and gives the spawning test its own inert checkout; all 70 focused checks pass with an unusable pinned
host. See [accepted producers and cold-import repair](../references/evidence/settings-and-pack-contracts.md#independent-producers-accepted-cold-helper-imports-repaired--2026-10-18).
No further performance profiling follows from the accepted producers. The next strict gate must cover
the remaining runtime/integration/app legs on the corrected source. Its whole-job cap is 60m because
this cold run consumed 28m before those legs; individual step bounds remain unchanged. Windows is
deallocated and no earlier hosted gate remains running.
Cold-import checkpoint **`9b056f4ab`** is pushed. [Strict run `39175530615`](https://github.com/spankyed/apack/actions/runs/39175530615)
finished with a pack-typecheck timeout (62s including cleanup; no type diagnostic). Independent
producer contracts passed again; later runtime/integration/app legs were not reached. Two isolated
cold Vue typechecks measured 24.72s CPU / 14.66s wall and 24.95s / 14.65s: about 1.7 cores,
while admission reserved one. The repair reserves two cores and retains the quick 60s deadline.
Scheduler/graph checks preserve that distinction; hosted acceptance remains outstanding.
The finite native closure register and full Phase 7 audit remain required.
The pure helper-protocol expectation repair `39352b2c7` passes all 67 adjacent PE cases and CLI types;
it is newer than the run's pinned source. B1/B2 checkpoint `2a0e9efc0` separates runtime selector
observations from copy callbacks, delivering selected OS policies and missing/failed-context probes to
the existing tooling/watch owner. All 89 focused pure cases, mutation checks and CLI types/lint pass;
the existing real Windows Node application-context case passes in 22.610s with added selector assertions.
That Windows selector run was deallocated afterward; its useful overlay is preserved in a scoped stash.
See [selector evidence](../references/evidence/settings-and-pack-contracts.md#runtime-selection-inputs-reach-compiler-watches--2026-10-18).
Broader installed publisher-policy mutations and registry notifications are not proven by this check;
retain the finite closure register and final platform/strict obligations. No new watcher framework,
registry polling or profiling effort is authorized.
A separate [Windows binder control](../references/evidence/build-input-snapshot-proof.md#windows-binder-ordinary-loader-control--2026-10-18)
uses the OS-generated bound directory: ordinary/bound imports load, while removing the lookup table
still fails in the ordinary loader. Preserve this historical result without treating it as proof that
all address-only inputs are invalid; the approved refusal boundary now settles support scope. The subsequent
[single-import control](../references/evidence/build-input-snapshot-proof.md#single-import-binding-control-2026-10-18)
also fails in the ordinary loader after eliminating all Windows/CRT imports. It closes that additional
hypothesis and requires no production change.

### Bounded build-input and freshness checkpoints

Completed prerequisites: captured compiler installation/session reuse (`aba660aed`), shared authored
scope (`882d2a50b`), public cancellation (`6641b2c99`), startup capture (`37890aa9b`), publication
alias-processing repair (`c85fc178a`), and ordered effective execution-options/runtime-version hashing
(`65a189cb7`), early launch identity (`3929897a3`), and authored bytes/membership before
preloads (`bbf05ec00`). These are source evidence, not a claim that the full strict gate passes.

| Checkpoint | Required outcome and acceptance boundary | Dependencies |
|---|---|---|
| B1 — Launch and remaining input coverage | Reconcile current capture against actual supported compiler paths. The launch audit preserves inherited NODE_OPTIONS and forwarded export conditions; supervisor entry modes are not worker configuration. Early launch identity and authored bytes/membership are implemented through `bbf05ec00`. Selected runtime ownership is implemented in `e369d3cb9`, with local Node/Electron and actual backend/Vite acceptance. Close the named input gaps and platform cases in the B1/B3 closure register below. Separate reproduced defects from missing evidence; enumerate concrete missing inputs before implementing; prove relevant changes invalidate/refuse publication while equivalent runs preserve identity and resolution. Ordered options already landed; do not reimplement them. | Existing captured installation/startup view. |
| B2 — Frontend compiler generation | Implemented and locally accepted in `a595246f2` / `d3833f788`: matching backend/Vite generations, configuration replacement, fresh metadata/link resolution, private caches, failure retention, interrupted startup and awaited retirement pass. Real browser HMR through a generated external-pack entry preserves state/document. Retain these checks for final committed-source acceptance; B1/B3 still own remaining input/subscription and platform/runtime cases. | Relevant B1 inputs are implemented; preserve remaining cross-phase producer acceptance. |
| B3 — Remaining resource lifetime | Use the B1/B3 closure register below to identify each remaining native/background operation, its existing lifetime owner and missing proof. Close demonstrated gaps so build-owned work cannot outlive final validation/disposal. Preserve accepted cancellation/watch behavior; unverified platform behavior is not itself a demonstrated defect. | Relevant B1/B2 owners; no security sandbox or general resource-confinement expansion. |
| B4 — Persist successful input/output association | Publish the completed input record atomically with sealed output. Failed or incoherent builds retain the incumbent; readers can validate the association without executing pack/compiler code. Startup observations alone are not this record. | Complete relevant B1–B3 producer ownership. |
| B5 — Passive freshness consumers | Migrate archive, prebuilt tests, default-fork preparation and drive to the common record. Preserve manual builds, deterministic reuse, source-free installed inspection and deliberately stale drive behavior. Remove replaced freshness heuristics. | B4. |
| B6 — Converged acceptance | Resolve affected failures from preserved evidence and focused reproducers, then run the required converged strict checkpoint. The final committed-source strict `--all` remains Phase 7. | Converged B1–B5 source; focused checks accompany each earlier checkpoint. |

#### Current compiler checkpoint (2026-10-18)

**Current outcome:** the Windows report-reader repair is committed as `11cb737e2`; the two-build
lifecycle/budget repair is `9adb9073f`. The [public repeated-build case](../references/evidence/build-input-snapshot-proof.md#windows-repeated-build-identity-and-owned-teardown--2026-10-18)
now passes in **224.65s**, preserving both fresh installations, source paths, stable cache/output
identity, archive acceptance and complete disposal. This closes that named failure; it does not close
the remaining policy/platform cases, B6 or final strict acceptance. Earlier failure states below are
checkpoint history, superseded by this outcome rather than instructions to repeat accepted work.

The [remaining-obligation audit](../references/evidence/build-input-snapshot-proof.md#remaining-native-obligations-and-bound-only-control--2026-10-18)
corrects stale lifetime labels against existing Windows/Linux acceptance. Its bounded ordinary-loader
control still fails after removing the bound import's lookup table, including with a fixed-base importer;
it proves no product defect or valid unsupported image. The user-approved refusal boundary above
supersedes the earlier open support question; verify that refusal without repeating invalid fixtures. Next resolve outside-image/publisher-policy and remaining mapped/runtime
acceptance against actual supported paths; B6 and the full Phase 7 audit remain required.

Source `931e08186` now accepts [physical outside selection through a private assembly](../references/evidence/build-input-snapshot-proof.md#outside-private-assembly-dll-ownership-acceptance--2026-10-18)
in 4.561s: Windows loads the exact outside DLL, then existing admission refuses before initialization.
No production change is needed. Preserve this proof alongside the accepted application-context
controls. Publisher/system-policy changes and remaining mapped/runtime acceptance remain explicit;
the converged strict checkpoint still needs the full cross-phase producer/consumer run.

Source `c27e78a06` and its [ownership evidence](../references/evidence/build-input-snapshot-proof.md#compiler-installation-namespace-ownership--2026-10-18)
exclude private installation ancestor probes from replayable source identity. Inert owner regression,
mutation, types and lint are accepted; the public two-installation check instead ended with native
exit 3221226356 before completed-build assertions. The scoped Windows diagnostic accepts
first-build replay and archive verification; both workers exit 0 without an unhandled exception, but
the test reaches its unchanged 240s budget during the second build and fixture cleanup races. The
original native failure remains unexplained, and repeated-build identity is unaccepted. Preserve the
owned-process receipts and avoid another uninstrumented rerun or deadline increase. Neither run is a
complete public-build acceptance result.

Source `34684ee56` closes the named [imports/exports candidate audit](../references/evidence/build-input-snapshot-proof.md#package-mapping-candidate-ownership--2026-10-18):
three original freshness counterexamples, 22 host models, three CLI ownership regressions and actual
Node/Electron main-thread/async-loader controls pass. Matching mapping branches are conservatively
observed; Node owns selection/errors. No new general resolver work is identified by this bounded audit.
Continue the finite native/platform obligations below, then B6 and final acceptance. Keep repeated-build
identity unaccepted on current source; preserve all phases and do not restart accepted lifecycles for
reassurance.

Source `afc98b845` accepts the missing [Electron application-context startup case](../references/evidence/build-input-snapshot-proof.md#electron-application-context-startup-acceptance--2026-10-18)
in 22.039s under the unchanged 60s bound: exact private copied-DLL selection and pre-initialization
compiler refusal pass. This is a fixture/acceptance checkpoint; production code needed no change.
Source `d2c459913` also accepts [Electron DotLocal startup](../references/evidence/build-input-snapshot-proof.md#electron-dotlocal-startup-acceptance--2026-10-18)
in 13.320s under the unchanged 60s bound, with copied-runtime identity, actual selected DLL and refusal
before initialization. Both named Electron context gaps are now accepted; preserve remaining
localized/outside-image/publisher/system-policy input obligations, platform cases, B6 and final gates.

Source `8fae65949` closes the demonstrated [neutral transitive private-candidate gap](../references/evidence/build-input-snapshot-proof.md#transitive-private-assembly-candidate-ownership--2026-10-18):
original missing-probe failure in 10.312s, final direct/transitive acceptance in 6.725s/6.302s. Actual
selection, candidate creation/removal, configuration changes and refused-context repair inputs pass.
One dictionary owns candidate traversal and validation; the extra context rebind is removed. Localized
and outside-image private probing, publisher/system-policy acceptance, other platform cases, B6 and
final strict `--all` remain required; this does not close all Windows policy behavior.

Source `604981200` repairs the [explicit localized-candidate omission](../references/evidence/build-input-snapshot-proof.md#declared-localized-private-candidate-ownership--2026-10-18):
original missing-probe failure in 9.586s; final direct/transitive/localized cases pass in
6.327s/5.951s/5.967s with unchanged budgets. Explicit `en-US` selection, candidate appearance/restoration
and refused-context repair inputs are accepted. Wildcard/user/system fallback and MUI satellite
behavior remain unverified within the existing localized/policy obligation, alongside outside-image
probing, publisher/system-policy inputs, other platform cases, B6 and final strict `--all`. No exclusion
or reduction of the full goal is made.

Source `8d6f62323` implements [directory membership through successful and refused activation queries](../references/evidence/build-input-snapshot-proof.md#private-assembly-directory-membership-and-copy-identity--2026-10-18).
Typed entries reach the existing source record, watcher and owned copy; passive replay after disposal
passes. Six affected Windows cases accept wildcard directory creation/removal and repair, direct,
transitive and declared-culture selection, Node/Electron copy identity and pre-initialization refusal
in 58.549s total, unchanged per-case budgets. Fifty-one inert local cases, CLI types and lint pass.
Keep remaining outside-image/publisher/system-policy and platform obligations, repeated-build acceptance,
B6 and final strict `--all`. Next reconcile policy/selection-context requirements against current producer
cache identity and the approved ADR, with concrete counterexamples before new machinery. Classify MUI
requirements as actual assembly selection or native resource I/O; the latter is already outside the
user-approved boundary and must not silently expand this goal. No required assembly-selection case is
excluded by this classification.

The [captured-policy checkpoint](../references/evidence/build-input-snapshot-proof.md#captured-native-policy-in-compiler-identity--2026-10-18)
(`2dc550a5b`) repairs omitted native loader state in phase identity and Windows policy invalidation in retained
runtime identity. All 57 focused Windows checks and actual Node/Electron application startup controls
pass; source paths, copied-runtime identity and refusal before initialization remain asserted. The
single public repeated-build case fails at 129.548s with `0xC0000374`, matching the earlier native crash,
not its 240s deadline. The [follow-up report-API controls](../references/evidence/build-input-snapshot-proof.md#windows-report-api-race-short-reproducer-and-rejected-lock--2026-10-18)
reproduce the same native status without pack compilation in 184ms, and through the actual Windows
metadata reader in 461ms. Excluding network diagnostics and a shared-lock candidate do not fix the
actual reader; the rejected candidate remains stashed. The [replacement process-metadata reader](../references/evidence/build-input-snapshot-proof.md#windows-process-metadata-reader-without-diagnostic-reports--2026-10-18)
now removes Windows report calls, retaining native PATH and exact loaded-DLL meaning through the existing
metadata/lifetime owner. Both short regressions, 57 models and actual packaged Node/Electron startup
controls pass. The uninstrumented public build now completes its first build/replay/archive without
heap corruption; its second fresh build reaches the 240s limit. Follow-up `9adb9073f` fixes that case's
owned teardown and measured two-capture Windows budget; the complete repeated-build case now passes
as linked above. Next reconcile the remaining policy/platform obligations against current code and
recorded acceptance before adding implementation, then B6 and final strict acceptance. No other phase
is waived.

**Execution boundary:** the user recovered the daily-use Mac by restarting after unrelated apps
stopped launching. Cause remains unproven. Use the approved
[Windows development VM](../../references/guides/windows-development-vm.md) for interactive Windows
native, captured-runtime and cancellation debugging and focused validation, with one execution owner
and two cores. Use disposable GitHub runners for macOS/Linux execution, clean platform verification
and the existing final gates through `compiler_macos`, `compiler_windows` or `compiler_linux`.
Do not change macOS security settings or repeat local native batches. Preserve the
[incident evidence](../references/evidence/build-input-snapshot-proof.md#macos-launch-policy-investigation-2026-10-17).

**Current handoff:** preserve the implemented compiler/input owners and close the finite native/platform
cases below. Source checkpoint `d8ac9486c` accepts both ordinary Windows dependency-redirection controls;
the corrected test blob and exact VM evidence are recorded below. The [SxS admission counterexample](../references/evidence/build-input-snapshot-proof.md#windows-sxs-admission-counterexample-2026-10-18)
now confirms the low-level predicate misses the OS-selected private assembly. Its expected-failing
regression is stashed locally and on the VM. Source `113116791` implements
[`.local` admission and runtime inventory](../references/evidence/build-input-snapshot-proof.md#windows-local-redirection-admission-checkpoint-2026-10-18):
both marker forms, manifest policy, missing-input freshness and private-runtime ownership. Exact outside
selection/refusal and the existing retained-compiler ownership/freshness/HMR case pass on matching VM
source. A first runtime attempt hit its unchanged deadline; a timestamped diagnostic and final matching
source pass without a deadline change. The original timeout's cause remains unproven.
Source `267fa8117` implements the default-application-context repair. Source `8c7c960ae` extends
that same reader and input owner to resource 2, preserving default-context
selection and runtime-copy checks. Actual Node startup refuses a DLL-local assembly's transitive
outside library before initialization, then executes captured value-22 code once the dependency is
package-contained. A loaded-System32/private-`psapi.dll` collision also preserves exact selection
without helper-side initialization. See the [DLL checkpoint](../references/evidence/build-input-snapshot-proof.md#windows-dll-activation-context-checkpoint-2026-10-18)
and [earlier four-point review](../references/evidence/build-input-snapshot-proof.md#windows-default-application-context-admission-checkpoint-2026-10-18).
The [helper/launcher audit](../references/evidence/build-input-snapshot-proof.md#windows-helper-and-launcher-checkpoint-2026-10-18)
observed both the live metadata helper and its actual C# compiler in a Windows job. A subsequent
[lifetime probe and repair](../references/evidence/build-input-snapshot-proof.md#windows-helper-compiler-lifetime-repair-2026-10-18)
in `f6cd78014` reproduces compiler survival after helper timeout and parent loss, then closes both paths
with a shared job established before compilation. The suspended real-compiler probes, mutation-checked
regression, seven launcher scenarios, seven DLL/startup controls and builder publication boundary pass.
Source `8e93dc4f4` repairs the launcher proof's runtime-directory input. Source `61431e063` accepts
[DLL-specific configuration](../references/evidence/build-input-snapshot-proof.md#windows-dll-configuration-acceptance-2026-10-18):
ordinary selection, observed configuration bytes and actual Node refusal/allowed snapshot startup.
Source `4aa3bc7a5` accepts the
[Electron module-context path](../references/evidence/build-input-snapshot-proof.md#windows-electron-node-api-host-binding-2026-10-18)
through the production launcher, repairing a false outside-Node refusal for standard Node-API delay
imports. Runtime exports are tied to captured executable bytes; ordinary outside-library refusal stays
covered. Source `4dbeaa968` repairs
[higher-priority private-candidate observation](../references/evidence/build-input-snapshot-proof.md#windows-private-assembly-candidate-freshness-2026-10-18):
real selection changes from value 22 to 33, invalidates the earlier view and restores its identity
when the candidate is removed. Source `6e16483b4` now preserves failed-query repair inputs through
the existing observer. The [refusal-input checkpoint](../references/evidence/build-input-snapshot-proof.md#windows-activation-refusal-input-checkpoint-2026-10-18) accepts configuration/missing-candidate observation,
repair invalidation and four real Node/Electron/helper cases on identical VM source. Source `9bbe9e505`
repairs the next demonstrated defect: extended drive-root probes made subscription construction throw
`EISDIR` and terminate the watcher. The [watch-root checkpoint](../references/evidence/build-input-snapshot-proof.md#windows-watch-root-checkpoint-2026-10-18)
accepts all 18 watcher checks and a real frontend-report subscription replay.
Source `595a7d8e1` fixes the reproduced publication boundary: separate retained Vite processes scan
private staged output during Windows rename. The focused regression fails against the old code in
2.4s and passes with private `.apack` watching excluded; authored generated files and external
dependency inputs remain watched. See the
[publication checkpoint](../references/evidence/build-input-snapshot-proof.md#windows-private-output-publication-checkpoint--2026-10-18).
The subsequent slow lifecycle was profiled: initial compiler dependency inventory takes 69.8s in
synchronous reads; capture takes 33.4s. That attributes the blocked phase without claiming its underlying
filesystem latency is explained. Source `72ad6bae9` makes frontend replacement share an unchanged,
verified compiler installation; each frontend retains its private workspace, and the last owner releases the compiler.
The complete Windows native watch lifecycle **passes in 232.4s**, under its unchanged 300s budget:
missing-assembly refusal before initialization, incumbent service, failed-input repair subscription,
repair-only creation, values 11 then 22, successful publication, one notification and old-frontend
retirement. See the [reuse and recovery checkpoint](../references/evidence/build-input-snapshot-proof.md#verified-compiler-reuse-and-windows-recovery--2026-10-18).
Preserve stash `540fa3cc844918afe1c634c00d24857451c5506f` and earlier failed reports as history.
Do not repeat this accepted lifecycle for reassurance or infer acceptance for other loader paths.
Sources `1293ae2fe` and `47387a502` close a demonstrated frontend startup JavaScript gap: existing reads reached
subscriptions, but a newly appearing nearer package did not invalidate reuse. Startup lookup metadata
now goes through the existing file view while Node retains resolution. The real ESM/custom-loader case
passes in 44.54s under its original 60s bound, including probe delivery, actual nearer-package selection
by a replacement, restoration and live Vue. The resolver hook is released with startup read ownership. See the
[startup lookup checkpoint](../references/evidence/build-input-snapshot-proof.md#startup-package-lookup-observation--2026-10-18).
Source `ce0b5e00b` makes installation capture/verification yield between byte reads and accept the builder's
cancellation signal; synchronous consumers retain the same traversal and content identity. Source
`1e023b29f` observes initial bare launch requests, package-less CommonJS candidates, missing relative/index/main
inputs and symlink targets through the existing startup owner. Nine focused resolution models pass;
the matching Windows runtime case passes in 47.23s, including bare require/import flags, probe delivery,
invalidation/restoration, replacement selection and live Vue. Cold attempts before the async repair
blocked the test worker; the one startup scenario now has a measured 120s budget, with helper/freshness
bounds unchanged. See the [namespace and capture checkpoint](../references/evidence/build-input-snapshot-proof.md#startup-namespace-and-responsive-capture-checkpoint--2026-10-18).
Sources `348862f30` and `bdfd7f005` close the reproduced async-loader ESM lookup omission through
the same startup read owner. Explicit loader flags get an observer before their graph loads;
programmatic registration waits for the user's first call. Plain launches do not gain a loader thread.
The real Windows retained-Vite case passes in 102.37s, and the exact-order two-build backend case passes
in 170.88s. Final focused controls prove lazy registration, retirement of cached registration references,
and refusal without a startup owner. See the [async-loader checkpoint](../references/evidence/build-input-snapshot-proof.md#async-loader-namespace-observation-checkpoint--2026-10-18).
Source `21389b608` closes the reproduced loader-local CommonJS omission using Node's actual CJS
lookup paths, including `createRequire`, transitive loads, custom `require.resolve({ paths })` and
`module.paths`. The observer is startup-owned and delegates selection to Node. All 16 focused models
pass locally and on Windows; original Node 23.11.1 and Electron 37.2.4/Node 22.17.1 controls preserve
selection and preload order. The retained-Vite case passes in 100.16s under its unchanged 120s bound,
including transitive CommonJS invalidation, restoration, replacement selection and HMR. See the
[CommonJS checkpoint](../references/evidence/build-input-snapshot-proof.md#commonjs-native-lookup-observation-checkpoint--2026-10-18).
Next audit package import/export mappings against existing observations before adding machinery.
Those mapped-target paths remain unverified. Broader cold/aggregate budgets, remaining native/platform
cases, B6 and final committed-source strict acceptance remain open. Preserve accepted paths without
repeating them for reassurance.
Transitive/localized/outside-image probing and publisher/system-policy
changes remain required beyond the recognized root-dependency prefixes closed here. Then close
remaining runtime acceptance; Electron application-context and DotLocal controls are accepted in `afc98b845` / `d2c459913` as linked above. Preserve helper
cleanup through clean-platform/converged acceptance; do not reschedule the
accepted basic Node/DLL controls. Earlier stashed controls remain preserved as evidence. Configured
Node `.local` public-build acceptance remains `9d25152aa`; the separate full-CLI
SxS timeout is preserved and not a passing gate. All other closure-register and final-gate requirements
remain open. Preserve the validated VM overlays and failed controls, save evidence off-machine and
deallocate after focused execution; the linked checkpoint records its exact source and power state.

| Area | Current source and acceptance | Remaining obligation |
|---|---|---|
| Live native/frontend input ownership | `ccaa809a8` retains process-wide copies, worker receipts and failed-candidate repair probes; unresponsive freshness checks refuse within five seconds. Actual watch refusal/recovery/retirement passes on `e6ce60a78` in hosted run `39079492068`, within the restored 120-second scenario budget. | Preserve this behavior through converged native and final gates; no new watch coordinator. |
| Frontend startup JavaScript | `c85f3fd95` captures ordinary preloads. `6d482e79f` captures enclosing package metadata; real ESM/custom-loader/transitive export selection and live Vue pass in hosted run `39079716622`. | Preserve accepted byte restoration, source paths and HMR; do not infer universal resolution coverage from one case. |
| macOS launch environment | `b7385c0bb` accepts only physical OS directories for versioned overrides; both real versioned cases pass in `39080454772`. `ef01842ed` applies the same policy to the single shared-cache directory. The revised one-builder OS baseline/refusal case passes on `baf461618` in `39081394988` in 27.62 seconds with its original 60-second deadline. All 48 parser/environment checks pass. | Preserve ordinary package-relative/OS loading and attributed refusal. Converged native-file acceptance on final source remains required; selected runs do not cover every case. |
| Runtime/signing | Shared-launcher pre-initialization Mach-O refusal/contained loading passes in `39095180283`; actual retained Node/Vite passes in `39095878658`. Default Electron 37.2.4 capture/launch passes in `39097385010`. Source `ee1c76459` additionally preserves the complete macOS Contents distribution, sealed relative link text and physical ASAR bytes through capture and disposal. Five inert runtime/copy checks pass. Hosted `39099157645` on that source accepts exact app entitlements, hardened runtime/Developer ID, strict captured signature verification, real Electron startup, freshness and cleanup in 2.14s, with one confirmed passing case. See [strict-profile evidence](../references/evidence/build-input-snapshot-proof.md#strict-app-profile-electron-probe-2026-10-18). | The demonstrated strict-profile capture/cleanup defects are closed. Remaining linked runtime/native combinations still need bounded acceptance; this tiny compiler-entry probe does not prove every addon combination. Full Windows Electron pack build/archive passes on `3827993ba`; complete signed macOS and Linux Electron compilation plus Node archive now pass on `f37315483`. The named complete-distribution compilation gap is closed; preserve the existing native module/preload/thread cases and explicit policy obligations and approved bound-only refusal acceptance. Preserve accepted runtime controls through B6 and final strict acceptance; do not broaden permissions or claim isolation. |
| Windows process ownership | Job Object/lifetime acceptance passes in `39075394015` attempt 2. Exact OS-reported DLL ownership, privacy, source restoration, Vue and outside-PATH refusal pass in `39091568546`; Unicode and bound-import lookup fallback pass in `39092975820` / `39093260230`. Backend preload/thread publication passes in `39095177818`; combined preload/thread reuse passes in `39097382309`. Source `4f1fdfbee` extends the same native owner to CommonJS content compilation, with 13 focused checks passing. Hosted `39100052114` on fixture correction `965b914b4` accepts that complete ownership/freshness/cleanup/refused-publication case in 106.17s under the unchanged 120s bound. See [compiler-reader evidence](../references/evidence/build-input-snapshot-proof.md#content-compiler-native-ownership-checkpoint-2026-10-18). | Preserve accepted ownership, cross-drive, codegen, cleanup and exact-copy checks. Run `39100566892` confirms extended tool paths are misclassified by the actual API. Source `aee3a18ab` uses the existing comparison for all eight remaining ownership decisions and preserves device prefixes when parsing module queries (51 pure checks pass). Hosted `39101205268` accepts eleven Windows alias/query/live-event cases; `39101209244` accepts the exact macOS live-event case in 1.09s after a local EMFILE failure. The live case is now guarded against daily-use Mac execution; no resource/security limit is changed. Namespace classification is accepted. B3 async watcher failure repair is implemented in the current checkpoint: attributed native/frontend subscription errors cancel builds, drain owned disposal and reach public/dev callers through the existing watcher owner. All 31 mocked/inert lifecycle checks, CLI types and focused lint pass. On pushed source `167722d1f`, macOS `39103783217` and the unit stage of Windows `39103780229` each accept ten focused watcher cases, including real backend/frontend controls. The separate ordinary-control failures are resolved by dependency-shaped probes and configuring `.local` before first launch. The [Windows VM control checkpoint](../references/evidence/build-input-snapshot-proof.md#windows-vm-redirection-control-acceptance-2026-10-18) accepts both exact value/path controls in 2.98s combined. Source `113116791` adds `.local` observation, admission and runtime inventory with matching focused VM acceptance; Configured Node `.local` public-build capture/refusal passes in `9d25152aa`; The default application-context Node SxS repair now has focused startup/copy acceptance linked above; Electron module/application SxS and DotLocal startup controls are accepted in `4aa3bc7a5`, `afc98b845` and `d2c459913`; remaining context/policy obligations stay explicit. See [hosted watcher/control evidence](../references/evidence/build-input-snapshot-proof.md#hosted-watcher-acceptance-and-pe-control-result-2026-10-18). No local live watcher runs. Close activation/SxS/.local redirection, approved bound-only refusal acceptance and supported search-state reconciliation. The [current Windows audit](../references/evidence/build-input-snapshot-proof.md#remaining-windows-resolution-audit-2026-10-18) identified unused manifest parsing and missing `.local` observation. The `.local` checkpoint addresses the latter; The default-context SxS omission is repaired as linked above; other context and policy edges remain open. Private `.local`/SxS controls are authored in the existing PE integration file. Both ordinary controls pass on the approved VM, and `.local` now refuses the proven outside selection. Configured Node `.local` now has public-build acceptance; Basic DLL-owned resource-2 selection and actual Node startup now pass as linked above; DLL-specific configuration and actual Node snapshot startup are accepted in `61431e063`; Electron module-context is accepted in `4aa3bc7a5`; Electron application-context and DotLocal startup are accepted in `afc98b845` / `d2c459913`; broader policy/watch edges remain unaccepted. Their [proof boundary](../references/evidence/build-input-snapshot-proof.md#private-pe-redirection-control-candidate) preserves actual Node/Electron and admission acceptance as required. Watcher checkpoint source is `6d6a8e9e1`; the user pushed `167722d1f`, and its focused hosted watcher acceptance is recorded above. Remaining platform/native requirements, B6 and final strict `--all` stay required; partial support/refusals are not exclusions. |
| Linux native ownership | `3ec217669` adds runtime preflight at the shared launcher; run `39085132469` accepts the constructor boundary, metadata, retained ELF/Vue, lifetime, native backend preload/thread, independent Vite and backend baselines. Filtered run `39085739556` on `b310e9a0b` additionally accepts the ordinary bare-SONAME/ORIGIN-RUNPATH worker case, launch-env mutation and new-override invalidation. | These concrete gaps are closed on their recorded Node sources. Preserve them in converged/final acceptance. Remaining mapped-image/runtime-distribution checks stay explicit; continue the remaining Windows lookup/preload/thread obligations rather than repeating accepted Linux cases for diagnosis. |

The Linux retained-library counterexample is repaired and accepted on `b02217703`; see
[Linux acceptance](../references/evidence/build-input-snapshot-proof.md#retained-elf-library-acceptance-2026-10-17).
The native backend preload/thread publication boundary also passes on `1fbf12216`; see
[Linux backend acceptance](../references/evidence/build-input-snapshot-proof.md#linux-native-backend-publication-acceptance-2026-10-17).
The runtime-linked constructor control and all bounded Linux stages now pass on `3ec217669` in
`39085132469`; see [runtime acceptance](../references/evidence/build-input-snapshot-proof.md#runtime-linked-elf-launcher-acceptance-2026-10-17).
The ordinary ELF bare-SONAME/ORIGIN-RUNPATH worker case now also passes on `b310e9a0b` in
`39085739556`; see [RUNPATH acceptance](../references/evidence/build-input-snapshot-proof.md#elf-runpath-and-launch-state-acceptance-2026-10-17).
The [Windows DLL control](../references/evidence/build-input-snapshot-proof.md#accepted-windows-dll-ownership-and-full-path-module-metadata-2026-10-17)
now accepts exact captured ownership, freshness and pre-initialization outside-library refusal through
the existing native owner. Preserve the accepted Job Object and shared path identity implementations.
The [Unicode/binding follow-up](../references/evidence/build-input-snapshot-proof.md#windows-unicode-metadata-and-bound-import-control-correction-2026-10-17)
distinguishes the accepted Unicode case from a failing ordinary-Node fixture; do not treat that failure
as a production counterexample. Remaining linked-runtime distributions, mapped-image/platform cases,
stricter app signing and final gates remain required.

The strict two-core checkpoint on `ccaa809a8` stopped at three repository bookkeeping failures after
passing packaged authoring, external-pack contracts, default-pack build, facade/schema/import checks
and typechecks. Corrections pass all 951 affected repository checks; this is not a full strict pass.
Do not repeat that broad run to diagnose already-corrected bookkeeping. Finish the named native/platform
work, then B6 and final committed-source strict `--all`, preserving every phase below.
See [compiler evidence](../references/evidence/build-input-snapshot-proof.md#shared-cache-acceptance-and-linux-proof-boundary-2026-10-17)
for exact source commits, commands, failures and passed runs.

#### Earlier compiler checkpoints

These paragraphs retain historical source-specific results and unresolved requirements. The live ledger
and current handoff above own status; an old “pending” statement is not a second current backlog.

Source `525350813` applies native canonical path identity consistently, preserving authored metadata
query semantics and root-link observations. Corrections `672645cf4` / `329cfbd89` preserve fixture and
logical-source filesystem identities. Windows run `39063657523` on `0c259a570` passes all 157 focused
checks (eight platform skips), completes its first build at 77.74 seconds and archive at 90.28 seconds,
and produces second-build output around 174 seconds. Its 180-second deadline expires during return
or cleanup, so the case makes forward progress; final completion is still unverified. Give this single
Windows two-build/archive case 240 seconds, retaining 120 seconds locally and every assertion. The
focused Windows diagnostic selects startup and repeat-build baseline cases; broader platform/native
lifetime acceptance remains required with its implementation. See
[timing evidence](../references/evidence/build-input-snapshot-proof.md#windows-repeated-build-forward-progress-2026-10-17).
Source `b1c1c87c6` integrates the shared Windows build/Vite job owner. Run `39065375155` passes the
actual production launch helper's success/failure/cancellation/Unicode proof and all 162 focused unit
cases (eight platform skips). The publication step never reaches its intended case: a Windows shell
hop splits the quoted name filter and runs unrelated tests instead. The workflow now invokes Vitest's
JavaScript entry directly, retaining the source condition through its environment and preserving argv.
No assertion is weakened to hide the unintended SIGTERM-handler failure.

The native proof now also checks that retiring one compiler leaves its replacement alive, and forcibly
kills an independent controller to verify parent-loss cleanup. The original 30-second proof budget
and two-second parent-loss settlement bound remain. Review also identifies a launcher input defect:
PowerShell modifies its own environment, which must not reach Node. The requested Node environment
now travels over a private memory channel directly into `CreateProcessW`, including correct IPC vars;
it is absent from launch files. The native proof checks policy/module-path/Unicode/absent-variable
preservation. Run `39066744863` on `519ac2a16` now passes that complete native helper proof,
including forced parent loss and isolated replacement. Its package/publication/repeated-build steps
did not run: dependency installation failed with a GitHub API 403 downloading ripgrep.
The focused workflow now supplies the installer's supported `GITHUB_TOKEN`, matching the main CI;
the native helper pass does not certify the pending integrations. See
[handoff evidence](../references/evidence/build-input-snapshot-proof.md#windows-environment-and-final-lifetime-cases-2026-10-17).
Local types, CLI packaging, POSIX descendant publication, syntax/lint and 53 tooling cases pass.
Actual repeated-build baseline, build/frontend integration and final strict acceptance remain open.

Follow-up Windows run `39067640431` on `1dacb59ec` is terminal and fully passes: authenticated
installation, matching package build, 162 focused checks (eight platform skips), the exact real
descendant-publication case, startup identity and repeated-build/archive identity. The repeated-build
case takes 164.325 seconds under its existing 240-second Windows budget. This closes the previously
unexecuted Windows baseline/publication acceptance, not the remaining Vite/native-input paths or
the converged/final gates. See [Windows acceptance evidence](../references/evidence/build-input-snapshot-proof.md#windows-producer-baseline-acceptance-2026-10-17).

Source `6fd1a5050` implements SDK-dependent standard macOS native fallbacks and distinguishes absent
fallback settings from explicitly empty lists. Forty-two unit cases, four real loader cases covering
SDK 13/14 dylib/framework searches and empty-list suppression, the real explicit-fallback
refusal/incumbent-retention case, CLI types and lint pass. The real loader proof uses macOS 26.3.1 /
Node 23.11.1 and private fixtures; no system directory writes. Restricted/hardened-runtime fallback
policy still needs acceptance; versioned/shared-cache controls, retained Vite native initialization,
ELF/PE and converged/final acceptance remain open. See [standard fallback evidence](../references/evidence/build-input-snapshot-proof.md#sdk-dependent-standard-native-fallbacks-2026-10-17).

Source `ce172953d` installs native admission before retained Vite preloads, shares the existing native
capture owner, and checks frontend inputs before readiness/reuse. Vite copies selected images rather
than freezing the authored package. Actual native preload and explicit-worker cases preserve Vue HMR,
detect changed libraries and refuse outside-library initialization while retaining the incumbent;
backend preload/thread regressions also pass. Builder cancellation, real generation replacement and
actual Vite descendant/replacement ownership pass locally. Next: deliver frontend discoveries and
failure probes into live watch subscriptions, account for frontend preload JS inputs, and accept the
loader/late-load paths. Versioned/shared-cache/restricted-runtime controls, ELF/PE, remaining platform
coverage and converged/final gates remain required. See [retained Vite evidence](../references/evidence/build-input-snapshot-proof.md#retained-vite-native-input-ownership-2026-10-17).

Windows run `39069433335` on `0ac839c94` passes native job ownership, 169 focused checks, both
publication/cancellation cases and actual Vite replacement/descendant ownership. Its baseline then
fails because the final cleanup removed `stopReads`, still required by the JavaScript CLI entry and
embedded launch fixture. Source `482ee0598` restores that distinct preload/compilation phase boundary;
real local launch identity and repeated build/cache/archive checks pass (48.36 seconds), as do CLI
types and lint. Windows baseline acceptance on the repaired source remains pending. Live frontend
subscription delivery is next; no watch implementation is claimed by this repair.

Source `59b890dcb` repairs the macOS explicit fallback gap: launch-time `DYLD_FALLBACK_LIBRARY_PATH`
survives preload mutation, selected external fallback libraries refuse before native initialization,
and the incumbent survives. Current-directory lookup precedes fallback lookup; a successfully resolved
package-relative library does not consult unused fallback paths. Twenty-seven unit cases, four real
native/compiler cases, CLI types and correctness lint pass. See
[checkpoint evidence](../references/evidence/build-input-snapshot-proof.md#explicit-native-fallback-admission-2026-10-17).
Source `c1abbd9c2` implements framework override/fallback admission using the same ordered search, with full framework/version
paths and the retained launch environment. Thirty unit cases and three real compiler-preload cases
pass, including preserved dylib fallback behavior; see
[framework evidence](../references/evidence/build-input-snapshot-proof.md#native-framework-search-admission-2026-10-17).
Versioned/shared-cache controls and default fallbacks, retained frontend native initialization,
ELF/PE, platform lifetime and converged/final acceptance remain open. Do not treat these focused repairs as full B1/B3 closure.
The demonstrated `DYLD_IMAGE_SUFFIX` gap is now repaired: capture launch-time ordered suffixes and
inspect selected addon/library variants, preserving suffix-before-rpath and directory-before-suffix
ordering. Missing variants are observed; nonexistent owned candidates are not realpathed. A real build
executes captured suffixed bytes, detects their change, and refuses a later transitive outside
dependency before initialization while retaining the incumbent. Thirty-five native unit cases,
subprocess inventory, CLI types and lint pass; see
[suffix evidence](../references/evidence/build-input-snapshot-proof.md#selected-native-image-suffix-admission-2026-10-17).
Versioned overrides/shared-cache controls/default fallbacks, retained frontend native initialization,
ELF/PE, platform lifetime and final gates still require closure.

#### Execution boundaries and closure

The contract is: each published build has one coherent input/output association; source consumers can
compare that association with their required inputs without running compiler or pack code. Coherence
and freshness differ: a build can faithfully represent its captured inputs while being older than the
checkout. Output integrity is required even when a consumer deliberately accepts that older build.

For B1 and B3, record a finite path matrix in the existing evidence record before implementation:

| Supported path / operation | Existing owner and source evidence | Uncovered requirement | Closing check / disposition |
|---|---|---|---|
| Enumerate actual startup, compiler, dependency-resolution and native/background paths | Name the current capture or lifetime owner | State the concrete missing guarantee, or record none | Link existing proof, add a focused check where needed, or identify an explicit unsupported path |

Audit findings are not automatically implementation tasks. A supported path with sufficient ownership
and evidence closes without new machinery. An unverified requirement remains open; do not call it a
defect without evidence or treat lack of a reproducer as permission to omit it. Include one-shot and
dev/watch execution and relevant platform differences; do not invent a broader resource framework.

#### B1/B3 closure register and decisions

This register distinguishes implemented owners, demonstrated defects and missing acceptance.
The [native compiler input boundary ADR](../../references/adr/native-compiler-input-boundary.md)
records the user-approved bounded contract (2026-10-17): captured package-contained and OS libraries,
with attributed refusal of identifiable outside-library dependencies. Arbitrary external native capture
and native file I/O retain their explicitly approved boundary. Computed runtime loading remains an
explicit detection limit, not a claim of stronger security isolation. Historical counterexamples below do not describe current source.

| Item | Current implementation and acceptance | Required closure |
|---|---|---|
| Outside-library admission | Common module/startup/worker/frontend owners use Mach-O, ELF and PE admission. Actual macOS direct/transitive/preload/thread/Vite cases, Linux native backend/runtime cases (`39085132469`, `39085739556`) and Windows backend/thread/content-compiler controls (`39095177818`, `39097382309`, `39100052114`) accept captured loading and refusal before initialization. Windows Node/Electron application/module/DotLocal controls additionally accept exact copied selection. | Preserve all existing refusal, source/copy identity, freshness and incumbent-retention assertions. Reconcile the finite loader-selection gaps below, then accept the converged source. The original absolute-library counterexample is repaired; do not restart its implementation. |
| Native/background lifetime | Windows Job Object ownership passes in `39075394015` attempt 2; Linux startup/cancellation/descendant/retirement and independent Vite ownership pass in `39083965583`. The Windows native watch replacement/refusal/repair lifecycle passes on `72ad6bae9`. The helper compiler timeout/parent-loss defect is repaired in `f6cd78014`, with real suspended-compiler controls. `9adb9073f` accepts two fresh builders and complete disposal on Windows. | These named owner paths have implementation and runtime evidence. Preserve them through clean-platform/B6/final acceptance; do not schedule them again as missing implementation. A new lifetime defect requires a specific counterexample through an existing owner, not a general resource framework. |
| Remaining loader-selection evidence | Current PE helper reads selected assembly manifests through `QueryActCtx`, observes policy-store candidates when the OS omits the selected policy path, probes private candidates, delegates binding to Windows, and maps resources without initialization. Runtime inventory includes selected context and captured OS policy. Existing checks cover transitive/declared/wildcard language candidates, configuration changes and creation/removal. | Outside-image private-assembly selection is accepted in `931e08186`, with its physical outside DLL refused before initialization. The [system-assembly control](../references/evidence/build-input-snapshot-proof.md#windows-system-assembly-selection-and-copied-runtime--2026-10-18) now accepts exact OS DLL selection, fresh copied-runtime identity, all selected OS manifests and manifest-change/restoration freshness in 4.287s, without production changes. Publisher-policy mutation and copy/freshness acceptance now pass on `7ce19661f` as recorded above. The bound-only scope decision is closed by the user-approved refusal above; its attribution, pre-initialization and incumbent-retention checks remain required. Other specifically named unresolved linked/mapped-image combinations retain their existing acceptance obligations. Do not infer a defect from the old partial labels, omit required cases, or implement address recovery from a malformed fixture. |
| Platform coverage | Exact recorded runs cover macOS ARM64, Windows x64 and Linux x64 on their documented Node/Electron versions; packaging alone is not acceptance. | Preserve exact OS/architecture/runtime evidence, close the finite unresolved combinations and run converged/final gates. A version range is not a requirement to invent an unlimited version matrix; unverified configured targets are not implicitly excluded. |

Configured targets, inspected 2026-10-17:

- macOS ARM64: packaging in `electron-builder.mjs` and `build/build.sh`, release workflow in
  `.github/workflows/build-mac.yml`, and main CI in `.github/workflows/ci.yml`.
- Windows x64: packaging in the same build files and release workflow in
  `.github/workflows/build-windows.yml`; these do not establish native compiler acceptance.
- Linux x64: packaging configuration exists; no Linux app-build workflow was found. Resolve intended
  support explicitly before expanding platform work. This uncertainty does not exclude Linux.
- Runtime declarations: Node `>=23.5.0`, Electron `37.2.4` in root `package.json`. Record the exact
  runtime exercised by each acceptance case; a version range is not evidence for every version.

Before implementation, enumerate the applicable library-loading, changed-input, cancellation and
watch-recovery cases for those environments, with observable pass criteria: supported inputs execute
as intended; tracked changes invalidate freshness; owned work settles before final validation/disposal;
and refused candidates preserve the incumbent. Record each case as passed, failed or unverified;
unsupported cases require an explicit approved boundary decision. Do not create an unlimited platform
or runtime-version matrix from these headings.

A scanner, binary relocation, additional interception or general resource confinement is not the
prescribed solution. Any proposal must demonstrate that it closes the observed defect while preserving
resolution and loading semantics. Static dependency inspection alone cannot establish complete capture
of dynamic loading or arbitrary native I/O. Distinguish input coherence/freshness from security
isolation; stronger isolation remains deferred. Any change to the promised input guarantee needs an
explicit decision, not merely a documentation disclaimer.

Continue API consumption and other independent work while resolving these items. Use focused checks
for each repair, preserve existing evidence, and run the converged/final gates after the relevant
implementation has converged rather than using broad suites to discover the next task.

B2 must demonstrate that a successful compiler refresh changes the compiler actually used by both
backend builds and Vite. Define their generation relationship, failed-refresh recovery and awaited
retirement from the inspected lifecycle. Do not prescribe simultaneous server startup or an atomic
cross-process swap without showing that the architecture needs it. Preserve HMR and useful source paths.

B4 must settle the common successful-build record before migrating consumers. It must associate:

- The accepted compiler installation/runtime identity and effective execution/build options.
- The completed source and dependency input identity, including relevant external/linked inputs and
  resolution observations (including missing paths or directory membership when they affect output).
- The sealed output identity, so an input record cannot certify another build's bytes.

Reuse captured inputs and existing output verification rather than introducing another source scanner
or reading private phase caches as public authority. Specify record ownership, deterministic encoding,
and verification at a common layer. State the expected execution/environment comparison context;
do not blindly compare a different authoring command's ambient environment or persist raw credentials
for replay; the host must not import CLI internals. Publish the record with its
output only after input validation and build-owned work settle; failure retains the incumbent pair.
Startup observations alone do not establish this completed association. Installed verification must
not need authored sources, machine-local temporary paths or executable compiler/pack modules.

B5 must record the actual policy and migrate each consumer to that common authority:

| Consumer | Required policy / acceptance |
|---|---|
| Archive creation | Verify sealed output and enforce the command's required source-input freshness; explicitly identify the comparison context. |
| Prebuilt tests | Refuse missing, altered or mismatched builds against the inputs required by the test invocation. |
| Default-fork preparation | Verify the selected build and required provenance; compare current inputs wherever preparation promises a current-source build. |
| Drive | Verify output integrity; retain explicit deliberately stale use and give accurate current-input guidance otherwise. |
| Installed/offline discovery (preservation boundary) | Verify published data without authored source files, compiler execution, automatic rebuilding or staging. |

Direct/manual builds and watch must produce the same association. Prove timestamp-only touches and
exact byte restoration remain current; same-mtime byte changes, relevant additions/removals, linked
inputs and compiler/dependency/option changes invalidate reuse. Preserve deterministic output caching.
Exercise the actual cached-chain/app-preparation path as well as focused record checks. Remove the
replaced mtime and reader-specific heuristics; do not add dual-format reads or compatibility fallbacks.

Close each B checkpoint with its concrete implementation delta (or evidence-only closure), focused
acceptance results, source commit and explicit remaining cases. B6 consolidates B1–B5 and diagnoses the
retained failures from exact reproducers before the required converged strict checkpoint; it does not
restart accepted implementation or require repeated broad runs for diagnosis. Phase 7 still owns the
final whole-goal strict `--all` on committed source. These details clarify existing scope, not new phases.

Local-machine prevention checkpoint `a808d2c3a` makes the CLI integration config refuse macOS execution
outside GitHub-hosted runners before importing specs. It covers direct Vitest and root-project/chain
selection; unit checks and normal product commands are unchanged. Eight policy cases, an actual local
configuration refusal, CLI types and focused lint pass. This is an operational boundary, not a finding
about the launch incident's cause or acceptance of the remaining compiler work. See
[guard evidence](../references/evidence/build-input-snapshot-proof.md#local-compiler-integration-guard-2026-10-17).
Windows PE checkpoint `b70228539`, including shared path identity `a07182ec2`, repairs the original
DLL bypass, extended-root/namespace defects and Node 23's incomplete report module inventory through
the existing copy owner. Run `39091568546` passes exact DLL ownership, report privacy, source byte/mode
restoration, Vue updates and attributed outside-PATH refusal before both initialization markers in
44.38s on the original 60s deadline. Forty-six focused PE cases, forty-four adjacent host/CLI cases,
types and lint pass in the recorded checks. See [accepted evidence and source history](../references/evidence/build-input-snapshot-proof.md#accepted-windows-dll-ownership-and-full-path-module-metadata-2026-10-17).
Remaining Windows lookup and preload/thread/publication obligations stay in the current closure
register. Other native/profile requirements, B6 and final committed-source strict `--all` remain open
and must execute in disposable CI; this focused pass does not close them.

The latest strict run, `2026-10-17T00-23-23Z-27374`, failed in integration after `ENOSPC` errors and
its existing 600-second aggregate deadline. Both unit pools, typechecks, builds and both packaged-authoring
halves passed. A dependent-runtime fixture omission found in that run is repaired (all five cases pass).
Other compiler/publication/watch assertions and individual timeouts remain unclassified; disk exhaustion
does not prove their common cause. The final full external-app step was not reached. Preserve the earlier
watch/frontend evidence too. Diagnose exact failures and establish available disk capacity before another
broad run; do not reopen the publication repair without new evidence. No passing strict gate is claimed.

### Execution order and change control

Phase 5 source checkpoint: frontend boundaries, `713a6c1fd`. Focused Vue/lifetime checks and the
real external-pack Electron case pass: failed panes/forms preserve other panes, host settings and
defaults; retired frontend retry is refused. The staged source and built runtime matched that proof.
Final whole-goal strict acceptance remains open.

Current Phase 4 source checkpoint: `cd9c57de6`, following producer `94148c9e0` and catalog/admission
`479c75e01`. One child actor owns entity intent, the invoked existence query and final delivery;
readiness carries a token. Feature handlers are direct, reference callbacks are removed, verified test
metadata is captured once, and offline inspection shows compiled destinations. Sixty shell checks and
the real external-pack Electron reference click pass. See [checkpoint evidence](../references/evidence/settings-and-pack-contracts.md#entity-opening-lifecycle-checkpoint-2026-10-16).
Strict run `2026-10-16T22-31-16Z-68388` failed the import boundary and facade report; both are corrected
and individually verified. Its authoring and external contract steps pass. Later gate steps and final
committed-source strict `--all` remain unproven; no passing broad gate is claimed.

Feature checkpoint `831221020` replaces the blueprint timer with `NODE.REVEAL`, a matching reply and
feature-owned cancellation; layout results belong to their requesting graph. Library document replies
fill only the current editor target and cannot navigate. All 99 affected Flows/Library tests, pack
types, lint, import boundaries, facade check and real default-pack build pass. Strict run
`2026-10-16T23-05-19Z-85766` stopped at packaged authoring: `lstat` could not find a default-pack runtime
source map while its build overlapped the authoring step. The disappearance's exact cause is not
established. No broad rerun or tooling change; preserve this for B6. See
[feature checkpoint evidence](../references/evidence/settings-and-pack-contracts.md#feature-navigation-checkpoint-2026-10-16).

Acceptance checkpoint `95ff95ab3` closes the six-handler and stored-message gaps. Eight reproduced
Actions/Prompts failures now pass: leaving detail, deactivation and returning to a cached selection
retire pending calls. Three reproduced shell failures now pass: breadcrumb/Back/Forward navigation
cancels pending entity opening. All 105 shell cases and 159 affected feature cases pass, as do host,
pack and E2E types and lint. The rebuilt runtime passes the real saved-message cross-feature click:
import a thread, reload its persisted message, click the rendered reference, verify the destination
note's title and content. See [acceptance evidence](../references/evidence/settings-and-pack-contracts.md#entity-navigation-acceptance-checkpoint-2026-10-16).
The preserved authoring gate failure remains open; no passing broad gate is claimed for this source.

Next: complete the remaining discovery inventory against current registration fields, native
declarations, event contracts and static assets; identify and close actual gaps. Do not restart the
implemented reference identity, destination catalog, shell lifecycle or unrelated compiler work.
The [registration inventory](../plans/discovery-without-activation.md#remaining-registration-audit-2026-10-16)
now records each field's authority and remaining gap. Native designation parity is repaired in
`b268fac86`. Endpoint source checkpoint `774b0844c` publishes one static endpoint-contract projection,
checks native/authored bindings and captures effective routing sets at admission. The real external-app
run exposed queued sends outliving their inbox; bus stop completion now drains earlier messages before
retiring authority. All 110 bus/lifecycle cases and the exact Electron disable/remove/restore case pass.
All 5,168 host and 888 pack unit cases pass (two pack cases remain intentionally skipped), as do five
dependent-runtime integration cases. CLI/testing types and lint pass after the last fixture repair.
The strict gate remains incomplete as recorded above; see the [checkpoint evidence](../references/evidence/discovery-without-activation.md#static-endpoint-contracts-2026-10-17).
Viewer checkpoint `be5a9344b` closes native backend artifact/block admission with the existing authored
checks. All 705 affected registry/runtime/fixture/frontend cases, host/SDK types and lint pass; no broad
rerun follows the recorded disk failure. Content checkpoint `2e1701fad` adds native content declarations,
shared writer ownership/backend membership checks and explicit native application acceptance. All 761
affected cases, 46 authored-manifest cases, host/SDK types, lint, refreshed package builds and schema/API
generation pass. Current checkpoint `f72cb8756` adds native migrations, shared checked bindings and
admitted native/installed targeting without fake manifests. App-line native owners need no own version;
pack-line owners declare it. All 840 affected cases, host/SDK types, lint, package builds and schema/API
generation pass. The inherited-key version-record and SemVer build-metadata rerun bugs are repaired.
Display-name audit/cleanup `123efbd6f` removes unused registration metadata rather than inventing a
native field. Required-entry checkpoint `b916d0e5e` refuses missing backend entries and frontend entries
required by declared bindings before staging, installation or build publication. All 705 affected
pack/CLI cases, two real build cases, host/CLI types and lint pass. Backend-only builds remain valid;
source-free discovery does not import authored modules. See [entry evidence](../references/evidence/discovery-without-activation.md#required-build-entries-and-display-metadata-2026-10-17).
Compiled-content checkpoint `3119205be` centralizes verified index capture in `readPackBuild`, shared
by staging and installer admission; CLI inspection drops its independent checks. Missing index entries,
wrong owners/policies and missing compiled data files refuse; missing specialty source paths fail the
compiler. Focused cases, types/lint and real shipped/external output reads pass; final layout acceptance
passes 110 cases including installation and capture races. See [content evidence](../references/evidence/discovery-without-activation.md#compiled-content-admission-2026-10-17).
Reader cleanup `e6ce3f1e4` removes the unused declaration-only reader; all 110 layout cases, host types
and lint pass. The [asset producer audit](../references/evidence/build-input-snapshot-proof.md#asset-producer-audit-and-bounded-follow-through-2026-10-17)
classifies remaining media, CSS, lazy/worker chunks and public-file copying. Proofs show returned Vite
graphs omit public copies and media copying bypasses an injected captured-byte view; neither alone
proves a publication failure. The [B1/B3 path matrix](../references/evidence/build-input-snapshot-proof.md#b1b3-current-compiler-path-matrix-2026-10-17)
is now recorded against current owners. Media execution checkpoint `129b541de` copies ordinary files
through captured byte/directory/metadata reads, preserving permissions and native link/special-file
behavior. The real input-view regression passes after reproducing live-byte copying; 22 compiler cases,
SDK/CLI types, lint and package builds pass. The preserved exit-handler case passes unchanged in an
isolated run; its earlier failure cause remains unclassified. See [media evidence](../references/evidence/build-input-snapshot-proof.md#captured-media-execution-checkpoint-2026-10-17).
Native-package acceptance `4c126846f` runs a real captured platform executable and addon after deleting
their source fixture; all ten installation cases pass. This verifies the existing package owner on the
current platform, not external binary overrides or Node/Electron runtime ownership. Public-input
checkpoint `d09a7f447` gives the frontend bundler the existing build owner and projects Vite's public
directory onto captured authored files, preserving copied permissions and bundle replacement behavior.
The real Vite regression, 19 adjacent frontend cases, CLI types/lint and package refresh pass. See
[public-input evidence](../references/evidence/build-input-snapshot-proof.md#captured-public-directory-checkpoint-2026-10-17).
Frontend scope checkpoint `0e03d4021` runs the complete bundling operation under the existing captured
read owner, retaining Vite's root and resolvers. Changed/unchanged real compiler cases cover Vue,
dependency code, CSS/SVG, lazy imports, browser workers, globs, Sass, Tailwind and configuration source
globals. The public-file case, 19 adjacent cases, CLI types/lint/package refresh and real external-pack
build/publication pass. See [frontend evidence](../references/evidence/build-input-snapshot-proof.md#frontend-read-scope-checkpoint-2026-10-17).
Dependency-startup checkpoint `9ecf788fb` captures declared npm bytes, filtered membership and missing
lookups before user initialization through the existing package reader/input owner. Twelve focused
input tests, the real native-preload regression, CLI/host types, lint and refreshed CLI build pass.
The real worker's two builds preserve unchanged sealed output/cache identity (50.02s). Existing twenty
package-reader cases also pass. See [dependency evidence](../references/evidence/build-input-snapshot-proof.md#early-declared-dependency-capture-checkpoint-2026-10-17).
This closes the demonstrated early declared-input gap, not external executable/runtime ownership or
all transient resolution paths. The next [executable-selection proof](../references/evidence/build-input-snapshot-proof.md#external-esbuild-executable-selection-proof-2026-10-17)
demonstrates that a changed external `ESBUILD_BINARY_PATH` executes under unchanged captured compiler
identity. Source `5c5f733fb` repairs that configured selection through the existing installation owner,
including its reuse checks, worker environment and cleanup. Twelve installation cases, real override
build/repeat identity, corrected cancellation fixture, CLI types/lint and package refresh pass; see
[executable checkpoint evidence](../references/evidence/build-input-snapshot-proof.md#captured-external-esbuild-executable-checkpoint-2026-10-17).
Frontend ownership checkpoint `a595246f2` now retains one builder for initial/dev/watch compilation and
Vite workers. Actual A/B publication/HTTP source watching, failure retention, watcher/session ownership
and complete process/copy/cache retirement pass, alongside affected lifecycle tests, CLI/scripts types,
lint and package builds. See [frontend generation evidence](../references/evidence/build-input-snapshot-proof.md#retained-frontend-compiler-ownership-checkpoint-2026-10-17).
Configuration checkpoint `d3833f788` refreshes on pack/shared metadata changes through the same owner;
fresh lookup fixes a reproduced UI link-cache omission. All 39 focused builder/package/shared cases,
CLI/host types, lint and package refresh pass. Real browser HMR through generated registration preserves
component state and document with no page errors; see [configuration/browser evidence](../references/evidence/build-input-snapshot-proof.md#frontend-configuration-and-browser-hmr-checkpoint-2026-10-17).
Cleanup `a67edefc1` centralizes generation sequencing; 29 affected lifecycle cases, CLI types and lint
pass. The [runtime-copy proof](../references/evidence/build-input-snapshot-proof.md#generation-cleanup-and-runtime-copy-feasibility-2026-10-17)
shows owned Node and Electron execution is feasible locally; Electron needs adjacent frameworks.
Runtime checkpoint `e369d3cb9` now owns the selected executable in the captured installation and uses
it for both worker launches. Twenty-three focused cases across the recorded runs, three real integration
cases, CLI types/lint/package refresh and integrated owned Electron execution pass; see
[runtime ownership evidence](../references/evidence/build-input-snapshot-proof.md#selected-runtime-ownership-checkpoint-2026-10-17).
Tooling subscription checkpoint `0bb9e64ec` closes the idle compiler/runtime/esbuild omission through
the existing observer/signature. Twenty-five focused cases, real idle filesystem delivery, CLI
types/lint/package refresh and a real distributable inventory check pass; see
[subscription evidence](../references/evidence/build-input-snapshot-proof.md#idle-tooling-subscription-checkpoint).
Namespace/native checkpoint `701928e9f` proves actual outside-addon execution uses the owned tree;
existing implementation suffices. Thirty-three view/namespace/observation cases and actual early
startup pass; see [bounded reconciliation](../references/evidence/build-input-snapshot-proof.md#native-module-and-namespacethread-acceptance-2026-10-17).
Environment checkpoint `84f473549` repairs a reproduced Vite output/identity mismatch, using a shared
initial-environment digest and private-path normalization. Twenty-five focused cases, actual startup
capture, CLI types/lint/package refresh pass. Repeat-build revision/cache assertions pass in a 64.02s
diagnostic run; its original 60s aggregate-budget failure remains a B6/final-gate item. See
[environment evidence](../references/evidence/build-input-snapshot-proof.md#initial-environment-identity-checkpoint).
Passive glob replay is implemented in `6c7198474`: actual TypeScript directory selection records
native filesystem facts, with complete authored membership supplied by its existing owner. Fifty focused
cases and real early startup pass; see [replay evidence](../references/evidence/build-input-snapshot-proof.md#passive-glob-replay-checkpoint).
Watch checkpoint `268ef667b` eliminates redundant tooling discovery while preserving build-time byte
verification. All 24 affected integration cases pass with two workers; no timeout changed. The
external-types budget remains tight and no broad/strict pass is claimed; see
[watch repair evidence](../references/evidence/build-input-snapshot-proof.md#compilerwatch-integration-repair-2026-10-17).
Common native input ownership is implemented in `0434a0703`: capture/replay now lives in the host
build layer, with no compiler activation or import-time filesystem interception. Eighty-two focused
checks, actual bundled startup, host/CLI types, lint and package refresh pass; see
[common-owner evidence](../references/evidence/build-input-snapshot-proof.md#common-native-input-owner-checkpoint).
Completed-frame replay repair `2d7dd140c` now honors explicitly consumed generated bytes without
expanding authored membership. Its regression failed on unchanged input before the fix; 52 affected
cases, passive replay and host/CLI types pass. See
[generated-input evidence](../references/evidence/build-input-snapshot-proof.md#explicit-generated-input-replay-checkpoint).
B4 source checkpoint `0192d2819` publishes completed input observations and recorded package/compiler/execution context in
`dist/build-inputs.json`, sealed by the existing output receipt. Reused phases retain their prior input
facts; passive replay uses common native ownership and installed staging omits source metadata. Real
repeat publication preserves phase reuse, sealed revision and cleanup (50.00s); 100 affected cases,
110 layout/receipt cases and host/CLI types pass. See
[completed-record evidence](../references/evidence/build-input-snapshot-proof.md#completed-source-inputoutput-association-checkpoint).
The frontend metadata reader now derives shared SDK owners from `getSdkFeModules()` and retains UI's
dynamic exports; it does not adopt backend EARS sharing. The six shared-package rule cases and eight
builder cases pass, alongside CLI types/lint; see the same evidence record.
Frontend output checkpoint `0e84bd67c` retains actual Vite emissions and public copies through final
sealing, including CSS/lazy/worker/maps and placeholder replacement. Missing required output refuses
the real candidate and retains its incumbent directory. See
[frontend output evidence](../references/evidence/build-input-snapshot-proof.md#frontend-output-expectations-checkpoint).
Content-output checkpoint `72435c778` feeds compiled JSON, the index and regular media bytes into that same
expectation owner. The real post-compilation media-deletion case refuses publication and retains its
incumbent; SDK/CLI types, 23 focused checks and all 28 SDK API reports pass. See
[content output evidence](../references/evidence/build-input-snapshot-proof.md#content-and-media-output-expectations-checkpoint).
Writer-output checkpoint `d4e24d4b5` feeds native backend/content/step bundles, rendered facade/helper/DSL
declarations, metadata and reused-phase files into that same final check. Reuse verifies the prior receipt's expected bytes before copying.
Twenty-eight unit/passive cases, six DSL cases, three actual native compiler cases, host/CLI types and
lint pass. Two real builds preserve reuse/revision/cleanup in 65.20s; see
[remaining writer evidence](../references/evidence/build-input-snapshot-proof.md#remaining-writer-output-expectations-checkpoint).
This implements B4's supported file-writer coverage. Its final acceptance still depends on the retained
B1/B3 ownership/lifetime requirements and converged checks. B5's prebuilt-test checkpoint `c70f37c3b` now verifies
the sealed output, replays completed source/dependency observations and requires a recorded `--release`
option when the invocation requests it. Its comparison context is the selected build's captured
compiler/execution context, not the Playwright runner's unrelated environment. A real default-setup
build now publishes that record and passes prebuilt acceptance; a release invocation refuses that
development output. Default-fork checkpoint `6a4f68602` checks the selected shipped build's completed inputs
and pins its prepared archive digest and checksum bytes. Its context is that selected build's recorded
compiler/options; preparation still builds the fork normally. Full preparation/cache/app acceptance
remains open. Archive checkpoint `8058fd1a2` verifies the completed record under its build lock and replays inputs again
after creating a temporary archive, before replacing published files. Its default output is
`.apack/archives`, outside authored inventory; custom output should remain under `.apack/` or outside the
pack. The comparison context is the selected build's recorded compiler/options, not the archiving process.
Archive-based tests compare the candidate's verified published-file hashes to that same captured
receipt and recheck its inputs at installation acceptance. Without local dist, explicit archives retain
independent source-free verification; a release invocation requires local release output for comparison.
Drive verifies the default pack's output/record and warns without preventing deliberate stale use.
The app-runtime timestamp nudge remains separate; it is not a pack freshness authority. The obsolete
pack timestamp checker and archive mtime comparison are removed. Focused acceptance, types and lint
are recorded in the evidence; no converged strict or final `--all` pass is claimed.
The real default build and archive pass; archive takes 19.39s and its unchanged assertions now live in
the integration suite rather than exceeding the fast suite's 15s budget. External preparation builds
both fixtures and passes 38 contract cases, but the fresh fork's archive exposed a source namespace
defect: native root-directory observations included the not-yet-published dist entry. Native directory
and cursor reads now apply the same source exclusions as module resolution; explicit output-directory
reads retain their full observations. A small case fails before the fix and passes afterward. The actual
worker now proves fresh publication, archive acceptance and unchanged repeat-build reuse in 61.51s.
See [fresh directory evidence](../references/evidence/build-input-snapshot-proof.md#fresh-publication-directory-namespace-repair).
Generic acceptance repair `f8fbbedf5`: adapted the generic portions of `d5845c96f` without merging research work.
The watcher mock now supplies the current factory; build stamps declare the two transitive input
modules; synthetic packs include required frontend/content files before sealing. The content compiler
failure fixture no longer declares an unrelated nonexistent source. All 155 affected fast checks pass.
The three-build replacement/cache case passes its assertions in 59.27s alone and exceeds 60s alongside
focused checks; it now has a named 120s exception, alongside the two existing 120s scenarios. This does
not resolve compiler cost or the earlier aggregate integration deadline. See
[generic acceptance evidence](../references/evidence/build-input-snapshot-proof.md#generic-acceptance-repair).
B5 real handoff acceptance now passes on source `895143b7b`: default build, fresh fork build/archive,
cached preparation verification and all four isolated app launches (two-window replacement/dev reload,
fork restart, removed-pack boot and restored-pack boot). The old external fixture correctly refused
before startup for stale compiler observations; rebuilding that fixture allowed the complete lifecycle
to pass. App bundles were refreshed because they inline changed host code. See
[real handoff evidence](../references/evidence/build-input-snapshot-proof.md#real-default-fork-handoff-acceptance).
Ordinary compiler-worker filesystem observations and one-shot settlement are implemented in
`c7d5603c5`. A real content compiler previously published an external worker-read value that freshness
did not track; the regression now passes for explicit termination, natural exit with explicit options,
nested workers and a background worker. A CPU-blocked worker refuses publication and preserves the
incumbent. Existing native preload/loader and builder cancellation checks pass. See
[worker ownership evidence](../references/evidence/build-input-snapshot-proof.md#compiler-created-worker-input-ownership).
Watch continuity and repair are implemented in `77e4bffc5`: typed capture probes feed existing
subscriptions after successful and failed compilers; the common record supplies additional native
freshness checks. A real external retarget fails without replacing the incumbent, then creating its
missing file publishes the repair without authored edits. Recursive directory probes, original source
paths, close cancellation and native termination semantics are covered. See
[watch evidence](../references/evidence/build-input-snapshot-proof.md#worker-watch-continuity-and-repair).
Native package-relative library ownership has source checkpoint `6710e3026`: extensionless file-path imports
capture the selected addon's owning package through the existing native input reader. An actual macOS
addon/library test and public build prove copied-byte execution and passive changed-input refusal;
see [native-library evidence](../references/evidence/build-input-snapshot-proof.md#package-relative-native-library-ownership).
Absolute external-library loading remains a demonstrated gap; other-platform lifetime behavior remains
unverified. The B1/B3 closure register above owns the support decisions and finite acceptance work;
neither item has an approved exclusion. Do not grow this repair into an incidental binary
relocation framework or make all independent work wait on that design decision. A1's API-route
inventory/prototype can proceed using the already implemented catalog and caller binding.
Focused tests, types/lint and the actual public build pass. One strict chain was deliberately stopped
during external authoring after its completed package/report/type checks passed; it is not a strict pass.
Its exact evidence and terminal cleanup are recorded at the link above. A1's first interface slice is
committed as `b39c189b8`: host onboarding is separate from appData administration, with owning-engine,
actual reset/restore, published-pack action and type/report acceptance. See
[onboarding evidence](../references/evidence/settings-and-pack-contracts.md#onboarding-api-separation-2026-10-17).
A1's combined codegen/host-binding/provider/lifetime/action prototype now passes; see
[prototype evidence](../references/evidence/settings-and-pack-contracts.md#consumed-service-prototype-2026-10-17).
The A2 declaration/codegen foundation is committed as `1a0de64fb`: shared grammar/host baseline,
direct provider ownership/selection, build validation, schema assistance and catalog preservation pass.
See [declaration evidence](../references/evidence/settings-and-pack-contracts.md#consumed-service-declaration-foundation-2026-10-17).
A2's pre-import/admission and read-only validation/inspection checkpoint is committed as `558b42220`.
Missing/disabled/invalid providers, direct ownership, dependency versions and nested requirements are
checked from catalog data; poisoned consumer modules remain unexecuted. See
[admission evidence](../references/evidence/settings-and-pack-contracts.md#consumed-service-admission-2026-10-17).
A3 root retirement is implemented in `3ccd27614`: retained generated roots cannot regain settings
authority after rebind, and cleanup failure still refreshes the exported root. See
[root lifetime evidence](../references/evidence/settings-and-pack-contracts.md#generated-service-root-retirement-2026-10-17).
A3 core binding/filtering/lifetimes are implemented in `cccc12d5d`: backend `bindServices` receives
the host-selected facade, types select the same APIs, accepted provider/host generations guard
retained methods and nested objects, and inference agent methods retain their lifetime. Registry-local
mock overrides cannot expand the selection or cross registries. The coordinator still owns caller
retirement after actor cleanup; scheduling failure revokes immediately. See
[core binding evidence](../references/evidence/settings-and-pack-contracts.md#selected-service-bindings-2026-10-17).
A4 service/action routes are implemented in `bb6df4a45`: the public ambient SDK service value is
removed, ActionService/LLM use generated bindings, and action logger/emitter views preserve accepted
selection, lifetime and sender labels. Root flows capture the action factory once; child flows inherit
it. Scoped settings and registry-owned harness overrides retain their contracts. Actual shipped-pack
action, inference, onboarding and reset cases pass; see
[action access evidence](../references/evidence/settings-and-pack-contracts.md#bound-action-access-and-ambient-route-removal-2026-10-17).
The named B4/B6 marker mutation is reproduced and repaired in `caf57cb0e`; see
[generation cache evidence](../references/evidence/settings-and-pack-contracts.md#generation-cache-ownership-2026-10-17).
A4 content-target validation already uses the normalized entity registry; retain its checks rather than
reimplementing it. Authoring acceptance on source `1fbc1e223` passes: default build, standalone facade report with
preserved build freshness, five dependent runtime cases, seven unchanged harness cases, and the real
external authoring contract (38 fixture cases, bundled UI build/typecheck and default-fork archive).
`45f2a3458` gives the dependent fixture real generated registration/bindings; `1fbc1e223` types a
scheduler test double from its provider without granting the consumer unused APIs. See
[current authoring evidence](../references/evidence/settings-and-pack-contracts.md#current-build-service-authoring-acceptance-2026-10-17).
The app run then passed 26 cases, including fork reload, and exposed premature caller retirement
when disabling default-setup. `3769e930f` fixes that owner mismatch; 64 focused cases and the actual
formerly failing disable/remove/replace/restore window pass. See
[teardown evidence](../references/evidence/settings-and-pack-contracts.md#disabled-caller-retirement-2026-10-17).
The two-core checkpoint stopped at `typecheck:api` after 24.7s: four API composition test files still
used dynamic imports of the removed ambient SDK service value. `5f5970e6e` migrates those tests to
bound host ports/engine/registry and the baseline emitter. All 30 affected cases, all three API typecheck
projects and focused lint pass. See
[API test migration evidence](../references/evidence/settings-and-pack-contracts.md#api-composition-test-migration-2026-10-17).
The resumed two-core checkpoint then passed the current default build, facade, all reached type/schema/
export/specifier/tier/lint checks and external contract/fork preparation, but failed packaged authoring:
the generated demo service called inference without declaring it. `a0911a017` adds `host/inference`
to that fixture and checks authored types before running its unit tests. Its retained tarball-installed
workspace passes types and all seven harness cases. See
[packaged fixture evidence](../references/evidence/settings-and-pack-contracts.md#packaged-inference-declaration-2026-10-17).
The corrected complete author half passes in 263s and its app half in 21s, including both browser
cases, offline database export and no workspace symlinks. Logs:
`/private/tmp/apack-packaged-consumption-author-full.log` and
`/private/tmp/apack-packaged-consumption-app.log`. The two-worker host pool completed with 5,323
passing cases, one failed case and one collection failure. `1f5db11c6` repairs the API composition mock
and nonexistent docs-index link; all 21 affected cases pass. The pack pool completed with 881 passing
cases and eight failures in four files: tests inspected lifetime-bound service handles as raw spies or
expected raw object identity. `df1a937a8` retains the original spies for assertions while executing through
the guarded services; all 17 affected cases, pack types and focused lint pass. Neither focused repair
is a single converged pool pass. The previously unexecuted integration pool reached its 600s suite deadline on two workers
(`/private/tmp/apack-service-integration-pool.log`). Before termination it reported scaffold and linked
Tailwind watcher case deadlines plus an overly specific stale-archive diagnostic assertion. The
scaffold and linked Tailwind scenarios now pass together on two workers in `545054877`:
three selected cases pass in 108.70s, including the feature-build prerequisite. The scenario-specific
120s exceptions retain every assertion and both 20s watcher waits; actual scenario times are 59.76s
and 65.45s. `1ad1c8c12` also accepts both exact valid stale-archive diagnostics. Local concurrency is
accepted, but the aggregate 600s suite timeout and remaining integration files are unresolved. Do not repeat the broad pool for
diagnosis or treat the generic timeout message's historical 60s estimate as evidence of a deadlock.
The bounded cost diagnostic is complete: `858120200` removes duplicate namespace-admission work;
actual captured-resolution cases pass, but whole-build/aggregate capacity is not claimed improved.
`ac964c348` makes pool output live and integration fail at its first failure, retaining verdict and
coverage rules. See [cost and failure evidence](../references/evidence/settings-and-pack-contracts.md#bounded-compiler-cost-and-early-failure-checkpoint-2026-10-17).
The [public contract audit](../references/evidence/settings-and-pack-contracts.md#public-contract-documentation-audit-2026-10-17)
aligns current default selection, static versus executable contributions, caller-bound services,
migrations, settings and shell-test guidance with inspected implementation. Manifest decision 12 now
records catalog-based selection as the explicit replacement for registration-order selection.
The subsequent converged two-worker attempt reached 600s with three publication-file failures:
one help-case timeout and two resulting cwd/temporary-directory failures. `a8531f54d` removes global
cwd mutation, skips unrelated frontend work in the help-only case, and forwards `--bail=1` through the
pool CLI because root configuration was not inherited by independent projects. All 14 affected cases
and 62 pool checks pass; the real separate-project/control proof and types/lint pass. See
[repair evidence](../references/evidence/settings-and-pack-contracts.md#project-fail-fast-and-publication-test-isolation-2026-10-17).
The broad run remains incomplete. Do not repeat it for diagnosis: aggregate execution/budget must be
resolved before another whole-pool attempt. `b366ae4d5` also corrects the historical healthy-cost diagnostic and isolated retry reports: neither
elapsed time nor a passing retry identifies the original cause. All 185 affected checks and types/lint
pass; [diagnostic evidence](../references/evidence/settings-and-pack-contracts.md#evidence-only-timeout-and-retry-diagnostics-2026-10-17).
No budget is changed and no broad rerun follows. Next: resolve native/platform and aggregate validation boundaries, then finish converged
acceptance, the final requirement audit and strict gate. Do not
repeat the accepted tarball producer just to restate its status. No whole-gate pass is claimed from the focused repairs.
After the captured pack-test edits, refreshed default-setup, both external fixtures and the fork through
the real authoring contract. The complete external app command now passes all 27 fixture cases, the
bundled-UI editor case and all four normal fork launch/restart/removal/restoration cases:
`/private/tmp/apack-editor-checkpoint-external-app.log`. See
[current app evidence](../references/evidence/settings-and-pack-contracts.md#refreshed-external-app-and-normal-fork-acceptance-2026-10-17).
This is current local app convergence, not a whole strict-gate pass. Keep B1/B3 native/platform
requirements and the final committed-source strict `--all` open. The user subsequently approved bounded
native support in `711565757`. `cc186a0d0` enforces declared outside-library refusal for selected macOS
compiler modules, preserving real captured relative loading, JavaScript exports fallback and repeated
refusal. See [native checkpoint evidence](../references/evidence/build-input-snapshot-proof.md#bounded-macos-module-library-admission-2026-10-17).
Startup/thread/Vite, ELF/PE and public-build acceptance remain required within that approved boundary.
Windows validation uses the existing manual CI dispatch (`6fb4d9bcb`). The user authorized branch
pushes and focused Windows CI on 2026-10-17. No descendant-lifetime acceptance is claimed.
Native startup checkpoint `e6dd35d52` keeps native admission active independently of startup filesystem
interception, reuses the package/read-tree owners, and verifies captured relative preload loading,
changed-library freshness and incumbent retention after direct/transitive refusal. Four real addon
cases, 79 affected unit cases, 53 tooling cases, host/CLI types and lint pass. See the
[startup evidence](../references/evidence/build-input-snapshot-proof.md#native-startup-admission-checkpoint-2026-10-17).
This is a focused source checkpoint, not the converged B6 or final strict gate. A diagnostic run also
demonstrated inherited preloads executing without capture in checkout setup and the separate content
runtime checker. `70101557e` fixes the checker boundary: it simulates a dependent runtime without
compiler launch options, preventing compiler hooks from hiding unusable published bundles. The
regression fails on the prior implementation; six runtime cases and the real ordered-preload,
changed-loader rebuild case pass. Checkout setup precedes compiler capture; it is not an unowned
compilation phase. See the [boundary evidence](../references/evidence/build-input-snapshot-proof.md#published-runtime-initialization-boundary-2026-10-17).
Do not interpret compiler-startup acceptance as arbitrary child-process coverage. Retained frontend
and other-platform native acceptance, ELF/PE, loader-environment semantics, Windows lifetime ownership and the converged/final
gates remain open. Next, reconcile native initialization with retained frontend generations while
preserving live authored HMR and checking the existing generation owner before adding machinery.
`abdcb7c95` fixes one inspected frontend identity omission: the reuse signature now includes effective
ordered Node options with the same source-condition filtering as launch. Its regression fails before
the fix; nine builder lifecycle/identity checks, CLI types and focused lint pass. This closes changed
launch-option reuse, not native preload dependency capture or all frontend initialization inputs.
`c3b27fda7` closes the real macOS native-worker acceptance case through the existing thread owner:
captured relative loading, changed-library freshness, direct/transitive pre-initialization refusal and
incumbent retention pass in 38.18s. The shared preload regression also passes in 27.77s, with 53 tooling
checks, CLI types and lint. See [native-worker evidence](../references/evidence/build-input-snapshot-proof.md#native-worker-library-acceptance-2026-10-17).
A separate 0.84s native-loader experiment demonstrates that inherited `DYLD_LIBRARY_PATH` can replace
a captured loader-relative library with an outside copy. `70480baeb` closes that demonstrated case:
launch settings survive preload environment changes and worker creation; matching outside overrides
refuse before addon initialization, while an unused directory is allowed and its later matching file
invalidates freshness. The real worker/public-build case passes in 31.03s with incumbent retention;
52 focused cases, 53 tooling cases, CLI types, lint and a targeted mutation check pass. See the
[search-path checkpoint](../references/evidence/build-input-snapshot-proof.md#native-search-override-admission-2026-10-17).
`99ca1c6af` closes direct pre-initialization insertion through build preparation and both worker launch
owners: normal OS insertion succeeds; live outside and original-package paths refuse before launch,
without running a real library constructor or replacing the accepted build. The real case passes in
25.70s with 24 policy cases, 53 tooling cases, CLI types, lint and a targeted mutation check. See the
[insertion checkpoint](../references/evidence/build-input-snapshot-proof.md#pre-launch-library-insertion-admission-2026-10-17).
This does not close every loader control: inspect applicable framework/versioned/fallback/suffix
controls and shared-cache-specific precedence before claiming the macOS environment boundary complete.
Then finish retained-frontend initialization without freezing HMR. ELF/PE, Windows descendant
lifetime/native execution and the converged/final strict gates remain open.
The user authorized branch pushes and focused Windows CI. Packaging launch/exports and unit
portability repairs now pass all seven original focused files on Windows (81 cases, seven platform
skips) in [run 39059985521](https://github.com/spankyed/apack/actions/runs/39059985521).
`71e862359` preserves worker stacks; [run 39060486872](https://github.com/spankyed/apack/actions/runs/39060486872)
identifies ordinary realpath failing on Windows extended paths. The current coherent correction
uses native identity across roots, package inputs, captured trees and passive readers while preserving
root-link metadata and authored-root watch exclusions. `f42e77db9` separately isolates a pack's esbuild
override from checkout setup. See [path-policy evidence](../references/evidence/build-input-snapshot-proof.md#consistent-native-compiler-path-identity-2026-10-17)
for the focused checks and real local repeated-build proof. Run the expanded focused Windows job
against the committed correction; worker-baseline fail-fast remains enabled. Compiler platform and
descendant-lifetime acceptance remain open. The earlier Windows trial history is retained in that
evidence record rather than another live task list.
The local two-core integration run against `e8940bb6d` reached its unchanged 600s deadline after
eight files / 474 cases passed, including all seven native-library cases; the pool remains incomplete.
See [launcher and pool evidence](../references/evidence/build-input-snapshot-proof.md#windows-package-launcher-and-local-integration-checkpoint-2026-10-17).
Do not repeat this broad run to diagnose the Windows launcher or count it as B6/final acceptance.

The single two-core strict run failed preparing the default-pack fork: the build observation for
`src/__generated__/.inputs-hash` no longer matched, and the chain also invalidated default-setup's
output stamp. The external fixture's 38 checks and real packaged-authoring author half passed first;
app halves, unit pools and integrations did not complete in that run. This is a named B4/B6 freshness
acceptance gap, not permission to weaken strict validation. The focused reproduction now proves the actual writer: standalone generation changes only its
compiler-specific stamp, which previously lived among consumed generated modules. The stamp now lives
in `.apack/generate-entries.json`; generated-byte changes still invalidate builds. The real default/fork
path now passes on the repaired committed source; strict convergence still needs acceptance. Retain the explicit B1/B3 gaps and incomplete gate. Finish affected integration
acceptance on two cores before repeating a broad gate. Do not rebuild
the accepted default/fork handoff again unless its inputs change or a named coverage gap requires it.
Reconcile
the finite native/platform lifetime boundary against supported compiler operations before closing B1/B3. Preserve required external-library and
platform/thread-lifetime acceptance;
preserve the now-accepted namespace cases without starting another resolver or observation framework. Preserve
B2's accepted owner and browser proof; do not schedule another frontend generation implementation.
Then complete B4–B6 and all-kind acceptance. Asset input/output completeness remains required under B1/B4,
not a deferred follow-up or another discovery store. All three Phase 6 workstreams remain required. Do not restart implemented endpoint
or navigation work, or rerun a broad gate to investigate the preserved integration failures.

1. Phase 4 entity destinations/caller migration and Phase 5 containment are implemented and locally
   accepted. Retain their checks for final verification rather than schedule another implementation.
2. Close the remaining discovery inventory: classify supported registration fields, native declarations,
   events and static assets; identify actual reader/loader gaps and finish those migrations. Each slice
   names the declaration, binding and publication guarantees it consumes. A producer dependency blocks
   only the affected slice, not all installed-data readers.
3. Complete B1–B6. Before changing B1 or B3, record a finite matrix of supported paths, existing owners,
   concrete uncovered requirements and the check that closes each gap. Review existing implementation
   first; do not treat an audit heading as authorization for another general capture/resource framework.
4. Implement consumed APIs and close the actual remaining provenance/replacement gaps. Reuse landed
   ownership, inspection and replacement behavior rather than replaying historical plans.
5. Complete Phase 7 across the entire preserved scope using the acceptance register below.

Before each checkpoint, record its concrete change, acceptance cases and dependency. Close it with
source/evidence before selecting another. A newly found concern must name the observed defect or
required acceptance gap, the existing requirement it serves, and a finite exit condition. An existing
requirement remains required even before a failing reproducer exists; investigating it is not permission
to implement an unlimited generalization. Proposals expanding the agreed scope require an explicit user
decision. Keep research hypotheses separate from demonstrated defects and required acceptance checks.

Keep detailed historical logs in [the evidence record](../references/evidence/settings-and-pack-contracts.md) for traceability. Update this ledger when a checkpoint closes;
do not append a new competing live backlog or repeatedly copy all remaining work into every evidence
entry. No scope is dropped, validation weakened, deferred work revived or implementation certified by
this documentation change.

### Final acceptance register

This is the cross-phase closure checklist. Subsystem plans retain their detailed cases; link existing
coverage and source evidence here as each row converges, recording missing checks explicitly. A row
with missing or indirect evidence remains open. Existing local passes need not be rerun separately
before the final gate unless their inputs or asserted behavior change. This register does not replace
required checkpoint validation. The final acceptance decision above governs remaining validation;
historical strict-gate references in this register retain their original evidence boundaries.

| Scope | Required closure evidence | Current disposition |
|---|---|---|
| Foundation and manifest | Complete supported-field classification; all 17 consolidation decisions and both naming outcomes; generated EARS typed/untyped behavior, ownership, canonical writer, schema/API reports and external authoring | Current audit `a74bbd88a` covers all decisions; declaration/schema/generator/writer code remains unchanged at `3827993ba`. Current normalization/parser inspection agrees. Preserve historical EARS/content/runtime evidence and require the active strict schema/API/authoring gates; no new consolidation implementation is identified. |
| Settings | Host, pack and feature ownership; same-name groups, shared/restricted policy, disabled/failed owners, reset/import, custom forms and multiple windows | Current five host-only window cases and complete 27-case external app suite pass, including import, two assistant groups, restricted dependency credentials, custom forms and cross-window edits. Preserve the existing unit/failure cases for final strict acceptance. |
| Discovery | Every supported kind/native field and static asset; source-free poisoned pack/dependency inspection, inactive owners, collisions, atomic updates and checked bindings; no activation/user-data writes | Registration-field classification is closed in `031e3a521`; its catalog/declaration readers remain unchanged. Preserve poisoned/source-free/inactive-owner and exact-binding coverage through the strict gate. No additional reader implementation gap is identified. |
| Editor and content | Actual Monaco worker/cold document and typing through replacement; shared-library disposal; static flow edges, rename/missing-target diagnostics and honest dynamic status | Real cold-worker/typed replacement/shared lifetime cases pass in `d1c38bc58`; no-activation marker `9b7d112cf`, five-build DSL case `3913fe196` and source-free flow checks `415228f0c` are accepted. Preserve this evidence through the final gate; these are not unimplemented migrations. |
| Build ownership/freshness | Finite B1/B3 path matrices, frontend generation replacement/HMR, atomic successful input/output association, four passive consumers, preserved failure retention and deterministic reuse | B2/B4/B5 are implemented and locally accepted. B1/B3 retain their recorded platform, runtime, admission and lifetime evidence; bound-only refusal is user-approved in `c38c36301` and has focused verification in `12447893a`. Main native-watch repair `bc53fed70` passes in strict run `39196299955`; that run stops at the later preload case's 60s limit. Diagnostic `39199301017` proves both cases complete; main scoped repair is `24dc840c1`, with previously unreached native-tail acceptance in `39199767205`. The strict run predates the PE repair and does not reach authoring/runtime/app halves; final committed-source acceptance remains required. Preserve the complete closure register and every required final gate. |
| Entity navigation | Build-checked destinations, conflicts/disabled/missing/retired delivery, typed guard, complete caller migration and stored-reference Electron case | Locally accepted through `95ff95ab3`; retain the complete handler, cancellation and real-window evidence for final acceptance. |
| Frontend containment | Pane/form failures preserve other panes, host settings/defaults; retries reject retired instances in main/popout paths | Locally accepted in `713a6c1fd`; preserve through final gate. |
| API consumption | Audited declaration granularity, generated/runtime facade agreement, undeclared/unavailable API diagnostics, content/dependency contracts and settings policy | A1–A4 service routes are implemented through `bb6df4a45`; A4 content checks already exist. Refreshed authoring/harness and complete external app/fork acceptance pass; A5 schema/API/export agreement passes on `b62da5c72`, with public guides and templates reconciled; see [agreement evidence](../references/evidence/settings-and-pack-contracts.md#a5-schema-and-api-agreement-2026-10-17). Converged and final strict acceptance remain open. |
| Provenance/replacement | Exact origin/version/content through reuse/inspection; explicit linked development; fork restart/reload, managed updates, disable/remove/restore, override retention and failed-publication incumbent | Locally accepted real external app/fork lifecycle and cache/resolution/inspection cases remain the authority. No provenance or replacement code changed after their accepted checkpoint; retain exact producer/archive/app consumption in the strict gate. |
| External package consumer and release preparation | Real CLI/SDK/testing package tarballs installed outside the monorepo; real scaffold/build, release preparation, verified archive and exact archive execution against isolated host data; preserve relevant release-sequence checks | Use the existing packaged-authoring author/app halves and release tests. Apply the evidence boundaries below; local success is not public release readiness. |
| Final committed tree | Requirement-by-requirement audit, reviewed schema/API/docs/templates, passing normal integration and mapped prior/focused checks on recorded committed source; actual authoring/app evidence | Outstanding; the user waived repeating the full strict gate, not the audit or uncovered behavior. Archive only after every row is proven. |

### External authoring and release evidence

Use the existing [packaged-authoring author half](../../../tests/acceptance/packaged-authoring/test-packaged-authoring-author.sh)
and [app half](../../../tests/acceptance/packaged-authoring/test-packaged-authoring-app.sh), not a second acceptance harness.
They pack the actual CLI/SDK/UI/EARS/testing distribution trees into local npm tarballs, install them
in a temporary project outside the monorepo, scaffold/build/test a pack and prepare a verified archive.
The app half runs that exact archive against the explicitly selected built host with disposable
profile/database data and compares installed integrity metadata. An isolated host here does not mean
cutting an app release: reuse the built checkout through the existing host-selection contract.

Required closure for this goal:

- Preserve real installed-package behavior, generated declarations/exports, archived files and
  source-free runtime checks; workspace imports or unpublished global CLI fallback cannot stand in
  for package-consumer acceptance. App/pack dependencies must use the recorded explicit test host.
- Separate local build publication (accepting `dist/` and its build/input record) from publishing a
  public release. Failure retention and coherent replacement remain required local behavior.
- Report archive/runtime acceptance separately from release readiness. Current release dry-run
  continues after reporting preflight errors; a passing dry-run archive does not establish valid
  origin, credentials, workflow or public package/host availability. Record those preflight findings
  and any intentionally split E2E checks rather than claiming an unrestricted release pass.
- Preserve relevant existing release-sequence/refusal tests and repair regressions caused by this
  goal's contract changes. Add cases only for uncovered affected behavior; this is not a new release
  subsystem or a requirement to perform a real version/tag/push cycle before this goal can close.
- Record source/package/host identity, exact checks/results and the scope actually exercised in the
  existing evidence record, retaining the required converged/final checks. Reuse unchanged accepted
  cases rather than restarting authoring implementation or repeatedly running broad suites.

No permanent external pack repository, monorepo release, public npm/Homebrew publication or GitHub
release token is required for these local checks. The
[external-pack release readiness plan](../../plans/deferred/external-pack-release-readiness.md) owns fresh public
workflow bootstrap, release-readiness semantics/recovery and the separately authorized GitHub release
round trip. The [distribution plan](../../plans/deferred/npm-and-homebrew-distribution.md) owns npm/Homebrew.
Record these public paths as unverified; do not silently claim them from local tarballs or make them
prerequisites for finishing this goal. No existing manifest, settings, discovery or external runtime
requirement is moved out of this goal by that distinction.

### Discovery, editor and provenance closure

Use this checklist to reconcile the register above against current code before scheduling repairs.
For each row, record the implementation path/source commit, existing test/evidence links, exact missing
work (or none), and result in the existing subsystem evidence record. Distinguish a demonstrated defect
from unverified acceptance. An old “partial” label is not evidence that implementation is still missing.

| Closure item | Existing implementation to reconcile | Pass condition / missing evidence to resolve |
|---|---|---|
| Discovery readers and fields | Common catalog and reader migrations; current registration/native/snapshot field inventory rechecked | Supported registration-field classification is closed in the [current audit](../references/evidence/settings-and-pack-contracts.md#registration-and-reader-closure-audit-2026-10-17). Lifecycle, offline schema, CLI and UI metadata use accepted declarations; activation eligibility is separate. Final all-kind and asset/producer acceptance remain required; no new duplicate reader is identified by this audit. |
| Installed discovery and replacement | Verified build admission, checked bindings and catalog publication | Every supported kind remains inspectable with authored sources absent and throwing executable entries unimported. Disabled/failed owners remain explainable; collisions name owners; invalid replacements retain accepted metadata/bindings. Inspection writes no user data. Reuse existing per-kind proof and add only uncovered cases. |
| Compiled flow references | Static index/reader checkpoint `7196d61d3`; actual source-free external build inspected at `df1a937a8` | Local acceptance closed: verified external output reports two incoming memo-action edges; rename/removal analysis retains those edges as `not-indexed`. Existing computed/unavailable cases remain explicit. See [external flow evidence](../references/evidence/settings-and-pack-contracts.md#source-free-external-flow-inspection-2026-10-17). Final committed-source gate remains required. |
| Cold editor and worker readiness | Catalog-driven composition `8863043a6`; compiled DSL readers/offline Monaco; real worker acceptance `d1c38bc58` | Local acceptance closed: cold document gains actual worker completions from a disabled source-free build; replacement changes completions/diagnostics without replacing its model or losing typed draft/selection. Removal yields missing-provider diagnostics. See [window evidence](../references/evidence/settings-and-pack-contracts.md#real-cold-monaco-worker-and-editor-lifetimes-2026-10-17); preserve for the final gate. |
| Editor replacement and shared-library lifetime | Generation-checked composition and owned DSL libraries; five real host-only window cases pass at `d1c38bc58` | Monaco local acceptance closed: typed document/model/selection survive replacement and shared assistance survives one editor closing; Tiptap activation/removal preserves draft/selection/update count. Compiler five-build publication/refusal/reuse/removal is locally accepted in `3913fe196`, with explicit invocation-versus-published identity and a measured per-case deadline. Preserve for final all-kind/strict acceptance. |
| Dependency origin and inspection | Immutable cache/admission `ff4358588`, read-only inspection `d6fa2c6dc`; current reader/producer audit | Local acceptance closed: cache reuse retains original origin/version/content, differing repositories cannot reuse one another's cache, changed same-version builds retain prior paths, and explicit links remain identifiable. Existing real producer/consumer inspection survives source removal without cache writes or activation. See [provenance reconciliation](../references/evidence/settings-and-pack-contracts.md#dependency-provenance-closure-audit-2026-10-17). Final strict acceptance remains required. |
| Dependency/replacement consistency | Existing receipt admission, common freshness record and shipped-pack replacement checkpoints | A consumer cannot mix declarations and executable bytes from different accepted builds. Failed publication preserves the incumbent; captured paths remain coherent across replacement. Reconcile restart/reload, overrides and disable/remove/restore against existing real handoff evidence before adding cases. |

Close each row by linking sufficient evidence or fixing its named omission, then update the owning
register disposition. Preserve the complete per-kind and cross-phase requirements in linked plans;
this checklist neither replaces them nor starts a parallel backlog. Reuse accepted evidence unless
inputs or assertions changed. Run focused checks for repairs and the required converged/final gates
after convergence. Do not restart implemented subsystems or add frozen resolution without a concrete
distribution requirement. API-consumption implementation continues independently where dependencies allow.

## Background (2026-10-12, at 3d389b9c8 on session/naming-contracts)

The [naming goal](goal-naming-conventions.md) is complete and archived, with its outcome
and validation recorded. Commit `3d389b9c8` closes that work. The settings/discovery plans and this goal
are already on its branch; use that completed state or a later integration containing it as the baseline.
Do not restart naming implementation or require ongoing synchronization with the finished branch.

At kickoff, settings and discovery were designed but unimplemented. That historical baseline comprised
shared foundation, settings, full discovery, navigation/fault boundaries, and API consumption/provenance/
replacement. The live ledger now distinguishes landed implementation from unfinished work and final
verification. Historical surveys in the linked plans are not current-code claims.

## Decisions

1. **One working branch in the main checkout.** The initial isolated branch was forked from master.
   The user then promoted it to the main checkout; continue there on `session/settings-pack-contracts`.
   Naming integration is a kickoff prerequisite, not an ongoing workstream. Commit incrementally.
2. **One shared foundation.** Inventory all supported contribution kinds before designing the catalog.
   Extend the existing snapshot/build pipeline, with settings as the first catalog projection. No second
   authored inventory, settings-only catalog or runtime fallback for missing declaration metadata.
3. **Safe checkpoints before switching readers.** Each migrated kind includes descriptor validation,
   checked binding, ownership rules and coherent build/publication before consumers depend on it.
   Keep declared, eligible and active states distinct. Discovery changes no execution ordering by itself.
4. **Settings contracts stay settled.** App settings belong to the host; pack groups use
   `extensions.settings`; features use their own settings definitions. JSON Schema describes values and
   validation; forms remain custom. Shared dependency read/write/reset is the default, with opt-in
   owner-only mutation enforced through trusted caller binding. Preserve user overrides and lifecycle state.
5. **Build on completed naming.** Verify the baseline once, follow its resulting contracts for new APIs
   and retain its regression checks. Do not apply retired blanket naming bans or repeat its refactors.
6. **Finish the whole active scope.** Phase 6 has separate API, provenance and replacement checkpoints.
   None is silently dropped because the settings/discovery work is substantial. Strong security isolation,
   general lazy activation and speculative package-manager work remain outside this goal.
7. **Contracts are maintained when they change.** Migrate all owned callers, fixtures, templates and public
   docs at each checkpoint; regenerate affected schemas/API reports then. There are no users to support
   through old-format compatibility. Normal boot/import use the current settings contract only; the
   developer backup is a separate explicit operation if conversion proves necessary.

## Working setup and checkpoint workflow

### Kickoff

Pin the chosen starting commit and verify it contains the completed naming work (`3d389b9c8`) and this
goal. Record the base SHA, naming completion SHA, goal branch and worktree path. If naming was merged
with preserved history, verify ancestry. If squash/rebase changed its commit identity, record the landing
commit and verify the resulting contracts and archived validation instead of insisting on the old SHA.
Master is a suitable base once that integration has landed; do not branch from a tree missing naming.

The initial branch and worktree were created from master `d7e77829a`. On 2026-10-12 the user promoted
this goal into the main checkout at `/Users/spankyed/Develop/Projects/AgentBuddy`, keeping the branch
`session/settings-pack-contracts` and its commits. Continue there; do not create another worktree merely
because the original kickoff used one. Preserve unrelated concurrent work and use isolation only when
requested or clearly necessary under CLAUDE.md. The promotion supersedes the original worktree requirement.

If an existing goal branch lacks naming, integrate the completed commits once through the repository's
`session:check` workflow before implementation. Resolve conflicts and validate the combined candidate,
then incorporate only the tested result. No repeating naming-branch fetch/merge loop is required.

### Each implementation checkpoint

Run focused checks and the required checkpoint validation, inspect the staged diff, and commit a usable
logical change before starting the next. Record its commit and validation in [the evidence record](../references/evidence/settings-and-pack-contracts.md), then update the live ledger. Large phases have
multiple checkpoints; Phase 6's three workstreams each have their own commits and evidence.

Follow [bounded validation](../../../CLAUDE.md#keep-validation-bounded). Define the checkpoint's claims
and checks before its broad run. Diagnose failures from preserved logs and the smallest reproducer;
after a fix, run the failing case and affected suite. Another broad run needs a stated coverage gap or
the required converged checkpoint/final gate, not reassurance after each edit. An unexplained recurring
failure stops broad reruns: report the exact blocker and next diagnostic action. Do not expand the
implementation into unrelated test infrastructure or performance work without an explicit scope decision.
Required gates and the final committed-source strict `--all` acceptance remain required.

Apply settled naming rules to new interfaces as ordinary implementation review. If separately authorized
integration work later becomes necessary, follow CLAUDE.md's pinned integration validation; the completed
naming branch is not an automatic source of future changes.

## Phases

### Phase 0 — Isolate the work and establish the baseline

Establish the branch from a committed state containing completed naming and this goal. The initial
worktree setup is complete and the branch is now promoted to the main checkout. Inspect the linked plans
against that code, record current contribution/setting entry points, and verify the naming baseline once.
Use existing isolated fixtures for stored-data and app checks.

**Done when:** the branch/worktree and source SHA are recorded, setup succeeds, source work is untouched,
and baseline failures or stale survey claims are investigated and accounted for before affected work starts.

### Phase 1 — Contribution inventory and shared foundation

Follow the inventory and foundation checkpoints in
[discovery without activation](../plans/discovery-without-activation.md), shared diagnostics in
[manifest maturity](../plans/manifest-maturity.md#2-share-precise-validation-and-diagnostics), and the
settings contract prototype in [settings architecture](../plans/settings-architecture.md).

Cover every supported registration/extension field, its owners, static metadata/assets, dynamic results
and runtime binding. Establish one validated descriptor reader and host catalog, including host-owned
contributions. Prototype the schema/type/defaults contract and trusted settings caller binding. Publish
settings metadata and generated bindings coherently, with ownership and stale-build checks.

**Done when:** the inventory has no unclassified supported fields; the first settings projection reads
without pack execution; diagnostics distinguish invalid from incomplete; mismatched bindings, conflicts
and failed rebuilds are covered before consumer migration. Mutation checks prove the relevant guards.

### Phase 2 — Complete settings ownership and interfaces

Implement the remaining [settings architecture](../plans/settings-architecture.md) checkpoints in
reviewable slices: host app ownership and current-document validation; pack groups and handles; feature-schema conversion;
onboarding state/preferences separation; window runtime; custom forms and product surface.

Use the existing draft helper, request correlation and typed paths. Fix Projects snapshot mutation,
disposal and stale-array writes. Validate defaults and overrides consistently; preserve orphaned overrides.
Validate the current document through the common installed catalog, including import/restore paths.
Do not add automatic historical-format conversion; backup preflight must refuse invalid candidates
before replacing live data.

**Done when:** the settings plan's acceptance checks pass for all three owners; host settings work with
no default-setup; disabled definitions remain readable/validated; shared/owner policies hold through typed
and untyped supported paths; reset/defaults, restored data, custom forms and multiple windows behave correctly.

### Required manifest consolidation before extending Phase 3

Implement [manifest consolidation](../plans/manifest-consolidation.md) M1–M6. The original entity/shape
ownership, relations, module-reference, lifecycle, checks, feature-description, format-key and canonical
writing outcomes were not optional. Preserve all 17 reconciled decisions and the original phase checks,
with explicit replacements/exclusions recorded there. M1–M6 source checkpoints are committed and audited in the evidence record. Their remaining cross-phase requirements
continue in Phase 3; preserve the consolidated grammar while expanding other consumers. The required
[own-key preservation correction](../plans/manifest-consolidation.md#required-own-key-preservation-correction-2026-10-15)
closed the reopened M1 preservation condition in `29f0cc556`, before the next discovery-reader switch.

**Done when:** every required consolidation row has source/validation evidence; generated EARS and
typed/untyped behavior are preserved; unchanged authored content keeps compiled identity and ordinary
boot/apply behavior; all native/source/installed and loosely typed readers, authoring tools, schemas,
reports, fixtures/templates and public docs agree. Required field descriptions and canonical writing
have explicit checks. The completed naming baseline, current format constants, existing settings
contract and release metadata remain intact. No compatibility, inferred existence or volatility addition.

### Phase 3 — Complete discovery and remove obsolete glue

The live execution ledger above owns status and execution dependencies; the discovery plan's
[current checklist](../plans/discovery-without-activation.md#current-discovery-checklist)
provides detailed consumer contracts, source checkpoints and remaining acceptance. Historical audits and dated
“next/remaining” notes in this goal are checkpoint evidence, not a second current backlog; later work
supersedes their status claims without dropping unmet requirements. Keep build-freshness consumers
separate from discovery consumers, and retain every later phase below.

Finish the [discovery plan](../plans/discovery-without-activation.md) on Phase 1's foundation. Extend
checked binding/freshness per kind before migrating settings/details/help, shell navigation, references,
editor contributions and palette readers. Remove the audited runtime discovery unions and duplicate
projections without deleting real execution, readiness, teardown or user-content notification machinery.

**Done when:** all discovery acceptance checks pass, including poisoned executable pack/dependency entries,
zero activation or user-data writes during discovery, disabled/failed pack metadata, ownership diamonds,
atomic catalog updates and stale frontend completion rejection. Actual queries still execute their required
providers. Source watch/codegen publication cannot pair new bindings with stale descriptors. Compiled
content inventory includes static flow/action edges and named rename/missing-reference checks with
honest dynamic-reference status. `apack pack info` shows actual contribution identities and useful
metadata, including unbuilt/unavailable status without source-file-count substitution. Facade field,
constant and cache naming are consistent (`facades`, `PACK_TYPES_FACADE`); missing required facades
fail by dependency name with a rebuild remedy, preserving capability-based acceptance and DSL defs.

### Phase 4 — Entity navigation

Implement [entity opening](../plans/open-entity.md) using the catalog and readiness coordinator. Preserve
canonical entity IDs through stored-reference round trips before migrating affected callers. Labels and
short codes remain presentation; do not add short-code lookup or old-format fallback. Declare build-checked destinations once; keep
entity ownership distinct from the feature that opens an entity. Migrate callers before deleting old
reference navigation callbacks.

**Done when:** claimed eligible destinations are unambiguous; missing/disabled destinations have useful
results; readiness delivery rejects stale revisions; stored references preserve canonical entity IDs
through serialization/parsing and open the right entity even when display codes collide. Required
guards and the plan's focused/E2E checks pass.

### Phase 5 — Frontend failure boundaries

Implement the frontend workstream of [fault isolation](../../plans/pack-fault-isolation.md). Scope contributed
canvas, panel and custom-form failures to their pane, with the catalog owner named and a safe recovery
path. Keep the shell and settings runtime outside those boundaries.

**Done when:** throwing contribution fixtures leave another pane and host settings usable; declarations
and defaults survive failure; retries cannot revive unloaded build revisions. Do not implement process
isolation or change the security model here.

### Phase 6 — Finish the three contract workstreams

Complete these independently, committing each validated logical checkpoint. Provenance and shipped
replacement already have substantial landed implementation; audit their remaining gaps against the
live ledger and recorded source rather than treating all three workstreams as unimplemented:

| Workstream | Implementation owner | Done when |
|---|---|---|
| Consumed APIs | [API consumption](../plans/declared-capabilities.md) | Actual APIs/granularity are audited; generated and host-bound facades agree; undeclared supported APIs and unavailable required providers fail usefully; content targets respect supported SDK/dependency contracts; settings policy remains intact |
| Dependency provenance | [Manifest maturity, section 4](../plans/manifest-maturity.md#4-preserve-dependency-provenance-and-reproducibility) | Exact version, origin and content identity survive cache reuse and inspection; linked development remains explicit; differing resolutions are explainable. A new frozen-resolution mode is conditional on distribution needing it, not required speculatively |
| Shipped-pack replacement | [Replacement](../plans/replaceable-shipped-packs.md) | Deliberate forks survive restart/reload; app-managed updates remain supported; disable, uninstall and restoration stay distinct; overrides survive; pre-publication failure retains the old build/catalog; activation failure does not claim rollback of arbitrary user-data effects |

These share catalog identities and existing caller/refresh contracts; no new inventory or sandbox is
introduced. Re-audit old paths, CLI refusals and install records before changing them. Settle the concrete
consumption declaration/granularity through the linked plan's prototype before implementing its
dependent behavior. The removal-suppression record is already implemented; preserve its selected
contract and test actual gaps rather than redesigning it from the old proposal.

For consumed APIs, the linked plan owns the finite A1–A5 checkpoints and acceptance matrix. Record
A1's real generated/runtime prototype and the selected API baseline, provider identities and pack/feature
granularity before committing to syntax. At pack granularity, onboarding/administration separation limits
what an onboarding-only pack consumes; it does not isolate features inside a pack that consumes both.
Keep dependency selection, required-provider availability, runtime readiness and target mutation policy
separate. A3 must prove retained methods cannot acquire replacement-runtime authority; A4 must exercise
the actual Database, onboarding and action paths. Close A5 with schema/API/docs/template agreement and
external runtime evidence, then retain these cases for Phase 7. Do not implement sandboxing, a new
catalog or general lazy activation as part of this API contract.

**Done when:** all three rows and their linked verification pass, with affected external-pack fixtures,
templates and public contracts updated. No workstream is merely marked “follow up” to close this goal.

### Phase 7 — Final review and completion

Review the entire implemented diff for correctness and completeness
against the inventory, all reconciled original requirements in manifest consolidation, and each plan's acceptance criteria. Fix omissions and bugs, and commit them. Check failure paths, build revisions, dependency ownership, import
migration, multiple windows, disable/uninstall/reinstall, and external authoring.

Run focused checks as changes are made and `npm run chain` at validated checkpoints. For final
acceptance, follow the user-approved decision in the live ledger: require the current complete normal
integration pass, audit prior/focused evidence against the committed tree, and close only actual
uncovered checks. Include affected real app/external-pack/packaged-authoring behavior from the linked
plans; do not substitute schema acceptance for behavior or repeat unchanged accepted checks.
Record the final commit, exact commands/results and naming completion SHA.
Apply the external-authoring/release evidence boundaries above when reporting the packaged-authoring
result; public publishing is not a substitute for, or prerequisite to, the required local behavior.
The earlier final-gate route was `gh workflow run ci.yml --ref session/settings-pack-contracts
-f strict_chain=true`, executing `npm run chain -- --strict --all --cores 2 --no-classify` on disposable
macOS. Preserve its historical console/per-step results without treating partial runs as passes.
The user subsequently waived another execution; do not launch it for this closeout.

**Done when:** all required implemented behavior and checks pass; the tree is clean; naming is complete
and integrated; every phase has evidence. Add Outcome, archive this goal and completed subsystem plans,
repair incoming/outgoing links and commit closure. Keep the roadmap/reference docs where they remain useful;
do not archive unfinished or deferred work as completed. Publishing or PR merge remains separately requested.

## Deferred

- [Lazy activation](../../plans/deferred/lazy-activation.md), including boot-performance implementation.
- [Security isolation](../../goals/goal-pack-security-isolation.md) and out-of-process backend execution.
- Storage/LMDB, advisory-lock and console-transaction redesign; surfaces-to-surfaces, logs extraction
  and distribution work outside the required dependency provenance contract.
- A new registry/package manager, speculative optional integrations, generated settings forms and new
  preference scopes. The package-dist watcher follow-up is separate; required descriptor freshness is not.
- [External-pack public release readiness](../../plans/deferred/external-pack-release-readiness.md) and
  [npm/Homebrew distribution](../../plans/deferred/npm-and-homebrew-distribution.md); required local
  packaged-authoring/archive/runtime acceptance remains in this goal.

## Constraints

Follow root and package CLAUDE instructions, including isolated test storage, bounded process cleanup,
change-controlled typed EARS behavior and the current data contract. Do not touch production app data,
release metadata or unrelated concurrent work. Install dependencies and generate output independently
in each worktree. Fix failing checks rather than relax assertions; mutation-check new contract guards.

Commit usable logical checkpoints with explicit paths and reviewed staged diffs. No pushes, publishing,
release workflows or PR operations without separate authorization. No compatibility aliases or
old-format settings/discovery paths, including temporary boot/import fallback or invalid-value exemptions.
An unresolved required contract or failing acceptance check keeps the goal open; document blockers
instead of calling it complete.

## Evidence

Checkpoint history and validation logs live in [the evidence record](../references/evidence/settings-and-pack-contracts.md).
The live ledger and acceptance register above own current work and closure. Preserve unresolved
requirements recorded in that history; moving evidence does not complete or exclude them.

## Outcome as it stood before closure

Superseded by [Outcome (2026-10-19)](#outcome-2026-10-19), which is this goal's closure record and what the
docs link to. Kept because the archive preserves a goal's text rather than rewriting it — read the section
below as the state on 2026-10-18, not as current status.

Pending completion. The [first current-source manifest audit](../references/evidence/settings-and-pack-contracts.md#current-source-manifest-audit-first-pass-2026-10-18)
passes 68 focused schema/editor/reference/writer/selector checks and confirms schema generation agrees.
It corrects stale roadmap claims without completing Phase 7. API-report checking refuses stale local
published output; matching-output CI verification, the remaining native/platform work and final strict
`--all` remain required. At completion, record each phase's results, evidence, design corrections,
final naming completion SHA and any genuinely out-of-scope follow-ups.
