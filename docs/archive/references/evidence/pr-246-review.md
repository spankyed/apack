# PR #246 review — findings

Findings of the review planned in [the review plan](../../plans/pr-246-review.md), for
[#246](https://github.com/spankyed/apack/pull/246) (`session/settings-pack-contracts` against `master`,
merge base `d7e77829a`). Each finding was checked against the source by reading the cited code. A finding
marked *plausible* is argued from the code but was not reproduced. Severity levels are the plan's.

The finding descriptions below preserve the original review evidence and source locations. Their
current dispositions are recorded here and in [repair evidence](pr-246-repairs.md); descriptions of
pre-repair behavior are not claims that the defect remains in current source.

## Verdict

The original review baseline was `8d31bdccc` (2026-10-19). The descriptions and source
locations below preserve that historical review; the disposition table records subsequent repairs.
Do not interpret the historical acceptance register at the end as the current defect list.

Implementation repairs are complete for the findings marked completed below. The requested app/native
acceptance now passes; [the acceptance record](pr-246-acceptance.md) preserves source pins and reports:

- Complete general app suite: 32/32; external pack app suite: 28/28, including step-owner services,
  settings recovery/ownership, multi-window reload and fork replacement/restoration.
- Actual source CLI install/rebuild/runtime delivery/shutdown and all six real LMDB import/rollback cases.
- Runtime smoke: 5/5; tarball-only external authoring, seven harness cases, two real app-consumer cases,
  and offline queries/exports against the installed archive.
- Both complete unit pools pass on the earlier strict source; all 66 applicable integration files pass
  across retained runs, with two platform-specific skips. Reporter, facade and archive harness repairs
  have focused passing evidence. No single all-green full strict run is claimed.

The app route passes on `f5312107e`, and smoke/packaged authoring on its documentation-only descendant
`c60b5e4ab`. Historical acceptance prose below remains scoped to its original source.

The packaged beta-host half of S.5 remains untested: no suitable beta release is published. No release
has been created. Findings 3a.1, 10.1, 10.2 and 10.7 remain explicitly deferred to the validation-feedback
budget plan; R-D2 remains an accepted documented limitation.

## Status — reconciled 2026-10-20

The settings and service findings added during repair work are included. There are no additional
finding IDs in this version beyond those reconciled below. “Completed” means implementation and
focused verification; remaining application/native acceptance is listed separately.

