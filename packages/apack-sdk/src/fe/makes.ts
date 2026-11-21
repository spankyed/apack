// The asks a machine makes, declared once and made by name.
//
//   const made = makes(({ one, each }) => ({
//     push: one(fromAsk('code', 'commit.PUBLISH_BRANCH')),
//     stage: each(fromAsk('code', 'commit.STAGE_FILES')),
//   }))
//
//   setup({
//     types: {} as { context: { making: Making<typeof made> }; events: MyEvent | MadeEvent<typeof made> },
//     actors: made.actors,
//   }).createMachine({
//     context: { making: made.none() },
//     on: {
//       [made.done]: { actions: made.settle() },
//       'commit.PUSH_BRANCH': { actions: enqueueActions(({ enqueue }) => made.make(enqueue, 'push', {})) },
//       'commit.STAGE_FILES': { actions: enqueueActions(({ enqueue, event }) => made.make(enqueue, 'stage', event.path, { paths: [event.path] })) },
//       'made.push': { actions: ... },   // event.outcome: how it ended
//       'made.stage': { actions: ... },  // event.key: which one
//     },
//   })
//
// `one` is an ask of which one is under way at a time; `each` is one under way per key. Which are under way is
// `making`, in the machine's context: `making.push` is whether a push is, and `making.stage[path]` whether that path's
// is. A component reads it like any other field, and names no id.
//
// Making one that is already under way gives the one before up and makes it again; a machine that would sooner
// ignore the second reads `making` first. `drop` gives one up, which ends it where it is answered.
//
// How each ended reaches the machine as an event of its own, `made.<name>`, so a transition, a guard and a target
// are written for it as for any event. One transition takes the end of every ask made (`made.done`, `made.settle()`):
// it lets the ask go, clears it from `making`, and raises that event, so `making` already reads as ended in whatever
// handles it.
//
// That transition is written at the machine's root, and again in any state that has a `'*'` transition of its own: a
// state's wildcard is tried before its parent's transitions, so it would take an ask's end and the ask would stay
// under way for good. The `swallowed-ask-ends` pack rule refuses a wildcard written without it.
import { enqueueActions, type AnyActorLogic, type EventObject, type InputFrom, type MachineContext, type OutputFrom, type ParameterizedObject } from 'xstate'

/** An ask of which one is under way at a time */
export interface OneMade<TLogic extends AnyActorLogic> {
  /** That one is under way at a time */
  readonly kind: 'one'
  /** What the machine runs to make it: `fromAsk(…)` */
  readonly logic: TLogic
}
/** An ask of which one is under way per key */
export interface EachMade<TLogic extends AnyActorLogic> {
  /** That one is under way per key */
  readonly kind: 'each'
  /** What the machine runs to make it: `fromAsk(…)` */
  readonly logic: TLogic
}

type Declared = OneMade<AnyActorLogic> | EachMade<AnyActorLogic>
type Declarations = Readonly<Record<string, Declared>>
type LogicOf<D> = D extends { logic: infer TLogic extends AnyActorLogic } ? TLogic : never

type MakingFrom<M extends Declarations> = {
  readonly [N in keyof M]: M[N] extends EachMade<AnyActorLogic> ? Readonly<Record<string, true>> : boolean
}

type EndedOf<M extends Declarations> = {
  [N in keyof M & string]: M[N] extends EachMade<AnyActorLogic>
    ? { type: `made.${N}`; key: string; outcome: OutputFrom<LogicOf<M[N]>> }
    : { type: `made.${N}`; outcome: OutputFrom<LogicOf<M[N]>> }
}[keyof M & string]

/**
 * Which asks are under way, for the asks a surface's contract names with their kinds:
 * `making: MakingOf<{ export: 'one'; nodeDetails: 'each' }>`. A contract is a leaf and cannot name its machine, so
 * this is how it publishes the asks other code may read as under way. It names as many of the machine's asks as it
 * means to publish, and the machine's `makes` is held to the names and kinds it gives.
 */
