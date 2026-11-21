// The prototype's types and kernel: states that reach each other by name, across a backend and its windows.
//
// A state's value is where it is and the data there:  { at: 'thread.sending', data: { … } }
//
// States run in a system. A backend system and each window's system are separate, joined by a link. Within a
// system, one message from outside and everything it causes is one step, and nothing leaves until the step commits.
//
//   tell(name, event)        to a backend system: nobody waits
//   ask(name, ask, args)     of a backend system: exactly one answer, refusal or failure comes back
//   progress(update)         from the handler of an ask, to whoever asked, before it answers. It arrives in batches
//   broadcast(name, event)   from the backend to that surface in every window
//   watch(key, feature, view, args, heard)   follows a live read of the database for as long as the state is the case

import { produce } from './draft.mts'

export type AnyEvent = { readonly type: string }
/**
 * One ask. `refuses` names the ways it may be refused that an asker can act on: kinds alone
 * (`'not-found' | 'no-access'`), or each kind with the data its refusal carries
 * (`{ 'name-taken': { existingId: string } }`).
 */
export type AskShape = { args: object; answer: unknown; refuses?: string | Record<string, object>; progress?: unknown }
export type Asks = Record<string, AskShape>

/** What a state is, declared as a type: its own data, and the states inside it. The same shape all the way down. */
export type Shape = { data?: object; states?: Record<string, Shape> }

/** What some code can reach by name: the backend's systems, and the surfaces a window runs. */
export type Net = {
  systems: Record<string, { events: AnyEvent; asks: Asks }>
  surfaces: Record<string, { events: AnyEvent }>
  /** The live reads a feature offers, by feature and then by name. */
  views: Record<string, Record<string, { args: object; result: unknown }>>
}
type Nothing = { systems: {}; surfaces: {}; views: {} }

/** What a view delivers: its result, and each changed result after it, or why it could not be read. */
export type ViewUpdate<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }
/** What runs a view: it calls `heard` with the result and every changed result until the function it returns is called. */
export type ViewHost = (feature: string, view: string, args: object, heard: (update: ViewUpdate<unknown>) => void) => () => void

export type AskEnd =
  | 'failed'        // the handler threw
  | 'abandoned'     // whatever was answering ended first
  | 'unavailable'   // nothing takes this ask where it was sent
  | 'disconnected'  // the link to whoever was answering closed
/** An ask's refusals by kind, with what each carries: nothing, where only kinds were declared. */
type Refusals<A> = A extends { refuses: infer R } ? ([R] extends [string] ? { [K in R]: {} } : R) : {}
type Refuses<A> = keyof Refusals<A> & string
type RefusalData<D> = [keyof D] extends [never] ? [] : {} extends D ? [data?: D] : [data: D]
/**
 * Why an ask was not done, as its asker gets it: a kind to branch on, a message to show, and whatever data the ask
 * declares for that kind. Checking `kind` narrows to that data.
 */
export type AskFailure<A = {}> =
  | { [K in Refuses<A>]: { readonly kind: K; readonly message: string } & Readonly<Refusals<A>[K]> }[Refuses<A>]
  | { readonly kind: AskEnd; readonly message: string }
export type Outcome<V, F = AskFailure> = { readonly ok: true; readonly value: V } | { readonly ok: false; readonly failure: F }
type AnyOutcome = Outcome<unknown, { readonly kind: string; readonly message: string }>
type ProgressOf<A extends AskShape> = A extends { progress: infer P } ? P : never
type OutcomeOf<A extends AskShape> = Outcome<A['answer'], AskFailure<A>>

/** In a state's `data`, marks a field that whoever enters the state has to give. */
export const given: unique symbol = Symbol('given')
type Given = typeof given

// ── what a state's code is checked against ──────────────────────────────────────────────────────────────────────────

type DataOf<S> = S extends { data: infer D extends object } ? D : {}
type StatesOf<S> = S extends { states: infer T extends Record<string, Shape> } ? T : {}
type Names<S> = keyof StatesOf<S> & string
type Sub<S, K> = K extends keyof StatesOf<S> ? StatesOf<S>[K] : never
type Join<H extends string, K extends string> = H extends '' ? K : `${H}.${K}`

type Paths<S> = [Names<S>] extends [never] ? never : { [K in Names<S>]: K | `${K}.${Paths<StatesOf<S>[K]>}` }[Names<S>]
type Leaves<S> = [Names<S>] extends [never] ? never : { [K in Names<S>]: [Names<StatesOf<S>[K]>] extends [never] ? K : `${K}.${Leaves<StatesOf<S>[K]>}` }[Names<S>]
type Below<S, P> = P extends `${infer H}.${infer T}` ? DataOf<Sub<S, H>> & Below<Sub<S, H>, T> : DataOf<Sub<S, P>>
type DataAt<S, P extends string> = P extends '' ? DataOf<S> : DataOf<S> & Below<S, P>

/** A state as it is read: where it is, and the data there. */
export type Value<S> = [Names<S>] extends [never]
  ? { readonly data: Readonly<DataOf<S>> }
  : { [L in Leaves<S>]: { readonly at: L; readonly data: Readonly<DataAt<S, L>> } }[Leaves<S>]

/** Every state a path passes through: `thread` and `thread.idle` for `thread.idle`. */
type Through<A> = A extends `${infer H}.${infer T}` ? H | `${H}.${Through<T>}` : A

/**
 * Whether a value is at a state or anywhere inside it. It narrows the value to the places under that state, so the
 * data that exists there can be read. The path is the structure itself: nothing is declared, and nothing can go stale.
 */
