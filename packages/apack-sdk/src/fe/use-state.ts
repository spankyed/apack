// What a component reads a machine with: where it is and what it holds, as one reactive value, and how to send to it.
//
//   <script setup lang="ts">
//   const { state: commit, send } = useState(() => panelChild(code, 'commit'))
//   </script>
//
//   <template>
//     <span>{{ commit?.data.gitBranch }}</span>
//     <button @click="send({ type: 'commit.PUSH_BRANCH' })">Push</button>
//   </template>
//
// What it gives is taken apart by name, as a Vue composable's result is: a ref a component's setup holds by name is
// read in its template without `.value`.
//
// A machine is mirrored once, however many components read it, from the first reader until the last has gone, and
// its actor is subscribed to once. On each snapshot the fields of the context that are another value are written
// into the mirror, so a component renders again for the fields it read and for no others. A `useSelector` is a
// subscription of its own that runs its selector again on every snapshot, so a component with sixty of them does
// sixty selectors' work for a change to one field.
//
// What a field holds is the machine's own value, never a copy and never made reactive: a machine makes a new object
// for what it changes and keeps the rest, so a value is the same one for as long as the machine holds it. An object a
// component reads is the one the machine compares with when it is sent back, a watch on a field runs when the
// machine replaced it, and what is not plain data (a component, an actor, a class instance) is handed over as it is.
//
// The fields are read-only: `v-model` on one does nothing, and a field is shown with `:value` and changed by sending.
import { computed, getCurrentScope, onScopeDispose, shallowReactive, shallowReadonly, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { AnyActorRef, EventFrom, SnapshotFrom } from 'xstate'
import { useSurface } from './actor-system.ts'

/** What has nothing inside it to write. Asked first, so that a string marked as a kind of id, which is a string and an object at once, stays the string it is */
type Whole = string | number | bigint | boolean | symbol | null | undefined

/**
 * A machine's context as a component reads it. No field of it can be assigned, at any depth, and a field that is a
 * list, a map or a set cannot be changed in place. A list further in than a field is typed as it was declared.
 *
 * Each half goes as far as it costs nothing. A read-only object is taken wherever a writable one is expected, so
 * read-only fields at every depth ask nothing of a helper that takes the object. A read-only list is refused where a
 * writable one is expected, which is the one thing TypeScript holds a caller to: said of a field's own list it is
 * kept across a call, and said of every list inside an entity it would refuse the entity wherever its declared type
 * is asked for. So a prop or a parameter that takes a field's list says `readonly Item[]`.
 */
export type Read<T> =
  T extends Whole ? T
  : T extends (...given: never[]) => unknown ? T
  : T extends ReadonlyMap<infer Key, infer Held> ? ReadonlyMap<Key, ReadInside<Held>>
  : T extends ReadonlySet<infer Item> ? ReadonlySet<Item>
  : T extends object ? { readonly [K in keyof T]: ReadHeld<T[K]> }
  : T
/** What a field holds, as it is read: a list, a map or a set that cannot be changed in place, and an object whose fields cannot be assigned */
type ReadHeld<T> =
  T extends Whole ? T
  : T extends (...given: never[]) => unknown ? T
  : T extends ReadonlyMap<infer Key, infer Held> ? ReadonlyMap<Key, ReadInside<Held>>
  : T extends ReadonlySet<infer Item> ? ReadonlySet<Item>
  : T extends object ? { readonly [K in keyof T]: ReadInside<T[K]> }
  : T
/** What is further in than a field: an object's fields cannot be assigned, at any depth, and a list, a map or a set is as it was declared */
type ReadInside<T> =
  T extends Whole ? T
  : T extends (...given: never[]) => unknown ? T
  : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? T
  : T extends readonly unknown[] ? { [K in keyof T]: ReadInside<T[K]> }
  : T extends object ? { readonly [K in keyof T]: ReadInside<T[K]> }
  : T

/** A machine as a component has it: the state it is at, as a path, and its context */
export interface MachineState<TActor extends AnyActorRef> {
  /** Where it is: `'idle'`, or `'thread.sending'` for a state inside another */
  readonly at: string
  /** What it holds, each field the machine's own value. Whatever reads a field runs again when the machine replaces it */
  readonly data: SnapshotFrom<TActor> extends { context: infer Context } ? Read<Context> : never
}

/** What `useState` hands a component */
export interface UsedState<TActor extends AnyActorRef, TState = MachineState<TActor>> {
  /** The machine as it is now. Read-only: a field is shown with `:value`, and changed by sending */
  readonly state: ComputedRef<TState>
  /** Sends the machine an event */
  send(event: EventFrom<TActor>): void
}

type Snapshot = { value?: unknown; context?: unknown }

/** One machine, mirrored once for everything that reads it */
interface Mirror {
  readonly key: string
  /** What components are handed: where the machine is, and its fields, neither of which they can write */
  readonly shown: { readonly at: string; readonly data: Record<string, unknown> }
  readers: number
  stop(): void
}

/** A machine's mirror by the session its actor runs as, which a proxy around the actor passes through */
const mirrors = new Map<string, Mirror>()

/** Where a machine is, as a path: `{ thread: 'sending' }` is `thread.sending` */
function placeOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return ''
  const inner = Object.entries(value)
  // A machine in several places at once has no one place to name. No surface's machine is, so this is not read.
  if (inner.length !== 1) return JSON.stringify(value)
  const [name, rest] = inner[0]!
  const below = placeOf(rest)
  return below ? `${name}.${below}` : name
}

