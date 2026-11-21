// The prototype's types and kernel: states that reach each other by name, across a backend and its windows.
//
// A state's value is where it is and the data there:  { at: 'thread.sending', data: { … } }
//
// States run in a system. A backend system and each window's system are separate, joined by a link. Within a
// system, one message from outside and everything it causes is one step, and nothing leaves until the step commits.
//
//   tell(name, event)        to a backend system: nobody waits
//   ask(name, ask, args)     of a backend system: exactly one answer, refusal or failure comes back
//   progress(update)         from the handler of an ask, to whoever asked, before it answers
//   broadcast(name, event)   from the backend to that surface in every window

export type AnyEvent = { readonly type: string }
export type AskShape = { args: object; answer: unknown; refuses?: string; progress?: unknown }
export type Asks = Record<string, AskShape>

/** What a state is, declared as a type: its own data, and the states inside it. The same shape all the way down. */
export type Shape = { data?: object; states?: Record<string, Shape> }

/** What some code can reach by name: the backend's systems, and the surfaces a window runs. */
export type Net = { systems: Record<string, { events: AnyEvent; asks: Asks }>; surfaces: Record<string, { events: AnyEvent }> }
type Nothing = { systems: {}; surfaces: {} }

export type AskEnd =
  | 'failed'        // the handler threw
  | 'abandoned'     // whatever was answering ended first
  | 'unavailable'   // nothing takes this ask where it was sent
  | 'disconnected'  // the link to whoever was answering closed
export type AskFailure<K extends string = never> = { readonly kind: K | AskEnd; readonly message: string }
export type Outcome<V, K extends string = never> = { readonly ok: true; readonly value: V } | { readonly ok: false; readonly failure: AskFailure<K> }
type Refuses<A extends AskShape> = A extends { refuses: infer K extends string } ? K : never
type ProgressOf<A extends AskShape> = A extends { progress: infer P } ? P : never
type OutcomeOf<A extends AskShape> = Outcome<A['answer'], Refuses<A>>

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

type Gained<S, H, T> = T extends `${infer TH}.${infer TT}`
  ? (H extends `${TH}.${infer HT}` ? Gained<Sub<S, TH>, HT, TT> : H extends TH ? Below<Sub<S, TH>, TT> : Below<S, T>)
  : DataOf<Sub<S, T>>

/** What happens next, in the shape of the value: where to be, and what data changes. */
type Next<R, H extends string> =
  | { at?: never; data: Partial<DataAt<R, H>> }
  | { [T in Paths<R>]: {} extends Gained<R, H, T> ? { at: T; data?: Partial<DataAt<R, T>> } : { at: T; data: Gained<R, H, T> & Partial<DataAt<R, T>> } }[Paths<R>]

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

  /** Asks a backend system, or a state this one started. `heard` is called with each progress update before the answer. */
  ask<K extends SystemsOf<N>, Q extends keyof N['systems'][K]['asks'] & string>(
    of: K, name: Q, args: AskOf<N, K, Q>['args'], heard?: (update: ProgressOf<AskOf<N, K, Q>>) => void,
  ): Promise<OutcomeOf<AskOf<N, K, Q>>>
  ask<A2 extends Asks, Q extends keyof A2 & string>(
    of: Handle<unknown, never, A2>, name: Q, args: A2[Q]['args'], heard?: (update: ProgressOf<A2[Q]>) => void,
  ): Promise<OutcomeOf<A2[Q]>>

  /** From the backend: tells that surface, in every window, an event. */
  broadcast<K extends keyof N['surfaces'] & string>(to: K, event: N['surfaces'][K]['events']): void

  /** A state this one started, as it is now. */
  read<V2>(of: Handle<V2, never, Asks>): V2
  /** Starts a state that runs exactly as long as this one is the case. */
  start<S2 extends Shape, E2 extends AnyEvent, A2 extends Asks>(name: string, made: State<S2, E2, A2>): Handle<Value<S2>, E2, A2>
  /** The handle of a state this one started, by the name it was started under. */
  child<S2 extends Shape, E2 extends AnyEvent, A2 extends Asks>(name: string, of: State<S2, E2, A2>): Handle<Value<S2>, E2, A2>
  /** Released, last first, when this state stops being the case. */
  use(release: () => void): void
}

