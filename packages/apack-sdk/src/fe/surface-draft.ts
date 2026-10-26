// What a surface's components hold that the user has not saved yet, kept where a remount cannot reach it.
import { ref, type Ref } from 'vue'
import type { FeatureRef } from '../ids/index.ts'
import { boundFeHost } from '../runtime/fe-host.ts'
import { useSurface } from './actor-system.ts'

/**
 * Each bound window's drafts, by surface ref and name. Keyed on the bound host rather than held at module scope, so
 * a test binding another host starts with none, and the drafts go with the window that held them.
 */
const drafts = new WeakMap<object, Map<string, Ref<unknown>>>()

/**
 * A value a surface's component holds for the user until it is saved: typed text, a form's fields, a selection.
 *
 * **A remount does not lose it.** When the window reconnects to the API — the API restarted, the socket dropped —
 * the shell accepts every pack again and replaces each surface's actor, and `SurfaceScope` remounts the surface for
 * its new actor. That is deliberate: it is what drops the asks the old connection left unanswered, a view held behind
 * unanswered writes and a retired settings binding. A `ref` in the component goes with it; this one is kept by the
 * surface's ref and the draft's `name`, so the remounted component is handed the same ref, holding what was typed.
 *
 * It lasts as long as the window, not across a restart of the app: what must survive that is saved, through the
 * surface's system or `useSurfaceStorage`. `name` is the surface's own, scoped to it as a storage name is.
 */
export function useSurfaceDraft<T>(name: string, initial: T): Ref<T> {
  const surface = useSurface<{ id: FeatureRef }>()
  const host = boundFeHost()
  let held = drafts.get(host)
  if (!held) drafts.set(host, held = new Map())
  const key = `${surface.id}:${name}`
  let draft = held.get(key) as Ref<T> | undefined
  if (!draft) held.set(key, draft = ref(initial) as Ref<T>)
  return draft
}