function acquire(actor: AnyActorRef): Mirror {
  const key = actor.sessionId
  let mirror = mirrors.get(key)
  if (!mirror) {
    const first = actor.getSnapshot() as Snapshot
    // Shallow on purpose: a field's value is the machine's own object, which is never written to and so has nothing
    // to track inside it
    const data = shallowReactive<Record<string, unknown>>({ ...(first.context as Record<string, unknown> | undefined) })
    const held = shallowReactive({ at: placeOf(first.value), data: shallowReadonly(data) })
    const subscription = actor.subscribe((snapshot: Snapshot) => {
      const at = placeOf(snapshot.value)
      if (held.at !== at) held.at = at
      const now = (snapshot.context ?? {}) as Record<string, unknown>
      // A machine's context gains fields and never loses one: an assignment is merged into it
      for (const field of Object.keys(now)) if (!Object.is(data[field], now[field])) data[field] = now[field]
    })
    const made: Mirror = { key, shown: shallowReadonly(held), readers: 0, stop: () => subscription.unsubscribe() }
    mirrors.set(key, made)
    mirror = made
  }
  mirror.readers++
  return mirror
}

function release(mirror: Mirror): void {
  if (--mirror.readers > 0 || mirrors.get(mirror.key) !== mirror) return
  mirror.stop()
  mirrors.delete(mirror.key)
}

/** How many machines are mirrored: nought once no component reads one. For a spec */
export const _mirrored = (): number => mirrors.size

/**
 * Reads the machine of the surface this component belongs to.
 *
 * Which surface that is is where the component is rendered, so the type is the caller's to name:
 * `useState<NotesActor>()`.
 */
export function useState<TActor extends AnyActorRef>(): UsedState<TActor>
/**
 * Reads a machine. Given as a function, it is followed: when the actor it returns changes, as when a surface is
 * replaced or a child is spawned, this reads the other one from then on. It reads as nothing while there is none.
 */
export function useState<TActor extends AnyActorRef>(actor: MaybeRefOrGetter<TActor>): UsedState<TActor>
/** The same, for an actor that may not be there yet: a child that has not been spawned. Its state is then nothing */
export function useState<TActor extends AnyActorRef>(actor: MaybeRefOrGetter<TActor | undefined>): UsedState<TActor, MachineState<TActor> | undefined>
export function useState(actor?: MaybeRefOrGetter<AnyActorRef | undefined>): UsedState<AnyActorRef, unknown> {
  if (!getCurrentScope()) {
    throw new Error("useState follows a machine until the component goes, so it is called in a component's setup, not in a handler or a computed")
  }
  const given = arguments.length === 0 ? useSurface<AnyActorRef>() : actor
  const current = computed(() => toValue(given))

  // One mirror is held at a time, taken before the one before is let go, so that a machine both name is not dropped
  // and made again. It is swapped as the actor changes, before anything reads through it.
  const mirror = shallowRef<Mirror>()
  let held: Mirror | undefined
  watch(() => current.value?.sessionId, () => {
    const next = current.value ? acquire(current.value) : undefined
    if (held) release(held)
    held = next
    mirror.value = next
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { if (held) release(held); held = undefined })

  return {
    // Read-only: a mirror is shared by every component that reads its machine, so one that wrote a field would
    // change what all the others see, and nothing would have told the machine. To change it, `send`.
    state: computed(() => mirror.value?.shown),
    send: (event) => { current.value?.send(event) },
  }
}