export function within<V extends { readonly at: string }, P extends Through<V['at']>>(value: V, state: P): value is Extract<V, { readonly at: P | `${P}.${string}` }> {
  return value.at === state || value.at.startsWith(`${state}.`)
}

type Gained<S, H, T> = T extends `${infer TH}.${infer TT}`
  ? (H extends `${TH}.${infer HT}` ? Gained<Sub<S, TH>, HT, TT> : H extends TH ? Below<Sub<S, TH>, TT> : Below<S, T>)
  : DataOf<Sub<S, T>>

/**
 * A change to data: the fields to replace, or a function that edits a draft of the data in place. The draft is the way
 * to change something nested: `(d) => { d.titles[id] = title }`. Nothing is mutated; a new value is made from the edits.
 * A move that has nothing to give may edit a draft too: the draft is the data where the handler sits, edited before
 * the move. A move that enters a state needing data says it as fields, since those fields are what it gives.
 */
type Change<D> = Partial<D> | ((draft: D) => void)

/** What happens next, in the shape of the value: where to be, and what data changes. */
type Next<R, H extends string> =
  | { at?: never; data: Change<DataAt<R, H>> }
  | { [T in Paths<R>]: {} extends Gained<R, H, T> ? { at: T; data?: Partial<DataAt<R, T>> | ((draft: DataAt<R, H>) => void) } : { at: T; data: Gained<R, H, T> & Partial<DataAt<R, T>> } }[Paths<R>]

/** A state this one started. Only its starter holds it: it can be told, asked and read, never written. */
export interface Handle<V, E extends AnyEvent, A extends Asks> { readonly ref: string; readonly _?: { v: V; e: (event: E) => void; a: A } }

type SystemsOf<N extends Net> = keyof N['systems'] & string
type AskOf<N extends Net, K extends SystemsOf<N>, Q extends keyof N['systems'][K]['asks']> = N['systems'][K]['asks'][Q]

export interface Scope<R, H extends string, E extends AnyEvent, N extends Net> {
  /** The data that exists here: this state's own and that of every state around it. */
  readonly data: Readonly<DataAt<R, H>>
  /** The whole value, as it is now. */
  readonly snapshot: Value<R>
  /** Aborted when this state stops being the case. For an ask, also when whoever asked has gone. */
  readonly signal: AbortSignal

  /** Tells this running state an event. */
  send(event: E): void

  /** Tells a backend system, or a state this one started, an event. Nobody waits. */
  tell<K extends SystemsOf<N>>(to: K, event: N['systems'][K]['events']): void
  tell<E2 extends AnyEvent>(to: Handle<unknown, E2, Asks>, event: E2): void

  /**
   * Asks a backend system, or a state this one started. `heard` is called with the progress made since it was last
   * called, as a list: however fast updates are produced, they arrive at most once a frame, so that a stream of
   * ten thousand is a few dozen changes and not ten thousand.
   */
  ask<K extends SystemsOf<N>, Q extends keyof N['systems'][K]['asks'] & string>(
    of: K, name: Q, args: AskOf<N, K, Q>['args'], heard?: (updates: ReadonlyArray<ProgressOf<AskOf<N, K, Q>>>) => void,
  ): Promise<OutcomeOf<AskOf<N, K, Q>>>
  ask<A2 extends Asks, Q extends keyof A2 & string>(
    of: Handle<unknown, never, A2>, name: Q, args: A2[Q]['args'], heard?: (updates: ReadonlyArray<ProgressOf<A2[Q]>>) => void,
  ): Promise<OutcomeOf<A2[Q]>>

  /** From the backend: tells that surface, in every window, an event. */
  broadcast<K extends keyof N['surfaces'] & string>(to: K, event: N['surfaces'][K]['events']): void

  /**
   * Follows a view until this state stops being the case. `heard` is called with its result and each changed result.
   * A second watch under the same key replaces the first, which is how a view is followed again with other arguments.
   */
  watch<F extends keyof N['views'] & string, V extends keyof N['views'][F] & string>(
    key: string, feature: F, view: V, args: N['views'][F][V]['args'], heard: (update: ViewUpdate<N['views'][F][V]['result']>) => void,
  ): void
  /** Stops following the view watched under this key. */
  unwatch(key: string): void

  /** A state this one started, as it is now. */
  read<V2>(of: Handle<V2, never, Asks>): V2
  /** Starts a state that runs exactly as long as this one is the case. */
  start<S2 extends Shape, E2 extends AnyEvent, A2 extends Asks>(name: string, made: State<S2, E2, A2>): Handle<Value<S2>, E2, A2>
  /** The handle of a state this one started, by the name it was started under. */
  child<S2 extends Shape, E2 extends AnyEvent, A2 extends Asks>(name: string, of: State<S2, E2, A2>): Handle<Value<S2>, E2, A2>
  /** Released, last first, when this state stops being the case. */
  use(release: () => void): void
}

/**
 * What an event's handler is given: everything but `ask`. A handler is synchronous and cannot await an answer, and
 * an ask it only started would end, if its state were left, with nothing around it to take that. Asking is for `run`
 * and for an ask's handler, which the kernel is around.
 */
export type EventScope<R, H extends string, E extends AnyEvent, N extends Net> = Omit<Scope<R, H, E, N>, 'ask'>

