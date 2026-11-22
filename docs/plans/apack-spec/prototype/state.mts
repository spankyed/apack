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
//   report(event)            from a state that was started, to the state that started it
//
//   make(name, key?)         from a state: has one of the asks it declares under `makes` made, once
//
// What a state starts, the views it follows and the asks it awaits are declared, each naming the fields of the data
// it depends on. Which of them are live follows from the data, and is looked at again only when one of those changes.
// Those are standing: while the data says so, they go on. An ask to make once is not, and is made by saying so.

import { produce } from './draft.mts'

export type AnyEvent = { readonly type: string }
/**
 * One ask. `refuses` names the ways it may be refused that an asker can act on: kinds alone
 * (`'not-found' | 'no-access'`), or each kind with the data its refusal carries
 * (`{ 'name-taken': { existingId: string } }`).
 */
export type AskShape = { args: object; answer: unknown; refuses?: string | Record<string, object>; progress?: unknown }
export type Asks = Record<string, AskShape>

/**
 * What a state is, declared as a type: its own data, the states inside it, and the states it starts. The same shape
 * all the way down.
 */
export type Shape = {
  data?: object
  states?: Record<string, Shape>
  starts?: Record<string, AnyState | Each<AnyState>>
  /** At the outermost state only: what it tells whichever state started it. */
  reports?: AnyEvent
  /**
   * At the outermost state only: the events it sends itself, and nothing else may send it. They are taken by its
   * `internal` handlers. What others may send it is the events it is declared with.
   */
  internal?: AnyEvent
  /** The asks it makes when told to, by name: `each` for one made for each of many keys, `one` for one at a time. */
  makes?: Record<string, 'each' | 'one'>
}

/** Any state, as something another can start. */
export type AnyState = State<any, any, any, any>
/** In a shape's `starts`: one of these for each key, where a bare state is the one. */
export interface Each<T> { readonly _each?: T }

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
type StartsOf<S> = S extends { starts: infer C extends object } ? C : {}
type StartsBelow<S, P> = P extends `${infer H}.${infer T}` ? StartsOf<Sub<S, H>> & StartsBelow<Sub<S, H>, T> : StartsOf<Sub<S, P>>
/** Everything started where a handler sits: by its own state and by every state around it. */
type MakesOf<S> = S extends { makes: infer M extends object } ? M : {}
type MakesBelow<S, P> = P extends `${infer H}.${infer T}` ? MakesOf<Sub<S, H>> & MakesBelow<Sub<S, H>, T> : MakesOf<Sub<S, P>>
/** The asks that can be made where a handler sits: its own state's and those of every state around it. */
type MakesAt<S, P extends string> = P extends '' ? MakesOf<S> : MakesOf<S> & MakesBelow<S, P>
/** Every ask a state makes, whichever of its states declares it: what is read from outside it. */
type AllMakes<S> = MakesOf<S> & ([Names<S>] extends [never] ? {} : UnionToIntersection<{ [K in Names<S>]: AllMakes<StatesOf<S>[K]> }[Names<S>]>)
/** Which of them are under way: by key, for one made for each of many, and whether, for one at a time. */
type MakingOf<M> = { readonly [K in keyof M]: M[K] extends 'each' ? Readonly<Record<string, true>> : boolean }
type StartsAt<S, P extends string> = P extends '' ? StartsOf<S> : StartsOf<S> & StartsBelow<S, P>
type ReportsOf<S> = S extends { reports: infer P extends AnyEvent } ? P : never
type InternalOf<S> = S extends { internal: infer P extends AnyEvent } ? P : never
/** A field that says which there are: by its keys, or by its items. */
type KeysField<D> = { [K in keyof D & string]: D[K] extends readonly string[] | Readonly<Record<string, unknown>> ? K : never }[keyof D & string]
type UnionToIntersection<U> = (U extends unknown ? (of: U) => void : never) extends (of: infer I) => void ? I : never
/** Everything a state starts, whichever of its states declares it: what can be reached from outside it. */
export type AllStarts<S> = StartsOf<S> & ([Names<S>] extends [never] ? {} : UnionToIntersection<{ [K in Names<S>]: AllStarts<StatesOf<S>[K]> }[Names<S>]>)
export type HandleOf<T> = T extends Each<infer X> ? HandleOf<X> : T extends State<infer S2, infer E2, infer A2, any> ? Started<Value<S2>, E2, A2, AllStarts<S2>> : never
type Join<H extends string, K extends string> = H extends '' ? K : `${H}.${K}`

type Paths<S> = [Names<S>] extends [never] ? never : { [K in Names<S>]: K | `${K}.${Paths<StatesOf<S>[K]>}` }[Names<S>]
type Leaves<S> = [Names<S>] extends [never] ? never : { [K in Names<S>]: [Names<StatesOf<S>[K]>] extends [never] ? K : `${K}.${Leaves<StatesOf<S>[K]>}` }[Names<S>]
type Below<S, P> = P extends `${infer H}.${infer T}` ? DataOf<Sub<S, H>> & Below<Sub<S, H>, T> : DataOf<Sub<S, P>>
type DataAt<S, P extends string> = P extends '' ? DataOf<S> : DataOf<S> & Below<S, P>

/**
 * A value as it is read. No field of it can be assigned, at any depth, and a field that is a list, a map or a set
 * cannot be changed in place. A list further in than a field is typed as it was declared.
 *
 * Each half goes as far as it costs nothing. A read-only object is taken wherever a writable one is expected, so
 * read-only fields at every depth ask nothing of a helper that takes the object. A read-only list is refused where a
 * writable one is expected, which is the one thing TypeScript holds a caller to: said of a field's own list it is
 * kept across a call, and said of every list inside an entity it would refuse the entity wherever its declared type
 * is asked for. What holds at every depth, whatever the types say, is that the value is frozen.
 */
/** What has nothing inside it to write. Asked first, so that a string marked as a kind of id, which is a string and an object at once, stays the string it is. */
type Whole = string | number | bigint | boolean | symbol | null | undefined
export type Read<T> =
  T extends Whole ? T
  : T extends (...given: never[]) => unknown ? T
  : T extends ReadonlyMap<infer Key, infer Held> ? ReadonlyMap<Key, Inside<Held>>
  : T extends ReadonlySet<infer Item> ? ReadonlySet<Item>
  : T extends object ? { readonly [K in keyof T]: ReadHeld<T[K]> }
  : T
/** What a field holds, as it is read: a list, a map or a set that cannot be changed in place, and an object whose fields cannot be assigned. */
type ReadHeld<T> =
  T extends Whole ? T
  : T extends (...given: never[]) => unknown ? T
  : T extends ReadonlyMap<infer Key, infer Held> ? ReadonlyMap<Key, Inside<Held>>
  : T extends ReadonlySet<infer Item> ? ReadonlySet<Item>
  : T extends object ? { readonly [K in keyof T]: Inside<T[K]> }
  : T
/**
 * What is further in than a field: an object's fields cannot be assigned, at any depth, and a list, a map or a set
 * is as it was declared. A read-only object is taken wherever a writable one is expected, so saying it costs no
 * caller anything. A read-only list is not, so one further in is left writable in its type, and frozen.
 */
type Inside<T> =
  T extends Whole ? T
  : T extends (...given: never[]) => unknown ? T
  : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? T
  : T extends readonly unknown[] ? { [K in keyof T]: Inside<T[K]> }
  : T extends object ? { readonly [K in keyof T]: Inside<T[K]> }
  : T
/** What a field may be given: its own type, or that read from somewhere it cannot be written. */
type Givable<D> = { [K in keyof D]: D[K] | Read<D[K]> }

/** A state as it is read: where it is, and the data there. */
export type Value<S> = ([Names<S>] extends [never]
  ? { readonly data: Read<DataOf<S>> }
  : { [L in Leaves<S>]: { readonly at: L; readonly data: Read<DataAt<S, L>> } }[Leaves<S>])
  // What it has been told to make and has not yet ended. The kernel keeps this, and nothing else writes it.
  & ([keyof AllMakes<S>] extends [never] ? {} : { readonly making: MakingOf<AllMakes<S>> })

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
type Change<D> = Partial<Givable<D>> | ((draft: D) => void)

/** What happens next, in the shape of the value: where to be, and what data changes. */
type Next<R, H extends string> =
  | { at?: never; data: Change<DataAt<R, H>> }
  | { [T in Paths<R>]: {} extends Gained<R, H, T> ? { at: T; data?: Partial<Givable<DataAt<R, T>>> | ((draft: DataAt<R, H>) => void) } : { at: T; data: Givable<Gained<R, H, T>> & Partial<Givable<DataAt<R, T>>> } }[Paths<R>]

/** A state this one started. Only its starter holds it: it can be told, asked and read, never written. */
export interface Handle<V, E extends AnyEvent, A extends Asks, C = {}> { readonly ref: string; readonly _?: { v: V; e: (event: E) => void; a: A; c: C } }
/**
 * A handle to a state that another started. It is a name, and the state it names runs only while its starter is the
 * case and its key is there: reading it gives nothing while it is not running.
 */
export interface Started<V, E extends AnyEvent, A extends Asks, C = {}> extends Handle<V, E, A, C> { readonly _started: true }

type SystemsOf<N extends Net> = keyof N['systems'] & string
type AskOf<N extends Net, K extends SystemsOf<N>, Q extends keyof N['systems'][K]['asks']> = N['systems'][K]['asks'][Q]

