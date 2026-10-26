import { computed, defineComponent, Fragment, h, inject, onScopeDispose, provide, shallowRef, watch, type ComputedRef, type InjectionKey } from 'vue'
import type { AnyActorRef } from 'xstate'
import { splitRef } from '../ids/refs.ts'
import { _runDelivery } from '../events/delivery.ts'
import { boundFeHost } from '../runtime/fe-host.ts'

const SURFACE: InjectionKey<ComputedRef<AnyActorRef>> = Symbol('surface')

/**
 * The actor of the surface this component belongs to. The host provides it where it renders a surface's canvas,
 * panel and chat, and `SurfaceScope` where a surface's component is rendered elsewhere (its settings, in the settings
 * surface). Another surface's state is read with `useUntypedSurfaceState`/`readUntypedSurfaceState`, which name it by ref and hand
 * back a value rather than its actor.
 *
 * Which surface a component belongs to is where it is rendered, not anything at the call site, so the type is the
 * caller's to name — `useSurface<MemosActor>()`, or a typed binding it is inferred from. It has no default: one
 * would be `any` in all but name, and a component that never named its surface would read a context field the
 * machine dropped, and keep compiling.
 */
export function useSurface<T>(): T {
  const surface = inject(SURFACE, undefined)
  if (!surface) throw new Error('useSurface() runs in a component a surface renders: its canvas, panel or chat, or one inside a <SurfaceScope>')
  return sendsAsItself(surface.value) as T
}

/**
 * One wrapper per actor, so two `useSurface()` calls in one component hand back the same object. Keyed on the
 * actor, so it goes when the actor does.
 */
const wrappers = new WeakMap<AnyActorRef, AnyActorRef>()

/**
 * The actor, with a send that says which surface made it.
 *
 * A component sending to its own surface is the one path that reaches a machine's actions from outside a
 * delivery — the bus names the message it routes to a system and the shell names the one it hands a surface, but
 * a click goes straight to the actor. Running the send in a delivery means the action's own `sendToSystem`
 * stamps this surface's ref, so a system can answer *this* surface in the window it was asked from. `actor.id` is
 * that ref because the shell spawns a surface with its ref as both `id` and `systemId`.
 *
 * Only `send` is wrapped; everything else passes through bound to the actor. `subscribe` and `getSnapshot` are
 * what a selector is built on, so `surface-send-scope.spec.ts` pins both reaching the real actor through the
 * wrapper; the `bind` is what keeps a detached `const { send } = actor` working.
 */
function sendsAsItself(actor: AnyActorRef): AnyActorRef {
  const existing = wrappers.get(actor)
  if (existing) return existing
  /**
   * One function per member, kept, so `surface.getSnapshot === surface.getSnapshot`.
   *
   * Handing back a fresh binding on every read works with the `@xstate/vue` this repo has — it reads each
   * member once — but that is a fact about somebody else's code at one version, and the failure if a later one
   * memoises on identity is every selector in every surface quietly ceasing to update. Keeping them removes the
   * question. Only functions are kept: a plain property is read through each time, since the actor owns it.
   */
  const bound = new Map<PropertyKey, unknown>()
  const wrapper = new Proxy(actor, {
    get(target, prop, receiver) {
      const kept = bound.get(prop)
      if (kept !== undefined) return kept
      const value = prop === 'send'
        ? (event: unknown) => _runDelivery({ receiver: target.id, event: event as object }, () => target.send(event))
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
 * The running actor of the surface at `ref`, a registered surface's `<packId>/<featureId>`.
 *
 * Not exported from `@apackdev/sdk/fe`: pack code reads a surface through `useUntypedSurfaceState`/`readUntypedSurfaceState` and
 * sends to one through the generated sends, so no pack holds another surface's actor.
 */
export function surfaceActor(ref: string): AnyActorRef {
  const actor = surfaceActorIfRunning(ref)
  if (!actor) throw new Error(`No surface is running at "${ref}"`)
  return actor
}

/**
 * The same, or undefined when nothing is running at `ref` yet. A pack's own surfaces are all spawned in the step
 * that registers them, so absence means another pack whose frontend is still loading — a state to render, not a
 * bug. The readers in `surface-state.ts` use this; `SurfaceScope` uses `surfaceActor`, where a missing surface means
 * the component was mounted for one that doesn't exist.
 */
export function surfaceActorIfRunning(ref: string): AnyActorRef | undefined {
  if (!splitRef(ref)) throw new Error(`"${ref}" doesn't name a surface: a surface is named "<packId>/<featureId>"`)
  return boundFeHost().application.system.get(ref)
}

/**
 * Renders its slot as part of the surface at `surface` (a registered surface's `<packId>/<featureId>`), so
 * `useSurface()` in it returns that surface's actor: for a surface's component rendered outside its own areas, such as
 * its settings in the settings surface.
 */
export const SurfaceScope = defineComponent({
  name: 'SurfaceScope',
  props: { surface: { type: String, required: true } },
  setup(props, { slots }) {
    const actor = shallowRef<AnyActorRef | undefined>(surfaceActor(props.surface))
    const follow = () => { actor.value = surfaceActorIfRunning(props.surface) }
    watch(() => props.surface, follow, { flush: 'sync' })
    const subscription = boundFeHost().application.subscribe(follow)
    onScopeDispose(() => subscription.unsubscribe())
    provide(SURFACE, computed(() => actor.value ?? surfaceActor(props.surface)))
    // A component may capture its actor during setup. Its subtree belongs to that actor's lifetime.
    return () => actor.value ? h(Fragment, { key: actor.value.sessionId }, slots.default?.()) : null
  },
})