export interface AskScope<R, H extends string, E extends AnyEvent, N extends Net, A extends AskShape> extends Scope<R, H, E, N> {
  /**
   * `throw refuse(kind, message)` answers with one of the refusals the ask declares. A kind that carries data takes
   * it as a third argument: required when the declaration has required fields, and not accepted when it has none.
   */
  refuse<K extends Refuses<A>>(kind: K, message: string, ...data: RefusalData<Refusals<A>[K]>): Error
  /** Tells whoever asked something before the answer. Only they hear it. */
  progress(update: ProgressOf<A>): void
}

/** Events: synchronous. What a handler returns is what happens next. */
type On<R, H extends string, E extends AnyEvent, N extends Net> =
  { [T in E['type']]?: (event: Extract<E, { type: T }>, scope: EventScope<R, H, E, N>) => Next<R, H> | void }
const ANSWERED = Symbol('answered')
/** An answer together with what happens next: what an ask's handler returns when answering also changes something. */
export interface Answered<V, X> { readonly [ANSWERED]: true; readonly answer: V; readonly next: X }
/**
 * Answers, and says what happens next, as one thing. The change is made in the step the answer leaves in, so whoever
 * asked never hears of a change that was not made: if the change is refused, the ask is answered `failed`.
 */
export function answered<V, X>(answer: V, next: X): Answered<V, X> { return { [ANSWERED]: true, answer, next } }

/**
 * What can happen next after an `await`. Data is changed by editing a draft, never by giving fields: fields would be
 * worked out from data as it was before the wait, and would overwrite what changed meanwhile. A draft is edited when
 * the change is made, against the data as it is then. A move still gives the fields the states it enters need.
 *
 * It is also where to check what has to hold when the change is made. What was checked before the wait may not be
 * so after it, and an edit may `throw refuse(...)`: the ask is then answered with that refusal and nothing changes.
 */
type NextAfterAwait<R, H extends string> =
  | { at?: never; data: (draft: DataAt<R, H>) => void }
  | { [T in Paths<R>]: {} extends Gained<R, H, T> ? { at: T; data?: (draft: DataAt<R, H>) => void } : { at: T; data: Gained<R, H, T> } }[Paths<R>]

/**
 * Asks: may be async. What a handler returns is the answer. To change something as well it returns
 * `answered(answer, next)`, where `next` is what any handler returns: where to be, and what data changes.
 */
type Answering<R, H extends string, E extends AnyEvent, A extends Asks, N extends Net> =
  { [Q in keyof A]?: (args: A[Q]['args'], scope: AskScope<R, H, E, N, A[Q]>) =>
    | A[Q]['answer'] | Answered<A[Q]['answer'], Next<R, H>>
    | Promise<A[Q]['answer'] | Answered<A[Q]['answer'], NextAfterAwait<R, H>>> }

/**
 * Where a state goes when its work fails: what `run` threw, and what happens next. It is an event's handler in every
 * other way: synchronous, and without `ask`. It is never given a `Left`, which is the state having been left and not
 * its work failing, so it is where to handle a failure without a `catch` that could take one.
 */
type Failed<R, H extends string, E extends AnyEvent, N extends Net> = (error: unknown, scope: EventScope<R, H, E, N>) => Next<R, H> | void

/**
 * What a state does while it is the case. Work that awaits can fail long after the state was entered, with nobody
 * around it, so a `run` that returns a promise has to say where the state goes then. A `run` that only sets things up
 * may leave `failed` out: what it throws is reported, and the state stays as it was entered.
 */
type Work<R, H extends string, E extends AnyEvent, N extends Net> =
  | { run?: (scope: Scope<R, H, E, N>) => Next<R, H> | void; failed?: Failed<R, H, E, N> }
  | { run: (scope: Scope<R, H, E, N>) => Promise<Next<R, H> | void>; failed: Failed<R, H, E, N> }

/** The definition of a state. The same keys at every depth, the outermost included. */
export type Def<R, S, H extends string, E extends AnyEvent, A extends Asks, N extends Net> = {
  /** The events it takes while it is the case. An event goes to the innermost state that takes it. */
  on?: On<R, H, E, N>
  /** The asks it answers while it is the case. An ask goes to the innermost state that answers it. */
  asks?: Answering<R, H, E, A, N>
} & Work<R, H, E, N> & ([keyof DataOf<S>] extends [never] ? { data?: never } : {
  /** Its own data: each field's starting value, or `given` for one whoever enters it has to give. */
  data: { [K in keyof DataOf<S>]-?: DataOf<S>[K] | Given }
}) & ([Names<S>] extends [never] ? { start?: never; states?: never } : {
  /** The state inside it that it is at when whoever enters it does not say. */
  start: { [K in Names<S>]: {} extends DataOf<StatesOf<S>[K]> ? K : never }[Names<S>]
  /** Every state inside it. */
  states: { [K in Names<S>]: Def<R, StatesOf<S>[K], Join<H, K>, E, A, N> }
})

export interface State<S extends Shape, E extends AnyEvent, A extends Asks> { readonly def: unknown; readonly _?: { s: S; e: E; a: A } }

/** `state`, for code that can reach `N` by name. In the app this is what a pack's generated facade would export. */
export function reaching<N extends Net = Nothing>() {
  return <S extends Shape, E extends AnyEvent = never, A extends Asks = {}>() =>
    (def: Def<S, S, '', E, A, N>): State<S, E, A> => ({ def })
}

// ── the system ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What an ask is ended with when whoever made it has gone: the state that asked was left, or the system stopped.
 * It is raised where the ask is awaited, as cancellation is everywhere else, so that `finally` runs and what was
 * held is released. The kernel discards it at the top of `run` and of an ask's handler; nothing has to catch it.
 */