export interface Scope<R, H extends string, E extends AnyEvent, N extends Net> {
  /** The data that exists here: this state's own and that of every state around it. */
  readonly data: Read<DataAt<R, H>>
  /** The whole value, as it is now. */
  readonly snapshot: Value<R>
  /** Aborted when this state stops being the case. For an ask, also when whoever asked has gone. */
  readonly signal: AbortSignal

  /**
   * Tells this running state an event: one only it sends itself, which its `internal` handlers take, or one that
   * others may send it too.
   */
  send(event: Read<E | InternalOf<R>>): void

  /** Tells a backend system, or a state this one started, an event. Nobody waits. */
  tell<K extends SystemsOf<N>>(to: K, event: Read<N['systems'][K]['events']>): void
  tell<E2 extends AnyEvent>(to: Handle<unknown, E2, Asks>, event: Read<E2>): void
  /**
   * From a window: tells another surface in this window an event that surface says it takes. A surface and a
   * backend system can be called the same, so a surface is named as one. From the backend a surface is broadcast to.
   */
  tell<K extends keyof N['surfaces'] & string>(to: { readonly surface: K }, event: Read<N['surfaces'][K]['events']>): void

  /**
   * Asks a backend system, or a state this one started. `heard` is called with the progress made since it was last
   * called, as a list: however fast updates are produced, they arrive at most once a frame, so that a stream of
   * ten thousand is a few dozen changes and not ten thousand.
   */
  ask<K extends SystemsOf<N>, Q extends keyof N['systems'][K]['asks'] & string>(
    of: K, name: Q, args: Read<AskOf<N, K, Q>['args']>, heard?: (updates: ReadonlyArray<ProgressOf<AskOf<N, K, Q>>>) => void,
  ): Promise<OutcomeOf<AskOf<N, K, Q>>>
  ask<A2 extends Asks, Q extends keyof A2 & string>(
    of: Handle<unknown, never, A2>, name: Q, args: Read<A2[Q]['args']>, heard?: (updates: ReadonlyArray<ProgressOf<A2[Q]>>) => void,
  ): Promise<OutcomeOf<A2[Q]>>

  /** From the backend: tells that surface, in every window, an event. */
  broadcast<K extends keyof N['surfaces'] & string>(to: K, event: Read<N['surfaces'][K]['events']>): void

  /**
   * Tells the state that started this one something. It arrives there as an event, with `from` saying which state
   * told it: its key, where it is one of many. Only its starter hears, as only whoever asked hears an ask's progress.
   */
  report(event: Read<ReportsOf<R>>): void

  /**
   * Has an ask this state declares under `makes` made, once. It is made when the step commits, with the data as the
   * handler left it. One that is already under way, or under way for that key, is the same one and is not made
   * twice. How it ends goes to the handler it was declared with.
   */
  make<K extends keyof MakesAt<R, H> & string>(name: K, ...key: MakesAt<R, H>[K] extends 'each' ? [key: string] : []): void
  /** Gives one up: the one answering is told, and how it ended is not heard. */
  drop<K extends keyof MakesAt<R, H> & string>(name: K, ...key: MakesAt<R, H>[K] extends 'each' ? [key: string] : []): void

  /** A state this one started, as it is now. */
  read<V2>(of: Handle<V2, never, Asks>): V2
  /**
   * A state this one starts, by the name it is declared under, and by key where there is one for each. A handle is
   * a name: asking through one whose state is not running is answered `unavailable`.
   */
  child<K extends keyof StartsAt<R, H> & string>(name: K, ...key: StartsAt<R, H>[K] extends Each<any> ? [key: string] : []): HandleOf<StartsAt<R, H>[K]>
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
  progress(update: Read<ProgressOf<A>>): void
}

/** Events: synchronous. What a handler returns is what happens next. */
type On<R, H extends string, Taken extends AnyEvent, E extends AnyEvent, N extends Net> =
  { [T in Taken['type']]?: (event: Extract<Taken, { type: T }>, scope: EventScope<R, H, E, N>) => Next<R, H> | void }
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
    | Read<A[Q]['answer']> | Answered<Read<A[Q]['answer']>, Next<R, H>>
    | Promise<Read<A[Q]['answer']> | Answered<Read<A[Q]['answer']>, NextAfterAwait<R, H>>> }

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
  on?: On<R, H, E, E, N>
  /**
   * The events it sends itself, while it is the case. Nothing outside it reaches these: what is told, broadcast or
   * sent to it from outside is looked for in `on` alone.
   */
  internal?: On<R, H, InternalOf<R>, E, N>
  /** The asks it answers while it is the case. An ask goes to the innermost state that answers it. */
  asks?: Answering<R, H, E, A, N>
} & Work<R, H, E, N> & ([keyof DataOf<S>] extends [never] ? { data?: never } : {
  /** Its own data: each field's starting value, or `given` for one whoever enters it has to give. */
  data: { [K in keyof DataOf<S>]-?: DataOf<S>[K] | Given }
}) & ([keyof StartsOf<S>] extends [never] ? { starts?: never } : {
  /**
   * The states it starts. Each runs for exactly as long as this one is the case and, where there is one for each
   * key, for as long as its key is among the keys the data gives. Nothing starts or stops one by hand: change the
   * data, and what runs follows in the same step.
   */
  starts: (start: Start<DataAt<R, H>>) => { [K in keyof StartsOf<S>]: StartsOf<S>[K] extends Each<infer X> ? EachOf<DataAt<R, H>, X>
    : NeedsGiven<StartsOf<S>[K]> extends true ? OneOf<DataAt<R, H>, StartsOf<S>[K]> : StartsOf<S>[K] | OneOf<DataAt<R, H>, StartsOf<S>[K]> }
}) & {
  /**
   * The views it follows while it is the case. What each is asked for comes from the data, and what it delivers goes
   * to a handler, which returns what happens next as any handler does.
   */
  follows?: (follow: Follow<R, H, E, N>) => Record<string, Followed<R, H, E, N>>
  /**
   * The asks it is waiting on while it is the case: a read, asked again when a field it names changes, or one for
   * each key of a field, which is how several writes are under way at once. How each ended goes to a handler.
   */
  awaits?: (asking: Asking<R, H, E, N>) => Record<string, Awaiting<R, H, E, N>>
} & ([keyof MakesOf<S>] extends [never] ? { makes?: never } : {
  /**
   * The asks it makes when a handler says `make`. A read is awaited because the data says so, for as long as it
   * does. A write is not like that: it is made once, by saying so, and nothing in the data stands for it.
   */
  makes: (asking: { one: MakeOne<R, H, E, N>; each: MakeEach<R, H, E, N> }) => { [K in keyof MakesOf<S>]: MakesOf<S>[K] extends 'each' ? MadeEach<R, H, E, N> : MadeOne<R, H, E, N> }
}) & ([Names<S>] extends [never] ? { start?: never; states?: never } : {
  /** The state inside it that it is at when whoever enters it does not say. */
  start: { [K in Names<S>]: {} extends DataOf<StatesOf<S>[K]> ? K : never }[Names<S>]
  /** Every state inside it. */
  states: { [K in Names<S>]: Def<R, StatesOf<S>[K], Join<H, K>, E, A, N> }
})

/** A state, as something that can be started. `G` names the fields of its own data that whoever starts it has to give. */
export interface State<S extends Shape, E extends AnyEvent, A extends Asks, G extends string = never> { readonly def: unknown; readonly _?: { s: S; e: E; a: A; g: G } }
/** The fields a definition marks `given` in its own data. */
type GivenIn<D> = D extends { data: infer X } ? { [K in keyof X]: X[K] extends Given ? K : never }[keyof X] & string : never

/** What a started state has to be given: the fields of its own data that it marks `given`. */
type RootGiven<X> = X extends State<infer S2, any, any, infer G> ? Givable<Pick<DataOf<S2>, G & keyof DataOf<S2>>> : never
type NeedsGiven<X> = X extends State<any, any, any, infer G> ? ([G] extends [never] ? false : true) : false

/** One state for each key of a field, each given its data from its key and the starter's data. */
export interface EachOf<D, X> { readonly each: KeysField<D>; readonly state: X; readonly given: (key: string, data: Read<D>) => RootGiven<X> }
/** One state, given its data from the starter's data. */
export interface OneOf<D, X> { readonly state: X; readonly given: (data: Read<D>) => RootGiven<X> }

// ── one grammar for what a state starts, follows and awaits ─────────────────────────────────────────────────────────
//
//   starts:  (start)  => ({ thread: start(thread, { each: 'titles', given: (threadId) => ({ threadId }) }) }),
//   follows: (follow) => ({ detail: follow('threads', 'detail', { from: ['id'], args: ({ id }) => ({ id }), heard }) }),
//   awaits:  (asking) => ({ diff:   asking('code', 'GET_GIT_DIFF', { from: ['selected'], args: ({ selected }) => selected, ended }) }),
//
// Each says which fields of the data it depends on: `each`, a field with one of them for each of its keys, or
// `from`, the fields a single one reads. The kernel looks again only when one of those fields changes. There is
// nothing to work out and nothing to run to find out, so nothing can throw, and the graph can say what depends on
// what. Each is written as a function of the helper it is made with, which is what gives a handler inside it the
// types of the state it is declared in.

/**
 * Makes a state to start. With `each`, one for each key of that field, or each item where the field is a list: a
 * key that appears starts its state, one that goes stops it, and one that stays leaves it as it is. `given` says
 * what the state is given as it starts, once.
 */
