import { entityTypeOf, type EARS } from '@apackdev/ears';
/** Canonical entity wire type, available through the frontend SDK. */
export { entityTypeOf };
import type { OpenEntity } from '../events/index.ts';
import { boundFeHost } from '../runtime/fe-host.ts';
import { getDesignated, hasDesignation } from '../designations/index.ts';
import type { HostShell, SurfaceEvent } from './shell.ts';
import { splitRef } from '../ids/refs.ts';
import { _runDelivery } from '../events/delivery.ts';

export type { SurfaceEvent } from './shell.ts';

function getApp(): HostShell {
  return boundFeHost().application;
}

/**
 * Opens the surface at `ref` and hands its actor `event`, checking nothing about either: the untyped half of the
 * `openSurface` a pack's `#generated/fe` builds over this, as `untypedQuery` is of `query`. Pack code naming a surface
 * itself uses the generated one, which checks the name and the event at compile time; this is for a ref that
 * arrives as data — a link block's target — and for host code, which has no pack to be typed against.
 *
 * The shell does the opening, so a ref whose pack's frontend is still loading opens once it has loaded, and one no
 * pack provides is reported to the user once loading has settled. Only a string that isn't a ref at all is refused
 * here.
 */
export function untypedOpenSurface(ref: string, event?: SurfaceEvent | SurfaceEvent[]): void {
  if (!splitRef(ref)) throw new Error(`"${ref}" doesn't name a surface: a surface is named "<packId>/<featureId>"`);
  const events = event === undefined ? [] : Array.isArray(event) ? event : [event];
  getApp().send({ type: 'OPEN_SURFACE', surface: ref, events });
}

/**
 * Opens a link the way the user chose. The surface playing the `browser` role takes `LINK.OPEN { url }` and decides,
 * by its own settings (a tab of its own, or the system's browser); with no surface in that role, the system's browser.
 */
export function openLink(url: string): void {
  const ref = hasDesignation('browser') ? getDesignated('browser') : undefined;
  const browser = ref ? getApp().system.get(ref) : undefined;
  // Reaching the actor rather than asking the shell, because the lookup *is* the decision: a shell request for a
  // surface that isn't here waits and then tells the user, where this has somewhere better to go. The delivery is
  // opened anyway, so a send the browser makes while handling carries its own ref — the thing every other path to
  // a surface's actor gets from the host's `notifySurfaceActor`, and the one reason this bypass still had to change.
  if (browser && ref) {
    const event = { type: 'LINK.OPEN', url };
    _runDelivery({ receiver: ref, event }, () => browser.send(event));
  }
  else window.electronAPI?.shell?.openExternal(url);
}

/** Open Settings → Help at the index, a feature's articles, or one pack-qualified article. */
export function openHelp(target: import('../framework/pack-help.ts').HelpTarget = {}): void {
  if (target.articleId && !target.packId) throw new Error('Opening an article requires its packId.');
  if (target.featureId && !target.packId) throw new Error('Filtering help by feature requires its packId.');
  untypedOpenSurface('host/settings', { type: 'HELP.OPEN', target });
}

/** Open the declared destination for an entity in this window. */
export function openEntity(id: EARS.EntityId): void {
  getApp().send({ type: 'OPEN_ENTITY', id });
}

/** A destination guard; bind E to the surface contract's `opens` union. */
export function entityIs<E extends string>({ event }: { event: { type: string; id?: unknown } }, params: { entity: E }): boolean {
  return event.type === 'OPEN_ENTITY' && 'id' in event && typeof event.id === 'string' && event.id.includes('-')
    && entityTypeOf(event.id as OpenEntity['id']) === params.entity;
}