export class Left extends Error {
  constructor(what: string) { super(`${what} was left before this ask was answered`); this.name = 'Left' }
}

class Refusal extends Error { constructor(readonly kind: string, message: string, readonly data?: object) { super(message) } }
class Question {
  settled = false
  constructor(private readonly settle: (outcome: AnyOutcome) => void) {}
  end(outcome: AnyOutcome): void { if (!this.settled) { this.settled = true; this.settle(outcome) } }
}
const refusal = (kind: string, message: string, data?: object): AnyOutcome => ({ ok: false, failure: { ...data, kind, message } })

type Plain = Record<string, unknown>
type LooseDef = { data?: Plain; start?: string; on?: Record<string, Function>; asks?: Record<string, Function>; run?: Function; failed?: Function; states?: Record<string, LooseDef> }
type Heard = (update: unknown) => void

interface Active {
  readonly top: Running
  readonly def: LooseDef
  readonly name: string
  readonly path: string
  readonly around: Active | undefined
  inside: Active | undefined
  readonly controller: AbortController
  readonly releases: Array<() => void>
  readonly questions: Set<Question>
  readonly started: string[]
  readonly watching: Map<string, () => void>
}
interface Running { ref: string; data: Plain; root: Active }

type Item =
  | { kind: 'event'; ref: string; event: AnyEvent }
  | { kind: 'ask'; ref: string; name: string; args: object; question: Question; heard?: Heard; gone?: AbortSignal }
  | { kind: 'result'; of: Active; value: unknown }
  | { kind: 'failure'; of: Active; error: unknown }
  | { kind: 'answer'; question: Question; outcome: AnyOutcome; change?: { of: Active; next: unknown } }
  | { kind: 'out'; leave: () => void }

/** What one system offers another over a link. */
interface Port {
  event(ref: string, event: AnyEvent): void
  /** Returns what to call when whoever asked has gone. */
  ask(ref: string, name: string, args: object, heard: Heard, settle: (outcome: AnyOutcome) => void): () => void
}
/**
 * Things that happen one after another: what crosses a link in one direction, or a system's frames. What is in one
 * lane keeps its order, as messages on one socket do. What is in two lanes can come in either order, and that is the
 * whole of what a schedule may choose.
 */
export interface Lane { readonly label: string }
/** A link between a window and its backend. What crosses it arrives later, and not at all once it is closed. */
interface Link { open: boolean; readonly up: Lane; readonly down: Lane }
const PORT = Symbol('port')

/**
 * What changed in one running state in one step: whether it is somewhere else now, and each place in its data that
 * changed, as a path. `['messages', 'THR-1', '3']` is the fourth message of one thread, and nothing else.
 */
export interface Changes { readonly moved: boolean; readonly paths: ReadonlyArray<ReadonlyArray<string>> }

export interface System {
  start<S extends Shape, E extends AnyEvent, A extends Asks>(ref: string, made: State<S, E, A>): Handle<Value<S>, E, A>
  send<E extends AnyEvent>(to: Handle<unknown, E, Asks>, event: E): void
  ask<A extends Asks, Q extends keyof A & string>(of: Handle<unknown, never, A>, name: Q, args: A[Q]['args'], heard?: (updates: ReadonlyArray<ProgressOf<A[Q]>>) => void): Promise<OutcomeOf<A[Q]>>
  read<V>(of: Handle<V, never, Asks>): V
  /** Every running state here, as of the last commit. */
  snapshot(): Record<string, unknown>
  /** Called once per step that changed anything, after it has committed. */
  subscribe(listener: (changed: readonly string[], fields: Readonly<Record<string, readonly string[]>>, changes: Readonly<Record<string, Changes>>) => void): void
  /** From a window: joins it to its backend. Closing the link is the window going away. */
  connect(backend: System): { close(): void }
  stop(): void
}

/** More than this handled in one step is states telling each other without end: the step is cut short and reported. */
const RUNAWAY = 10_000

/** A data field holding more items than this is reported: a collection that large belongs in a view. */
const LARGE = 10_000

