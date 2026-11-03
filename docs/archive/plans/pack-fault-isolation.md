# A pack that breaks should cost its own feature, not the app

Status: frontend pane/form containment is implemented in `713a6c1fd`, including focused lifecycle
checks and a real external-pack Electron acceptance case. Frontend delivery is complete in the
[closed settings/pack goal](../goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19), whose user-approved
final acceptance uses the passing normal integration gate and preserved source-specific evidence.
Out-of-process execution remains deferred to the design-first
[security isolation goal](../../goals/goal-pack-security-isolation.md).

The host scopes Vue component errors in canvas, panel, chat and custom settings forms to the affected
pane, with owner-attributed nonfatal diagnostics. Settings data and host controls remain outside the
custom form. Accepted frontend instance identity and current catalog/build checks prevent retry from
reviving retired code; reused component objects still receive a new instance identity on replacement.
Native shell/settings failures retain their host handler. This changes neither activation ordering nor
the security model. The owning goal records exact source and validation evidence.

The survey below is historical design input from 2026-10-08, not a current implementation inventory.

## Context

Packs run in the host's processes: backends in the API process, frontends in the renderer. **Load time is
guarded already**, and well:

- a pack whose runtime fails to load is skipped with a reason (`loader.ts`'s `skipped`, the registry's
  `loadProblem`);
- `activationProblem` (`packs/runtime/activation-outcome.ts`) turns a failed activation or a failed content
  into a message naming the pack;
- the frontend entry import is wrapped, and a registration that registers nothing is reported
  (`features/packs/fe/frontends.ts`);
- the renderer has a global Vue error handler (`renderer/src/main.ts:92`).

**Run time is thinner.** A backend pack's work happens inside XState actors, so a throw in an action errors
that actor rather than the process — real containment, inherited rather than designed. On the frontend, one
global handler catches what Vue surfaces, and a pack's component that throws during render takes its subtree
with it; nothing scopes the blast radius to the pack.

VS Code runs extensions in a separate **extension host process**, and the reason is mostly stability rather
than security: a wedged or crashing extension must not take the window down.

## The trigger

Re-audit actual installation paths and the trust model. Registry availability alone does not establish
whether users can install external code. Frontend error boundaries have an independent stability payoff;
process isolation needs its own threat-model and synchronous EARS design in the security goal.

A second trigger, weaker but earlier: a crash report that names a pack's frontend as the cause of a blank
window. That is the cheap half's evidence.

## Frontend boundaries

**Scope the frontend blast radius to the pack.** A pack's canvas, panel and settings each render inside a
`SurfaceScope` already; an error boundary at that seam turns "a pack's component threw" into "that pack's
pane shows an error and the app keeps working", with the pack named. Vue's `onErrorCaptured` is the
mechanism and the shell is the owner.

Use catalog owner identities and explicit activation outcomes when reporting failures. Keep settings
snapshots and the shell runtime outside contributed form boundaries. A component failure does not remove
its pack’s declarations or defaults, and retry must not revive an unloaded build revision. Test canvas,
panel and custom settings-form failures, with another pane and host settings still usable.

This is a contained change with its own payoff, independent of any trust story: today the global handler
(`main.ts:92`) learns about the error, and the user learns that the window is blank.

## Separate process-isolation design

**A process boundary for pack backends.** The shape VS Code uses, and the questions it forces here:

- **The bus crosses it.** `sendToSystem`, `broadcastToSurface` and the envelope would become cross-process
  messages for pack systems. The envelope already carries `from`/`via` and the bus already routes on `to`,
  so the addressing survives; the synchronous assumptions do not.
- **EARS does not cross it.** Packs query and transact synchronously against an in-memory engine
  (`query`, `create`/`write`, `transact` — *"synchronous, do NOT await"*). That is the hard constraint: an out-of-process pack cannot
  keep that API, and changing it changes every pack's data code. **This, not the process spawn, is what
  makes this expensive**, and any estimate that misses it is wrong.
- **Services cross it** as RPC, which is what `declared-capabilities.md` would already have made explicit.

## Verification

Frontend proof: `tests/packs/external-pack/tests/e2e/fault-boundaries.spec.ts` exercises the declared
`faults` fixture's canvas/panel render errors and custom-form setup error. It proves another pane and
host settings remain usable, retry recovers the canvas, and settings defaults remain intact. The
mounted Vue and frontend-registry checks cover current/replaced/unloaded instance identity, refused
candidates, owner reporting and scope cleanup; native host handling remains outside the boundary.
All pass at the implementation checkpoint; retain the final goal's committed-source strict gate.

For process isolation, if selected by the security design: a fixture pack that wedges (an infinite loop) and one that crashes,
with the app surviving both and reporting which pack. Neither is assertable today without the boundary.

## Risks

**The cheap half can hide a bug.** An error boundary that swallows a pack's failure into a quiet pane makes
a broken pack look merely empty. It has to report — `reportError` and the pack's record (`lastError`,
already the convention) — or it trades a loud failure for a silent one.

**The expensive half is a rewrite of the data contract, not an isolation feature.** Treat "packs run
out-of-process" as a goal with EARS at its centre, not as a hardening task.

## What this is not

- Not a security boundary against hostile packs. In-process JavaScript with access to the bound runtime is
  not contained by an error boundary, and saying otherwise would be worse than saying nothing.
- Not a replacement for [API consumption](declared-capabilities.md). That plan describes supported API
  dependencies; these boundaries contain component failures. Neither confines arbitrary pack code.
