import { _withPerformanceEvent } from '../runtime/performance.ts';
import type { ActionArgs, EventObject, MachineContext, Mapper, ParameterizedObject } from 'xstate';
import { safeEvents } from '../helpers/actor-helpers.ts';
import { _answered, _askEnded, _askFailureOf, _askSignal, _clientOf, _currentDelivery, _failedAnswer, _progressed, _refuse, _replyTo, ASK_ANSWER_TYPES, ASK_CANCELLED, type AnswerPayload, type ProgressPayload, type AskAnswered, type AskDeclaration, type AskEventOf, type AskFailed, type AskProgressed, type AskName, type AskEventsOf, type ContractAsks, type RefuseOf } from '../events/index.ts';
import { reportError } from '../logger/report-error.ts';
import type { ArrayChanges } from '../utils/change-detection.ts';
import { eventTypes } from '../events/event-types.ts';

/** The events every system accepts: the app sends them, so no system declares them */
export type SystemEvents =
  /**
   * Publish what you hold now — the one event that asks for data, and the only one most systems handle.
   *
   * It follows every fact below, so a system does not wire "send my startup data" once per cause and a new
   * cause costs it nothing. Handle a fact as well only for what publishing cannot fix: work held over rows
   * that are gone, state that tracks whether a client is attached.
   */
  | { type: 'SEND_STATE' }
  /** A client connected. Most systems need only the `SEND_STATE` that follows it */
  | { type: 'CLIENT_CONNECTED' }
  /**
   * A pack was activated, reloaded or torn down while the app runs, or its content was imported: what it
   * registers (its slash commands) and the content it applied may differ. Sent once the change is complete.
   */
  | { type: 'PACK_CHANGED'; packId: string }
  /**
   * The feature's settings changed: `settings` as they now apply, and `changes` to what they list, when the store
   * tells them. The feature's surface gets it too (`FeatureSettingsUpdated`).
   */
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: unknown; changes?: ArrayChanges | null }
  /**
   * Every row the app holds was replaced — reset, or a backup imported — and the new world is built.
   *
   * Handling it is optional: the bus also asks every system for its startup data, so a surface's view is
   * refreshed either way. Declare it only for what re-reading cannot fix, such as work held over rows that
   * are now gone.
   */
  | { type: 'DATA_REPLACED' }
  /**
   * Another process committed to the database, a local tool such as `apack db exec`, and rows may have changed in any
   * way, though most are as they were. Unlike `DATA_REPLACED` it doesn't mean work held over rows has lost them.
   *
   * Handling it is optional, as there: the bus also asks every system for its startup data. Declare it only for what
   * re-reading cannot fix. Rows derived from others are for a projection (`defineProjections`), which is caught up before
   * this arrives.
   */
  | { type: 'DATA_CHANGED_ELSEWHERE' }
  /**
   * The answers to this system's own asks of another system, when it handles them as events rather than awaiting
   * them (`ask`): every system may ask, so every system receives them
   */
  | AskAnswered
  | AskFailed
  | AskProgressed
  /** An asker stopping an ask of this system's. The bus takes it, and the ask's handler's `signal` aborts */
  | { type: typeof ASK_CANCELLED }

/**
 * The event types every system accepts, as a value: a send of one to a feature that runs no system is nobody's, and
 * dropped without a warning.
 */
export const SYSTEM_EVENT_TYPES = eventTypes<SystemEvents>()('SEND_STATE', 'CLIENT_CONNECTED', 'PACK_CHANGED', 'FEATURE_SETTINGS_UPDATED', 'DATA_REPLACED', 'DATA_CHANGED_ELSEWHERE', ...ASK_ANSWER_TYPES, ASK_CANCELLED);

/**
 * What a system's contract declares. A feature exports one as `Contract` from its `be/contract.ts`, and `apack.json`
 * names it at `features[].system.contract`:
 *
 * ```ts
 * export type Contract = {
 *   context: LogsContext
 *   incoming: IncomingLogEvents
 *   internal: LogsInternalEvents
 *   outgoing: OutgoingLogsEvents
 * }
 * ```
 *
 * Fields, not positions. `internal` is what the system's own children send it — a `fromCallback` child telling its
 * parent — and it reaches the machine's event union and nothing a dependent pack can see; as a fourth positional
 * type parameter it would have been a slot every call had to skip past, which is why the split waited for this.
 * `incoming`, `internal` and `context` may each be omitted.
 */