export type MakingOf<Kinds extends Readonly<Record<string, 'one' | 'each'>>> = {
  readonly [N in keyof Kinds]: Kinds[N] extends 'each' ? Readonly<Record<string, true>> : boolean
}

/**
 * Which of a machine's declared asks are under way, as its context holds it: `Making<typeof made>`. A boolean for
 * `one`, the keys under way for `each`
 */
export type Making<TMakes> = TMakes extends Makes<infer M> ? MakingFrom<M> : never

/**
 * The events `makes` adds to a machine's own: `MadeEvent<typeof made>`. How each declared ask ended, `made.<name>`
 * with its key where it has one, and the end of the actor it ran as, which only `made.settle()` handles
 */
export type MadeEvent<TMakes> = TMakes extends Makes<infer M>
  ? EndedOf<M> | { type: `xstate.done.actor.made.${string}`; actorId: string; output: unknown }
  : never

/** What a machine's `enqueueActions` hands its body, as far as making and dropping use it */
export interface MakesEnqueue {
  /** XState's, which starts the ask */
  spawnChild: (...given: never[]) => unknown
  /** XState's, which gives the ask up */
  stopChild: (...given: never[]) => unknown
  /** XState's, which records the ask in `making` */
  assign: (...given: never[]) => unknown
}

type Recorded = Record<string, boolean | Record<string, true>>
interface Enqueue {
  spawnChild(src: string, options: { id: string; input: unknown }): void
  stopChild(id: string): void
  assign(assignment: (args: { context: { making?: Recorded } }) => { making: Recorded }): void
  raise(event: EventObject): void
}

const PREFIX = 'made.'
let fresh = 0

/** A key no other ask has, for one made beside others of its name with nothing of its own to be told apart by */
export const freshKey = (): string => `#${++fresh}`

/** The asks a machine declared with `makes`: what it makes them, lets them go and reads them with */
export interface Makes<M extends Declarations> {
  /** The declared asks as a machine's actors: `setup({ actors: made.actors })`, or spread beside its others */
  readonly actors: { readonly [N in keyof M & string as `made.${N}`]: LogicOf<M[N]> }
  /** `making` with nothing under way: what a machine's context starts with */
  none(): MakingFrom<M>
  /** The event that ends any ask made: the key of the one transition that settles them */
  readonly done: 'xstate.done.actor.made.*'
  /** The action of that transition: lets the ask go, clears it from `making`, and raises `made.<name>` */
  settle<TContext extends MachineContext, TExpressionEvent extends EventObject, TEvent extends EventObject>(): ReturnType<typeof enqueueActions<TContext, TExpressionEvent, ParameterizedObject['params'] | undefined, TEvent, never, never, never, never, never>>
  /** Makes an ask of which one is under way at a time, giving up the one before */
  make<N extends OneNames<M>>(enqueue: MakesEnqueue, name: N, input: InputFrom<LogicOf<M[N]>>): void
  /** Makes the ask of one key, giving up the one before under that key */
  make<N extends EachNames<M>>(enqueue: MakesEnqueue, name: N, key: string, input: InputFrom<LogicOf<M[N]>>): void
  /** Gives an ask up: the one of its name, or of an `each` the one under `key`, or with no key every one */
  drop(enqueue: MakesEnqueue, context: { making: MakingFrom<M> }, name: keyof M & string, key?: string): void
  /** Every declared name: what a machine that gives all its asks up goes through */
  readonly names: readonly (keyof M & string)[]
}

type OneNames<M extends Declarations> = { [N in keyof M & string]: M[N] extends OneMade<AnyActorLogic> ? N : never }[keyof M & string]
type EachNames<M extends Declarations> = { [N in keyof M & string]: M[N] extends EachMade<AnyActorLogic> ? N : never }[keyof M & string]

