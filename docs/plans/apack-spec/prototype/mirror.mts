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

type Held = { at?: string; data: Record<string, unknown> }

/** One running state, mirrored once for everything that reads it. */
export interface Shared { readonly ref: string; readonly box: { now: Held | undefined }; readers: number }

/**
 * The mirrors of one system. A state is mirrored once however many read it, from the first reader until the last has
 * gone, and a state nobody reads is not mirrored at all. The system is listened to once, for as long as anything is
 * mirrored: a step costs a lookup for each state it changed and a write for each place, whatever is reading.
 */
export interface Mirrors {
  /** The mirror of the state running under this name, made if this is its first reader. */
  acquire(ref: string): Shared
  /** One reader fewer. The last one gone, the mirror is dropped. */
  release(shared: Shared): void
  /** How many states are mirrored. */
  readonly size: number
}

const made = new WeakMap<System, Mirrors>()

export function mirrors(sys: System): Mirrors {
  const existing = made.get(sys)
  if (existing) return existing
  const byRef = new Map<string, Shared>()
  let unsubscribe: (() => void) | undefined
  const read = (ref: string): Held | undefined => sys.read({ ref } as never) as Held | undefined
  const copied = (now: Held | undefined): Held | undefined => now && { at: now.at, data: owned(now.data) as Record<string, unknown> }

  const onStep = (changed: readonly string[], _: unknown, changes: Readonly<Record<string, { moved: boolean; paths: ReadonlyArray<ReadonlyArray<string>> }>>): void => {
    for (const ref of changed) {
      const shared = byRef.get(ref)
      if (!shared) continue
      const latest = read(ref)
      // It stopped, or it has only now started: there is nothing to write into, or nothing written yet.
      if (!latest || !shared.box.now) { shared.box.now = copied(latest); continue }
      const held = shared.box.now
      const mine = changes[ref]
      if (!mine) continue
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
    }
  }

  const all: Mirrors = {
    acquire(ref) {
      let shared = byRef.get(ref)
      if (!shared) {
        shared = { ref, box: reactive<{ now: Held | undefined }>({ now: copied(read(ref)) }), readers: 0 }
        byRef.set(ref, shared)
        unsubscribe ??= sys.subscribe(onStep)
      }
      shared.readers++
      return shared
    },
    release(shared) {
      if (--shared.readers > 0 || byRef.get(shared.ref) !== shared) return
      byRef.delete(shared.ref)
      if (!byRef.size) { unsubscribe?.(); unsubscribe = undefined }
    },
    get size() { return byRef.size },
  }
  made.set(sys, all)
  return all
}

/**
 * One reader of a running state, outside a component. A state another started may not be running: its mirror reads
 * as nothing until it is, and as nothing again once it has stopped, and a reader that read it runs again each time.
 */
export function mirror<V extends { data: object }>(sys: System, handle: Started<V, never, Asks, any>): { readonly value: V | undefined; stop(): void }
export function mirror<V extends { data: object }>(sys: System, handle: Handle<V, never, Asks>): { readonly value: V; stop(): void }
export function mirror(sys: System, handle: { readonly ref: string }): { readonly value: unknown; stop(): void } {
  const all = mirrors(sys)
  let shared: Shared | undefined = all.acquire(handle.ref)
  const box = shared.box
  return { get value() { return box.now }, stop: () => { if (shared) all.release(shared); shared = undefined } }
}