export interface Start<D> {
  <X extends AnyState>(state: X, options: { each: KeysField<D>; given: (key: string, data: Read<D>) => RootGiven<X> }): EachOf<D, X>
  <X extends AnyState>(state: X, options: { given: (data: Read<D>) => RootGiven<X> }): OneOf<D, X>
}

/** What `args` is given: the key, for one of many, or the fields it named. */
type Given_<R, H extends string, K extends string, Many> = [Many] extends [string] ? string : Read<Pick<DataAt<R, H>, K & keyof DataAt<R, H>>>
/** What a handler of one of many is given beside its scope: which one it is. */
type Keyed<Many> = [Many] extends [string] ? { readonly key: string } : {}

/** A view a state follows, as `follow` makes it. */
export interface Followed<R, H extends string, E extends AnyEvent, N extends Net> {
  readonly feature: string; readonly view: string; readonly each?: string; readonly from?: readonly string[]
  readonly args: Function; readonly heard: Function
  readonly _?: { r: R; h: H; e: E; n: N }
}
/**
 * Makes a view to follow. With `from`, it is asked for what `args` makes of those fields, and followed again when
 * one of them changes. With `each`, one is followed for each key of that field. What it delivers goes to `heard`,
 * which returns what happens next as any handler does.
 */
export type Follow<R, H extends string, E extends AnyEvent, N extends Net> = <
  F extends keyof N['views'] & string, V extends keyof N['views'][F] & string,
  K extends keyof DataAt<R, H> & string = never, Many extends KeysField<DataAt<R, H>> | undefined = undefined,
>(feature: F, view: V, options: {
  /** The fields a single one reads. It is followed again when one of them changes. */
  from?: readonly K[]
  /** A field with one to follow for each of its keys, in place of `from`. */
  each?: Many
  args: (given: Given_<R, H, K, Many>) => N['views'][F][V]['args']
  heard: (update: ViewUpdate<N['views'][F][V]['result']>, scope: EventScope<R, H, E, N> & Keyed<Many>) => Next<R, H> | void
}) => Followed<R, H, E, N>

/** An ask to make once, one at a time, as `one` makes it. */
export interface MadeOne<R, H extends string, E extends AnyEvent, N extends Net> { readonly kind: 'one'; readonly of: string; readonly ask: string; readonly args: Function; readonly ended: Function; readonly heard?: Function; readonly _?: { r: R; h: H; e: E; n: N } }
/** An ask to make once for each of many keys, as `each` makes it. */
export interface MadeEach<R, H extends string, E extends AnyEvent, N extends Net> { readonly kind: 'each'; readonly of: string; readonly ask: string; readonly args: Function; readonly ended: Function; readonly heard?: Function; readonly _?: { r: R; h: H; e: E; n: N } }
/** Makes an ask to make one at a time. What it is asked for is worked out from the data when it is made. */
export type MakeOne<R, H extends string, E extends AnyEvent, N extends Net> = <S extends SystemsOf<N>, Q extends keyof N['systems'][S]['asks'] & string>(of: S, ask: Q, options: {
  args: (data: Read<DataAt<R, H>>) => AskOf<N, S, Q>['args']
  ended: (outcome: OutcomeOf<AskOf<N, S, Q>>, scope: EventScope<R, H, E, N>) => Next<R, H> | void
  heard?: (updates: ReadonlyArray<ProgressOf<AskOf<N, S, Q>>>, scope: EventScope<R, H, E, N>) => Next<R, H> | void
}) => MadeOne<R, H, E, N>
/** Makes an ask to make for each of many keys. What each is asked for is worked out from its key when it is made. */
export type MakeEach<R, H extends string, E extends AnyEvent, N extends Net> = <S extends SystemsOf<N>, Q extends keyof N['systems'][S]['asks'] & string>(of: S, ask: Q, options: {
  args: (key: string, data: Read<DataAt<R, H>>) => AskOf<N, S, Q>['args']
  ended: (outcome: OutcomeOf<AskOf<N, S, Q>>, scope: EventScope<R, H, E, N> & { readonly key: string }) => Next<R, H> | void
  heard?: (updates: ReadonlyArray<ProgressOf<AskOf<N, S, Q>>>, scope: EventScope<R, H, E, N> & { readonly key: string }) => Next<R, H> | void
}) => MadeEach<R, H, E, N>

/** An ask a state awaits, as `asking` makes it. */
export interface Awaiting<R, H extends string, E extends AnyEvent, N extends Net> {
  readonly of: string; readonly ask: string; readonly each?: string; readonly from?: readonly string[]
  readonly args: Function; readonly ended: Function; readonly heard?: Function
  readonly _?: { r: R; h: H; e: E; n: N }
}
/**
 * Makes an ask to wait on.
 *
 * It is a read: it is there because the data says so, for as long as it does. With `from`, it is asked for what
 * `args` makes of those fields, and asked again when one of them changes, the one before given up. Where `args`
 * gives nothing, nothing is asked. To have it asked again with nothing else changed, name a field that only counts,
 * and change it. With `each` there is one for each key of that field: a key that appears asks, and one that goes
 * gives its ask up.
 *
 * An ask to make once, a write, is not awaited: it is declared under `makes` and made with `make`.
 *
 * How it ended goes to `ended`, and what it says before that to `heard`, as a list at most once a frame. Each
 * returns what happens next as any handler does.
 */
export type Asking<R, H extends string, E extends AnyEvent, N extends Net> = <
  S extends SystemsOf<N>, Q extends keyof N['systems'][S]['asks'] & string,
  K extends keyof DataAt<R, H> & string = never, Many extends KeysField<DataAt<R, H>> | undefined = undefined,
>(of: S, ask: Q, options: {
  /** The fields a single one reads. It is asked again when one of them changes. */
  from?: readonly K[]
  /** A field with one ask for each of its keys, in place of `from`. */
  each?: Many
  args: (given: Given_<R, H, K, Many>) => AskOf<N, S, Q>['args'] | ([Many] extends [string] ? never : null | undefined | false)
  ended: (outcome: OutcomeOf<AskOf<N, S, Q>>, scope: EventScope<R, H, E, N> & Keyed<Many>) => Next<R, H> | void
  heard?: (updates: ReadonlyArray<ProgressOf<AskOf<N, S, Q>>>, scope: EventScope<R, H, E, N> & Keyed<Many>) => Next<R, H> | void
}) => Awaiting<R, H, E, N>

/** `state`, for code that can reach `N` by name. In the app this is what a pack's generated facade would export. */
export function reaching<N extends Net = Nothing>() {
  return <S extends Shape, E extends AnyEvent = never, A extends Asks = {}>() =>
    <D extends Def<S, S, '', E, A, N>>(def: D): State<S, E, A, GivenIn<D>> => ({ def })
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

/**
 * What the engine says of a write to something frozen: assigning a field, adding or removing one, and what a list's
 * `push`, `pop`, `sort` and the like come to. `kernel-check.mts` makes each kind of write and fails when one of them
 * is no longer said this way, which is what a change of engine would do.
 */
const WRITE_TO_FROZEN = /^Cannot (assign to read only property|add property|delete property|define property|redefine property)\b/
/** What is added to such an error, since what the engine says names neither the mistake nor what to do. */
export const WROTE_TO_WHAT_WAS_READ = 'That is what a write to data read from a state throws. Data is not written where it is read: it is changed by returning a change, `{ data: (d) => { … } }`, and `d` is what may be written to'
/**
 * An error as the kernel reports it. A write to what a state holds throws where it was tried, in a handler or in a
 * helper the handler passed the value to, and the engine's words for it are about a property and an object. So
 * they are followed by what happened and what to write, wherever the kernel reports what was thrown.
 */
export const said = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  return error instanceof TypeError && WRITE_TO_FROZEN.test(error.message) ? `${error.message}. ${WROTE_TO_WHAT_WAS_READ}` : error.message
}
class Refusal extends Error { constructor(readonly kind: string, message: string, readonly data?: object) { super(message) } }
class Question {
  settled = false
  constructor(private readonly settle: (outcome: AnyOutcome) => void) {}
  end(outcome: AnyOutcome): void { if (!this.settled) { this.settled = true; this.settle(outcome) } }
}
const refusal = (kind: string, message: string, data?: object): AnyOutcome => ({ ok: false, failure: { ...data, kind, message } })

type Plain = Record<string, unknown>
type LooseDef = { data?: Plain; start?: string; on?: Record<string, Function>; internal?: Record<string, Function>; asks?: Record<string, Function>; run?: Function; failed?: Function; states?: Record<string, LooseDef>; starts?: (start: Function) => Record<string, { def: unknown } | { state: { def: unknown }; given: Function; each?: string }>
  follows?: (follow: Function) => Record<string, { feature: string; view: string; each?: string; from?: readonly string[]; args: Function; heard: Function }>
  awaits?: (asking: Function) => Record<string, { of: string; ask: string; each?: string; from?: readonly string[]; args: Function; ended: Function; heard?: Function }>
  makes?: (asking: { one: Function; each: Function }) => Record<string, { kind: 'one' | 'each'; of: string; ask: string; args: Function; ended: Function; heard?: Function }>
}
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
  /** The states it has started, by where each runs. */
  readonly started: Set<string>
  /**
   * The views it follows, by name and key: what each was asked for, how to stop following it, and which views'
   * deliveries led to it being asked that.
   */
  readonly following: Map<string, Live>
  /** The asks it awaits, by name and key, in the same terms. */
  readonly awaiting: Map<string, Live>
  /** The asks it was told to make and that have not ended, by name and key. */
  readonly making: Map<string, Live>
}
/**
 * One view being followed or one ask awaited: the values of the fields it named when it was asked, how to stop it,
 * and which deliveries led to it being asked.
 */