export function system(host: {
  side: 'backend' | 'window'
  /** What this system is called in a lane's label and nowhere else. */
  name?: string
  views?: ViewHost
  /**
   * Runs something later, after whatever is ahead of it in its lane. The default is the next turn of the event loop.
   * A check gives a schedule here, which decides the order between lanes and can run every one of them.
   */
  later?(lane: Lane, run: () => void): void
  /** Runs something once per frame. A window gives `requestAnimationFrame`; the default is the next turn of the event loop. */
  frame?(run: () => void): void
  trace?(line: string): void
}): System {
  /** How many defects have been reported: what a change is checked against, to know whether it was made. */
  let defects = 0
  const trace = (line: string): void => { if (line.startsWith('DEFECT')) defects++; host.trace?.(line) }
  const called = host.name ?? host.side
  const later = host.later ?? ((_: Lane, run: () => void): void => { setImmediate(run) })
  const frames: Lane = { label: `${called}'s frame` }
  const frame = host.frame ?? ((run: () => void): void => later(frames, run))
  /** Code that is not the kernel's, called where its throwing must not stop the step it is in. */
  const safely = (what: string, call: () => void): void => {
    try { call() } catch (error) { trace(`DEFECT: ${what} threw: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const running = new Map<string, Running>()
  const outside: Item[] = []
  const inside: Item[] = []
  /** What leaves when the step commits: answers, progress, what crosses a link, and word to subscribers. */
  const leaving: Array<() => void> = []
  const changed = new Set<string>()
  /** For each running state that changed in this step, the fields of its data that did. */
  const fields = new Map<string, Set<string>>()
  const touch = (ref: string, field: string): void => { changed.add(ref); fields.set(ref, (fields.get(ref) ?? new Set()).add(field)) }
  /** The same, to the place: what a reader of one part of the data needs, to know whether it is the part that changed. */
  const places = new Map<string, { moved: boolean; paths: string[][] }>()
  const placesOf = (ref: string) => places.get(ref) ?? places.set(ref, { moved: false, paths: [] }).get(ref)!
  const touchAt = (ref: string, path: readonly string[]): void => { touch(ref, path[0]!); placesOf(ref).paths.push([...path]) }
  /** A move can add and remove fields as states are left and entered: each one that differs afterwards changed. */
  const moved = (top: Running, was: Plain): void => {
    changed.add(top.ref)
    placesOf(top.ref).moved = true
    for (const field of new Set([...Object.keys(was), ...Object.keys(top.data)])) {
      if (field in was !== field in top.data || !Object.is(was[field], top.data[field])) touchAt(top.ref, [field])
    }
  }
  const listeners: Array<(changed: readonly string[], fields: Readonly<Record<string, readonly string[]>>, changes: Readonly<Record<string, Changes>>) => void> = []
  let committed: Record<string, unknown> = {}
  let stepping = false

  /** A window's link to its backend, and the asks waiting on it. */
  let up: { link: Link; port: Port; waiting: Set<Question>; gone: Set<() => void> } | undefined
  /** A backend's links to its windows. */
  const down = new Set<{ link: Link; port: Port }>()
  const carry = (link: Link, way: 'up' | 'down', across: () => void): void => { later(link[way], () => { if (link.open) across() }) }

  const innermost = (top: Running): Active => { let active = top.root; while (active.inside) active = active.inside; return active }
  const valueOf = (top: Running): Plain => { const at = innermost(top).path; return at ? { at, data: { ...top.data } } : { data: { ...top.data } } }
  const refOf = (to: string | { ref: string }): string => (typeof to === 'string' ? to : to.ref)

  /** Something to leave at the commit: of this step, or of one of its own if none is running. */
  const out = (leave: () => void): void => { if (stepping) leaving.push(leave); else arrive({ kind: 'out', leave }) }

  /** A name is a backend system: here on the backend, across the link from a window. A handle is always here. */
  const isAcross = (to: string | { ref: string }): boolean => typeof to === 'string' && host.side === 'window'

  const tell = (to: string | { ref: string }, event: AnyEvent): void => {
    const ref = refOf(to)
    if (!isAcross(to)) { enqueue({ kind: 'event', ref, event }); return }
    const mine = up
    if (!mine) { trace(`nothing to tell ${ref}: not connected`); return }
    out(() => carry(mine.link, 'up', () => mine.port.event(ref, event)))
  }

  /**
   * Progress gathered for this system, in the order it arrived: each entry is one ask's updates that came in a row.
   *
   * One change per update is quadratic for a collection that grows, and nothing reads a state faster than a frame, so
   * progress is handed over once a frame, as a list. **It is the only thing that waits.** And it never waits behind
   * anything: whatever else arrives here hands over what was gathered first (`handOver`), so progress is merged only
   * with progress that came straight after it, and its order against every other message is the order it was sent in.
   */
  const gathered: Array<{ hears: (updates: unknown[]) => void; signal: AbortSignal | undefined; updates: unknown[] }> = []
  let due = false
  const handOver = (): void => {
    due = false
    for (const each of gathered.splice(0)) if (!each.signal?.aborted) safely('what hears progress', () => each.hears(each.updates))
  }
  const gather = (hears: (updates: unknown[]) => void, signal: AbortSignal | undefined) => (update: unknown): void => {
    const last = gathered[gathered.length - 1]
    if (last?.hears === hears) last.updates.push(update); else gathered.push({ hears, signal, updates: [update] })
    if (!due) { due = true; frame(handOver) }
  }

  const ask = (to: string | { ref: string }, name: string, args: object, signal: AbortSignal | undefined, hears: ((updates: unknown[]) => void) | undefined): Promise<never> => new Promise((resolve, reject) => {
    const ref = refOf(to)
    const heard = hears && gather(hears, signal)
    // What was gathered is handed over before the answer, so an answer is never ahead of progress sent before it.
    const question = new Question((outcome) => { handOver(); if (!signal?.aborted) (resolve as unknown as (outcome: AnyOutcome) => void)(outcome) })
    // Whoever asked has gone: the ask ends where it is awaited, with `Left`, so the code that asked unwinds.
    const left = (): void => { trace(`an ask of ${ref} for ${name} was left unanswered by whoever made it`); reject(new Left(name)) }
    if (signal?.aborted) { left(); return }
    signal?.addEventListener('abort', left, { once: true })
    // In the same system the asker's own signal tells the answerer; across a link, the port does.
    if (!isAcross(to)) { enqueue({ kind: 'ask', ref, name, args, question, heard, gone: signal }); return }
    const mine = up
    if (!mine) { question.end(refusal('disconnected', `Not connected, so ${ref} cannot be asked`)); return }
    mine.waiting.add(question)
    out(() => carry(mine.link, 'up', () => {
      // Whoever asked may have ended before the ask crossed the link: then it is never started.
      if (signal?.aborted) { mine.waiting.delete(question); return }
      const gone = mine.port.ask(ref, name, args,
        (update) => carry(mine.link, 'down', () => heard?.(update)),
        (outcome) => carry(mine.link, 'down', () => { mine.waiting.delete(question); mine.gone.delete(gone); question.end(outcome) }))
      mine.gone.add(gone)
      signal?.addEventListener('abort', gone, { once: true })
    }))
  })

  const scopeOf = (mine: Active, signal: AbortSignal = mine.controller.signal) => {
    const alive = (): boolean => !mine.controller.signal.aborted
    const ref = mine.top.ref
    return {
      get data() { return mine.top.data },
      get snapshot() { return valueOf(mine.top) },
      signal,
      send: (event: AnyEvent) => { if (alive()) enqueue({ kind: 'event', ref, event }) },
      tell: (to: string | { ref: string }, event: AnyEvent) => { if (alive()) tell(to, event) },
      ask: (to: string | { ref: string }, name: string, args: object, hears?: (updates: unknown[]) => void) => {
        const asked = ask(to, name, args, signal, hears)
        // An ask that was started and never awaited ends with `Left` like any other, and that is not a failure of the process.
        asked.catch(() => {})
        return asked
      },
      broadcast: (to: string, event: AnyEvent) => { if (alive()) out(() => { for (const window of down) carry(window.link, 'down', () => window.port.event(to, event)) }) },
      watch: (key: string, feature: string, view: string, args: object, heard: (update: ViewUpdate<unknown>) => void) => {
        if (!alive() || !host.views) return
        mine.watching.get(key)?.()
        mine.watching.set(key, host.views(feature, view, args, (update) => { if (alive()) safely('what hears a view', () => heard(update)) }))
      },
      unwatch: (key: string) => { mine.watching.get(key)?.(); mine.watching.delete(key) },
      read: (target: { ref: string }) => valueOf(running.get(target.ref)!),
      start: (name: string, made: { def: unknown }) => { mine.started.push(`${ref}/${name}`); return begin(`${ref}/${name}`, made.def as LooseDef) },
      child: (name: string) => ({ ref: `${ref}/${name}` }),
      use: (release: () => void) => { mine.releases.push(release) },
    }
  }

  const enter = (top: Running, def: LooseDef, name: string, around: Active | undefined, entering: Plain): Active => {
    const path = around?.path ? `${around.path}.${name}` : name
    const active: Active = { top, def, name, path, around, inside: undefined, controller: new AbortController(), releases: [], questions: new Set(), started: [], watching: new Map() }
    if (around) around.inside = active; else top.root = active
    for (const [field, initial] of Object.entries(def.data ?? {})) {
      if (field in entering) top.data = { ...top.data, [field]: entering[field] }
      else if (initial === given) trace(`DEFECT: ${top.ref} entered ${path} without ${field}`)
      else top.data = { ...top.data, [field]: initial }
    }
    if (path) trace(`${top.ref} entered ${path}`)
    let made: unknown
    // What `run` throws at once is a failure like any later one, taken up when the entering it is part of is done.
    try { made = def.run?.(scopeOf(active)) } catch (error) { inside.push({ kind: 'failure', of: active, error }); return active }
    if (made instanceof Promise) {
      made.then((value) => arrive({ kind: 'result', of: active, value }), (error) => arrive({ kind: 'failure', of: active, error }))
    } else if (made !== undefined) inside.push({ kind: 'result', of: active, value: made })
    return active
  }

  const exit = (active: Active): void => {
    if (active.inside) exit(active.inside)
    if (active.path) trace(`${active.top.ref} left ${active.path}`)
    active.controller.abort()
    for (const stop of active.watching.values()) stop()
    active.watching.clear()
    for (const ref of active.started.reverse()) end(ref)
    for (const question of active.questions) leaving.push(() => question.end(refusal('abandoned', 'It stopped before answering')))
    for (const release of active.releases.reverse()) safely(`a release of ${active.top.ref}`, release)
    const { ...rest } = active.top.data
    for (const field of Object.keys(active.def.data ?? {})) delete rest[field]
    active.top.data = rest
    if (active.around) active.around.inside = undefined
  }

  const descend = (under: Active, names: readonly string[], entering: Plain): void => {
    let active = under
    for (const name of names) active = enter(active.top, active.def.states?.[name] ?? {}, name, active, entering)
    while (active.def.start !== undefined) active = enter(active.top, active.def.states?.[active.def.start] ?? {}, active.def.start, active, entering)
  }

  /**
   * Goes to a path. The states on the way that are already the case are kept; everything else that was the case
   * ends, innermost first; the rest of the path is entered, outermost first. The target itself is entered afresh.
   */
  const go = (top: Running, at: string, entering: Plain): void => {
    const names = at.split('.')
    let kept = top.root
    let shared = 0
    while (shared < names.length - 1 && kept.inside?.name === names[shared]) { kept = kept.inside!; shared++ }
    if (kept.inside) exit(kept.inside)
    descend(kept, names.slice(shared), entering)
  }

  const begin = (ref: string, def: LooseDef): { ref: string } => {
    changed.add(ref)
    const top = { ref, data: {}, root: undefined as unknown as Active }
    running.set(ref, top)
    descend(enter(top, def, '', undefined, {}), [], {})
    return { ref }
  }

  const end = (ref: string): void => {
    const top = running.get(ref)
    if (!top) return
    exit(top.root)
    running.delete(ref)
    changed.add(ref)
  }

  const reported = new Set<string>()
  const large = (top: Running, field: string): void => {
    const held = top.data[field]
    if (!Array.isArray(held) || held.length <= LARGE || reported.has(`${top.ref}.${field}`)) return
    reported.add(`${top.ref}.${field}`)
    trace(`LARGE: ${top.ref} holds ${held.length} items in ${field}. A collection this size belongs in a view`)
  }

  const apply = (active: Active, next: unknown, mayRefuse = false): void => {
    if (next === undefined || next === null || active.controller.signal.aborted) return
    const { at, data = {} } = next as { at?: string; data?: Plain | ((draft: Plain) => void) }
    const top = active.top
    if (typeof data === 'function') {
      // Edits to a draft. A field can be edited, never added or removed: which fields exist is the states' to say.
      const before = top.data
      let made: ReturnType<typeof produce<Plain>>
      // An edit that is refused changes nothing, and the move it came with is not made either.
      try { made = produce(before, data) } catch (error) {
        // A change that came with an answer may refuse, with one of the refusals its ask declares.
        if (mayRefuse && error instanceof Refusal) throw error
        trace(`DEFECT: ${top.ref}: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const { value, touched } = made
      const kept = Object.fromEntries(Object.keys(before).map((field) => [field, field in value ? value[field] : before[field]]))
      // All of an edit or none of it: one place it may not change, and nothing is changed.
      const strays = touched.filter((path) => !(path[0]! in before && path[0]! in value))
      if (strays.length) { for (const path of strays) trace(`DEFECT: ${top.ref} has no field ${path[0]} to change`); return }
      for (const path of touched) touchAt(top.ref, path)
      top.data = touched.length ? kept : before
      for (const field of fields.get(top.ref) ?? []) large(top, field)
      if (at !== undefined) { const was = top.data; go(top, at, {}); moved(top, was) }
      return
    }
    // Data first, then the move: the work of a state that is entered reads the data as the handler left it.
    for (const [field, value] of Object.entries(data)) {
      if (!(field in top.data)) continue
      if (!Object.is(top.data[field], value)) touchAt(top.ref, [field])
      top.data = { ...top.data, [field]: value }
    }
    if (at !== undefined) { const was = top.data; go(top, at, data); moved(top, was) }
  }

  /**
   * A state's work failed. If the state is still the case it goes where its `failed` says, with the error. If it was
   * left first there is nowhere to go: a `Left` is that leaving and nothing more, and anything else is reported.
   */
  const fail = (active: Active, error: unknown): void => {
    if (error instanceof Left) return
    const where = `${active.top.ref}${active.path ? ` in ${active.path}` : ''}`
    const said = error instanceof Error ? error.message : String(error)
    if (active.controller.signal.aborted) { trace(`${where} failed after it was left: ${said}`); return }
    trace(`${where} failed: ${said}`)
    const failed = active.def.failed
    if (!failed) { trace(`DEFECT: ${where} says nowhere to go when its work fails, and stays as it is`); return }
    const { ask: _, ...scope } = scopeOf(active)
    safely(`${where}'s failed`, () => apply(active, failed(error, scope)))
  }

  /**
   * Makes the change an answer came with. The change is where to check what has to hold when it is made, since it is
   * made against the data as it is then: an edit that throws one of the ask's refusals answers with that refusal, and
   * nothing is changed. An answer whose change could not be made at all is not given either: the ask failed.
   */
  const withChange = (of: Active, next: unknown, outcome: AnyOutcome): AnyOutcome => {
    const before = defects
    try { apply(of, next, true) } catch (error) {
      if (error instanceof Refusal) return refusal(error.kind, error.message, error.data)
      throw error
    }
    return defects === before ? outcome : refusal('failed', 'The change that came with the answer was refused, so nothing was changed')
  }
  const isAnswered = (made: unknown): made is Answered<unknown, unknown> => typeof made === 'object' && made !== null && ANSWERED in made

  const taker = (top: Running, table: 'on' | 'asks', name: string): { handler: Function; of: Active } | undefined => {
    let of: Active | undefined = innermost(top)
    while (of && !of.def[table]?.[name]) of = of.around
    return of ? { handler: of.def[table]![name]!, of } : undefined
  }

  const handle = (item: Item): void => {
    if (item.kind === 'out') { leaving.push(item.leave); return }
    if (item.kind === 'result') { apply(item.of, item.value); return }
    if (item.kind === 'failure') { fail(item.of, item.error); return }
    if (item.kind === 'answer') {
      // An answer that came with a change: the change is made here, in the step the answer leaves in. If the state
      // that answered was left meanwhile, its ask was ended as abandoned when it was, and nothing is changed.
      const outcome = item.change && !item.change.of.controller.signal.aborted ? withChange(item.change.of, item.change.next, item.outcome) : item.outcome
      leaving.push(() => item.question.end(outcome))
      return
    }
    const top = running.get(item.ref)
    if (item.kind === 'event') {
      const found = top && taker(top, 'on', item.event.type)
      if (!found) { trace(`${item.ref} ignored ${item.event.type}`); return }
      const { ask: _, ...scope } = scopeOf(found.of)
      // A handler that throws changes nothing: the state is as it was before the event, which it could handle.
      try { apply(found.of, found.handler(item.event, scope)) } catch (error) {
        trace(`DEFECT: ${item.ref} threw handling ${item.event.type}, and nothing changed: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    const { name, args, question, heard, gone } = item
    const found = top && taker(top, 'asks', name)
    if (!found) { leaving.push(() => question.end(refusal('unavailable', `${item.ref} does not take ${name}`))); return }
    const failed = (error: unknown): AnyOutcome => {
      if (error instanceof Refusal) return refusal(error.kind, error.message, error.data)
      // The handler was itself asking, and whoever asked it went: it stopped answering, it did not fail.
      if (error instanceof Left) return refusal('abandoned', error.message)
      // Whoever asked is told it failed. Where it failed is said here, since the asker may be in another process.
      const message = error instanceof Error ? error.message : String(error)
      // Work that was passed `signal` throws when it aborts. That is the handler stopping as it was asked to.
      if (signal.aborted) { trace(`${item.ref} stopped answering ${name}, as whoever asked had gone: ${message}`); return refusal('abandoned', message) }
      trace(`${item.ref} failed answering ${name}: ${message}`)
      return refusal('failed', message)
    }
    const signal = gone ? AbortSignal.any([found.of.controller.signal, gone]) : found.of.controller.signal
    try {
      const made = found.handler(args, {
        ...scopeOf(found.of, signal),
        refuse: (kind: string, message: string, data?: object) => new Refusal(kind, message, data),
        progress: (update: unknown) => { if (!signal.aborted) out(() => heard?.(update)) },
      })
      if (made instanceof Promise) {
        found.of.questions.add(question)
        made.then(
          (value) => arrive(isAnswered(value) ? { kind: 'answer', question, outcome: { ok: true, value: value.answer }, change: { of: found.of, next: value.next } } : { kind: 'answer', question, outcome: { ok: true, value } }),
          (error) => arrive({ kind: 'answer', question, outcome: failed(error) }),
        )
      } else {
        const outcome: AnyOutcome = isAnswered(made) ? withChange(found.of, made.next, { ok: true, value: made.answer }) : { ok: true, value: made }
        leaving.push(() => question.end(outcome))
      }
    } catch (error) { leaving.push(() => question.end(failed(error))) }
  }

  const commit = (): void => {
    if (changed.size) {
      const refs = [...changed]
      changed.clear()
      committed = Object.fromEntries([...running].map(([ref, top]) => [ref, valueOf(top)]))
      const which = Object.fromEntries([...fields].map(([ref, touched]) => [ref, [...touched]]))
      fields.clear()
      const where = Object.fromEntries(places)
      places.clear()
      leaving.push(() => { for (const listener of listeners) safely('a subscriber', () => listener(refs, which, where)) })
    }
    for (const leave of leaving.splice(0)) safely('what leaves at the commit', leave)
  }

  /** One step: something from outside, then everything it caused inside, then the commit. */
  const step = (first: () => void): void => {
    stepping = true
    try {
      first()
      for (let handled = 0; inside.length; handled++) {
        const item = inside.shift()!
        if (handled < RUNAWAY) { handle(item); continue }
        // What it had done is committed, so that the states can be read and the report says where they got to.
        trace(`DEFECT: a step was cut short after ${RUNAWAY} things, at ${'ref' in item ? item.ref : item.kind}: something tells something else without end`)
        inside.length = 0
      }
      commit()
    } finally { stepping = false }
  }
  const pump = (): void => { while (!stepping && outside.length) step(() => handle(outside.shift()!)) }
  const arrive = (item: Item): void => { handOver(); outside.push(item); pump() }
  const enqueue = (item: Item): void => { if (stepping) inside.push(item); else arrive(item) }

  const port: Port = {
    event: (ref, event) => arrive({ kind: 'event', ref, event }),
    ask: (ref, name, args, heard, settle) => {
      const gone = new AbortController()
      arrive({ kind: 'ask', ref, name, args, question: new Question(settle), heard, gone: gone.signal })
      return () => gone.abort(new Error('Whoever asked has gone'))
    },
  }

  const self: System & { [PORT]: Port; [key: symbol]: unknown } = {
    [PORT]: port,
    start: (ref, made) => {
      let handleOf: { ref: string }
      if (stepping) handleOf = begin(ref, made.def as LooseDef)
      else { step(() => { handleOf = begin(ref, made.def as LooseDef) }); pump() }
      return handleOf!
    },
    send: (to, event) => arrive({ kind: 'event', ref: to.ref, event }),
    ask: (of, name, args, hears) => ask(of, name, args, undefined, hears as ((updates: unknown[]) => void) | undefined),
    read: (of) => committed[of.ref] as never,
    snapshot: () => committed,
    subscribe: (listener) => { listeners.push(listener) },
    connect: (backend) => {
      const link: Link = { open: true, up: { label: `${called} to its backend` }, down: { label: `the backend to ${called}` } }
      const theirs = backend as unknown as { [PORT]: Port; attach(window: { link: Link; port: Port }): () => void }
      const mine = { link, port: theirs[PORT], waiting: new Set<Question>(), gone: new Set<() => void>() }
      up = mine
      const detach = theirs.attach({ link, port })
      return {
        close: () => {
          link.open = false
          detach()
          // The backend learns that whoever asked has gone, and every ask still waiting here is told so.
          for (const gone of mine.gone) gone()
          for (const question of mine.waiting) arrive({ kind: 'answer', question, outcome: refusal('disconnected', 'The connection closed before the answer') })
          up = undefined
        },
      }
    },
    stop: () => step(() => { for (const ref of [...running.keys()].reverse()) end(ref) }),
  }
  ;(self as unknown as { attach(window: { link: Link; port: Port }): () => void }).attach = (window) => { down.add(window); return () => { down.delete(window) } }
  return self
}