| Findings | Current status | Commit / evidence |
|---|---|---|
| 1.1, 1.2 | Completed: isolate destination conflicts; keep disabled reloads inactive | `fed33dae8` |
| 1.3, 2.5 | Completed: correct host module/hash/recovery documentation | `278661695`; the claim that `packFileHashes` was absent was incorrect |
| 2.1, 2.3, 2.4 | Completed: enable explicit reinstalls, repair damaged caches, correct CLI documentation | `46ef9a95e`, `88be3f633` |
| 2.2 | Completed: recover interrupted acceptance and prior installation decisions | `88be3f633`; filesystem recovery cases pass |
| 5.1 | Completed: admission protection, host-only recovery, atomic reset and explicit relaunch | `8d31bdccc`, `3a6b649b5`; real recovery/reopen passed; [current acceptance](pr-246-acceptance.md) |
| 5.2 | Closed: intentional explicit-override contract; conflicting guide corrected | [Decided contract](../../plans/settings-architecture.md), `278661695` |
| 5.3, 5.4 | Completed: apply committed save snapshots and share frontend/backend read authorization | `d3f3e1765`, `f6eceeeda` |
| 5.5 | Completed: preserve typing through save echoes and edits after a superseding reset | `8ec60b1e5`, `f6eceeeda`; seven component cases pass |
| 7.1, 7.3 | Completed: refuse provider mutation and diagnose undeclared service reads | `7b68cad48` |
| 7.2 | Completed; actual external step calls its owning service through the running brain | `7b68cad48`; complete app run `39477143294`, [acceptance evidence](pr-246-acceptance.md) |
| 8.1, 8.2 | Completed; all six real LMDB import/rollback cases pass on disposable macOS | `53da4c140`; repeated runner evidence in [acceptance record](pr-246-acceptance.md) supersedes the local native abort |
| 8.3 | Completed: permit replacement-owned writes and expire that authority afterward | `c960deca3`, `d282c7624` |
| 8.4 | Completed: refuse overlapping app-data replacement requests | `53da4c140` |
| 8.5, 8.6 | Completed: correct import lifecycle documentation and reset/import refusal text | `c960deca3` |
| Completeness: source-coverage claim | Completed: historical acceptance is explicitly bounded to its tested source | `278661695` |
| Completeness: fresh integrated acceptance | Recorded with explicit limits: requested app/native/smoke/packaged checks pass; integration inventory passes across retained runs; no single full strict pass claimed | [Current acceptance runs and exact source pins](pr-246-acceptance.md) |
| 3a.1 | Deferred: a cache-validity decision for check steps | [Validation feedback budget](../../plans/validation-feedback-budget.md#review-findings-this-plan-owns) |
| 3a.2, 3a.3 | Completed: resolve a dangling link from its physical directory; name a broken authored link | "fix(build): resolve dangling watch links physically, name broken authored links, restart dev servers after publication" |
| 6.1 | Completed: unloaded tabs open through the shell's wait, are dimmed, and the switch hotkeys skip them | "fix(shell): unload refused frontend replacements and route unloaded tabs through the shell" |
| 6.3 | Completed: a refused replacement unloads the frontend it would have replaced | "fix(shell): unload refused frontend replacements and route unloaded tabs through the shell" |
| 6.4 | Closed, not a defect: activation precedes the irreversible style commit on purpose ("preserves the incumbent when candidate activation throws before host resource publication"), and the freshness check already runs synchronously before `commit`. "sends a write made while activating only when the commit is accepted/refused" (`pack-store-replacement.spec.ts`) shows a refused commit sends nothing the candidate wrote while activating | "test(pack-store): prove a refused commit sends nothing written during activation" |
| 6.2 | Completed: reference-name conflicts go through the catalog like destination conflicts; every enabled owner is refused and shown in the Packs view, independent of load order | "fix(packs): refuse every owner of a shared reference name, as destination conflicts are" |
| 3b.2 | Completed: a published build whose dev server fails re-verification restarts the server; covered by reading only, its specs need a disposable runner | "fix(build): resolve dangling watch links physically, name broken authored links, restart dev servers after publication" |
| 3b.3 | Completed for the read-tree leak. The build path's lock release is unchanged: the next build's verification still blocks a stale publish | "fix(build): resolve dangling watch links physically, name broken authored links, restart dev servers after publication" |
| 3b.1 | Completed: Linux reads process-group state from `/proc`; other POSIX hosts keep `/bin/ps` and name it when missing | "fix(build): read process-group state from /proc on Linux instead of requiring ps" |
| 3b.4 | Completed: the phase-cache comments state that no cached phase reads `--release`; dropping it from the key with the frontend bundle's cache was correct | "docs(build): state why the phase-cache key omits the release flag" |
| 4.1, 4.2, 4.3, 4.4 | Completed: guide examples and names match the schema and exports; every whole-manifest fence parses | "docs: align public pack guides with the manifest schema and exports" |
| 9.1, 9.3, 9.4 | Completed: symlinked documents open; reopening refetches; a rebuilt graph keeps its layout | "fix(default-setup): open symlinked documents, refetch reopened items, keep layouts of rebuilt graphs" |
| 9.2 | Completed: each `FLOWS_CONNECTED` asks for the shown flow again, keeping its node selection and editor while the node exists; a flow that is gone gives way to the published root flow | "fix(flows): refresh the shown flow when the backend republishes, falling back to the root flow" |
| 10.1, 10.2, 10.7 | Deferred: deadline and declared-cost decisions; no change until measured | [Validation feedback budget](../../plans/validation-feedback-budget.md#review-findings-this-plan-owns) |
| 10.3–10.6 | Completed: strict runs keep their own group; each filtered step's report is verified; the fixture build precedes internal-repo-checks integration; uploads point at `.apack` output | "ci: keep strict runs, verify each filtered step, build fixtures first, upload .apack output" |
| S.1, S.2 | Completed for startup-invalid settings: persisted-row preflight and host-only recovery | `3a6b649b5`; real recovery/reopen passed; [acceptance evidence](pr-246-acceptance.md) |
| S.4 | Closed by 6.3: no kept frontend is left with a dropped settings binding | "fix(shell): unload refused frontend replacements and route unloaded tabs through the shell" |
| S.3 | Completed: a frontend whose pack the ready catalog withdrew during loading is taken back out | "fix(shell): take back a frontend whose pack was withdrawn while it loaded" |
| S.5 | Completed: a checkout's app installs each `apack pack dev` build itself (`POST /dev/install`) under the registry's per-pack claim, which every pack operation now takes; a packaged app gets builds copied only while stopped, restarting after a backend rebuild | "fix(packs): install apack pack dev builds through the app, restarting packaged hosts" |

### Remaining limits and follow-ups

1. Packaged-beta S.5 requires a suitable published beta release; none exists. The actual source-host
   lifecycle passes in `39477143294`. Publishing is outside this task.
2. Integration evidence is composed across retained runs, not one all-green normal-suite/strict run.
   Exact tested pins and the later documentation-only descendants remain explicit in the acceptance
   record. The complete app and packaged routes have fresh passing runs.
3. Deferred findings 3a.1, 10.1, 10.2 and 10.7 remain with their owning plan. R-D2 remains the accepted
   physical-watch-path limitation; R-D1's restart path is source-reviewed without a dedicated spec.
   The cold-build cost finding [R-F1](../../plans/validation-feedback-budget.md#review-findings-this-plan-owns) remains with the validation-feedback budget plan.

## Repair-diff review (2026-10-20)

The 39 commits from the first review's source (`dc8573b7b`) to `1f92ce805`, read by commit in five groups:
settings; pack install, runtime, catalog and backup; services and shell; build, CLI and CI; default-setup
and guides. *Confirmed* findings were checked against the code; *plausible* ones are argued from it.

| # | Severity | Commit | Finding | Status |
|---|---|---|---|---|
| R-C1 | Medium (confirmed) | `7b68cad48` | The flow runner finds a step's handler through `getStepBinding`, which returns nothing when two catalog owners claim a step type, a disabled installed pack included. The runner then completes the step as a silent success, so a disabled pack declaring `llm` makes every `llm` node do nothing. The same skip happens briefly while a pack reloads | Fixed — "fix(steps): run the enabled owner of a step, and fail a step no running pack provides" |
| R-E1 | Medium (confirmed) | `7294d6853` | 9.3 is not closed: `ACTION_CREATED`/`PROMPT_CREATED`, broadcast to every window, select the new item while the list shows. Clicking it then skips the fetch, the form keeps the previous item's fields, and a save overwrites the new item with them | Fixed — "fix(default-setup): a created action or prompt no longer selects itself in every window" |
| R-B1 | Medium (confirmed) | `36608fe9c` | The rename missed `tests/packs/external-pack/tests/e2e/settings-ownership.spec.ts`, which still sends `runtimeRevision`; `settings.openPack`'s strict schema refuses it, so `test:external-pack:app` fails | Fixed — "test(app): align persisted-profile and settings credential acceptance fixtures" |
| R-B2 | Medium (confirmed) | `a47ec923b` | On a checkout host, a first build that fails to load or initialise makes `apack pack dev` exit and close its app, where the watcher used to keep running so the author could fix it | Fixed — "fix(cli): keep pack dev watching after a refused first install, and keep the dev server up until its replacement is" |
| R-D1 | Medium (confirmed) | `7182c952d` | When the reused generation's dev server fails re-verification, it is closed before its replacement starts; if the restart fails, the `pack-dev-servers` marker is left naming a dead port. Before, the old server stayed up | Fixed — "fix(cli): keep pack dev watching after a refused first install, and keep the dev server up until its replacement is" (no spec exercises the dev-server restart path; covered by reading. The fourteen builder lifecycle cases passing in `39414905716` do not reach it) |
| R-A2 | Medium (plausible) | `8d31bdccc` | A pack install or update during a backup import is admitted against the engine mid-replacement; an imported row that breaches the new declaration then makes every settings read, and App reset, fail until relaunch | Fixed — "fix(packs): hold a pack's claim through teardown, report refused operations, exclude them during data replacement" |
| R-E2 | Low–Medium (confirmed) | `1f3e6123b` | The 9.2 refresh shares the `pendingFlow` slot with user selections, which a node double-click, re-selecting the shown flow, leaving the view or switching tabs clears; the refreshed graph is then dropped and the stale one stays | Fixed — "fix(flows): give the publish refresh its own slot, fall back when an opening flow is gone, keep nodes being added" |
| R-C2 | Low–Medium (plausible) | `47f153de5` | A click on a dimmed tab queues an open that later navigation does not cancel, so the window switches to it when its pack loads | Fixed — "fix(shell): a later navigation supersedes an open still waiting for its pack" |
| R-A1 | Low (confirmed) | `3a6b649b5`, `0336dc203`, `d3f3e1765` | In recovery mode the store fences only `recover()`: an unconditioned set, reset, replace-all or reset-all from a non-window client commits, then building the reply throws (crashing the settings system) or reports a refusal after reset-all wiped every preference | Fixed — "fix(settings): admit only the recovery reset while settings need recovery" |
| R-B4 | Low (confirmed) | `a47ec923b` | Uninstall and update refused by the claim only log, so the Packs view's prompt or spinner never clears; the claim now also contends with dev installs and reloads | Fixed — "fix(packs): hold a pack's claim through teardown, report refused operations, exclude them during data replacement" |
| R-B5 | Low (confirmed) | `53da4c140` | A rolled-back import reloads memory with the volatile partition, which boot never hydrates | Fixed — "fix(packs): keep rollbacks from leaving install records in builds or loading run history" |
| R-E3 | Low (plausible) | `1f3e6123b` | While any flow request is pending, a `FLOWS_CONNECTED` after a reset skips the root-flow fallback, and a deleted flow's empty answer is shown | Fixed — "fix(flows): give the publish refresh its own slot, fall back when an opening flow is gone, keep nodes being added" |
| R-B3 | Low (plausible) | `a47ec923b` | Uninstall and disable release the claim when `TEARDOWN_PACK` is sent, before the bus's teardown unregisters the pack; a dev install in that gap is registered and then unregistered by it | Fixed — "fix(packs): hold a pack's claim through teardown, report refused operations, exclude them during data replacement" |
| R-B6 | Low (plausible) | `88be3f633` | A refused acceptance whose record restore also fails leaves `.apack-install-record.json` inside the restored build, which verification then refuses | Fixed — "fix(packs): keep rollbacks from leaving install records in builds or loading run history" |
| R-E4 | Low (plausible) | `1f3e6123b` | A refresh answer computed before an in-flight `CREATE_NODE` drops the temporary node and its edges | Fixed — "fix(flows): give the publish refresh its own slot, fall back when an opening flow is gone, keep nodes being added" |
| R-D2 | Low (plausible) | `7182c952d` | 3a.2 is partly open: `..` in a dangling link's own text is still collapsed lexically, not through intermediate symlinks | Accepted — known limit, stated on `physicalWatchPath` |

Checked clean: settings array paths, replacement write scopes, save acknowledgement, autosave, recovery
requests and boot preflight; claim release on every path, packaged restart, install records, staging
recovery, dependency cache, catalog conflicts and backup rollback retention; frontend unload, withdrawn
frontends and service facades; `/proc` parsing, the read-tree close, the CLI runner guard and every CI
change; Library symlinks, layout merging and every changed guide fence.

## Area 5: settings

Scope: `apack-host/src/features/settings/`, `services/settings.ts`, `fe/settings-{runtime,snapshot}.ts`,
SDK `fe/settings.ts` and `testing/fake-settings.ts`, the API's settings transport, the renderer's settings
views, and their specs.

| # | Severity | Finding | Status |
|---|---|---|---|
| 5.1 | Blocker | A stored override the current schema rejects blocks every settings write and every window | Completed — admission and recovery; see evidence |
| 5.2 | Medium | Replacing the whole document stores every default as a user choice | Closed — intentional; docs fixed |
| 5.3 | Medium (plausible) | A second write right after the first is refused as a conflict | Completed |
| 5.4 | Medium | Frontend readers read any owner's settings; the backend refuses the same read | Completed |
| 5.5 | Low (plausible) | Text typed while a debounced save is in flight can be lost | Completed |

**5.1. A stored override the current schema rejects locks settings up.**
`apack-host/src/features/settings/validation.ts:38-58`. Every `write()` (`be/store.ts:104-106`) validates the
merged document against every declared owner's schema in full. Only owners with no declaration get the
"unchanged since before" allowance (line 46-49). So once the store holds an override that a current
declaration rejects, every update, reset and replace on any owner throws `SettingsRefusedError`. An
override like that appears when a pack update narrows a setting to an enum, or removes a key under
`additionalProperties: false`, or when a host release tightens the app definition. It also appears when a
backup's orphan data is imported and the pack is installed later. Nothing preflights stored overrides
against new declarations (`packs/catalog.ts`, `installer.ts`).

The window fails too. The store serves the merged values unchecked. The window's snapshot reader calls
`validateEffective` (`fe/settings-snapshot.ts:45`), which throws, so the first read ends `disconnected`
(`fe/settings-runtime.ts:176-180`). `connectWindowSettings` (`renderer/src/runtime/settings.ts:56-66`) then
never reports connected, and the shell falls to its connection error. The reset the store would accept
cannot be sent from the UI, so recovery needs `apack db`.

This is a regression. `master`'s writer had the carve-out *"A declaration changing must not trap existing
data: only new or changed invalid values are refused"* (`store.ts:106` there). `store.spec`'s *"refuses
retaining invalid declared data"* pins the new backend behaviour, and nothing covers the window side.

**5.2. Replacing the whole document stores every default as a user choice.** `be/store.ts:144-148`:
`replaceAll` validates and writes the document it is given. The JSON editor sends the full effective
document, so every default of every owner becomes a stored override, and later default changes never
reach that user. Those pinned keys also become 5.1's trap when a schema later narrows them. `master`
stored `changesFrom(defaults(), settings)`. `store.spec`'s *"stores replacements as explicit choices,
including default-equal values"* says the change is deliberate, but the host guide still says *"The row
holds only what the user changed."* Either the guide or the code is wrong.

**5.3. A second write right after the first is refused (plausible).** With no explicit condition, the window
port builds one from its own snapshot (`fe/settings-runtime.ts:87-95`). The settings system replies
`SETTINGS_SAVED` before the store's change has been broadcast. The port settles on the reply without
updating its snapshot (`:165-170`). So `await set(x, 1); await set(x, 2)` sends the second write with the
old expected value, and the store refuses it as *"This setting changed since editing began"*. `fakeSettings`
ignores conditions, so pack component tests cannot see this. No spec covers sequential writes through the
window port. The ordering between reply and broadcast was argued from the system's action order and was
not reproduced.

**5.4. Frontend reads ignore the backend's read policy.** `useFeatureSettings` and `usePackSettings`
(`apack-sdk/src/fe/settings.ts:69-75`) read any owner from the window's full snapshot through the host
port. The backend refuses a pack that reads an owner it does not depend on (`store.ts` `authorize`). The
public frontend API, reported in `etc/fe.api.md`, therefore gives a pack frontend what its backend may not
read. Settings hold no secret values, so this is a contract disagreement rather than a leak.

**5.5. A keystroke during an in-flight save can be lost (plausible).** `PersonalInfo.vue` debounces saves at
500ms and cancels the pending save whenever `props.settings` changes. `useSettingsDraft` also replaces the
draft on any persisted change. If the echo of one save arrives after the user typed more, the input
reverts and the newer save is dropped.

**Checked clean.**
- A refusal leaves the row and listeners untouched.
- `compare` handles absent and present values and `runId`.
- Owner, dependency and `access: 'owner'` checks are correct.
- `FEATURE_SETTINGS_UPDATED` goes out once per changed feature.
- `answerSettings` replies or broadcasts, never both.
- The window runtime has request timeouts, settles on disposal, orders by revision and `runId`, and keeps
  the accepted snapshot when a broadcast is invalid.
- App preferences belong to the host.
- Frontend validation imports only the pure modules.
- A host reset removes orphan fields, and a pack write to an orphan is refused.
- Mutations need host-issued credentials per connection and registration ID.
- No compatibility reads. No assertion was loosened.

## Area 7: service consumption

Scope: SDK `services/` and `framework/service-consumption.ts`; host `packs/service-binding.ts`,
`service-requirements.ts` and `services/`; the generated service facades; flow execution's use of
`servicesForAction`; and their specs.

| # | Severity | Finding | Status |
|---|---|---|---|
| 7.1 | Medium | A pack can patch a shared host service through its facade, and the patch outlives the pack | Completed |
| 7.2 | Medium | A step from another pack receives default-setup's service access and identity | Completed; actual brain/service app check passes (`39477143294`) |
| 7.3 | Low | Reading a service outside the selection returns `undefined` with no diagnostic | Completed |

**7.1. The service facade writes through to the shared object.** `apack-host/src/packs/service-binding.ts:85`:
`set(_, key, next) { check(); return Reflect.set(value, key, next, value); }`. `value` is the provider's
real object. The host's `inference`, `secrets` and `filesystem` are plain mutable module constants
(`services/inference.ts:53`, `secrets.ts:5`, `filesystem.ts:6`) shared by every pack's facade. So pack A
assigning `services.inference.generateText = wrapped` changes it for pack B, and A sees B's prompts. When A
is retired, its binding is revoked, but the wrapper stays installed on the host object. The guide says
binding is not a security sandbox, but a retired caller's code still running breaks the retirement
contract this PR adds. The only spec touching `set` passes because its fixture is frozen.

**7.2. A foreign step receives default-setup's service access.**
`default-setup/src/features/brain/be/flow-system.ts:215` and `:374` pass default-setup's own
`servicesForAction` to every step handler, including steps another pack contributes
(`steps/types.ts:153`). Such a step can reach APIs outside its own declared selection, and its sends are
stamped `from: 'default-setup'`, which breaks the rule that `from` names the sending pack. The same shape
existed on `master` as `getAppServices`. This PR is what introduces the selection boundary it bypasses. No
spec covers a foreign step's access.

**7.3. No diagnostic for an undeclared service.** `apack-sdk/src/services/index.ts:171` returns
`Reflect.get(current, key)`, which is `undefined` for anything outside the selection. Typed pack code is
protected by the generated `Services` type. Action code is untyped (`new Function`), so it fails with
*"Cannot read properties of undefined"* instead of naming the missing `consumes.services` ref.

**Checked clean.**
- A binding refuses calls until published, and is revoked when binding throws, publication fails, or
  cleanup throws on unload.
- The host generation changes even when the same object is rebound.
- A held provider handle throws on retirement and never redirects to a replacement.
- Inference calls and streams already started settle on the original. Only `createAgent` results are
  wrapped.
- Settings subscriptions are released on revoke.
- `servicesForAction` keeps the caller's selection and lifetime, and attributes only the logger and emitter.
- Harness mocks overlay the selection and never expand it.
- `secrets` exposes exactly `status`, `list`, `select`, `rename` and `delete`.
- Inference uses the selected key and an explicit base URL.
- Codegen, CLI validation, the host catalog and the runtime all use the one `_packServiceSelection`.

## Area 8: migrations, backup and app data

Scope: `apack-host/src/{backup,migrations}/`, `services/{app-data,onboarding,index}.ts`, the API's boot
wiring, and their specs.

| # | Severity | Finding | Status |
|---|---|---|---|
| 8.1 | High | A failure loading imported data deletes the previous database | Completed; real LMDB import/rollback checks pass |
| 8.2 | High | When import and rollback both fail, the error naming the kept copy is lost, and the copy sits in the OS temp dir | Completed; real LMDB import/rollback checks pass |
| 8.3 | Medium (latent) | Pack settings writes from migrations or `onInit` are refused during reset and import | Completed |
| 8.4 | Medium (plausible) | Reset and import, or two imports, can run on the store at once | Completed |
| 8.5 | Low | The migrations guide says import runs through `startPacks()`; it does not | Completed |
| 8.6 | Low | A reset tells settings writers "A backup is being imported" | Completed |

**8.1. A failure loading imported data deletes the previous database.**
`apack-host/src/services/app-data.ts:52-63` with `backup/index.ts:123-166`. `importDatabase` rolls back only
inside its own file-copy block. Once `replace()` has returned, the imported files are in place and the
store is open on them. If `reloadMemory()` (`engine.clear()` then `store.hydrate`) then throws, the catch at
line 59 calls `reloadMemory()` again on the *imported* files. Its comment, *"A failed file replacement has
restored the previous files"*, is false on this path. The error then leaves `withReplacement`, and
`importDatabase`'s `finally` removes the temp dir, rollback copy included, because `preserveRollback` is
false. The user's previous data is gone from disk, and memory holds a partial load. `readBackup` opens and
counts the candidate but never hydrates it, so a hydrate failure after validation is possible (a row
relation hydration rejects, or the volatile partition). Contradicts the host guide: *"Failed replacement
restores and hydrates the previous data."* No spec covers it: `tests/backup/import.spec.ts` only fails
`store.reopen`, and `api/tests/runtime/host-data-services.spec.ts` has no failure after replacement.

**8.2. When import and rollback both fail, the kept copy's location is lost.**
Same lines. If copying in fails and the rollback's `store.reopen()` also fails, `importDatabase` sets
`preserveRollback` and throws an `AggregateError` naming `…/rollback`. The app-data catch then calls
`reloadMemory()`. The store is closed, so `hydrate` → `openEnvs()` throws *"The LMDB store is closed"*
(`apack-ears/src/lmdb/store.ts:166`), and that error replaces the one naming the rollback. The copy is
under `os.tmpdir()` (`backup/index.ts:101`), which macOS purges. On `master` it was a `temp-backup-*`
directory beside the store.

**8.3. Settings writes from migrations or `onInit` are refused during reset and import (latent).**
`apack-host/src/features/settings/be/store.ts:79` refuses every write that names a pack caller while
`replacingData` is set. Reset (`app-data.ts:36-43`) now runs `startPacks()` (`onInit`, both migration
runners, content apply) inside `whileReplacingData`, and import runs both runners inside it. So a pack
migration that writes its settings through its owner-bound handle succeeds at boot and throws on reset or
import. `runPending` then stops and records nothing, and on the app line `startPacks` skips every pack
migration and the content apply. Latent: no pack declares a migration today, and default-setup's `onInit`
is empty.

**8.4. Reset and import can overlap (plausible).**
`whileReplacingData` (`store.ts:154-161`) is a re-entrant counter, not an exclusive section, and
`createAppData` takes no lock. The default-setup Database system accepts `IMPORT_DATABASE` and
`RESET_DATABASE` in `idle` without changing state (`default-setup/src/features/database/be/system.ts:290-326`),
and both actions are async. A reset arriving while an import has the store closed and is copying files
would `engine.clear()` and `store.reset()` underneath it. Whether the UI allows the second request was not
checked. The missing serialisation predates this PR, but the PR moved reset into the same bracket without
excluding the overlap.

**8.5. Guide contradicts import.** `apack-host/src/migrations/CLAUDE.md:9-10`: *"The API boot, app-data reset
and backup import run … through `startPacks()`, after pack `onInit` and before applying content."* Import
calls the two runners directly (`app-data.ts:57`), with no `onInit` and no content apply.

**8.6. Wrong refusal text during a reset.** Reset now enters `whileReplacingData`, so the settings system
moves to `replacingData` (`features/settings/be/system.ts`), and its refusals there say *"A backup is being
imported. Change the settings once it has finished."*

**Checked clean.**
- Reset order: shutdown hooks, `engine.clear`, `store.reset`, secrets, then `startPacks`, all inside the
  bracket, with `onReplaced` in a `finally`.
- Import validates a private copy (`readBackup` plus the settings validator) before `withReplacement`, so a
  refused backup never closes the store.
- "A failed migration stops the rest and records nothing" is held by `runner.spec.ts` and
  `native-migrations.spec.ts`.
- Settings and onboarding bind the owning engine, not the ambient one (`host-runtime.spec.ts`, two-engine case).
- A preferences reset leaves `AppState` alone.
- No compatibility reads remain after the 0.4.0 conversion was removed, which is decided behaviour.
- The spec diffs adapt fixtures and loosen no assertion.

## Area 1: catalog, registration and binding

Scope: `apack-host/src/packs/{registry,catalog,catalog-*,declaration-binding,extensions,backend-extensions,…}.ts`,
`packs/runtime/`, `features/packs/be/`, SDK `framework/`, and their specs. Includes a check of `7781c22d2`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1.1 | Blocker | Two enabled packs claiming one entity destination stop the app from booting | Completed |
| 1.2 | Medium | A dev reload starts a disabled app-owned pack | Completed |
| 1.3 | Low | The host guide lists `fe/app-extensions.ts`, which was deleted | Completed |

**1.1. A destination collision fails the whole boot.** `loadExternalPacks`
(`apack-host/src/packs/runtime/loader.ts:145`) calls `registry.refreshCatalog(packsDir)` before reading any
pack. That reaches `assertSurfaceDestinationClaims` (`packs/catalog-surfaces.ts:51-60`), which throws when two
enabled packs' surfaces `opens` the same entity. `loadAppPacks` (`loader.ts:192-195`) does not catch it, nor
does `setupBackend` (`api/src/runtime/index.ts:180`), so the API never starts. Two ways in:
- `apack pack install` checks the host, the app's defaults and ownership (`pack-install.ts:87-88`), but not
  the installed catalog's destination claims.
- Boot's `installShippedPacks` passes no `accept`, so an app update that adds an `opens` claim to a shipped
  pack is installed without a catalog check.

The failure is deliberate at loader level (`tests/packs/catalog-surfaces.spec.ts:85-100` expects the throw
before any runtime executes), but nothing turns it into a per-pack load problem. Every other refusal in the
loader is one ("a pack it can't admit or load comes back with a problem … so the Packs view says why"). With
the API down, the Packs view never opens to disable either pack. The CLI's offline `pack uninstall` is the
only way out.

**1.2. A dev reload starts a disabled app-owned pack.** `reloadPackById` (`packs/runtime/reload.ts:99-111`)
refreshes a shipped pack through `installShippedPacks`, whose `accept` calls `acceptInstalledPack`
unconditionally, then runs the returned starter (`onInit`, migrations, content apply, `ACTIVATE_PACK`). The
packs system's own update paths check enablement first (`features/packs/be/system.ts:479` and `:528`,
`if (enabled) …`), and the runtime guide says *"Disabled updates replace their build and catalog
definitions without starting a runtime."* So with default-setup disabled, a source edit under `npm run dev`
starts its systems and writes data, while the catalog still reports it disabled and refuses its services
to consumers. Only the refusal path of the shipped reload is tested (`shipped-packs.spec.ts:325`).

**1.3. Guide drift.** `packages/apack-host/CLAUDE.md`'s module map lists `fe/{pack-store,app-extensions,client,pack-frontends}.ts`.
`7781c22d2` deleted `fe/app-extensions.ts`.

**`7781c22d2` keeps every guarantee the guide states.** The undo log and `createOwnedStore` it removed had
no production callers by then: registration already rebuilt candidate tables from the admitted owners and
committed by swapping whole maps. `undo-log.spec.ts` tested only that dead helper. The behaviour it stood
for is covered elsewhere:
- repository publication rollback, and a refused candidate leaving no lookups or origin:
  `registration.spec.ts`, `registered-lookups.spec.ts`;
- incumbent retention, cleanup failure after commit, and reentrancy: `replacement.spec.ts`;
- runtime reload: `reload.spec.ts`.

**Checked clean.**
- `registerContributions` runs every refusal before the commit (`registry.ts:651-661`), and nothing in the
  commit block can throw.
- `replacePack` keeps the incumbent's position, issues a new registration ID, and retires the old binding
  after its actors stop.
- `unregisterPack` removes exactly the admitted keys.
- Load problems are cleared on register and teardown, and kept on a refused reload.
- The catalog validates before it changes and never notifies for a refused or empty change.
- Native and installed binding checks cover the same facets.
- No module-level state remains in the registry or lookup stores.
- No assertion was loosened in the reviewed specs.

## Area 2: discovery, install and shipped packs

Scope: `apack-host/src/packs/{layout,installer,discovery,installed,staging,app-sources,dependency-cache,updater}.ts`,
`apack-host/src/replace-dir.ts`, the CLI's `pack install|replace|restore|uninstall` commands, and their specs.

| # | Severity | Finding | Status |
|---|---|---|---|
| 2.1 | Medium | A pack disabled when uninstalled comes back disabled after a CLI reinstall | Completed |
| 2.2 | Medium (plausible) | A crash while accepting an update makes the next boot delete the previous build | Completed |
| 2.3 | Low | A damaged cached dependency build is never repaired | Completed |
| 2.4 | Low | The CLI guide says uninstall removes the install record | Completed |
| 2.5 | Low | The host guide describes hash functions and a staging kind that no longer exist | Completed |

**2.1. A CLI reinstall keeps the old `enabled: false`.** `uninstallPack`
(`apack-host/src/packs/installer.ts:505-508`) now leaves a deliberate-removal marker,
`{ id, enabled: previous.enabled, suppressAppInstall: true }`, and boot pruning keeps it
(`installed.ts:219`). `recordCliInstall` (`apack-cli/src/app/installed-packs.ts:31`) takes
`enabled: old?.enabled ?? true` from whatever record exists. So disabling a pack, uninstalling it, then
running `apack pack install` or `apack pack dev` brings it back disabled. The CLI prints "Open apack to load
the pack." and nothing explains why it does not load. The app's own install path forces `enabled: true`
(`recordInstalled`, `installed.ts:164-170`), so the two install paths disagree. No spec covers uninstall
followed by a CLI reinstall.

**2.2. An interrupted acceptance loses the previous build (plausible).** `replaceDir`
(`apack-host/src/replace-dir.ts:64-93`) renames the incumbent to `.<id>.previous-<pid>-…`, renames the
candidate into place, then calls `accept()`. The live app's `accept` is `acceptInstalledPack`
(`packs/runtime/lifecycle.ts:106-124`), which loads the candidate's runtime and registers it, so pack code
runs while both trees exist. If the process dies there (a `process.exit` in pack code, a native crash, OOM),
rollback never runs. On the next boot, `recoverStagingDirs` (`packs/staging.ts:65-81`) sees `<id>` present,
skips the restore, and deletes the stale `previous` directory. The incumbent is gone, and the never-accepted
candidate loads again. The installation record was already written before `accept`. The function's doc
comment still argues from `placePack`, which no longer exists. Not reproduced.

**2.3. A damaged cached dependency build is never repaired.** `dependency-cache.ts:140-142`: when
`builds/<revision>` exists, `checkBuild` throws on a damaged copy. The freshly verified copy staged beside it
is discarded in `finally`, so every later resolution of that dependency fails until someone deletes the
directory by hand.

**2.4. CLI guide drift.** `packages/apack-cli/CLAUDE.md`, Commands table: *"uninstall removes the record"*.
It now writes a marker that boot pruning keeps.

**2.5. Host guide drift.** `packages/apack-host/CLAUDE.md`, Pack layout, says `packFileHashes(layoutDir)` and
`stagedFileHashes(packRoot)` hash files from both sides of an install so the installer can compare them.
`packFileHashes` exists in `assets.ts` and is re-exported through layout; its absence was incorrectly
reported in the initial review. `stagedFileHashes` takes an integrity receipt (`layout.ts:134`), and
`installShippedPacks` compares `shippedRevision` instead. Staging recovery also lists a `publishing` kind
that `StagingKind` (`replace-dir.ts:15`) does not have.

**Checked clean.**
- `installFromDirectory` runs stage, verify, prepare, a receipt comparison, then the manifest, host and build
  checks, then `beforePlace` on a copy, then `replaceDir`. Temp dirs are removed on every throw path.
- `replaceDir` refuses to delete a destination another owner replaced (dev/ino check).
  `withInstallationRecord` restores the record when a placement is refused.
- Checksum pins: malformed ones are refused.
- `updateShippedPack` and `restoreShippedPack` check ownership before and at acceptance, and pin
  `expectedSourceRevision`.
- `readAppPackSources` refuses every duplicate claimant.
- `installShippedPacks` preserves unrecorded and user-owned builds and respects suppression.
- Discovery imports no pack modules.
- Boot pruning keeps the records of invalid builds and removal markers.
- Staging keeps the producer's checksums rather than recomputing them.
- install, replace, restore and uninstall hold `withPackMutation` across placement and the record write.
- The only loosened assertion (dev-install's `expect.objectContaining`) follows a new callback option and
  still pins the named fields.

## Area 3a: host build inputs

Scope: `apack-host/src/build/compiler-inputs/`, `build/{pack-build-inputs,package-inputs,pack-inputs,packages-built,discover}.ts`,
and their specs. Reviewed at `HEAD` = `278661695`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 3a.1 | Medium | A check step whose output directory another step rewrites is never cached again | Open |
| 3a.2 | Low (plausible) | A dangling relative link inside a symlinked directory is watched at the wrong path | Open |
| 3a.3 | Low | One dangling symlink in a pack's source tree breaks authored hashing with a bare ENOENT | Open |

**3a.1. Output evidence makes a shared scratch directory a cache key.** `unitStaleReason`
(`apack-host/src/build/packages-built.ts:824-830`) now treats a unit as stale unless its recorded
`outputFiles` equal the current digests of its outputs. The chain stamps every step through it, and passes
a step's declared `outputs` straight through (`scripts/lib/chain-stamps.ts`). `test:smoke` and `test:e2e`
both declare `outputs: ['.apack/tests/results']` (`scripts/lib/chain-steps.ts:1153`, `:1169`), and
Playwright wipes that directory at the start of a run. After `npm run chain -- --e2e`, or a hand-run
`npm run test:e2e` or `test:headed`, the next chain reports `test:smoke`'s outputs changed and runs it again
with no input moved, and the freshness sweep calls it stale. The error is in the safe direction (nothing
stale is accepted), but the root guide's claim that `test:smoke` stays cached on unchanged inputs no longer
holds.

**3a.2. A dangling relative link is resolved against the logical parent (plausible).**
`compiler-inputs/watch-paths.ts:21`: for a missing path whose last component is a symlink, the target is
`path.resolve(parent, readlink(file))` with `parent` the *logical* directory. The other branch uses the
physical parent. Inside a symlinked directory (`deps → /store/x`, `deps/a → ../b`) the kernel resolves
`/store/b`, but the view records `<root>/b` as missing. If `/store/b` later appears, the final check still
sees "missing" and accepts the capture. No spec covers a dangling link in the compiler file view. How often
this shape occurs was not established.

**3a.3. A dangling symlink breaks authored hashing.** `build/pack-inputs.ts:28` calls `fs.statSync(file)` with
no `throwIfNoEntry`, so one broken link in a pack's source (`src/old.ts → ../removed.ts`) throws a raw
`ENOENT` from authored hashing, watch-target derivation and native replay. The package walker
(`package-inputs.ts`) records dangling links as membership instead, so the two walkers disagree on the same
input. Not covered by `pack-inputs.spec.ts`.

**Checked clean.**
- The captured view hashes bytes, namespace (physical path, kind, executable bit), directory entries and
  the stat fields consumed. The final check re-takes each, plus glob results.
- Returned buffers, listings, locations and stats are copies, so callers cannot change the fingerprint.
- `build-inputs.json` is bound to the sealed receipt hash, and replay recomputes the authored inventory and
  package hash.
- Authored identity hashes path and bytes, with no timestamps.
- Passive replay installs no interception and activates no compiler, and this is tested in a fresh process.
- Recorded execution context is a digest, never a raw environment.
- `isPackInputPath` is the single exclusion rule for the authored view, hashing, watch targets and replay.
- Host build imports nothing from the CLI.
- A stamp is written only after a successful run.

## Cross-area seams

The interactions no single area owned. Reviewed at `HEAD` = `8d31bdccc` (*"Refuse pack declarations that
invalidate stored settings before publication"*), which landed during this pass. S.1 and S.2 are about that
commit.

| # | Severity | Seam | Finding | Status |
|---|---|---|---|---|
| S.1 | High | Catalog × settings | Once any stored value is invalid, every catalog change is refused, including the refresh after a toggle or uninstall has already happened | Completed for startup invalidity: host-only recovery prevents pack mutations |
| S.2 | Medium | Catalog × settings × boot | At boot, settings admission validates against empty settings, because packs load before the store is hydrated | Completed: persisted-row preflight before runtime loading |
| S.3 | Medium (plausible) | Install × frontend | A pack disabled while its frontend first loads stays registered in the window | Open |
| S.4 | Medium (plausible) | Settings × window | A reconnect revokes every frontend's settings binding, and a failed re-load leaves the pack reading `undefined` | Closed by 6.3 |
| S.5 | Low (plausible) | Build records × discovery | Under `apack pack dev`, the runtime loaded can be a newer build than the receipt just verified | Fixed |

**S.1. Settings admission blocks every catalog change once one value is invalid.**
`apack-host/src/packs/catalog.ts:130` runs `checkSettings` whenever declarations change, and
`services/index.ts:39` wires it as `compileSettingsCatalog(candidate).validate(settings.getOverrides())`, which
checks every declared owner. `declarationsChanged` compares whole catalog entries, including `enabled`,
so a toggle re-validates every override. In 5.1's state (an invalid stored value that is still unresolved
at startup), that throws for every publication:
- Disabling a pack: `features/packs/be/system.ts` persists `enabled=false` and tears the pack down, then
  calls `registry.refreshCatalog` outside the `try` that guards the pre-check (`:630`). It throws, so the
  catalog still says enabled, the record says disabled, the runtime is gone, and `PACK_ENABLED_CHANGED`
  never goes out.
- Uninstall: the files are gone, then the refresh throws and the UI reports `PACK_UNINSTALL_FAILED`.
- The installer's `assertPackSettings` checks only the candidate plus the app, so it accepts builds that
  every later `emitPacksList` then fails to publish. The Packs view stops receiving `PACKS_LIST`.

**S.2. Boot admission reads empty settings.** `api/src/runtime/index.ts:180` loads packs (`loadAppPacks`) before
`store.hydrate()` at `:192`. Both the loader's `catalog.assertPackSettings` and the catalog's publish-time
check read `settings.getOverrides()` from the unhydrated engine, which is `{}`. So an installed build whose
declarations reject stored values is admitted at boot without a diagnostic, and leaves the profile in
5.1's state. The same commit reads the store directly for shipped installs
(`settingsOverrides: () => storedSettings(store)`, `:171`), but not for the loader.

**S.3. A pack disabled during its first frontend load stays in the window (plausible).**
`features/packs/fe/frontends.ts:184` commits a frontend to the window's registry (surfaces, forms, steps,
text editor extensions, stylesheet, settings binding) inside `load()`. Then `mergePackPlugins`
(`features/application/fe/machine.ts:212-216`) finds the pack no longer eligible and returns without
recording it in `acceptedPackRuntimes`. The loader unloads only owners listed there
(`pack-frontends.ts:27-29`), so the frontend, its global stylesheet and its tiptap extensions stay with no
backend until the pack is re-enabled.

**S.4. A failed re-load after a reconnect leaves settings dead (plausible).** `fe/settings-runtime.ts:54`
disposes every frontend's settings binding when the connection ends. Only a successful re-load issues a
new one. If a pack's refresh fails, the window keeps its surfaces (as in 6.3), but its settings reads
return `undefined`, which pack code cannot tell from "no value", and its writes are refused. The host's
binding wrapper still reports `active`, so nothing shows an error.

**S.5. The runtime is not bound to the verified receipt (plausible, development only).**
`packs/runtime/loader.ts:68-96` verifies the installed directory, then requires `runtime/index.cjs` by path
with no hash check. `apack pack dev` places builds with `replaceDir` while the app runs, without
`withPackMutation`. A rebuild landing between the two loads build B's code under build A's revision. The
next reload repairs it.

**Checked clean.**
- **Catalog × settings:** a settings write cannot be validated against one catalog and published with
  another. The store recompiles when the catalog revision moves.
- **Install × frontend:** pack settings credentials are bound to client, registration ID, declaration and
  build, and re-checked per request. Replacement retires the old window binding at commit.
- **Build records × discovery:** `readPackBuild` ties snapshot, manifest and content index to one verified
  receipt, and staging keeps the producer's checksums.
- **Service binding × runtime:** provider handles check the admitted owner and catalog enablement on every
  call, and settings subscriptions stop on revoke.
- **Settings × reply × window:** replies route by `answering`. Late replies after a reconnect are dropped,
  and pending writes are refused rather than left hanging.

## Area 10: tooling, CI and tests

Scope: `.github/`, `scripts/lib/`, `scripts/*.ts`, `tests/scripts/`, `packages/internal-repo-checks/`, the vitest configs.
Reviewed at `HEAD` = `278661695`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 10.1 | Medium | The `suite` deadline doubled to 600s for every suite step, and its stated reason no longer applies | Open |
| 10.2 | Medium | 69 per-test deadline exceptions were added, many citing a run that hit the old limit | Open |
| 10.3 | Medium | A plain CI dispatch cancels an in-flight strict-acceptance run on the same ref | Open |
| 10.4 | Medium | Name-filtered platform steps have no check that any case ran | Open |
| 10.5 | Medium (plausible) | The manual CI `check` job fails, because internal-repo-checks' integration half needs a fixture build it doesn't run | Open |
| 10.6 | Low | The external-pack failure upload points at paths the PR moved | Open |
| 10.7 | Low (plausible) | `test:external-pack:app` still declares 18s after gaining the default-fork lifecycle | Open |

**10.1. The suite rung doubled, and its reason has gone.** `scripts/lib/step-timeouts.ts:117-118`: `suite`
is now `600_000` (300s on `master`). The commit that raised it gave the integration pool outgrowing
300s as the reason. A later commit moved that pool to its own `acceptance` class (`:149`), and the
header now says *"Ordinary suites/bundles retain 600s"* (`:85`), which states the doubled value as the
old one. So every `suite` step (the unit pools, `build:default-setup`, `build:runtime`, `test:smoke`,
`test:e2e`, the external-pack and authoring halves, every `bounded.ts suite` call) waits 10 minutes before
killing a hang. No measurement shows a remaining member needs it. `step-timing.spec.ts`'s real readings
were replaced with synthetic ones that pass at the new rung. The root guide says *"Do not change
deadlines, assertions or input scope merely to obtain a pass."*

**10.2. 69 per-test deadline exceptions.** `packages/internal-repo-checks/tests/suite-timeouts.spec.ts:30`:
`TIMEOUT_EXCEPTIONS` was empty on `master` and now has 69 entries, mostly CLI integration cases and
`_support` hooks, at 120s to 540s against the 60s Large budget. Many reasons are a run that exceeded the
old limit (*"Normal run 39262109257 exceeds the inherited 60s…"*, *"before the former 180s full-build
limit aborts it"*). Some give no figure. `test:integration`'s aggregate is now 7200s, so the pool
deadline cannot catch what the per-test ones miss. Each entry is reasoned, so whether they are budgets or
raises to pass is a judgement. This records that the gate is much looser than before.

**10.3. A plain dispatch cancels strict acceptance.** `.github/workflows/ci.yml:62-64`: the concurrency group
names the compiler inputs but not `strict_chain`, and the *new* run decides `cancel-in-progress`. A
default dispatch on the same ref after a strict one gets the same group with cancel `true`, and GitHub
cancels the strict run partway through. The comment says diagnostic results must finish.

**10.4. Platform steps can run nothing and pass.** `.github/workflows/compiler-linux.yml:68-90` has four
`--testNamePattern` steps and no check that a case ran. A renamed case makes a step select zero tests,
which vitest reports as skipped and exits 0. The Windows and macOS workflows verify only the native
step's JSON, not their other filtered steps. Every pattern matches a case today. Root guide: *"A check
that reports nothing may have looked at nothing."*

**10.5. The manual `check` job lacks a fixture build (plausible).** `ci.yml:147-151` runs internal-repo-checks'
integration half without building the fixture packs. `dev-pack-hmr.integration.spec.ts` now fails in
`beforeAll` when `tests/packs/external-pack/src/__generated__/pack-entry-fe.ts` is missing, and that
directory is gitignored. The chain orders this after `test:external-pack:contract`. `ci.yml` does not. Not
dispatched to confirm.

**10.6. Stale upload paths.** `ci.yml:186-194` uploads `tests/packs/external-pack/tests/{results,screenshots}/`
on failure. Fixture Playwright output now goes to `.apack/tests` (`apack-testing/src/playwright.ts:32`), so
a failed run uploads nothing.

**10.7. Stale declared cost (plausible).** `test:external-pack:app` still declares `seconds: 18`
(`chain-steps.ts`), but with no arguments it now also runs `tests/scripts/test-default-pack-fork.ts`: four more
app launches and four `apack pack` commands. `chain --dry`'s path and drift figures understate it. Not
measured.

**Checked clean.**
- `strict-chain.yml` runs bash with `pipefail`, and the authoring scripts use `set -euo pipefail`, so
  `| tee` cannot hide an exit code.
- No `|| true`, `continue-on-error` or `--passWithNoTests` was added. The integration pool adds `--bail=1`.
- New chain edges (fork producer, default-fork output, `facade:check --from-build`, integration →
  contract) are declared and asserted.
- No process is killed by pattern: liveness probes use `kill(pid, 0)`, and only spawned handles are
  killed.
- `ci.yml`'s header matches `ASSUMED_RUNGS`.
- Nothing is gated on `process.env.CI`, and the macOS runner guard is never faked.
- New populations are asserted non-empty.

## Area 9: default-setup's migration

Scope: `packages/default-setup/src` and `tests/`. Reviewed at `HEAD` = `278661695`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 9.1 | High | Double-clicking a symlinked Library document no longer opens it | Open |
| 9.2 | High | After a backup import or reset, the open flow keeps its stale graph | Open |
| 9.3 | Medium | Reopening the selected action or prompt shows a cached, possibly stale form, and saving it overwrites newer data | Open |
| 9.4 | Medium (plausible) | A graph change during layout discards the layout for good | Open |

**9.1. Symlinked documents don't open.** `features/library/fe/state.ts:155-165`: a double-click on a symlinked
document sends `GET_DOCUMENT` from the browser view without setting `editingDocumentId` or entering
`edit`. This PR moved `DOCUMENT_LOADED` from a root handler that targeted `.edit` into the `edit` state,
guarded on `editingDocumentId` (`:1031-1034`). So the answer arrives in `browser` and is dropped. No spec
has a symlink case.

**9.2. A replaced flow is never refetched.** `features/flows/fe/state.ts:171-185`: once a flow is selected,
`setSurfaceData` keeps the local `selectedFlowId` and `graph` on every `FLOWS_CONNECTED`. The first
`FLOWS_CONNECTED` already selects the root flow, so in practice the published graph is always ignored. At
the same time the Database surface stopped reloading the window after an import or reset
(`database/fe/components/BackupRestore.vue`, `database/fe/state.ts`), relying on the host to publish
restored state to live surfaces. After a reset or import, the canvas shows the old graph, and edits target
rows that are gone or replaced. Selecting the same flow again does not refetch, because `selectFlow`
returns early for the selected flow.

**9.3. Reopening a selected action uses a cached form.** `features/actions/fe/state.ts:89-96`: `selectAction`
returns when the action is already selected, so the view shows the cached `formData`. `ACTION_UPDATED`
updates `selectedAction` but never `formData`, and returning to the list does not clear the selection.
So if another window, a content apply or an import changes the action, reopening it shows the old code,
and saving sends that old code over the newer stored action. `prompts/fe/state.ts` has the same early
return. The new spec case pins the caching. No case reopens a changed action.

**9.4. A graph change during layout discards the layout (plausible).** `flows/fe/state.ts:1147-1148` applies
`LAYOUT_COMPUTED` only when `context.graph === event.graph`. About fifteen handlers rebuild `graph` with
spread syntax (node and edge changes, `FLOW_REFRESHED`, and others). One firing while ELK is still
running drops the layout, nothing requests another, and the graph stays with `positions: {}`. The old
code merged positions by node id. How the canvas draws empty positions was not checked.

**Checked clean.**
- Every settings read is a typed owner-bound handle whose keys match the `apack.json` schemas, and the
  converted schemas keep the old defaults.
- Every host service used is declared in `consumes.services`.
- All 13 step declarations match the removed step exports.
- Reference types, categories and `opens` destinations match what the code opens. No old `note://`-style
  link writers remain.
- `FLOW_SELECT` answers with `reply()`, guarded by `answersCall`.
- Onboarding's move to a root-flow track is covered across connections, pause, restart and data replacement.
- Nothing imports the removed migrations or settings modules.
- No dual reads, repository casts, cross-feature frontend imports or raw sends.
- Goldens moved only with real content changes.

## Area 4: manifest schema, codegen and published surface

Scope: SDK `build/` and `framework/declaration-schema.ts`, `default-setup/apack.json`, the `etc/` report diffs,
`docs/public-facing/`, and the CLI templates. Reviewed at `HEAD` = `278661695`, with a check of `2524c10ef`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 4.1 | High | The manifest guide's complete example fails the schema | Open |
| 4.2 | High | The content guide's manifest snippets fail the schema | Open |
| 4.3 | Low | The features guide's "entry `apack pack add feature` writes" lacks the now-required `description` | Open |
| 4.4 | Low | The root guide names two settings composables the SDK no longer exports | Open |

**4.1. The manifest guide's example is invalid.** `docs/public-facing/manifest.md`, "Example manifest" (line
692 onward), is the guide's only complete `apack.json`. It has no `id`, which `ManifestSchema` requires
(`declaration-schema.ts:784`). It also has `"lifecycle": { "sources": … }`. This PR renamed `boot` to
`lifecycle`, and `LifecycleConfigSchema` (`:604-607`) is strict and accepts only `onInit` and
`onShutdown`. Content sources belong in `content.sources`. A pack author who copies the example is
refused by `apack pack validate` and `build`.

**4.2. The content guide's snippets are invalid.** `docs/public-facing/content.md` lines 453, 499 and 593 put
`sources` under `lifecycle`. The writer and format snippets (around 484 and 618) still declare a
top-level `"entities": { "Memo": "Memo" }`, which this PR removed: entities are declared under
`features.<id>.entities` or `data.entities`, mapped to a `path#Export` shape or `null`. The schema refuses
every one of these snippets, and none shows the current entity form.

**4.3. Feature entry drift.** `docs/public-facing/features.md` presents "the entry `apack pack add feature`
writes", but it has no `description`, which `FeatureEntrySchema` now requires. It also lacks the
`system.contract`, `surface.contract`, `settings.form` and `types` that `add feature`
(`apack-cli/src/commands/add/feature.ts:93-104`) writes.

**4.4. Root guide names removed exports.** The root `CLAUDE.md` `@apackdev/sdk/fe` bullet names
`useSettingsSection` and `updateSettings`. Neither is in `packages/apack-sdk/etc/fe.api.md` any more. The
settings composables now are `useFeatureSettings`, `usePackSettings`, `useAppSettings`,
`useSettingsDraft`, `useSettingsSave` and `useSettingsStatus`. No public guide or template uses a removed
export.

**`2524c10ef` is correct.** `.jsx` targets passed validation but were emitted as `../x.jsx.ts`. Deriving
codegen's extension list from `SCRIPT_MODULE_EXTENSIONS` makes the emitter and the resolver share one
list. Only the services path has a test.

**Checked clean.**
- The schema's cross-field rules exist and match the guide: format refs, writers limited to own entities,
  SDK wires not redeclared, reserved feature ids, identifier extension keys, `consumes.services` targets.
- Codegen refuses command collisions against transitive provenance, and repository and service collisions
  against direct dependencies. `MachineMatchesContract` is emitted per contracted system.
- `validatePackSources` refuses duplicate designations, and snapshot provenance merges correctly.
- Validation and codegen share module-target resolution.
- `apack.schema.json` was regenerated with the schema.
- The typed EARS files are untouched, and no new `any` reached the reports.
- No code reads the old keys (`boot`, `entityShapes`, `relKinds`, `settingsSections`, `typesEntry`,
  `builtIn`).
- `default-setup/apack.json` keeps every feature's designation, services and repositories, and moved
  entities, relations and settings to their new homes one for one.

## Area 3b: CLI build and native compilation

Scope: `apack-cli/src/build/`, `commands/{build,dev}.ts`, `bin/`. Reviewed at `HEAD` = `278661695`, with a check
of `b5362528e`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 3b.1 | Medium (plausible) | Builds fail on a host with no procps `ps` whenever a worker child outlives the worker | Open |
| 3b.2 | Medium | A frontend check failing after `dist` was replaced is reported as a failed build, and the app is not reloaded | Open |
| 3b.3 | Low | A failed process-group stop leaks the Vite read tree and releases the lock with group members alive | Open |
| 3b.4 | Low | The phase cache says release and development keys stay distinct; they no longer do | Open |

**3b.1. Group termination needs procps `ps`.** `stopCompilerProcessGroup`
(`apack-cli/src/build/compiler-process-group.ts:34`) confirms the group stopped by running
`/bin/ps -axo pgid=,stat=` with no fallback. A `node:*-slim` image has no `/bin/ps`, and busybox `ps`
rejects `-axo`. If any group member (esbuild's service, an inherited subprocess) is still alive when the
worker exits, the call rejects, the close handler rejects (`build-process.ts:242-245`), and the build fails
with no compiler error. Vite worker closure (`frontend-process.ts:72`) fails the same way. The incumbent
`dist` is kept. The disposable runners all ship procps, so no test reaches this. How often a member
outlives the worker was not established.

**3b.2. A failure after publication is reported as a failed build.** `build-process.ts:131-137`:
`buildWithCompiler` replaces `dist`, then `ensureFrontend(candidate)` re-verifies the reused frontend
generation. If that times out (5s, Vite busy) or a Vite-side input moved, it throws. Since
`candidate === current`, the error propagates (`:143-151`). `watch.ts:176-180` then logs
*"Build/reload failed"*, skips `onBuilt` and the reload, and schedules no retry. `dist` holds the new
build while the app runs the old one, until the next save. No spec covers a failure after publication.

**3b.3. Cleanup is skipped when the group stop fails.** In `frontend-process.ts:65-76`, the read-tree
removal sits after `await stopCompilerProcessGroup`, so a rejection leaks the `apack-vite-*` tree. In
`buildWithCompiler`, staging is removed and the pack lock released while live group members could still
write. The next build's verification still blocks stale publication, so the impact is cleanup only.

**3b.4. Phase cache header contradicts its key.** `apack-cli/src/build/phase-cache.ts:7` says *"Release and
development keys stay distinct."* This PR removed the `release:` component from the key, and the
compilation hash has no options either. Neither gated phase (types, DSL defs) depends on `release` today,
so no wrong bytes are published. But a release-sensitive phase gated later would reuse output across
modes, and no test asserts distinct keys.

**`b5362528e` preserves behaviour.** It hoists the shared helpers into one input object and spreads it into
the PE, ELF and Mach-O checks. The members each receives are identical, and admission logic is unchanged.

**Checked clean.**
- Publication waits for the worker's close and the group stop, checks for abort, and re-verifies the
  authored hash and sealed revision before `replaceDir`. Every path out cleans staging while the lock is
  held.
- Parent IPC loss kills the worker group.
- Phase reuse requires a verified receipt and current inputs, and re-hashes against the prior receipt.
- The expected-output check runs before sealing.
- Watch coalescing cannot publish a stale candidate.
- A ready replacement frontend exists before the old generation is disposed.
- Native admission happens at `process.dlopen`, before load, and Mach-O, ELF and PE share one dispatcher.
- Backend and Vite workers launch through one function.
- No deadline was raised in the spec diffs. Every timeout line is an addition.

## Area 6: frontend admission, shell and navigation

Scope: host `fe/` (not the settings runtime), `features/application/fe/`, `features/packs/fe/`; SDK `fe/`
(not settings); the renderer's runtime, transport and pack loading; and their specs. Reviewed at `HEAD` =
`278661695`.

| # | Severity | Finding | Status |
|---|---|---|---|
| 6.1 | Medium | A tab whose frontend is loading or was refused does nothing when chosen, and traps the switch hotkeys | Completed |
| 6.2 | Medium | Two packs declaring one reference name: the second loses its whole frontend, by load order | Open |
| 6.3 | Medium | After a refused replacement, the kept frontend's systems never get startup data on that connection | Completed: the frontend is unloaded instead |
| 6.4 | Low | A candidate's settings lifecycle activates before its last freshness check | Open |

**6.1. Declared but unaccepted tabs.** The toolbar and the surface-switch hotkeys now list every enabled
declared surface from the catalog (`surface-navigation.ts`), not only loaded ones. The toolbar sends
`SELECT_SURFACE`, and `setActiveSurface` returns when `currentSurface()` finds no actor
(`features/application/fe/machine.ts:556-557`), with no message. `SELECT_SURFACE` does not wait or refuse
the way `OPEN_SURFACE` does through `readyFor`. The hotkeys pick a neighbour from the same list (`:523`),
so a press onto a pack whose frontend failed is a no-op, and every later press picks the same neighbour
again. Before this PR the tabs came from loaded surfaces only. No spec covers it.

**6.2. Reference name conflicts are refused only in the window, and by load order.** `buildTables`
(`fe/pack-store.ts:182-196`) throws when two packs claim the same reference type or category. That refuses
the second pack's whole frontend registration: its surfaces, forms and steps. Which pack is second follows
`loadedPacks` order. The backend's reference catalog (`packs/catalog-references.ts`) has no conflict check,
so neither pack gets a load problem on the backend side. The first pack's binding is also never eligible,
because the reference reader treats two runtime owners as ambiguous. Entity destinations do this properly:
the backend refuses every competing owner and the window repeats the same check (`catalog-surfaces.ts:69`).

**6.3. Startup data stalls after a refused replacement.** On reconnect or a runtime update,
`announceLoadedPacks` (`machine.ts:288-292`) announces nothing while `packFrontendsNeedRefresh` is set,
and a failed refresh keeps it set (`:309`). The refused candidate's predecessor stays eligible, because
eligibility compares declaration and build revisions, not the registration ID. But no `packClientReady`
is sent for it on this connection, and the backend skipped it in that connection's `CLIENT_CONNECTED`. The
surface looks loaded and never receives its startup data until another load succeeds. The runtime guide
says *"A failed frontend remains unloaded."* Keeping the old frontend may be intended, but then its
systems need announcing, and the guide disagrees either way. `pack-loading.spec`'s refusal case asserts
nothing about this.

**6.4. Settings authority before the last check.** `commit` (`fe/pack-store.ts:259-261`) runs
`binding?.activate()`, which starts the candidate's settings lifecycle with a live port, and only then
`beforePublish()` (the freshness check and style commit, `features/packs/fe/frontends.ts:179`). If that
throws, the candidate is disposed and revoked, but its `bindSettings` hook has already run with live
authority. Reachable only when the freshness check or the style commit fails inside the callback, since
nothing awaits between prepare and commit.

**Checked clean.**
- Admission requires the backend's declarations, declaration revision, registration ID and build revision.
- Prepare and commit compare the registry revision.
- A refused candidate's settings binding is disposed, and a grant arriving after unload is disposed.
- Style leases are per attempt and never remove the accepted owner's stylesheet.
- `PACK_FRONTEND_LOADED` is sent only after acceptance.
- Replacing surfaces keeps tab position, visibility and selection.
- `SurfaceScope` re-keys on the actor's session.
- `pack://` serves bytes only when they match the requested receipt, and refuses traversal and symlinks.
- Pane and form failures are contained, and a retry with a changed identity is refused, in both main and
  popout windows.
- Backend and window entity-destination checks are the same code.
- No pack receives another surface's actor.
- No assertion was loosened or deadline raised.

## Completeness — historical gap and current acceptance

### Code changed after the accepted integration run — evidence corrected

**Original finding (corrected by `278661695`).** Before repair, the goal's [final audit](settings-and-pack-contracts.md#final-requirement-and-source-audit--2026-10-19)
says: *"After `1ba85b976`, only documentation changes. There is no newly uncovered implementation acceptance
gap."* The branch contradicts it. `git diff 1ba85b976..HEAD` outside `docs/` and `*.md` changes 17 files in
seven commits, none of which ran in the accepted normal integration run `39333769307` (on `06638811d`):

| Commit | Change | Area |
|---|---|---|
| `7781c22d2` | Removes contribution rollback machinery from `packs/extensions.ts` (−135), `registry.ts`, `backend-extensions.ts`, `fe/app-extensions.ts`, `fe/pack-store.ts`; deletes `tests/packs/undo-log.spec.ts` | 1, 6 |
| `b5362528e` | Refactors native runtime inspection file access, `apack-cli/src/build/compiler-native-libraries.ts` | 3b |
| `146809084` | Reference reader prefers runtime category declarations, `apack-sdk/src/fe/reference-reader.ts` | 6 |
| `2524c10ef` | Generated pack imports keep JSX paths, `apack-sdk/src/build/generate-entries.ts` | 4 |
| `dc8573b7b` | Settings document reads and validation diagnostics, `features/settings/{document,validation}.ts`, `be/store.ts` | 5 |
| `9b43b688d`, `3127e57af` | This review's own fixes (settings path readers, CLI runner guard) | 5, 10 |

Area 1 found that `7781c22d2` removed only dead code and kept every guarantee the guide states, so the
gap here is evidence, not a known defect. `b5362528e` changes native admission code that only disposable
runners exercise, so area 3b checks it.

### What the accepted run did not run

**High.** The goal treats run `39333769307` plus the source audit as its final acceptance, because the
user waived the repeated strict gate (`2c790624d`). That workflow (`strict-chain.yml` at `06638811d`)
ran four steps: `typecheck`, `build:default-setup`, `test:external-pack:contract` and
`test:integration -- --all`. It did not run:

| Step | Last recorded pass | Source then |
|---|---|---|
| `test:unit:host`, `test:unit:pack` | Strict run `39196299955` (5,667 host, 889 pack) | `55c9e1f54` |
| `build:runtime`, `test:smoke` | Strict checkpoint `2026-10-17T00-23-23Z-27374` | 2026-10-17 |
| `test:external-pack:app` (27 cases, plus fork lifecycle) | "Refreshed external app and normal fork acceptance" | 2026-10-17 |
| `test:packaged-authoring:author` / `:app` | Strict run `39172886664` (author half); app half at the 2026-10-17 checkpoint | 2026-10-17 |

The audit argues that every production change since then is covered by focused checks, and that
*"application settings, shell navigation, frontend boundaries … and replacement behavior are unchanged"*.
That argument ends at `1ba85b976`. `7781c22d2` then changed pack registration and the frontend pack
store, which is exactly what the external-app and smoke cases exercise. So the app-level behaviour the
goal lists as delivered (replacement, disable/remove/restore, multi-window settings, pane containment)
has not been run on the branch's current source.

What would close it is one run of those steps on committed source, on a disposable macOS runner
(`gh workflow run ci.yml --ref <branch> -f strict_chain=true`, or a normal-acceptance workflow extended
with the unit pools, `build:runtime`, `test:smoke` and both `:app` halves). They are now authorized and in progress; see [current acceptance evidence](pr-246-acceptance.md).

### Historical acceptance register at the original review baseline

Each row of the goal's
[Final acceptance register](../../goals/goal-settings-and-pack-contracts.md#final-acceptance-register),
judged against this review's findings at `HEAD` = `8d31bdccc`.
- **Delivered**: implemented, no open finding against it.
- **Delivered with open defects**: implemented, with open findings listed.
- **Not delivered**: the row's own pass condition does not hold.

This table preserves the original baseline assessment. Its open-finding cells are historical; the
current disposition table and acceptance record above supersede them.

| Register row | Verdict | Open findings |
|---|---|---|
| Foundation and manifest | Delivered with open defects | 4.1, 4.2: the public manifest and content guides' examples fail the schema, so the row's "external authoring" half does not hold for a pack author following them. 4.3, 4.4 |
| Settings | Delivered with open defects | S.4 remains open. 5.1 and startup-related S.1/S.2 paths have admission/recovery repairs with focused checks; packaged/native acceptance remains pending |
| Discovery | Delivered with open defects | 6.2: reference name conflicts are refused in the window only, by load order. S.5 (development only) |
| Editor and content | Delivered | Not reviewed beyond area 9's checks. No finding |
| Build ownership/freshness | Delivered with open defects | 3a.1–3a.3, 3b.1–3b.4. None publishes a stale build. `b5362528e` preserves behaviour |
| Entity navigation | Delivered with open defects | 6.1 (declared but unaccepted tabs), 9.1 (symlinked Library documents) |
| Frontend containment | Delivered with open defects | 6.3, 6.4, S.3, S.4 |
| API consumption | Delivered with open defects | 7.2 is implemented and awaits an application check |
| Provenance/replacement | Delivered with open defects | 9.2, 9.3: surfaces show stale data after a replacement, now that the Database surface no longer reloads the window. 1.x and 2.x are fixed |
| External package consumer and release preparation | Delivered with open defects | 4.1, 4.2 affect any author using the guides. 10.6: a failed external-pack CI run uploads nothing |
| Final committed tree | Not delivered | No application-level or integrated run covers the current source (see above), and the repairs since this review began are covered only by focused checks. 10.1–10.4 loosen or weaken the gates that would provide it |
