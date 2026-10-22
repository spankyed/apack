// A surface's own window storage, under a prefix derived from its ref rather than a name someone typed.
import type { FeatureRef } from '../ids/index.ts';
import { useSurface } from './actor-system.ts';

/** What a window keeps for one surface. The names are the surface's; the prefix is not its business. */
export interface SurfaceStorage {
  get(name: string): string | null;
  set(name: string, value: string): void;
  remove(name: string): void;
  /** The names this surface has stored, for the few callers that sweep their own keys */
  names(): string[];
}

/**
 * One surface's window storage.
 *
 * **The prefix is derived, which is the whole point.** A hand-typed key fails twice over. Two packs can
 * choose the same string and collide silently, window storage being one flat namespace per window; and
 * the key freezes whatever vocabulary its author typed, since renaming it orphans what the user has
 * stored under it — so a rename sweep has to leave it behind. Keyed on the ref, neither can happen: the
 * name a surface passes is scoped to the surface that passed it, and no rename reaches a prefix nobody
 * wrote down.
 *
 * Takes the ref rather than reading it from a component, because most callers are not components: a
 * machine's action, a persistence util, a module-level cache. Pack code has its ref from
 * `#generated/ref` (`ref('code')`), and `useSurfaceStorage()` is the sugar for a component that would
 * rather not repeat it.
 */
export function surfaceStorage(ref: FeatureRef, storage: Storage = localStorage): SurfaceStorage {
  const prefix = `${ref}:`;
  return {
    get: (name) => storage.getItem(prefix + name),
    set: (name, value) => { storage.setItem(prefix + name, value); },
    remove: (name) => { storage.removeItem(prefix + name); },
    names: () => Array.from({ length: storage.length }, (_, i) => storage.key(i))
      .filter((key): key is string => key !== null && key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  };
}

/** The storage of the surface whose component this runs in. */
export function useSurfaceStorage(): SurfaceStorage {
  const surface = useSurface<{ id: FeatureRef }>();
  return surfaceStorage(surface.id);
}

/** One surface's state for this renderer session, retained through reloads. */
export function surfaceSessionStorage(ref: FeatureRef): SurfaceStorage {
  return surfaceStorage(ref, sessionStorage);
}