export interface SystemContract {
  context?: unknown;
  incoming?: { type: string };
  /**
   * The asks it answers, by name: each an event an asker sends (`{ type: name, ...ask }`), answered exactly once
   * with `answer` or with a failure of one of the kinds `refuses` declares (`AskDeclaration`). Answered by the
   * table `defineSystem`'s `answers` builds, which has to cover every one.
   */
  asks?: Record<string, AskDeclaration>;
  internal?: { type: string };
  outgoing: { type: string };
}

// One `Contract*` per field of `SystemContract` above, whether or not the SDK reads it yet: a field and its reader
// are added together, so neither a count of the readers nor a search decides where the next one goes. The names
// generated code is written in are a separate layer (`IncomingEventsOf` and its neighbours, `events/index.ts`),
// built on these.
//
// Each reads a field that may be absent, so each is a conditional: an indexed access would answer from
// `SystemContract`'s own optional members and widen an omitted `internal` to `{ type: string }` rather than
// narrowing it to nothing.

/** The events a contract says the system receives from outside itself — what a sender may write */
export type ContractIncoming<C> = (C extends { incoming: infer Events } ? Events : never) | AskEventsOf<C>;
/** The events a contract says the system's own children send it; nobody else's to send */
export type ContractInternal<C> = C extends { internal: infer Events } ? Events : never;
/** The events a contract says the system sends to surfaces */
export type ContractOutgoing<C> = C extends { outgoing: infer Events } ? Events : never;
/** A contract's context, `{}` when it declares none */
export type ContractContext<C> = C extends { context: infer Context } ? Context : {};

/**
 * Everything the machine handles: what others send it, what its own children send it, and the app's. `Extract`
 * rather than a bare union because the conditionals above defer, and `safeEvents` needs a parameter it can see
 * is an event.
 */
type MachineEvents<C> = Extract<ContractIncoming<C> | ContractInternal<C> | SystemEvents, { type: string }>;

/**
 * The arguments XState hands a handler, for this system's context and events.
 *
 * It is the real thing rather than an approximation: `ActionArgs` is `UnifiedArg`, whose only type parameters
 * are the context and the event union — `self` carries `Record<string, AnyActorRef | undefined>` for its
 * children and `system` is `AnyActorSystem`, neither specialised per machine. So a spec that knows the
 * contract can build exactly what XState would, and wrapping costs no fidelity.
 */
type SystemArgs<C extends SystemContract> = ActionArgs<ContractContext<C>, MachineEvents<C>, MachineEvents<C>>;

/** The same, for a machine that declares its own context and events rather than deriving them from a contract */
type Args<TContext extends MachineContext, TEvent extends EventObject> = ActionArgs<TContext, TEvent, TEvent>;

/**
 * What XState hands an `invoke.input`, which is **not** what it hands an action: a `Mapper` receives
 * `{ context, event, self }` and no `system`. Typing `input` from `ActionArgs` compiles here and then fails at
 * every call site, because a function demanding `system` cannot take a `Mapper`'s argument.
 */
type InputArgs<TContext extends MachineContext, TEvent extends EventObject> =
  Parameters<Mapper<TContext, TEvent, unknown, TEvent>>[0];

/**
 * The params each action takes, keyed by name — what XState infers its own `TActions` from, and so what this
 * wrapper has to be shaped around.
 *
 * The first attempt returned a mapped type whose values were a *conditional* over the handler given
 * (`F extends (args, params: infer P) => void ? …`). TypeScript cannot invert a deferred conditional, so
 * XState inferred nothing and every action name in the machine config became "not assignable to Actions<…>".
 * Taking the params map as the type parameter instead is how XState itself does it, and it infers from the
 * same place: each handler's second argument.
 */
type ActionParams = Record<string, ParameterizedObject['params'] | undefined>;