interface Live { readonly seen: readonly unknown[]; readonly because: ReadonlySet<string>; stop: () => void }
interface Running {
  /** Every ask it can be told to make, whichever of its states declares it, and which kind each is. */
  makes: Map<string, 'one' | 'each'>
  ref: string; data: Plain; root: Active; starter?: { readonly ref: string; readonly from: string }
}

type Item =
  | { kind: 'event'; ref: string; event: AnyEvent; /** Sent by the state to itself. */ own?: true }
  | { kind: 'ask'; ref: string; name: string; args: object; question: Question; heard?: Heard; gone?: AbortSignal }
  | { kind: 'result'; of: Active; value: unknown }
  | { kind: 'failure'; of: Active; error: unknown }
  | { kind: 'view'; of: Active; name: string; id: string; key: string | undefined; update: ViewUpdate<unknown> }
  | { kind: 'ended'; made: boolean; of: Active; name: string; id: string; key: string | undefined; live: Live; outcome: AnyOutcome }
  | { kind: 'progressed'; made: boolean; of: Active; name: string; id: string; key: string | undefined; live: Live; updates: unknown[] }
  | { kind: 'make'; of: Active; name: string; key: string | undefined }
  | { kind: 'drop'; of: Active; name: string; key: string | undefined }
  | { kind: 'answer'; question: Question; outcome: AnyOutcome; change?: { of: Active; next: unknown } }
  | { kind: 'out'; leave: () => void }

/**
 * A database's `transact`, which is all the kernel knows of one: it runs a function as one unit, whose writes are kept
 * together when it returns and undone when it throws. One inside another joins it, and is undone alone when it throws.
 */
export type Transact = <T>(run: () => T) => T