const helpers = {
  one: <TLogic extends AnyActorLogic>(logic: TLogic): OneMade<TLogic> => ({ kind: 'one', logic }),
  each: <TLogic extends AnyActorLogic>(logic: TLogic): EachMade<TLogic> => ({ kind: 'each', logic }),
}

const idOf = (name: string, key?: string): string => (key === undefined ? `${PREFIX}${name}` : `${PREFIX}${name}.${key}`)

const held = (context: { making?: Recorded }): Recorded => {
  if (!context.making) throw new Error("makes keeps which asks are under way in the machine's context: declare `making` there, starting as `made.none()`")
  return context.making
}

/** Declares the asks a machine makes. Names are plain words: a name holds no dot */
export function makes<const M extends Declarations>(declare: (the: typeof helpers) => M): Makes<M> {
  const declared = declare(helpers)
  const names = Object.keys(declared) as (keyof M & string)[]
  for (const name of names) if (name.includes('.')) throw new Error(`An ask is made under a plain name, and "${name}" holds a dot`)
  const kindOf = (name: string): Declared['kind'] => {
    const found = declared[name]
    if (!found) throw new Error(`No ask is declared as "${name}": makes declares ${names.join(', ')}`)
    return found.kind
  }

  const record = (enqueue: Enqueue, name: string, key: string | undefined, under: boolean): void => enqueue.assign(({ context }) => {
    const making = held(context)
    // What is as it was is left as the same object, so nothing that reads `making` runs again for it
    if (key === undefined) return { making: making[name] === under ? making : { ...making, [name]: under } }
    if (key in (making[name] as Record<string, true>) === under) return { making }
    const { [key]: _was, ...others } = making[name] as Record<string, true>
    return { making: { ...making, [name]: under ? { ...others, [key]: true } : others } }
  })

  const make = (given: MakesEnqueue, name: string, ...rest: unknown[]): void => {
    const enqueue = given as unknown as Enqueue
    const each = kindOf(name) === 'each'
    if (each && typeof rest[0] !== 'string') throw new Error(`"${name}" is made once per key: make(enqueue, '${name}', key, input)`)
    const key = each ? rest[0] as string : undefined
    const id = idOf(name, key)
    enqueue.stopChild(id)
    enqueue.spawnChild(`${PREFIX}${name}`, { id, input: each ? rest[1] : rest[0] })
    record(enqueue, name, key, true)
  }

  const drop = (given: MakesEnqueue, context: { making: Recorded }, name: string, key?: string): void => {
    const enqueue = given as unknown as Enqueue
    if (kindOf(name) === 'one') { enqueue.stopChild(idOf(name)); record(enqueue, name, undefined, false); return }
    for (const one of key === undefined ? Object.keys(context.making[name] as Record<string, true>) : [key]) {
      enqueue.stopChild(idOf(name, one))
      record(enqueue, name, one, false)
    }
  }

  const settle = () => (enqueueActions as unknown as (collect: (args: { enqueue: Enqueue; event: { actorId?: string; output?: unknown } }) => void) => unknown)(({ enqueue, event }) => {
    const id = event.actorId
    if (typeof id !== 'string' || !id.startsWith(PREFIX)) throw new Error('made.settle() is the action of the transition on made.done, and of no other')
    const rest = id.slice(PREFIX.length)
    const dot = rest.indexOf('.')
    const name = dot === -1 ? rest : rest.slice(0, dot)
    const key = dot === -1 ? undefined : rest.slice(dot + 1)
    enqueue.stopChild(id)
    record(enqueue, name, key, false)
    enqueue.raise({ type: `${PREFIX}${name}`, ...(key !== undefined && { key }), outcome: event.output } as EventObject)
  })

  return {
    actors: Object.fromEntries(names.map((name) => [`${PREFIX}${name}`, declared[name]!.logic])),
    none: () => Object.fromEntries(names.map((name) => [name, declared[name]!.kind === 'each' ? {} : false])),
    done: 'xstate.done.actor.made.*',
    settle,
    make,
    drop,
    names,
  } as unknown as Makes<M>
}
