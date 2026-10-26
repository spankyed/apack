// The shell's surfaces: their order, which show, spawning each one's actor, and moving between them.
import type { Surface } from '@apackdev/sdk/fe';
import { HOST_PACK_ID, splitRef } from '@apackdev/sdk/ids';
import type { ShellContext } from './types.ts';
import type { AnyActorRef } from 'xstate';
import { notifySurfaceActor } from '../../../fe/surface-delivery.ts';

/** `surfaces` with the app's own (the host's: the Packs tab) after every pack's, each group in its order */
export function withHostLast(surfaces: Surface[]): Surface[] {
  const isHost = (surface: Surface) => splitRef(surface.id)?.packId === HOST_PACK_ID;
  return [...surfaces.filter((surface) => !isHost(surface)), ...surfaces.filter(isHost)];
}

/**
 * Spawns a surface's state machine under its own id as well as its system id, and hands it `SURFACE_STARTED` in a
 * delivery naming it (`SurfaceLifecycleEvent`, `@apackdev/sdk/fe`), where it asks for what it starts from. The id is
 * the key the shell tracks the child by: without one every surface shares a key, the shell holds only the last one
 * spawned, and stopping it stops that one alone while the rest keep running with their system ids taken.
 *
 * XState types `id` from the declared children, and surfaces are registered at runtime (built-in and from
 * packs), so the id goes through this one cast rather than at each call site.
 *
 * **The actor is started before it is handed the event.** XState defers a spawned child's start until the
 * spawning transition's actions have run, while a running shell runs this action at once, so the child is not
 * started yet: its mailbox would hold the event and handle it at the deferred start, after the delivery has
 * returned, and the surface's startup asks would go out with no sender for the system to answer. `start()` on a
 * running actor returns at once, so the deferred start finds it running and does nothing.
 */
export function spawnSurfaceActor(enqueue: unknown, surface: Surface): void {
  const spawner = enqueue as {
    spawnChild(state: Surface['state'], options: { id: string; systemId: string }): void;
    (action: (args: { system: { get(id: string): AnyActorRef | undefined } }) => void): void;
  };
  spawner.spawnChild(surface.state, { id: surface.id, systemId: surface.id });
  spawner(({ system }) => {
    const actor = system.get(surface.id);
    if (!actor) return;
    actor.start();
    notifySurfaceActor(actor, surface.id, { type: 'SURFACE_STARTED' });
  });
}

/** The adjacent declared tab, wrapping around; absent when the current tab is hidden. */
export function neighbourOf<T extends { id: string }>(visible: readonly T[], activeSurfaceId: string, direction: 'up' | 'down'): T | undefined {
  const index = visible.findIndex(surface => surface.id === activeSurfaceId);
  if (index === -1) return undefined;
  return visible[(index + (direction === 'up' ? -1 : 1) + visible.length) % visible.length];
}

/** The history after opening `surface`: moved within it when `historyIndex` is set (back and forward), else extended */
export function historyAfter(
  context: Pick<ShellContext, 'surfaceHistory' | 'historyIndex'>,
  surface: string,
  historyIndex?: number,
): Pick<ShellContext, 'surfaceHistory' | 'historyIndex'> {
  if (historyIndex !== undefined) return { surfaceHistory: context.surfaceHistory, historyIndex };
  const history = context.surfaceHistory.slice(0, context.historyIndex + 1);
  if (history[history.length - 1] === surface) return { surfaceHistory: context.surfaceHistory, historyIndex: context.historyIndex };
  return { surfaceHistory: [...history, surface], historyIndex: history.length };
}
