import { computed, defineComponent, Fragment, h, inject, onScopeDispose, provide, shallowRef, watch, type ComputedRef, type InjectionKey } from 'vue'
import { splitRef } from '../ids/refs.ts'
import { _runDelivery } from '../events/delivery.ts'
import { boundFeHost } from '../runtime/fe-host.ts'
import type { HostShellSurfaceRef, SurfaceEvent } from './shell.ts'

const SURFACE: InjectionKey<ComputedRef<HostShellSurfaceRef>> = Symbol('surface')

/**
 * The handle of the surface this component belongs to. The host provides it where it renders a surface's canvas,
 * panel and chat, and `SurfaceScope` where a surface's component is rendered elsewhere (its settings, in the settings
 * surface). Another surface's state is read with `useUntypedSurfaceState`/`readUntypedSurfaceState`, which name it by ref and hand
 * back a value rather than its handle.
 */
export function useSurface<T>(): T {
  const surface = inject(SURFACE, undefined)
  if (!surface) throw new Error('useSurface() runs in a component a surface renders: its canvas, panel or chat, or one inside a <SurfaceScope>')
  return sendsAsItself(surface.value) as T
}

/**
 * One wrapper per surface handle, so two `useSurface()` calls in one component hand back the same object. Keyed on
 * the handle, so it goes when the handle does.
 */
const wrappers = new WeakMap<HostShellSurfaceRef, HostShellSurfaceRef>()

/**
 * The surface handle, with a send that says which surface made it.
 */
function sendsAsItself(actor: HostShellSurfaceRef): HostShellSurfaceRef {
  const existing = wrappers.get(actor)
  if (existing) return existing
  const bound = new Map<PropertyKey, unknown>()
  const wrapper = new Proxy(actor, {
    get(target, prop, receiver) {
      const kept = bound.get(prop)
      if (kept !== undefined) return kept
      const value = prop === 'send'
        ? (event: SurfaceEvent) => _runDelivery({ receiver: target.id, event: event as object }, () => target.send(event))
        : Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      const fn = prop === 'send' ? value : (value as (...args: unknown[]) => unknown).bind(target)
      bound.set(prop, fn)
      return fn
    },
  })
  wrappers.set(actor, wrapper)
  return wrapper
}

/**
 * The running handle of the surface at `ref`, a registered surface's `<packId>/<featureId>`.
 *
 * Not exported from `@apackdev/sdk/fe`: pack code reads a surface through `useUntypedSurfaceState`/`readUntypedSurfaceState` and
 * sends to one through the generated sends, so no pack holds another surface's handle.
 */
export function surfaceActor(ref: string): HostShellSurfaceRef {
  const actor = surfaceActorIfRunning(ref)
  if (!actor) throw new Error(`No surface is running at "${ref}"`)
  return actor
}

/**
 * The same, or undefined when nothing is running at `ref` yet. A pack's own surfaces are all started in the step
 * that registers them, so absence means another pack whose frontend is still loading — a state to render, not a
 * bug. The readers in `surface-state.ts` use this; `SurfaceScope` uses `surfaceActor`, where a missing surface means
 * the component was mounted for one that doesn't exist.
 */
export function surfaceActorIfRunning(ref: string): HostShellSurfaceRef | undefined {
  if (!splitRef(ref)) throw new Error(`"${ref}" doesn't name a surface: a surface is named "<packId>/<featureId>"`)
  return boundFeHost().application.surface(ref)
}

/**
 * Renders its slot as part of the surface at `surface` (a registered surface's `<packId>/<featureId>`), so
 * `useSurface()` in it returns that surface's handle: for a surface's component rendered outside its own areas, such as
 * its settings in the settings surface.
 */
export const SurfaceScope = defineComponent({
  name: 'SurfaceScope',
  props: { surface: { type: String, required: true } },
  setup(props, { slots }) {
    const actor = shallowRef<HostShellSurfaceRef | undefined>(surfaceActor(props.surface))
    const follow = () => { actor.value = surfaceActorIfRunning(props.surface) }
    watch(() => props.surface, follow, { flush: 'sync' })
    const subscription = boundFeHost().application.subscribe(follow)
    onScopeDispose(() => subscription.unsubscribe())
    provide(SURFACE, computed(() => actor.value ?? surfaceActor(props.surface)))
    // A component may capture its handle during setup. Its subtree belongs to that instance's lifetime.
    return () => actor.value ? h(Fragment, { key: actor.value.sessionId }, slots.default?.()) : null
  },
})
