# Reconnect without remount

Status: planned, 2026-10-26. Not started.

A window that loses its connection to the API and gets it back — the API crashed and Electron main restarted it,
`npm run dev` rebuilt it, the socket dropped — remounts every pack surface. Whatever a surface's components held is
gone, unsaved input included. The reconnect should be invisible to the UI and recovered underneath it, which is
what Apollo and Relay do (the components stay, the data is fetched again) and what Phoenix LiveView does for form
input.

## Why

Measured in the main checkout, 2026-10-25: a probe typed into the `bundled-ui-pack` fixture's editor, confirmed the
component's model held it, then terminated the API child by the pid in its own `api-port` file. Electron main
restarted the API, the window reconnected, and the editor and the model both read the initial text again. That is
the fixture's intermittent "lost typing" failure exactly
([evidence](../references/evidence/build-input-snapshot-proof.md#electron-exit-hang-in-linked-worktrees-2026-10-25)).

The chain that produces it is deliberate, from the 2026-10-13 lifecycle work
([its record](../archive/references/evidence/discovery-without-activation.md)):

- a restarted API registers every pack afresh and mints a new registration ID (`randomUUID()`, `@apackdev/host`
  `packs/registry.ts`), and a reconnect sets `packFrontendsNeedRefresh` (`disconnectPackFrontends`,
  `features/application/fe/machine.ts`), so the shell re-accepts every pack and replaces each surface's actor;
- `SurfaceScope` keys its subtree by actor, so a new actor remounts the surface;
- that record names the limit outright: it does not "preserve arbitrary component-local drafts across actor
  replacement".

## What the remount is protecting, and why a per-surface fix is the wrong one

Replacing the actor clears three kinds of state that would otherwise outlive the connection they belong to:

- **Outstanding asks.** A reply is addressed to the connection's `client`, minted per WebSocket connection, so an ask
  outstanding when it drops is never answered: an open terminal's intent, a generated query, a page fetch.
- **`ViewWrites`' pending writes.** A view's results are held behind the surface's unanswered writes, and a write
  "that never is [answered] holds the view for good" (`@apackdev/sdk/fe` `view-writes.ts`). Kept across a reconnect
  with a write in flight, an editor's view would stop updating, silently.
- **Settings authority.** A handle from a retired binding is refused (`_createFeSettings`, "Retirement cannot revive
  it"); a kept component would hold one.

Keeping actors and asking every surface author to drop those on a reconnect hook is a pit of failure: the surface
that forgets freezes with no error. So the recovery belongs to the infrastructure, which already owns all three.

## Design

1. **Keep a surface's actor when its code is unchanged.** On acceptance, a surface whose `state` machine is the very
   object its running actor was spawned from is the same module (a build's URL, or a dev server's HMR, is what
   changes it), so its actor is kept and its subtree stays mounted. A changed machine is replaced as today. This is
   the only rule the shell needs, and it covers an API restart, where the registration ID changes and the code does
   not.
2. **Settle a dead connection's asks in the SDK.** Every send mints its call (`createSends`); the SDK records which
   calls a surface has outstanding on which connection, and when that connection ends it delivers each one a
   standard refusal (`CONNECTION_LOST`, answering the call). `answersCall`/`settleCall` and `ViewWrites` already
   treat a refusal correctly — a refused write reads the view again — so no surface changes. The open question to
   settle first: a refusal must reach a machine that typed its answers per ask, which needs one SDK-declared answer
   type every surface's inbox accepts, as `FEATURE_SETTINGS_UPDATED` is declared for every surface.
3. **Settings handles follow the module's binding.** A `_createFeSettings` instance belongs to one module instance,
   so to one build; its handles read the binding currently active for it instead of the one current at setup.
   A new build is a new module and cannot reach the old one's authority; with none active a handle refuses, as now.
4. **Ask again for startup data.** A kept actor is handed `SURFACE_STARTED` again, in a delivery naming it, so it asks
   for what it starts from on the new connection as a new actor would. Views need nothing: `watchView` resubscribes
   on a restart (`api:started`) and the tRPC client resubscribes on a dropped socket.

## Steps

1. The SDK refusal of a dead connection's calls (design 2), with the declared answer type, and its specs.
2. Settings handles following the module's binding (design 3); the host handoff spec's "old handle refused" case
   becomes "an old handle writes through the new binding of the same build, and is refused once none is active".
3. The shell keeping unchanged actors and re-sending `SURFACE_STARTED` (designs 1 and 4); the reconnect cases in
   `pack-loading.spec.ts` and `pack-handoff.spec.ts` keep the actor for an unchanged machine and replace it for a
   changed one.
4. The guide (`packages/apack-host/CLAUDE.md`, root `CLAUDE.md`'s "Actor replacement remounts…") and the 2026-10-13
   record's limit, updated to what holds.

**Done when** the reconnect probe above — type, restart the API, reconnect — reads the typed text afterwards; a write
in flight across the restart leaves its editor's view updating; and the full chain is green.

## Until then

The E2E fixture names the cause when a test fails across an API restart (`api-restarted`, `@apackdev/testing`
`appPage`), and state a surface must keep across a reconnect lives in its view or its machine's backend, not in
component-local state.