/**
 * Whether this is a handler to wrap or an action creator's result to leave alone.
 *
 * Every creator XState exposes — `assign`, `enqueueActions`, `spawnChild`, `raise`, `sendTo`, `sendParent`,
 * `emit`, `log`, `cancel`, `stopChild` — returns a function carrying an own `resolve`, which is how XState
 * resolves it later; a handler written by hand has no own properties at all. Wrapping one of those would
 * hide the property XState resolves it through, so the test is what keeps them whole.
 */
const isCreatorResult = (value: unknown): boolean =>
  typeof value === 'function' && Object.prototype.hasOwnProperty.call(value, 'resolve');

/**
 * Hands a handler the connection the message it handles arrived on, bound at entry so a handler that awaits or
 * stores it still has the right one: what it sends that window (`sendToWindow(client, …)`, a feed beside an
 * answer) goes there and nowhere else.
 */
const handing = <F>(handler: F): F => {
  if (typeof handler !== 'function' || isCreatorResult(handler)) return handler;
  const run = handler as unknown as (args: object, params: unknown) => void;
  return ((args: object, params: unknown) => {
    const delivery = answerable(args);
    const invoke = () => run({ ...args, client: _clientOf(delivery) }, params);
    const event = (args as { event?: unknown }).event;
    return _withPerformanceEvent(event, invoke);
  }) as unknown as F;
};

/**
 * The delivery a handler may answer or address: the one in scope when the event it handles is the message delivered
 * (`_Delivery`'s `event`), and none for an event its machine made while handling that message.
 */
const answerable = (args: object): ReturnType<typeof _currentDelivery> => {
  const delivery = _currentDelivery();
  return delivery !== undefined && delivery.event === (args as { event?: unknown }).event ? delivery : undefined;
};

/**
 * What hands a machine's handlers the connection the message they handle arrived on, for a machine that is not a
 * feature's system: a child a system spawns declares its own context and events rather than a feature contract, so it
 * has no `defineSystem` to come from. `defineSystem` is this plus the contract's types.
 */
export interface Handlers<TContext extends MachineContext, TEvent extends EventObject> {
  /** See `SystemSpec.actions` */
  actions<P extends ActionParams>(
    defs: { [K in keyof P]: (args: Args<TContext, TEvent> & { client?: string }, params: P[K]) => void },
  ): { [K in keyof P]: (args: Args<TContext, TEvent>, params: P[K]) => void };
  /** See `SystemSpec.input` */
  input<I>(build: (args: InputArgs<TContext, TEvent> & { client?: string }) => I): Mapper<TContext, TEvent, I, TEvent>;
}

/**
 * ```ts
 * const handlers = defineHandlers<Context, Event>();
 * export const commitSystem = setup({ types: { … }, actions: handlers.actions({ … }) }).createMachine(…);
 * ```
 */
export function defineHandlers<TContext extends MachineContext, TEvent extends EventObject>(): Handlers<TContext, TEvent> {
  return {
    actions: (defs) => Object.fromEntries(
      Object.entries(defs).map(([name, handler]) => [name, handing(handler)]),
    ) as never,
    input: (build) => (args) => build({ ...args, client: _clientOf(answerable(args)) }),
  };
}

/** What one of a system's ask handlers is handed */
export interface AnswerArgs<C extends SystemContract, K extends AskName<C>> {
  /** The ask, as the asker sent it */
  readonly args: AskEventOf<C, K>;
  /** The system's context as the ask arrived: a handler reads it, and changes it by sending its machine an event */
  readonly context: ContractContext<C>;
  /** The system's own actor, to send it an event — a state the answer moves it into */
  readonly self: SystemArgs<C>['self'];
  /** Aborts when the window that asked goes, and when whoever asked stops the ask */
  readonly signal: AbortSignal;
  /** The connection the ask arrived on, absent for one another system made */
  readonly client?: string;
  /**
   * Whether anyone waits for the answer: false for an ask sent from no delivery — an action, a timer — whose outcome
   * a handler that must still be heard tells every window itself
   */
  readonly waiting: boolean;
  /**
   * Tells whoever asked something before the answer, as the ask declares under `progress`. Only they hear it, and
   * nothing is told once `signal` has aborted
   */
  readonly progress: (update: ProgressPayload<ContractAsks<C>[K]>) => void;
  /** Builds a refusal of one of the kinds the ask declares, for the handler to throw */
  readonly refuse: RefuseOf<ContractAsks<C>[K]>;
}

