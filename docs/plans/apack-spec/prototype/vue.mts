// What a Vue component uses to read a running state and tell it things.
//
//   const { provide, useState } = vueBinding<{ threads: typeof threadsSurface }>()
//
//   provide(app, system)                                          // once, where the app is made
//
//   <script setup lang="ts">
//   const { state: threads, send, child } = useState('threads')
//   const { state: thread } = useState(() => child('thread', props.threadId))   // one of many, following the prop
//   </script>
//
//   <template>
//     <h1>{{ threads.data.titles[id] }}</h1>                       <!-- renders again when a title changes -->
//     <p v-if="thread">{{ thread.data.messages.length }}</p>      <!-- nothing while that thread is not running -->
//     <button @click="send({ type: 'OPEN_THREAD', threadId })">Open</button>
//   </template>
//
// What `useState` gives is taken apart by name, as Vue's composables are: a ref that a component's setup holds by
// name is read in its template without `.value`. In the script it is `threads.value`.
//
// A component reads and sends. It does not ask: an ask is work with an owner, and a component is not one. What a
// component needs done, it sends to a state, whose `run` does it.
import { computed, getCurrentScope, inject, onScopeDispose, shallowRef, toValue, watch, type App, type ComputedRef, type InjectionKey, type MaybeRefOrGetter } from '@vue/runtime-core'
import { mirrors, type Shared } from './mirror.mts'
import type { AllStarts, AnyEvent, AnyState, Asks, Each, HandleOf, Started, State, System, Value } from './state.mts'

const SYSTEM: InjectionKey<System> = Symbol('the system this app reads')

/** Reaching a state that this one starts: by the name it is declared under, and by key where there is one for each. */
type Child<C> = <K extends keyof C & string>(name: K, ...key: C[K] extends Each<any> ? [key: string] : []) => HandleOf<C[K]>

/** A running state, as a component has it. */
export interface Bound<V, E extends AnyEvent, C> {
  /** What it is: where it is and the data there. Whatever reads a place in it runs again when that place changes. */
  readonly state: ComputedRef<V>
  send(event: E): void
  readonly child: Child<C>
}
type BoundTo<X> = X extends State<infer S, infer E, any, any> ? Bound<Value<S>, E, AllStarts<S>> : never

/**
 * `Top` is what the window runs at its outermost, by the name each is started under. In the app a pack's generated
 * facade would give it, so a name that is not running does not compile.
 */
export function vueBinding<Top extends Record<string, AnyState>>() {
  /** Reads a state the window runs, by name. */
  function useState<K extends keyof Top & string>(name: K): BoundTo<Top[K]>
  /**
   * Reads a state another started. Given as a function, it is followed: when the handle it returns changes, as when
   * a prop does, this reads the other state from then on. It reads as nothing while its state is not running.
   */
  function useState<V extends { data: object }, E extends AnyEvent, C>(of: MaybeRefOrGetter<Started<V, E, Asks, C>>): Bound<V | undefined, E, C>
  function useState(source: string | MaybeRefOrGetter<{ readonly ref: string }>): Bound<unknown, AnyEvent, Record<string, never>> {
    const system = inject(SYSTEM)
    if (!system) throw new Error('No system was provided to this app. Call `provide(app, system)` where the app is made')
    const all = mirrors(system)
    const ref = computed(() => (typeof source === 'string' ? source : toValue(source).ref))

    // One mirror is held at a time, taken before the one before is let go, so that a state both name is not dropped
    // and made again. It is swapped as the handle changes, before anything reads through it.
    const current = shallowRef<Shared>()
    let held: Shared | undefined
    watch(ref, (now) => {
      const next = all.acquire(now)
      if (held) all.release(held)
      held = next
      current.value = next
    }, { immediate: true, flush: 'sync' })
    if (getCurrentScope()) onScopeDispose(() => { if (held) all.release(held); held = undefined })

    return {
      state: computed(() => current.value!.box.now),
      send: (event) => system.send({ ref: ref.value } as never, event as never),
      child: ((name: string, key?: string) => (system.child as (of: { ref: string }, name: string, key?: string) => unknown)({ ref: ref.value }, name, key)) as never,
    }
  }

  return {
    /** Gives an app the system its components read. */
    provide: (app: App, system: System): void => { app.provide(SYSTEM, system) },
    useState,
  }
}
