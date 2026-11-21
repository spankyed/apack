// The heart of the Vue binding: a running state as a reactive value a component can read.
//
//   const thread = mirror(system, handle)
//   thread.value.at                          // reactive
//   thread.value.data.messages[id]           // re-read only when that thread's messages change
//
// The kernel says, for each step, the exact places in a state's data that changed. Writing just those places into a
// reactive copy lets Vue's own dependency tracking do the rest: whatever read a place that changed runs again, and
// nothing else does. There is no selector to write and nothing to compare.
import { markRaw, reactive } from '@vue/reactivity'
import type { Asks, Handle, System } from './state.mts'

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * A copy the mirror owns. The kernel's values are shared and never mutated, and a reactive object is written to in
 * place, so the mirror cannot hold the kernel's own objects. What is not plain data is held as it is and not made
 * reactive: it is replaced whole, never edited.
 */
const owned = (value: unknown): unknown => {
  if (!isPlain(value)) return typeof value === 'object' && value !== null ? markRaw(value) : value
  if (Array.isArray(value)) return value.map(owned)
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, owned(inner)]))
}

export function mirror<V extends { data: object }>(sys: System, handle: Handle<V, never, Asks>): { readonly value: V; stop(): void } {
  const now = sys.read(handle as never) as { at?: string; data: object }
  const held = reactive({ at: now.at, data: owned(now.data) as Record<string, unknown> })
  let stopped = false

  sys.subscribe((_, __, changes) => {
    const mine = changes[handle.ref]
    const latest = sys.read(handle as never) as { at?: string; data: Record<string, unknown> } | undefined
    if (stopped || !mine || !latest) return
    if (mine.moved) held.at = latest.at
    for (const path of mine.paths) {
      // Walk to the place in both: what the state holds there now, and where in the mirror it goes.
      let from: unknown = latest.data
      let into: unknown = held.data
      for (const key of path.slice(0, -1)) { from = (from as Record<string, unknown> | undefined)?.[key]; into = (into as Record<string, unknown> | undefined)?.[key] }
      const last = path[path.length - 1]!
      if (typeof into !== 'object' || into === null) continue
      if (typeof from === 'object' && from !== null && last in from) (into as Record<string, unknown>)[last] = owned((from as Record<string, unknown>)[last])
      else delete (into as Record<string, unknown>)[last]
    }
  })

  return { value: held as unknown as V, stop: () => { stopped = true } }
}
