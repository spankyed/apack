# Unsaved state across a reconnect

Status: done, 2026-10-26: `useSurfaceDraft` in `@apackdev/sdk/fe`, adopted by the `bundled-ui-pack` fixture's editor.

A window that loses its connection to the API and gets it back — the API crashed and Electron main restarted it,
`npm run dev` rebuilt it, the socket dropped — remounts every pack surface, and whatever a surface's components held
for the user went with it, unsaved input included.

## Why

Measured in the main checkout, 2026-10-25: a probe typed into the `bundled-ui-pack` fixture's editor, confirmed the
component's model held it, then terminated the API child by the pid in its own `api-port` file. Electron main
restarted the API, the window reconnected, and the editor and the model both read the initial text again — the
fixture's intermittent "lost typing" failure exactly
([evidence](../../references/evidence/build-input-snapshot-proof.md#electron-exit-hang-in-linked-worktrees-2026-10-25)).

The remount is deliberate, from the 2026-10-13 lifecycle work
([its record](../references/evidence/discovery-without-activation.md)): a restarted API registers every pack
afresh under a new registration ID (`randomUUID()`, `@apackdev/host` `packs/registry.ts`), a reconnect sets
`packFrontendsNeedRefresh` (`features/application/fe/machine.ts`), the shell re-accepts every pack and replaces each
surface's actor, and `SurfaceScope` keys its subtree by actor.

## Decision: keep the remount, move the draft out of its reach

The other way — keep a surface's actor when its code is unchanged — was worked through and set aside, because the
remount is what clears three kinds of state that belong to the connection that ended:

- **Outstanding asks.** A reply is addressed to the connection's `client`, minted per WebSocket connection, so an ask
  outstanding when it drops is never answered.
- **`ViewWrites`' pending writes.** A view's results are held behind a surface's unanswered writes, and one "that
  never is [answered] holds the view for good" (`@apackdev/sdk/fe` `view-writes.ts`): an editor kept across a
  reconnect with a write in flight would stop updating, silently.
- **Settings authority.** A handle from a retired binding is refused (`_createFeSettings`).

Keeping actors would carry all three into a connection where they can never resolve, and making that safe needs
either every surface to clear them on a reconnect hook — a pit of failure, since the one that forgets freezes with no
error — or an SDK layer that settles a dead connection's calls with an answer type every surface's inbox accepts.
Both trade a visible loss for silent failures. What was being lost is the user's draft, and a draft does not belong
to the connection at all: it is the window's, so that is where it is kept.

`useSurfaceDraft(name, initial)` (`@apackdev/sdk/fe` `surface-draft.ts`) returns a ref kept per bound window by the
surface's ref and the draft's name. The remounted component asks for the same name and is handed the same ref,
holding what was typed. The remount still clears everything the old connection owned. This is form recovery, as
Phoenix LiveView does it across a reconnect: the component is rebuilt, the input is restored.

It lasts as long as the window. What must outlive a restart of the app is saved, through the surface's system or
`useSurfaceStorage`.

## What holds it

- `packages/apack-sdk/tests/fe/surface-draft.spec.ts`: under `SurfaceScope`, a draft survives the actor being replaced,
  each surface's draft is its own, and a newly bound window starts with none. With a plain `ref` in its place the
  survival case fails, which is what shows the case sees the remount.
- The reconnect probe above, run again with the fixture's editor on `useSurfaceDraft`: after the API restart, with the
  surface's actor replaced (a new session id), the editor and the model both read the typed text.
- The E2E fixture names an API restart under a failing test (`api-restarted`, `@apackdev/testing` `appPage`), so a
  failure caused by one says so rather than reading as a failed assertion.