/** One of a system's ask handlers: it returns the answer, or a promise of it, and throws a refusal */
export type AnswerHandler<C extends SystemContract, K extends AskName<C>> =
  (args: AnswerArgs<C, K>) => AnswerPayload<ContractAsks<C>[K]> | PromiseLike<AnswerPayload<ContractAsks<C>[K]>>;

/** What `answers` makes: the actions to give `setup`, and the transitions that run each on the ask it answers */
export interface Answers<C extends SystemContract> {
  readonly actions: { readonly [K in AskName<C>]: (args: SystemArgs<C>, params: undefined) => void };
  readonly on: { readonly [K in AskName<C>]: { readonly actions: K } };
}

/** The definition object returned by `defineSystem()`. */
export interface SystemSpec<C extends SystemContract> extends Handlers<ContractContext<C>, MachineEvents<C>> {
  types: { context: ContractContext<C>; events: MachineEvents<C> };
  typeOf: ReturnType<typeof safeEvents<MachineEvents<C>>>;
  /**
   * The system's actions, each handed the connection the message it handles arrived on (`client`), absent for a
   * message no window sent. A result is not an action's to send: it is an ask's answer (`answers`).
   *
   * **It wraps the record, never `setup`.** What XState receives is exactly the type it expects, so its
   * inference, `SetupReturn.extend`/`createAction` and the prebound creators are all untouched. An action
   * creator's result passes through whole, which gives the rule: an action that reads `client` is a plain function.
   *
   * **And it is in the record.** An action written inline in a `createMachine` config never passes through
   * here, so it is handed nothing.
   */
  actions<P extends ActionParams>(
    defs: { [K in keyof P]: (args: SystemArgs<C> & { client?: string }, params: P[K]) => void },
  ): { [K in keyof P]: (args: SystemArgs<C>, params: P[K]) => void };
  /**
   * An `invoke.input`, handed the same `client`, so an invoked actor receives it through its input.
   *
   * `input` is evaluated while the transition is being processed — inside the delivery — which is what makes
   * this work and what makes the connection it hands on bound rather than ambient.
   */
  input<I>(build: (args: InputArgs<ContractContext<C>, MachineEvents<C>> & { client?: string }) => I): Mapper<ContractContext<C>, MachineEvents<C>, I, MachineEvents<C>>;
  /**
   * The table that answers the system's asks (`asks` in its contract): one handler per ask, and it has to cover every
   * one. **A handler returns its answer and throws its refusal; it is not handed the means to give either.**
   *
   * ```ts
   * export const answers = librarySpec.answers({
   *   GET_DOCUMENT: async ({ args, signal, refuse }) => {
   *     const document = await libraryService.find(args.id, { signal })
   *     if (!document) throw refuse('not-found', 'Document not found')
   *     return { document }
   *   },
   * })
   *
   * setup({ types: librarySpec.types, actions: { ...answers.actions } })
   *   .createMachine({ on: { ...answers.on } })
   * ```
   *
   * Whoever asked is answered whichever way the handler ends, which is the point: a window that asked shows nothing
   * until it is answered, and an answer a handler has to remember on its failure path is one a new handler forgets.
   * What it returns is `ASK_ANSWERED`'s `answer`; what it throws is `ASK_FAILED`, of the kind `refuse` named, or
   * for an error from the disk the kind it is where the ask declares it (`not-found`, `no-access`), or else
   * `failed`. The work runs whether or not anybody asked, and a failure nobody asked about is reported, since no
   * window shows it. An ask the machine's current state does not take is answered `unavailable` by the bus.
   *
   * `answers.on` goes wherever the asks are taken: at the root for a system that takes them in every state, under a
   * state for one that takes them only there.
   */
  answers(defs: { readonly [K in AskName<C>]: AnswerHandler<C, K> }): Answers<C>;
}

/**
 * Define a backend system from its feature's contract: the events it receives, those its own children send it,
 * those it sends to surfaces, and its context. Its identity is its feature's: the manifest names the system module
 * under the feature, which runs it at `<packId>/<featureId>`, and the pack's code names it by the feature id.
 *
 * ```ts
 * import type { Contract } from './contract';
 * export const logsSpec = defineSystem<Contract>();
 * ```
 *
 * It carries no phantom properties. Codegen reads the events from the contract the manifest names — a declared
 * type, read without running anything — rather than from this value's type, which is what made an annotation on
 * the system's default export silently drop them.
 */