export interface AskScope<R, H extends string, E extends AnyEvent, N extends Net, A extends AskShape> extends Scope<R, H, E, N> {
  /** `throw refuse(kind, message)` answers with one of the refusals the ask declares. */
  refuse(kind: Refuses<A>, message: string): Error
  /** Tells whoever asked something before the answer. Only they hear it. */
  progress(update: ProgressOf<A>): void
}

/** Events: synchronous. What a handler returns is what happens next. */
type On<R, H extends string, E extends AnyEvent, N extends Net> =
  { [T in E['type']]?: (event: Extract<E, { type: T }>, scope: Scope<R, H, E, N>) => Next<R, H> | void }
/** Asks: may be async. What a handler returns is the answer; it changes nothing by returning. */
type Answering<R, H extends string, E extends AnyEvent, A extends Asks, N extends Net> =
  { [Q in keyof A]?: (args: A[Q]['args'], scope: AskScope<R, H, E, N, A[Q]>) => A[Q]['answer'] | Promise<A[Q]['answer']> }

/** The definition of a state. The same keys at every depth, the outermost included. */
export type Def<R, S, H extends string, E extends AnyEvent, A extends Asks, N extends Net> = {
  /** The events it takes while it is the case. An event goes to the innermost state that takes it. */
  on?: On<R, H, E, N>
  /** The asks it answers while it is the case. An ask goes to the innermost state that answers it. */
  asks?: Answering<R, H, E, A, N>
  /** What it does while it is the case. What it returns, now or later, happens only if it still is. */
  run?(scope: Scope<R, H, E, N>): Next<R, H> | void | Promise<Next<R, H> | void>
} & ([keyof DataOf<S>] extends [never] ? { data?: never } : {
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

class Refusal extends Error { constructor(readonly kind: string, message: string) { super(message) } }
class Question {
  settled = false
  constructor(private readonly settle: (outcome: Outcome<unknown, string>) => void) {}
  end(outcome: Outcome<unknown, string>): void { if (!this.settled) { this.settled = true; this.settle(outcome) } }
}
const refusal = (kind: string, message: string): Outcome<unknown, string> => ({ ok: false, failure: { kind: kind as AskEnd, message } })

type Plain = Record<string, unknown>
type LooseDef = { data?: Plain; start?: string; on?: Record<string, Function>; asks?: Record<string, Function>; run?: Function; states?: Record<string, LooseDef> }
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
}
interface Running { ref: string; data: Plain; root: Active }

type Item =
  | { kind: 'event'; ref: string; event: AnyEvent }
  | { kind: 'ask'; ref: string; name: string; args: object; question: Question; heard?: Heard; gone?: AbortSignal }
  | { kind: 'result'; of: Active; value: unknown }
  | { kind: 'answer'; question: Question; outcome: Outcome<unknown, string> }
  | { kind: 'out'; leave: () => void }

/** What one system offers another over a link. */
interface Port {
  event(ref: string, event: AnyEvent): void
  /** Returns what to call when whoever asked has gone. */
  ask(ref: string, name: string, args: object, heard: Heard, settle: (outcome: Outcome<unknown, string>) => void): () => void
}
/** A link between a window and its backend. What crosses it arrives later, and not at all once it is closed. */
interface Link { open: boolean }
const PORT = Symbol('port')

export interface System {
  start<S extends Shape, E extends AnyEvent, A extends Asks>(ref: string, made: State<S, E, A>): Handle<Value<S>, E, A>
  send<E extends AnyEvent>(to: Handle<unknown, E, Asks>, event: E): void
  ask<A extends Asks, Q extends keyof A & string>(of: Handle<unknown, never, A>, name: Q, args: A[Q]['args'], heard?: (update: ProgressOf<A[Q]>) => void): Promise<OutcomeOf<A[Q]>>
  read<V>(of: Handle<V, never, Asks>): V
  /** Every running state here, as of the last commit. */
  snapshot(): Record<string, unknown>
  /** Called once per step that changed anything, after it has committed. */
  subscribe(listener: (changed: readonly string[]) => void): void
  /** From a window: joins it to its backend. Closing the link is the window going away. */
  connect(backend: System): { close(): void }
  stop(): void
}

export function system(host: { side: 'backend' | 'window'; trace?(line: string): void }): System {
  const trace = (line: string): void => host.trace?.(line)
  const running = new Map<string, Running>()
  const outside: Item[] = []
  const inside: Item[] = []
  /** What leaves when the step commits: answers, progress, what crosses a link, and word to subscribers. */
  const leaving: Array<() => void> = []
  const changed = new Set<string>()
  const listeners: Array<(changed: readonly string[]) => void> = []
  let committed: Record<string, unknown> = {}
  let stepping = false

  /** A window's link to its backend, and the asks waiting on it. */
  let up: { link: Link; port: Port; waiting: Set<Question>; gone: Set<() => void> } | undefined
  /** A backend's links to its windows. */
  const down = new Set<{ link: Link; port: Port }>()
  const carry = (link: Link, across: () => void): void => { setImmediate(() => { if (link.open) across() }) }

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
    out(() => carry(mine.link, () => mine.port.event(ref, event)))
  }

  const ask = (to: string | { ref: string }, name: string, args: object, signal: AbortSignal | undefined, heard: Heard | undefined): Promise<never> => new Promise((resolve, reject) => {
    const ref = refOf(to)
    const question = new Question(resolve as unknown as (outcome: Outcome<unknown, string>) => void)
    // Once whoever asked has ended, its continuation never runs.
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    if (!isAcross(to)) { enqueue({ kind: 'ask', ref, name, args, question, heard }); return }
    const mine = up
    if (!mine) { question.end(refusal('disconnected', `Not connected, so ${ref} cannot be asked`)); return }
    mine.waiting.add(question)
    out(() => carry(mine.link, () => {
      const gone = mine.port.ask(ref, name, args,
        (update) => carry(mine.link, () => heard?.(update)),
        (outcome) => carry(mine.link, () => { mine.waiting.delete(question); mine.gone.delete(gone); question.end(outcome) }))
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
      ask: (to: string | { ref: string }, name: string, args: object, heard?: Heard) => ask(to, name, args, mine.controller.signal, heard),
      broadcast: (to: string, event: AnyEvent) => { if (alive()) out(() => { for (const window of down) carry(window.link, () => window.port.event(to, event)) }) },
      read: (target: { ref: string }) => valueOf(running.get(target.ref)!),
      start: (name: string, made: { def: unknown }) => { mine.started.push(`${ref}/${name}`); return begin(`${ref}/${name}`, made.def as LooseDef) },
      child: (name: string) => ({ ref: `${ref}/${name}` }),
      use: (release: () => void) => { mine.releases.push(release) },
    }
  }

  const enter = (top: Running, def: LooseDef, name: string, around: Active | undefined, entering: Plain): Active => {
    const path = around?.path ? `${around.path}.${name}` : name
    const active: Active = { top, def, name, path, around, inside: undefined, controller: new AbortController(), releases: [], questions: new Set(), started: [] }
    if (around) around.inside = active; else top.root = active
    for (const [field, initial] of Object.entries(def.data ?? {})) {
      if (field in entering) top.data = { ...top.data, [field]: entering[field] }
      else if (initial === given) trace(`DEFECT: ${top.ref} entered ${path} without ${field}`)
      else top.data = { ...top.data, [field]: initial }
    }
    if (path) trace(`${top.ref} entered ${path}`)
    const made = def.run?.(scopeOf(active))
    if (made instanceof Promise) {
      made.then((value) => arrive({ kind: 'result', of: active, value }), (error) => { if (!active.controller.signal.aborted) trace(`${top.ref} failed: ${String(error)}`) })
    } else if (made !== undefined) inside.push({ kind: 'result', of: active, value: made })
    return active
  }

  const exit = (active: Active): void => {
    if (active.inside) exit(active.inside)
    if (active.path) trace(`${active.top.ref} left ${active.path}`)
    active.controller.abort()
    for (const ref of active.started.reverse()) end(ref)
    for (const question of active.questions) leaving.push(() => question.end(refusal('abandoned', 'It stopped before answering')))
    for (const release of active.releases.reverse()) release()
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

  const apply = (active: Active, next: unknown): void => {
    if (next === undefined || next === null || active.controller.signal.aborted) return
    const { at, data = {} } = next as { at?: string; data?: Plain }
    const top = active.top
    if (at !== undefined) go(top, at, data)
    for (const [field, value] of Object.entries(data)) if (field in top.data) top.data = { ...top.data, [field]: value }
    changed.add(top.ref)
  }

  const taker = (top: Running, table: 'on' | 'asks', name: string): { handler: Function; of: Active } | undefined => {
    let of: Active | undefined = innermost(top)
    while (of && !of.def[table]?.[name]) of = of.around
    return of ? { handler: of.def[table]![name]!, of } : undefined
  }

  const handle = (item: Item): void => {
    if (item.kind === 'out') { leaving.push(item.leave); return }
    if (item.kind === 'result') { apply(item.of, item.value); return }
    if (item.kind === 'answer') { leaving.push(() => item.question.end(item.outcome)); return }
    const top = running.get(item.ref)
    if (item.kind === 'event') {
      const found = top && taker(top, 'on', item.event.type)
      if (!found) { trace(`${item.ref} ignored ${item.event.type}`); return }
      apply(found.of, found.handler(item.event, scopeOf(found.of)))
      return
    }
    const { name, args, question, heard, gone } = item
    const found = top && taker(top, 'asks', name)
    if (!found) { leaving.push(() => question.end(refusal('unavailable', `${item.ref} does not take ${name}`))); return }
    const failed = (error: unknown): Outcome<unknown, string> =>
      (error instanceof Refusal ? refusal(error.kind, error.message) : refusal('failed', error instanceof Error ? error.message : String(error)))
    const signal = gone ? AbortSignal.any([found.of.controller.signal, gone]) : found.of.controller.signal
    try {
      const made = found.handler(args, {
        ...scopeOf(found.of, signal),
        refuse: (kind: string, message: string) => new Refusal(kind, message),
        progress: (update: unknown) => { if (!signal.aborted) out(() => heard?.(update)) },
      })
      if (made instanceof Promise) {
        found.of.questions.add(question)
        made.then((value) => arrive({ kind: 'answer', question, outcome: { ok: true, value } }), (error) => arrive({ kind: 'answer', question, outcome: failed(error) }))
      } else leaving.push(() => question.end({ ok: true, value: made }))
    } catch (error) { leaving.push(() => question.end(failed(error))) }
  }

  const commit = (): void => {
    if (changed.size) {
      const refs = [...changed]
      changed.clear()
      committed = Object.fromEntries([...running].map(([ref, top]) => [ref, valueOf(top)]))
      leaving.push(() => { for (const listener of listeners) listener(refs) })
    }
    for (const leave of leaving.splice(0)) leave()
  }

  /** One step: something from outside, then everything it caused inside, then the commit. */
  const step = (first: () => void): void => {
    stepping = true
    first()
    while (inside.length) handle(inside.shift()!)
    commit()
    stepping = false
  }
  const pump = (): void => { while (!stepping && outside.length) step(() => handle(outside.shift()!)) }
  const arrive = (item: Item): void => { outside.push(item); pump() }
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
    ask: (of, name, args, heard) => ask(of, name, args, undefined, heard as Heard | undefined),
    read: (of) => committed[of.ref] as never,
    snapshot: () => committed,
    subscribe: (listener) => { listeners.push(listener) },
    connect: (backend) => {
      const link: Link = { open: true }
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