/** What one system offers another over a link. */
interface Port {
  event(ref: string, event: AnyEvent): void
  /** Returns what to call when whoever asked has gone. */
  ask(ref: string, name: string, args: object, heard: Heard, settle: (outcome: AnyOutcome) => void): () => void
  /** Follows a view the other system runs. Returns what to call to stop following it. */
  view(feature: string, view: string, args: object, heard: (update: ViewUpdate<unknown>) => void): () => void
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
export interface Changes { readonly moved: boolean; /** Whether what it is making changed. */ readonly making: boolean }

export interface System {
  start<S extends Shape, E extends AnyEvent, A extends Asks>(ref: string, made: State<S, E, A>): Handle<Value<S>, E, A, AllStarts<S>>
  /**
   * A state that this one starts, by the name it is declared under, and by key where there is one for each. This is
   * how something outside a handler reaches one: a component reading one card of many.
   */
  child<C, K extends keyof C & string>(of: Handle<unknown, any, any, C>, name: K, ...key: C[K] extends Each<any> ? [key: string] : []): HandleOf<C[K]>
  send<E extends AnyEvent>(to: Handle<unknown, E, Asks>, event: Read<E>): void
  ask<A extends Asks, Q extends keyof A & string>(of: Handle<unknown, never, A>, name: Q, args: Read<A[Q]['args']>, heard?: (updates: ReadonlyArray<ProgressOf<A[Q]>>) => void): Promise<OutcomeOf<A[Q]>>
  read<V>(of: Started<V, never, Asks, any>): V | undefined
  read<V>(of: Handle<V, never, Asks>): V
  /** Every running state here, as of the last commit. */
  snapshot(): Record<string, unknown>
  /** Called once per step that changed anything, after it has committed, until what it returns is called. */
  subscribe(listener: (changed: readonly string[], fields: Readonly<Record<string, readonly string[]>>, changes: Readonly<Record<string, Changes>>) => void): () => void
  /** From a window: joins it to its backend. Closing the link is the window going away. */
  connect(backend: System): { close(): void }
  /**
   * Whether nothing is under way here: no work a state is doing, no ask being answered or waited on, nothing put off
   * and nothing gathered. For a check, to wait until what it did has come to rest and not for a count of turns.
   */
  idle(): boolean
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
   * The `transact` of the database this system's rows are kept in. With one, a step is a unit of it: a handler's rows,
   * the data it changed and what it sent are kept together, and a handler that changes nothing has written nothing.
   */
  transact?: Transact
  /**
   * On a backend that runs views for its windows: calls `then` once every view has been sent what was kept before
   * this call. With it, what a step sends a window leaves after the views that window follows have been sent the
   * step's rows, down the same link, so a window is never told of something its views do not show yet.
   */
  viewsSent?(then: () => void): void
  /**
   * Runs something later, after whatever is ahead of it in its lane. The default is the next turn of the event loop.
   * A check gives a schedule here, which decides the order between lanes and can run every one of them.
   */
  later?(lane: Lane, run: () => void): void
  /** Runs something once per frame. A window gives `requestAnimationFrame`; the default is the next turn of the event loop. */
  frame?(run: () => void): void
  trace?(line: string): void
  /**
   * How many steps it will take before it takes no more. For a check, so that a kernel that never comes to rest is
   * heard from. The app gives none: one thing leading to the next for as long as it runs is what an agent's loop is.
   */
  limit?: number
}): System {
  const trace = (line: string): void => { host.trace?.(line) }
  const called = host.name ?? host.side
  /** How many things are under way: work, asks, and what was put off. Nothing is, when this is nought. */
  let pending = 0
  /** Counts a promise as under way until it settles, and whatever its settling does is done. */
  const under = <T,>(made: Promise<T>, done: (value: T) => void, failed: (error: unknown) => void): void => {
    pending++
    made.then((value) => { try { done(value) } finally { pending-- } }, (error) => { try { failed(error) } finally { pending-- } })
  }
  const putOff = host.later ?? ((_: Lane, run: () => void): void => { setImmediate(run) })
  const later = (lane: Lane, run: () => void): void => { pending++; putOff(lane, () => { pending--; run() }) }
  const frames: Lane = { label: `${called}'s frame` }
  const frame = host.frame ?? ((run: () => void): void => later(frames, run))
  /** Code that is not the kernel's, called where its throwing must not stop the step it is in. */
  const safely = (what: string, call: () => void): void => {
    try { call() } catch (error) { trace(`DEFECT: ${what} threw: ${said(error)}`) }
  }
  const running = new Map<string, Running>()
  const outside: Item[] = []
  const inside: Item[] = []
  /** What leaves when the step commits: answers, progress, what crosses a link, and word to subscribers. */
  const leaving: Array<(() => void) & { lost?: () => void }> = []
  /** Thrown inside a unit to have what it wrote undone, and caught around it. */
  const UNDONE = Symbol('undone')
  /**
   * Whether what was handled was made. Everything that takes something says which, as what it returns, so that a path
   * which forgets to does not compile: what was not made has its rows undone, and what was has them kept.
   */
  const MADE = true
  const NOT_MADE = false
  /** Set when a step's rows could not be kept. The states are ahead of the rows then, and no more steps are taken. */
  let broken = false
  /**
   * What is waiting to go to windows, in the order it was sent, until the views have been sent what its step kept.
   * One list for every window: what a backend sends them keeps its order across them too.
   */
  const toWindows: Array<() => void> = []
  /** How many of those have been asked after: what was sent since is still to be. */
  let askedAfter = 0
  /** Sends something to a window: now, or once the views it follows have been sent the rows of the step it leaves in. */
  const toAWindow = (send: () => void): void => { if (host.viewsSent) toWindows.push(send); else send() }
  /** After a step has left: has what it sent windows go once the views have caught up with it. */
  const release = (): void => {
    const wait = host.viewsSent
    if (!wait || toWindows.length === askedAfter) return
    const count = toWindows.length - askedAfter
    askedAfter = toWindows.length
    pending++
    wait(() => {
      pending--
      askedAfter -= count
      // What was sent before this was asked, and so before everything kept by then was sent to the views.
      for (const send of toWindows.splice(0, count)) safely('what is sent to a window', send)
    })
  }
  /** An answer leaves when the step's rows are kept. If they cannot be, whoever asked is told that it failed. */
  const answer = (question: Question, outcome: AnyOutcome): void => {
    leaving.push(Object.assign(() => question.end(outcome), { lost: () => question.end(refusal('failed', 'What this step wrote could not be kept, so nothing was changed')) }))
  }
  const changed = new Set<string>()
  /** For each running state that changed in this step, the fields of its data that did. */
  const fields = new Map<string, Set<string>>()
  /**
   * The running states that changed since what they start and follow was last matched to their data, and which of
   * their fields did: all of them, where a state moved or has only begun.
   */
  const stale = new Map<string, Set<string> | 'all'>()
  const mark = (ref: string, field?: string): void => {
    changed.add(ref)
    const now = stale.get(ref)
    if (field === undefined) stale.set(ref, 'all'); else if (now !== 'all') stale.set(ref, (now ?? new Set<string>()).add(field))
  }
  const touch = (ref: string, field: string): void => { mark(ref, field); fields.set(ref, (fields.get(ref) ?? new Set()).add(field)) }
  /** Whether each moved, and whether what it is making changed, in this step. */
  const places = new Map<string, { moved: boolean; making: boolean }>()
  const placesOf = (ref: string) => places.get(ref) ?? places.set(ref, { moved: false, making: false }).get(ref)!
  /** What a state is making changed. That is not its data, so nothing it starts, follows or awaits is looked at again. */
  const madeChanged = (top: Running): void => { changed.add(top.ref); placesOf(top.ref).making = true }
  /** A move can add and remove fields as states are left and entered: each one that differs afterwards changed. */
  const moved = (top: Running, was: Plain): void => {
    mark(top.ref)
    placesOf(top.ref).moved = true
    for (const field of new Set([...Object.keys(was), ...Object.keys(top.data)])) {
      if (field in was !== field in top.data || !Object.is(was[field], top.data[field])) touch(top.ref, field)
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

  /**
   * What a state holds is a value: once it is the state's, nothing changes it but a handler, which makes another.
   * So it is frozen, all the way down, and a write to it throws on the line that tried. A component is handed these
   * very objects, and so is whatever a handler passes on. Freezing stops at what is frozen already, which is all of
   * what a step did not change, and leaves alone what is not plain data: a class instance, a component, a map.
   */
  const frozen = <T,>(value: T): T => {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
    Object.freeze(value)
    for (const inner of Array.isArray(value) ? value : Object.values(value)) frozen(inner)
    return value
  }

  const innermost = (top: Running): Active => { let active = top.root; while (active.inside) active = active.inside; return active }
  const valueOf = (top: Running): Plain => {
    const at = innermost(top).path
    const value: Plain = at ? { at, data: frozen({ ...top.data }) } : { data: frozen({ ...top.data }) }
    if (!top.makes.size) return Object.freeze(value)
    // Which of the asks it can be told to make are under way, in the states that are the case.
    const making: Plain = Object.fromEntries([...top.makes].map(([name, kind]) => [name, kind === 'each' ? {} : false]))
    for (let active: Active | undefined = top.root; active; active = active.inside) {
      for (const id of active.making.keys()) {
        const cut = id.indexOf('/')
        if (cut < 0) making[id] = true; else (making[id.slice(0, cut)] as Plain)[id.slice(cut + 1)] = true
      }
    }
    return Object.freeze({ ...value, making: frozen(making) })
  }
  const refOf = (to: string | { ref: string }): string => (typeof to === 'string' ? to : to.ref)
  const isSurface = (to: unknown): to is { surface: string } => typeof to === 'object' && to !== null && 'surface' in to

  /** Something to leave at the commit: of this step, or of one of its own if none is running. */
  const out = (leave: () => void): void => { if (stepping) leaving.push(leave); else arrive({ kind: 'out', leave }) }

  /** A name is a backend system: here on the backend, across the link from a window. A handle is always here. */
  const isAcross = (to: string | { ref: string }): boolean => typeof to === 'string' && host.side === 'window'

  const tell = (to: string | { ref: string } | { surface: string }, event: AnyEvent): void => {
    if (isSurface(to)) {
      // A surface is in a window, and is told there. The backend has one of it in every window, and broadcasts.
      if (host.side !== 'window') { trace(`DEFECT: ${called} told the surface ${to.surface} ${event.type}. A surface is told from its own window, and broadcast to from the backend`); return }
      enqueue({ kind: 'event', ref: to.surface, event })
      return
    }
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

  /** An ask is under way from when it is made until it ends, however it ends. */
  const asked = <T,>(made: Promise<T>): Promise<T> => { under(made, () => {}, () => {}); return made }
  const ask = (to: string | { ref: string }, name: string, args: object, signal: AbortSignal | undefined, hears: ((updates: unknown[]) => void) | undefined): Promise<never> => asked(new Promise((resolve, reject) => {
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
  }))

  const scopeOf = (mine: Active, signal: AbortSignal = mine.controller.signal) => {
    const alive = (): boolean => !mine.controller.signal.aborted
    const ref = mine.top.ref
    return {
      get data() { return mine.top.data },
      get snapshot() { return valueOf(mine.top) },
      signal,
      send: (event: AnyEvent) => { if (alive()) enqueue({ kind: 'event', ref, event, own: true }) },
      tell: (to: string | { ref: string } | { surface: string }, event: AnyEvent) => { if (alive()) tell(to, event) },
      ask: (to: string | { ref: string }, name: string, args: object, hears?: (updates: unknown[]) => void) => {
        const asked = ask(to, name, args, signal, hears)
        // An ask that was started and never awaited ends with `Left` like any other, and that is not a failure of the process.
        asked.catch(() => {})
        return asked
      },
      broadcast: (to: string, event: AnyEvent) => { if (alive()) out(() => toAWindow(() => { for (const window of down) carry(window.link, 'down', () => window.port.event(to, event)) })) },
      make: (name: string, key?: string) => { if (alive()) enqueue({ kind: 'make', of: mine, name, key }) },
      drop: (name: string, key?: string) => { if (alive()) enqueue({ kind: 'drop', of: mine, name, key }) },
      report: (event: AnyEvent) => {
        if (!alive()) return
        const starter = mine.top.starter
        if (!starter) { trace(`${ref} was started by nothing, so it has nobody to report ${event.type} to`); return }
        enqueue({ kind: 'event', ref: starter.ref, event: { ...event, from: starter.from } as AnyEvent })
      },
      read: (target: { ref: string }) => valueOf(running.get(target.ref)!),
      child: (name: string, key?: string) => ({ ref: key === undefined ? `${ref}/${name}` : `${ref}/${name}/${key}` }),
      use: (release: () => void) => { mine.releases.push(release) },
    }
  }

  const enter = (top: Running, def: LooseDef, name: string, around: Active | undefined, entering: Plain): Active => {
    const path = around?.path ? `${around.path}.${name}` : name
    const active: Active = { top, def, name, path, around, inside: undefined, controller: new AbortController(), releases: [], questions: new Set(), started: new Set(), following: new Map(), awaiting: new Map(), making: new Map() }
    if (around) around.inside = active; else top.root = active
    for (const [field, initial] of Object.entries(def.data ?? {})) {
      if (field in entering) top.data = { ...top.data, [field]: entering[field] }
      else if (initial === given) trace(`DEFECT: ${top.ref} entered ${path} without ${field}`)
      else top.data = { ...top.data, [field]: initial }
    }
    if (path) trace(`${top.ref} entered ${path}`)
    let made: unknown
    // What `run` throws at once is a failure like any later one, taken up when the entering it is part of is done.
    // And what it wrote before it threw is taken back: work that fails at once has done nothing.
    const begin = (): void => { made = def.run?.(scopeOf(active)) }
    try { if (host.transact) host.transact(begin); else begin() } catch (error) { inside.push({ kind: 'failure', of: active, error }); return active }
    if (made instanceof Promise) {
      under(made, (value) => arrive({ kind: 'result', of: active, value }), (error) => arrive({ kind: 'failure', of: active, error }))
    } else if (made !== undefined) inside.push({ kind: 'result', of: active, value: made })
    return active
  }

  const exit = (active: Active): void => {
    if (active.inside) exit(active.inside)
    if (active.path) trace(`${active.top.ref} left ${active.path}`)
    active.controller.abort()
    for (const live of [...active.following.values(), ...active.awaiting.values()]) live.stop()
    active.following.clear()
    active.awaiting.clear()
    if (active.making.size) { for (const live of active.making.values()) live.stop(); active.making.clear(); madeChanged(active.top) }
    for (const ref of [...active.started].reverse()) end(ref)
    active.started.clear()
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

  /** What a definition declares, read from it once: each is a function of the helper its entries are made with. */
  const declared = new WeakMap<LooseDef, { starts: ReturnType<NonNullable<LooseDef['starts']>>; follows: ReturnType<NonNullable<LooseDef['follows']>>; awaits: ReturnType<NonNullable<LooseDef['awaits']>>; makes: ReturnType<NonNullable<LooseDef['makes']>> }>()
  const declaredBy = (def: LooseDef) => {
    let found = declared.get(def)
    if (!found) {
      found = {
        starts: def.starts?.((state: unknown, options: { each?: string; given: Function }) => ({ each: options.each, state, given: options.given })) ?? {},
        follows: def.follows?.((feature: string, view: string, options: object) => ({ feature, view, ...options })) ?? {},
        awaits: def.awaits?.((of: string, ask: string, options: object) => ({ of, ask, ...options })) ?? {},
        makes: def.makes?.({
          one: (of: string, ask: string, options: object) => ({ kind: 'one', of, ask, ...options }),
          each: (of: string, ask: string, options: object) => ({ kind: 'each', of, ask, ...options }),
        }) ?? {},
      }
      declared.set(def, found)
    }
    return found
  }
  const keysOf = (held: unknown): string[] => [...new Set(Array.isArray(held) ? held as string[] : Object.keys((held ?? {}) as object))]
  /** Where an error was thrown, outside the kernel and the draft: the line of the handler that did it. */
  const whereOf = (error: unknown): string => {
    const frames = error instanceof Error && error.stack ? error.stack.split('\n').slice(1) : []
    const frame = frames.find((line) => !/[/\\](state|draft)\.mts/.test(line) && /\.[cm]?[jt]s/.test(line))
    const found = frame?.match(/([^/\\(\s]+\.[cm]?[jt]s):(\d+)/)
    return found ? ` (${found[1]}:${found[2]})` : ''
  }
  /**
   * The view whose delivery this step began with, and the views whose deliveries led to it being asked what it is.
   * Everything in the step follows from that delivery. Whatever it leads to being asked is asked because of it, and
   * it may not lead back to itself or to any of those: what views ask for may not depend on each other in a circle.
   */
  let hearing: { readonly id: string; readonly because: ReadonlySet<string> } | undefined

  /**
   * Makes what a running state has started, and the views it follows, match what it declares and the data it holds
   * now. This is all that ever starts or stops either. `touched` is which of its fields changed since last time:
   * what there is one of for each key of a field is looked at again only if that field did.
   */
  const match = (top: Running, touched: Set<string> | 'all'): void => {
    const looks = (field: string): boolean => touched === 'all' || touched.has(field)
    for (let active: Active | undefined = top.root; active; active = active.inside) {
      const at = active
      for (const [name, declared] of Object.entries(declaredBy(at.def).starts)) {
        const under = `${top.ref}/${name}`
        const start = (ref: string, def: unknown, from: string, given: () => Plain): void => {
          let entering: Plain
          try { entering = given() } catch (error) { trace(`DEFECT: ${top.ref} could not say what to give ${ref}: ${said(error)}`); return }
          at.started.add(ref)
          begin(ref, def as LooseDef, entering, { ref: top.ref, from })
        }
        if ('def' in declared) { if (!at.started.has(under)) start(under, declared.def, name, () => ({})); continue }
        if (declared.each === undefined) { if (!at.started.has(under)) start(under, declared.state.def, name, () => declared.given(top.data) as Plain); continue }
        if (!looks(declared.each)) continue
        trace(`${top.ref} looked at ${declared.each} for which ${name} to run`)
        const wanted = new Map<string, string>()
        for (const key of keysOf(top.data[declared.each])) {
          if (key.includes('/')) trace(`DEFECT: ${top.ref} has a ${name} under ${JSON.stringify(key)}, and a key cannot hold a slash`); else wanted.set(`${under}/${key}`, key)
        }
        for (const ref of [...at.started]) if (ref.startsWith(`${under}/`) && !wanted.has(ref)) { at.started.delete(ref); end(ref) }
        for (const [ref, key] of wanted) if (!at.started.has(ref)) start(ref, declared.state.def, key, () => declared.given(key, top.data) as Plain)
      }

      /**
       * One of what this state follows or awaits, as it should be now. `seen` is the values of the fields it named:
       * the data is never changed in place, so a field that changed is a different value, and comparing the two
       * says whether to ask again without working anything out.
       */
      const settle = (live: Map<string, Live>, id: string, seen: readonly unknown[], begin: (entry: Live) => (() => void) | undefined, nothing = false): void => {
        const now = live.get(id)
        if (now && now.seen.length === seen.length && now.seen.every((value, index) => Object.is(value, seen[index]))) return
        // There is nothing to ask for now: what was asked is given up, and nothing can come round.
        if (nothing) { now?.stop(); live.set(id, { seen, because: new Set(), stop: () => {} }); return }
        const here = `${top.ref}#${id}`
        // A circle would be asked again, deliver again, and never come to rest, each round a read. It is refused
        // where it closes: this one goes on as it was.
        if (now && hearing && (hearing.id === here || hearing.because.has(here))) {
          trace(hearing.id === here
            ? `DEFECT: what ${here} delivered changed a field it is itself asked from. It goes on as it was`
            : `DEFECT: what ${hearing.id} delivered changed a field ${here} is asked from, and ${here} is what led to ${hearing.id} being asked. ${here} goes on as it was`)
          return
        }
        now?.stop()
        live.delete(id)
        const because: ReadonlySet<string> = hearing ? new Set([...hearing.because, hearing.id]) : new Set()
        // In place before it begins, so that whatever it delivers can be told from what an earlier one did.
        const entry: Live = { seen, because, stop: () => {} }
        live.set(id, entry)
        const stop = begin(entry)
        if (stop) entry.stop = stop; else live.delete(id)
      }
      const picked = (from: readonly string[]): Plain => Object.fromEntries(from.map((field) => [field, top.data[field]]))
      /** For one declared with `each`: the keys there are now, with what went stopped. Nothing if the field did not change. */
      const keysNow = (live: Map<string, Live>, name: string, field: string, what: string): string[] | undefined => {
        if (!looks(field)) return undefined
        trace(`${top.ref} looked at ${field} for which ${name} to ${what}`)
        const keys = keysOf(top.data[field])
        const wanted = new Set(keys.map((key) => `${name}/${key}`))
        for (const [id, entry] of [...live]) if (id.startsWith(`${name}/`) && !wanted.has(id)) { entry.stop(); live.delete(id) }
        return keys
      }

      // A window with no views of its own follows its backend's, over the link: what a view delivers comes down it
      // in order with everything else the backend sends.
      const linked = up
      const views: ViewHost | undefined = host.views ?? (linked && ((feature, view, args, heard) => {
        let stop: (() => void) | undefined
        let stopped = false
        out(() => carry(linked.link, 'up', () => {
          if (stopped) return
          stop = linked.port.view(feature, view, args, (update) => carry(linked.link, 'down', () => { if (!stopped) heard(update) }))
          linked.gone.add(stop)
        }))
        return () => {
          stopped = true
          const ended = stop
          if (ended) { linked.gone.delete(ended); out(() => carry(linked.link, 'up', ended)) }
        }
      }))
      if (views) for (const [name, declared] of Object.entries(declaredBy(at.def).follows)) {
        const followed = (id: string, key: string | undefined, seen: readonly unknown[], args: () => unknown): void => settle(at.following, id, seen, (live) => {
          let asked: object
          try { asked = args() as object } catch (error) { trace(`DEFECT: ${top.ref} could not say what to ask ${id} for: ${said(error)}`); return undefined }
          return views(declared.feature, declared.view, asked, (update) => {
            if (!at.controller.signal.aborted && at.following.get(id) === live) arrive({ kind: 'view', of: at, name, id, key, update })
          })
        })
        if (declared.each !== undefined) {
          for (const key of keysNow(at.following, name, declared.each, 'follow') ?? []) followed(`${name}/${key}`, key, [key], () => declared.args(key))
        } else {
          const from = declared.from ?? []
          if (!from.some(looks) && at.following.has(name)) continue
          followed(name, undefined, from.map((field) => top.data[field]), () => declared.args(picked(from)))
        }
      }

      for (const [name, declared] of Object.entries(declaredBy(at.def).awaits)) {
        const awaited = (id: string, key: string | undefined, seen: readonly unknown[], args: () => unknown): void => {
          let asked: object | null | undefined | false
          try { asked = args() as object | null | undefined | false } catch (error) { trace(`DEFECT: ${top.ref} could not say what to ask ${id} for: ${said(error)}`); return }
          const what = asked
          // Nothing to ask for is nothing asked, and it is still looked at again when its fields change.
          settle(at.awaiting, id, seen, (live) => {
          if (!what) return () => {}
          const given = new AbortController()
          const signal = AbortSignal.any([at.controller.signal, given.signal])
          const mine = (): boolean => at.awaiting.get(id) === live && !signal.aborted
          const hears = declared.heard && ((updates: unknown[]): void => { if (mine()) arrive({ kind: 'progressed', made: false, of: at, name, id, key, live, updates }) })
          const made = ask(declared.of, declared.ask, what, signal, hears) as unknown as Promise<AnyOutcome>
          // Given up, it ends with `Left`, which is that and nothing to hear of.
          made.then((outcome) => { if (mine()) arrive({ kind: 'ended', made: false, of: at, name, id, key, live, outcome }) }, () => {})
          return () => given.abort()
          }, !what)
        }
        if (declared.each !== undefined) {
          for (const key of keysNow(at.awaiting, name, declared.each, 'await') ?? []) awaited(`${name}/${key}`, key, [key], () => declared.args(key))
        } else {
          const from = declared.from ?? []
          if (!from.some(looks) && at.awaiting.has(name)) continue
          awaited(name, undefined, from.map((field) => top.data[field]), () => declared.args(picked(from)))
        }
      }
    }
  }
  /** Matches every state that changed, and whatever that starts, until nothing is left to match. */
  const matchStale = (): void => {
    while (stale.size) for (const [ref, touched] of [...stale]) { stale.delete(ref); const top = running.get(ref); if (top) match(top, touched) }
  }

  /**
   * Why a move cannot be made, if it cannot: worked out from the definition before anything is left or entered, so
   * that a move that is refused has done nothing. It follows `go`: the states on the way that are the case are kept,
   * the rest of the path is entered, and then whatever each of those starts at.
   */
  const cannotGo = (top: Running, at: string, entering: Plain): string | undefined => {
    const names = at.split('.')
    let def = top.root.def
    let kept: Active | undefined = top.root
    const after = new Set(Object.keys(def.data ?? {}))
    const enters = (inner: LooseDef, path: string): string | undefined => {
      for (const [field, initial] of Object.entries(inner.data ?? {})) {
        after.add(field)
        if (initial === given && !(field in entering)) return `cannot enter ${path} without ${field}`
      }
      return undefined
    }
    for (const [index, name] of names.entries()) {
      const inner = def.states?.[name]
      const path = names.slice(0, index + 1).join('.')
      if (!inner) return `has no state ${path} to go to`
      // A state on the way that is already the case is kept, with its data. The last is entered afresh.
      kept = index < names.length - 1 && kept?.inside?.name === name ? kept.inside : undefined
      if (kept) for (const field of Object.keys(inner.data ?? {})) after.add(field)
      else { const problem = enters(inner, path); if (problem) return problem }
      def = inner
    }
    for (let path = at; def.start !== undefined; ) {
      path = `${path}.${def.start}`
      def = def.states?.[def.start] ?? {}
      const problem = enters(def, path)
      if (problem) return problem
    }
    const stray = Object.keys(entering).find((field) => !after.has(field))
    return stray === undefined ? undefined : `will have no field ${stray} at ${at}`
  }

  const begin = (ref: string, def: LooseDef, entering: Plain = {}, starter?: Running['starter']): { ref: string } => {
    mark(ref)
    const makes = new Map<string, 'one' | 'each'>()
    const survey = (of: LooseDef): void => {
      for (const [name, made] of Object.entries(declaredBy(of).makes)) makes.set(name, made.kind)
      for (const inner of Object.values(of.states ?? {})) survey(inner)
    }
    survey(def)
    const top: Running = { ref, data: {}, root: undefined as unknown as Active, starter, makes }
    running.set(ref, top)
    descend(enter(top, def, '', undefined, entering), [], {})
    top.data = frozen(top.data)
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

  /** Makes a change, and freezes what the state holds afterwards, however the change went. */
  const apply = (active: Active, next: unknown, mayRefuse = false): boolean => {
    try { return change(active, next, mayRefuse) } finally { active.top.data = frozen(active.top.data) }
  }
  const change = (active: Active, next: unknown, mayRefuse: boolean): boolean => {
    if (next === undefined || next === null || active.controller.signal.aborted) return MADE
    const { at, data = {} } = next as { at?: string; data?: Plain | ((draft: Plain) => void) }
    const top = active.top
    if (typeof data === 'function') {
      // Edits to a draft. A field can be edited, never added or removed: which fields exist is the states' to say.
      const before = top.data
      let made: ReturnType<typeof produce<Plain>>
      // An edit that is refused changes nothing, and the move it came with is not made either.
      // A move is looked at before the edit is made: one that cannot be made takes its edit with it.
      const cannot = at === undefined ? undefined : cannotGo(top, at, {})
      if (cannot) { trace(`DEFECT: ${top.ref} ${cannot}`); return NOT_MADE }
      // Which fields there are is the states' to say, so the edit may change them and neither add nor remove one.
      // The write that tries throws there and then, and an edit that throws has changed nothing.
      try { made = produce(before, data, { fixed: true }) } catch (error) {
        // A change that came with an answer may refuse, with one of the refusals its ask declares.
        if (mayRefuse && error instanceof Refusal) throw error
        trace(`DEFECT: ${top.ref}: ${said(error)}${whereOf(error)}`)
        return NOT_MADE
      }
      const { value, touched } = made
      for (const path of touched) touch(top.ref, path[0]!)
      top.data = touched.length ? value : before
      for (const field of fields.get(top.ref) ?? []) large(top, field)
      if (at !== undefined) { const was = top.data; go(top, at, {}); moved(top, was) }
      return MADE
    }
    // The same rule for fields as for an edit: every one of them has to be a field there will be, or none is taken.
    // Without a move those are the fields there are. With one, they are the fields of the states the move leaves it in.
    const cannot = at === undefined
      ? Object.keys(data).filter((field) => !(field in top.data)).map((field) => `has no field ${field} to change`)[0]
      : cannotGo(top, at, data)
    if (cannot) { trace(`DEFECT: ${top.ref} ${cannot}`); return NOT_MADE }
    // Data first, then the move: the work of a state that is entered reads the data as the handler left it.
    for (const [field, value] of Object.entries(data)) {
      if (!(field in top.data)) continue
      if (!Object.is(top.data[field], value)) touch(top.ref, field)
      top.data = { ...top.data, [field]: value }
    }
    if (at !== undefined) { const was = top.data; go(top, at, data); moved(top, was) }
    return MADE
  }

  /**
   * A state's work failed. If the state is still the case it goes where its `failed` says, with the error. If it was
   * left first there is nowhere to go: a `Left` is that leaving and nothing more, and anything else is reported.
   */
  const fail = (active: Active, error: unknown): boolean => {
    if (error instanceof Left) return MADE
    const where = `${active.top.ref}${active.path ? ` in ${active.path}` : ''}`
    if (active.controller.signal.aborted) { trace(`${where} failed after it was left: ${said(error)}`); return MADE }
    trace(`${where} failed: ${said(error)}`)
    const failed = active.def.failed
    if (!failed) { trace(`DEFECT: ${where} says nowhere to go when its work fails, and stays as it is`); return MADE }
    const { ask: _, ...scope } = scopeOf(active)
    try { return apply(active, failed(error, scope)) } catch (thrown) { trace(`DEFECT: ${where}'s failed threw: ${said(thrown)}`); return NOT_MADE }
  }

  /**
   * Makes the change an answer came with. The change is where to check what has to hold when it is made, since it is
   * made against the data as it is then: an edit that throws one of the ask's refusals answers with that refusal, and
   * nothing is changed. An answer whose change could not be made at all is not given either: the ask failed.
   */
  const withChange = (of: Active, next: unknown, outcome: AnyOutcome): AnyOutcome => {
    let made: boolean
    try { made = apply(of, next, true) } catch (error) {
      if (error instanceof Refusal) return refusal(error.kind, error.message, error.data)
      throw error
    }
    return made ? outcome : refusal('failed', 'The change that came with the answer was refused, so nothing was changed')
  }
  const isAnswered = (made: unknown): made is Answered<unknown, unknown> => typeof made === 'object' && made !== null && ANSWERED in made

  const taker = (top: Running, table: 'on' | 'internal' | 'asks', name: string): { handler: Function; of: Active } | undefined => {
    let of: Active | undefined = innermost(top)
    while (of && !of.def[table]?.[name]) of = of.around
    return of ? { handler: of.def[table]![name]!, of } : undefined
  }

  /**
   * Takes one thing, whole. What a handler wrote is kept only if what it did is: one that threw, refused, or returned
   * a change that could not be made has its rows taken back, and the rows of everything else in the step stay.
   */
  const handle = (item: Item): void => {
    const within = host.transact
    if (!within) { take(item); return }
    try { within(() => { if (!take(item)) throw UNDONE }) } catch (error) { if (error !== UNDONE) throw error }
  }
  const take = (item: Item): boolean => {
    if (item.kind === 'out') { leaving.push(item.leave); return MADE }
    if (item.kind === 'result') return apply(item.of, item.value)
    if (item.kind === 'failure') return fail(item.of, item.error)
    if (item.kind === 'view') {
      const followed = declaredBy(item.of.def).follows[item.name]
      if (!followed || item.of.controller.signal.aborted) return MADE
      const { ask: _, ...scope } = scopeOf(item.of)
      hearing = { id: `${item.of.top.ref}#${item.id}`, because: item.of.following.get(item.id)?.because ?? new Set() }
      try { return apply(item.of, followed.heard(item.update, item.key === undefined ? scope : { ...scope, key: item.key })) } catch (error) {
        trace(`DEFECT: ${item.of.top.ref} threw hearing ${item.id}, and nothing changed: ${said(error)}`)
        return NOT_MADE
      }
    }
    if (item.kind === 'make' || item.kind === 'drop') {
      const { name, key } = item
      // It is made by the state that declares it, which is the one it stops with: here, or a state around here.
      let of: Active | undefined = item.of
      while (of && !(name in declaredBy(of.def).makes)) of = of.around
      if (!of || of.controller.signal.aborted) return MADE
      const at = of
      const top = at.top
      const id = key === undefined ? name : `${name}/${key}`
      const now = at.making.get(id)
      if (item.kind === 'drop') {
        if (!now) return MADE
        now.stop()
        at.making.delete(id)
        madeChanged(top)
        return MADE
      }
      // One that is under way is the same one: a second push while one is being made is that push.
      if (now) return MADE
      const declared = declaredBy(at.def).makes[name]!
      let asked: object
      try { asked = (key === undefined ? declared.args(top.data) : declared.args(key, top.data)) as object } catch (error) {
        trace(`DEFECT: ${top.ref} could not say what to ask ${id} for: ${said(error)}`)
        return NOT_MADE
      }
      const given = new AbortController()
      const signal = AbortSignal.any([at.controller.signal, given.signal])
      const live: Live = { seen: [], because: new Set(), stop: () => given.abort() }
      const mine = (): boolean => at.making.get(id) === live && !signal.aborted
      at.making.set(id, live)
      madeChanged(top)
      const hears = declared.heard && ((updates: unknown[]): void => { if (mine()) arrive({ kind: 'progressed', made: true, of: at, name, id, key, live, updates }) })
      const made = ask(declared.of, declared.ask, asked, signal, hears) as unknown as Promise<AnyOutcome>
      // Given up, it ends with `Left`, which is that and nothing to hear of.
      made.then((outcome) => { if (mine()) arrive({ kind: 'ended', made: true, of: at, name, id, key, live, outcome }) }, () => {})
      return MADE
    }
    if (item.kind === 'ended' || item.kind === 'progressed') {
      const table = item.made ? declaredBy(item.of.def).makes : declaredBy(item.of.def).awaits
      const live = item.made ? item.of.making : item.of.awaiting
      const declared = table[item.name]
      if (!declared || item.of.controller.signal.aborted || live.get(item.id) !== item.live) return MADE
      const top = item.of.top
      const { ask: _, ...scope } = scopeOf(item.of)
      const given = item.key === undefined ? scope : { ...scope, key: item.key }
      // What a read delivers may not lead round to itself. An ask that was made once has nothing to come round to.
      hearing = item.made ? undefined : { id: `${top.ref}#${item.id}`, because: item.live.because }
      if (item.kind === 'progressed') {
        try { return apply(item.of, declared.heard!(item.updates, given)) } catch (error) { trace(`DEFECT: ${top.ref} threw hearing ${item.id}, and nothing changed: ${said(error)}`); return NOT_MADE }
      }
      // One that was made has ended, so it is no longer under way. That is the kernel's to say, and it is said before
      // the handler, which may have it made again.
      if (item.made) { live.delete(item.id); madeChanged(top) }
      // A read that has ended stays as what was asked, so that it is not asked again until its fields change. There
      // is nothing left of it to give up: stopping it later tells nobody.
      else item.live.stop = () => {}
      try { return apply(item.of, declared.ended(item.outcome, given)) } catch (error) { trace(`DEFECT: ${top.ref} threw taking how ${item.id} ended, and nothing changed: ${said(error)}`); return NOT_MADE }
    }
    if (item.kind === 'answer') {
      // An answer that came with a change: the change is made here, in the step the answer leaves in. If the state
      // that answered was left meanwhile, its ask was ended as abandoned when it was, and nothing is changed.
      const outcome = item.change && !item.change.of.controller.signal.aborted ? withChange(item.change.of, item.change.next, item.outcome) : item.outcome
      answer(item.question, outcome)
      // An ask that is refused has changed nothing, whichever of its handler and its change refused.
      return outcome.ok
    }
    const top = running.get(item.ref)
    // Sent to a state that is not running. It may be one this step is about to start, so it waits until what runs
    // has been matched to the data.
    if (!top && !settling) { held.push(item); return MADE }
    if (item.kind === 'event') {
      // What a state sends itself is looked for among what only it sends, and then among what anyone may. What
      // comes from outside is looked for among what anyone may send, and nowhere else.
      const found = top && ((item.own ? taker(top, 'internal', item.event.type) : undefined) ?? taker(top, 'on', item.event.type))
      if (!found) {
        trace(top && !item.own && taker(top, 'internal', item.event.type)
          ? `${item.ref} was sent ${item.event.type} from outside, which only it sends itself: ignored`
          : `${item.ref} ignored ${item.event.type}`)
        return MADE
      }
      const { ask: _, ...scope } = scopeOf(found.of)
      // A handler that throws changes nothing: the state is as it was before the event, which it could handle.
      try { return apply(found.of, found.handler(item.event, scope)) } catch (error) {
        trace(`DEFECT: ${item.ref} threw handling ${item.event.type}, and nothing changed: ${said(error)}`)
        return NOT_MADE
      }
    }
    const { name, args, question, heard, gone } = item
    const found = top && taker(top, 'asks', name)
    if (!found) { answer(question, refusal('unavailable', `${item.ref} does not take ${name}`)); return MADE }
    const failed = (error: unknown): AnyOutcome => {
      if (error instanceof Refusal) return refusal(error.kind, error.message, error.data)
      // The handler was itself asking, and whoever asked it went: it stopped answering, it did not fail.
      if (error instanceof Left) return refusal('abandoned', error.message)
      // Whoever asked is told it failed. Where it failed is said here, since the asker may be in another process.
      const message = said(error)
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
        under(made,
          (value) => arrive(isAnswered(value) ? { kind: 'answer', question, outcome: { ok: true, value: value.answer }, change: { of: found.of, next: value.next } } : { kind: 'answer', question, outcome: { ok: true, value } }),
          (error) => arrive({ kind: 'answer', question, outcome: failed(error) }),
        )
        // What it wrote before it waited is kept: it answers in a later step, and this one is made.
        return MADE
      } else {
        const outcome: AnyOutcome = isAnswered(made) ? withChange(found.of, made.next, { ok: true, value: made.answer }) : { ok: true, value: made }
        answer(question, outcome)
        return outcome.ok
      }
    } catch (error) { answer(question, failed(error)); return NOT_MADE }
  }

  /**
   * Answers every ask among what was waiting to be taken, and lets the rest go: for a system that takes no more
   * steps, so that nobody is left waiting on one.
   */
  const turnAway = (waiting: Item[], why: string): void => {
    for (const item of waiting.splice(0)) if (item.kind === 'ask') safely('answering an ask that will not be taken', () => item.question.end(refusal('unavailable', why)))
  }
  const STOPPED = 'It stopped when it could not keep what a step wrote'
  /**
   * A step's rows could not be kept. Nothing has left yet, so nobody was told of a change that was not made. The
   * states are ahead of the rows now, and the system stops, all of it: an ask in the step is told it failed, one
   * that was waiting to be taken is told there is nothing to take it, and every state ends, which ends the work it
   * was doing and the asks it was answering. Nothing is left that somebody could be waiting on.
   */
  const lost = (error: unknown): void => {
    broken = true
    trace(`DEFECT: ${called} could not keep what a step wrote, and has stopped: its states were ahead of its rows. ${said(error)}`)
    changed.clear(); fields.clear(); places.clear()
    // Whoever asked in this step is told it failed. Nothing else the step would have sent leaves.
    for (const leave of leaving.splice(0)) if (leave.lost) safely('what leaves at the commit', leave.lost)
    turnAway(inside, STOPPED); turnAway(outside, STOPPED); turnAway(held, STOPPED)
    for (const ref of [...running.keys()].reverse()) end(ref)
    const refs = [...changed]
    changed.clear(); fields.clear(); places.clear()
    committed = {}
    for (const leave of leaving.splice(0)) safely('what leaves as it stops', leave)
    release()
    for (const listener of listeners) safely('a subscriber', () => listener(refs, {}, {}))
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
    release()
  }

  /** One step: something from outside, then everything it caused inside, then the commit. */
  let steps = 0
  let spent = false
  const step = (first: () => void): void => {
    if (host.limit !== undefined && ++steps > host.limit) {
      if (!spent) { spent = true; trace(`DEFECT: ${called} took ${host.limit} steps and takes no more: something leads to something else without end`) }
      // Nothing more is taken: an ask that was waiting to be is answered, or it would wait for good.
      turnAway(inside, 'It has taken every step it is allowed'); turnAway(outside, 'It has taken every step it is allowed')
      return
    }
    if (broken) { turnAway(inside, STOPPED); turnAway(outside, STOPPED); return }
    stepping = true
    // Whether everything was handled. A throw before that is the kernel's own; one after is the database not keeping it.
    let handled = false
    const all = (): void => {
      first()
      let count = 0
      for (;;) {
        for (; inside.length; count++) {
          const item = inside.shift()!
          if (count < RUNAWAY) { handle(item); continue }
          // What it had done is committed, so that the states can be read and the report says where they got to.
          trace(`DEFECT: a step was cut short after ${RUNAWAY} things, at ${'ref' in item ? item.ref : item.kind}: something tells something else without end`)
          inside.length = 0
          held.length = 0
        }
        // What runs is matched to the data once everything sent so far is handled, and not in between. So which
        // states run depends on the data the step leaves and not on the way it got there: a key taken out and put
        // back is a key that stayed, whether one handler did both or two did one each.
        matchStale()
        const ready = held.filter((item) => running.has(item.ref))
        if (!ready.length && !inside.length) break
        for (const item of ready) { held.splice(held.indexOf(item), 1); inside.push(item) }
      }
      // What is still waiting was sent to nothing that runs.
      settling = true
      try { for (const item of held.splice(0)) handle(item) } finally { settling = false }
      handled = true
    }
    try {
      // The step is one unit: its rows are kept as `transact` returns, and only then does anything leave.
      try { if (host.transact) host.transact(all); else all() } catch (error) {
        if (!handled) throw error
        lost(error)
        return
      }
      commit()
    } finally { stepping = false; hearing = undefined }
  }
  /** What was sent in this step to a state that is not running, until the step's match says whether it is to be. */
  const held: Array<Extract<Item, { ref: string }>> = []
  let settling = false
  const pump = (): void => { while (!stepping && outside.length) step(() => handle(outside.shift()!)) }
  const arrive = (item: Item): void => { handOver(); outside.push(item); pump() }
  const enqueue = (item: Item): void => { if (stepping) inside.push(item); else arrive(item) }

  const port: Port = {
    event: (ref, event) => arrive({ kind: 'event', ref, event }),
    ask: (ref, name, args, heard, settle) => {
      const gone = new AbortController()
      // Whoever asks through the port is across a link: what they hear and how it ends go to a window.
      arrive({ kind: 'ask', ref, name, args, question: new Question((outcome) => toAWindow(() => settle(outcome))), heard: (update) => toAWindow(() => heard(update)), gone: gone.signal })
      return () => gone.abort(new Error('Whoever asked has gone'))
    },
    view: (feature, view, args, heard) => {
      if (!host.views) { heard({ ok: false, error: `${called} runs no views` }); return () => {} }
      return host.views(feature, view, args, heard)
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
    child: ((of: { ref: string }, name: string, key?: string) => ({ ref: key === undefined ? `${of.ref}/${name}` : `${of.ref}/${name}/${key}` })) as unknown as System['child'],
    send: (to, event) => arrive({ kind: 'event', ref: to.ref, event }),
    ask: (of, name, args, hears) => ask(of, name, args, undefined, hears as ((updates: unknown[]) => void) | undefined),
    read: (of) => committed[of.ref] as never,
    snapshot: () => committed,
    subscribe: (listener) => {
      listeners.push(listener)
      return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
    },
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
    idle: () => pending === 0 && !due && !stepping && outside.length === 0,
    stop: () => step(() => { for (const ref of [...running.keys()].reverse()) end(ref) }),
  }
  ;(self as unknown as { attach(window: { link: Link; port: Port }): () => void }).attach = (window) => { down.add(window); return () => { down.delete(window) } }
  return self
}