export function defineSystem<C extends SystemContract>(): SystemSpec<C> {
  return {
    types: {
      context: {} as ContractContext<C>,
      events: {} as MachineEvents<C>,
    },
    typeOf: safeEvents<MachineEvents<C>>(),
    ...defineHandlers<ContractContext<C>, MachineEvents<C>>(),
    answers: (defs) => {
      const asks = Object.keys(defs);
      const handlers = defs as unknown as Record<string, (args: object) => unknown>;
      return {
        actions: Object.fromEntries(asks.map((asked) => [asked, (args: SystemArgs<C>) =>
          _withPerformanceEvent(args.event, () => answer(asked, handlers[asked]!, args))])),
        on: Object.fromEntries(asks.map((asked) => [asked, { actions: asked }])),
      } as unknown as Answers<C>;
    },
  };
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === 'function';

/**
 * Runs one ask's handler and answers its asker, whichever way the handler ends. Synchronous work is answered before
 * this returns, so a system that answers from what it holds answers within the delivery.
 */
function answer(asked: string, handler: (args: object) => unknown, args: { event: unknown; context: unknown; self: unknown }): void {
  const delivery = answerable(args);
  // Taken: the bus answers an ask nobody took, and this one is being answered
  if (delivery?.ask) delivery.ask.taken = true;
  const reply = _replyTo(delivery);
  const client = _clientOf(delivery);
  const call = delivery?.call;
  const signal = _askSignal(call, client);
  const refused = (error: unknown) => {
    _askEnded(call);
    // Stopped by whoever asked, or their window went: nobody waits, and stopping is what the work was told to do
    if (signal.aborted) return;
    const failure = _askFailureOf(error, delivery?.ask?.kinds);
    if (reply) reply(_failedAnswer(asked, failure));
    // Nobody asked, so no window shows it: work a handler does for an applier, a migration or a timer
    else reportError({ error, title: `${asked} failed`, source: delivery?.receiver ?? 'answers' });
  };
  let made: unknown;
  try {
    made = handler({
      args: args.event, context: args.context, self: args.self, signal, refuse: _refuse, waiting: reply !== undefined,
      progress: (update: unknown) => { if (!signal.aborted) reply?.(_progressed(asked, update)); },
      ...(client === undefined ? {} : { client }),
    });
  } catch (error) {
    refused(error);
    return;
  }
  // Two handlers rather than a `catch` after: a throw from answering is the bus's, not the work's, and is not answered again
  const answered = (value: unknown) => { _askEnded(call); if (!signal.aborted) reply?.(_answered(asked, value)); };
  if (isThenable(made)) Promise.resolve(made).then(answered, refused);
  else answered(made);
}

/**
 * Whether a system entry's machine was built from the contract given: `true`, or a sentence saying how they differ.
 *
 * `apack.json` names the contract the feature's facade publishes, and `defineSystem<Contract>()` types the machine.
 * They are two references to one type, and nothing in either place makes them the same one — a machine built from
 * some other contract compiles, and its feature then publishes events it never handles and handles events its
 * dependents can't send. Codegen asserts one of these per feature in the pack entry, so the pack's own typecheck
 * says so.
 *
 * It compares the specs rather than the contracts, since `SystemSpec` is what carries a contract into the machine:
 * its context and its event union. A contract's `outgoing` is deliberately outside that comparison — the machine
 * never types a send from its spec, so a difference there is the facade's business and this check's blind spot.
 */
export type MachineMatchesContract<Entry, C extends SystemContract> =
  // One tuple rather than two nested conditionals: it is element-wise assignability both ways, and it defers
  Entry extends { spec: infer Spec }
    ? [Spec, SystemSpec<C>] extends [SystemSpec<C>, Spec]
      ? true
      : 'this system\'s defineSystem<…> declares a contract that is not the one apack.json names for its feature'
    : 'this system\'s default export has no `spec` from defineSystem<…>';
