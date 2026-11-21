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
// its actor is subscribed to once. On each snapshot only the places of the context that changed are written into
// the mirror, so a component renders again for the fields it read and for no others. What a component is handed is
// read-only: `v-model` on a field of it does nothing, and a field is shown with `:value` and changed by sending. A `useSelector` is a
// subscription of its own that runs its selector again on every snapshot, so a component with sixty of them does
// sixty selectors' work for a change to one field.
import { computed, getCurrentScope, markRaw, onScopeDispose, reactive, readonly, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { AnyActorRef, EventFrom, SnapshotFrom } from 'xstate'
import { useSurface } from './actor-system.ts'

/** A machine as a component has it: the state it is at, as a path, and its context */
export interface MachineState<TActor extends AnyActorRef> {
  /** Where it is: `'idle'`, or `'thread.sending'` for a state inside another */
  readonly at: string
  /** What it holds. Whatever reads a place in it runs again when that place changes */
  readonly data: SnapshotFrom<TActor> extends { context: infer Context } ? Context : never
}

/** What `useState` hands a component */
export interface UsedState<TActor extends AnyActorRef, TState = MachineState<TActor>> {
  /** The machine as it is now. Read-only: a field is shown with `:value`, and changed by sending */
  readonly state: ComputedRef<TState>
  /** Sends the machine an event */
  send(event: EventFrom<TActor>): void
}

type Held = { at: string; data: Record<string, unknown> }
type Snapshot = { value?: unknown; context?: unknown }

/** One machine, mirrored once for everything that reads it */
interface Mirror {
  readonly key: string
  readonly box: { now: Held }
  /** The context as the machine last gave it: what the next one is compared with */
  seen: unknown
  readers: number
  stop(): void
}

/** A machine's mirror by the session its actor runs as, which a proxy around the actor passes through */
const mirrors = new Map<string, Mirror>()

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/**
 * A copy the mirror owns. A reactive object is written to in place, and a machine's context is its own, so the
 * mirror never holds the context's objects. What is not plain data — an actor, a class instance, a Map — is held
 * as it is and not made reactive: it is replaced whole, never looked inside.
 */
const owned = (value: unknown): unknown => {
  if (!isPlain(value)) return typeof value === 'object' && value !== null ? markRaw(value) : value
  if (Array.isArray(value)) return value.map(owned)
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, owned(inner)]))
}

/**
 * Writes into the mirror the places where the context differs from the one before. A machine makes a new object for
 * what it changes and keeps the rest, so two values that are the same object are the same all the way down, and are
 * not looked into.
 */
function write(into: Record<string, unknown>, was: Record<string, unknown>, now: Record<string, unknown>): void {
  const merged = (key: string): unknown => {
    const before = was[key]
    const after = now[key]
    const held = into[key]
    const alike = isPlain(before) && isPlain(after) && isPlain(held) && Array.isArray(before) === Array.isArray(after)
    if (!alike) return owned(after)
    write(held, before, after)
    return held
  }
  for (const key of Object.keys(now)) if (was[key] !== now[key] || !(key in into)) into[key] = merged(key)
  if (Array.isArray(now)) { if ((into as unknown as unknown[]).length !== now.length) (into as unknown as unknown[]).length = now.length; return }
  for (const key of Object.keys(into)) if (!(key in now)) delete into[key]
}

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
    const made: Mirror = {
      key,
      box: reactive({ now: { at: placeOf(first.value), data: owned(first.context ?? {}) as Record<string, unknown> } }),
      seen: first.context ?? {},
      readers: 0,
      stop: () => {},
    }
    const subscription = actor.subscribe((snapshot: Snapshot) => {
      const held = made.box.now
      const at = placeOf(snapshot.value)
      if (held.at !== at) held.at = at
      const now = snapshot.context ?? {}
      if (now === made.seen) return
      write(held.data, made.seen as Record<string, unknown>, now as Record<string, unknown>)
      made.seen = now
    })
    made.stop = () => subscription.unsubscribe()
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
    // Read-only: a mirror is shared by every component that reads its machine, so one that wrote into it would
    // change what all the others see, and nothing would have told the machine. To change it, `send`.
    state: computed(() => mirror.value && readonly(mirror.value.box.now)),
    send: (event) => { current.value?.send(event) },
  }
}
