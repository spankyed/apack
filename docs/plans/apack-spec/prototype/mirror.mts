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
import type { Asks, Handle, Started, System } from './state.mts'

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

/**
 * A state another started may not be running: its mirror reads as nothing until it is, and as nothing again once it
 * has stopped, and a reader that read it runs again each time.
 */
export function mirror<V extends { data: object }>(sys: System, handle: Started<V, never, Asks, any>): { readonly value: V | undefined; stop(): void }
export function mirror<V extends { data: object }>(sys: System, handle: Handle<V, never, Asks>): { readonly value: V; stop(): void }
export function mirror(sys: System, handle: { readonly ref: string }): { readonly value: unknown; stop(): void } {
  type Held = { at?: string; data: Record<string, unknown> }
  const read = (): Held | undefined => sys.read(handle as never) as Held | undefined
  const copied = (now: Held | undefined): Held | undefined => now && { at: now.at, data: owned(now.data) as Record<string, unknown> }
  const box = reactive<{ now: Held | undefined }>({ now: copied(read()) })
  let stopped = false

  sys.subscribe((changed, __, changes) => {
    if (stopped || !changed.includes(handle.ref)) return
    const latest = read()
    // It stopped, or it has only now started: there is nothing to write into, or nothing written yet.
    if (!latest || !box.now) { box.now = copied(latest); return }
    const held = box.now
    const mine = changes[handle.ref]
    if (!mine) return
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

  return { get value() { return box.now }, stop: () => { stopped = true } }
}
