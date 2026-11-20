import { fromPromise, type PromiseActorLogic } from 'xstate';

/** One way work can fail that its caller is expected to act on, told apart by `kind` */
export interface OutcomeFailure { readonly kind: string }

/**
 * How work ended, as a value: what it produced, or the one failure it ended with.
 *
 * For a failure the caller branches on — a refusal, a missing program, a busy store. A bug is still thrown: an
 * outcome names the ways work is known to fail, and a failure nobody named has no branch to be handled in.
 */
export type Outcome<TValue, TFailure extends OutcomeFailure> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: TFailure };

/** The outcome of work that produced `value` */
export const done = <TValue>(value: TValue): Outcome<TValue, never> => ({ ok: true, value });

/** The outcome of work that ended with `failure` */
export const failed = <TFailure extends OutcomeFailure>(failure: TFailure): Outcome<never, TFailure> => ({ ok: false, failure });

/** The failures an outcome type names */
export type FailureOf<TOutcome> = TOutcome extends { readonly ok: false; readonly failure: infer TFailure } ? TFailure : never;

/**
 * Actor logic for work that answers with an `Outcome`: `fromPromise`, whose output says how the work ended.
 *
 * A machine that invokes it reads every expected failure in `onDone`, typed, where `onError` hands it `unknown`:
 * `onOutcome` writes those transitions, one per kind. `onError` is left for what the work did not name.
 */
export function fromOutcome<TValue, TFailure extends OutcomeFailure, TInput = undefined>(
  work: (args: { readonly input: TInput; readonly signal: AbortSignal }) => PromiseLike<Outcome<TValue, TFailure>>,
): PromiseActorLogic<Outcome<TValue, TFailure>, TInput> {
  return fromPromise<Outcome<TValue, TFailure>, TInput>(({ input, signal }) => work({ input, signal }));
}

/** Reads the outcome an event carries, where it carries one: the done event of an actor made with `fromOutcome` */
function outcomeIn(event: unknown): Outcome<unknown, OutcomeFailure> | undefined {
  const output = (event as { readonly output?: unknown } | null)?.output;
  return typeof output === 'object' && output !== null && typeof (output as { ok?: unknown }).ok === 'boolean'
    ? output as Outcome<unknown, OutcomeFailure> : undefined;
}

/**
 * The outcome a done event carries, for an action or guard that is handed the machine's whole event union: throws
 * for an event that carries none, which is an action wired to a transition no outcome arrives on.
 */
export function outcomeOf<TOutcome extends Outcome<unknown, OutcomeFailure>>(event: { readonly type: string }): TOutcome {
  const outcome = outcomeIn(event);
  if (outcome === undefined) throw new Error(`Expected the done event of an actor made with fromOutcome, got ${event.type}`);
  return outcome as TOutcome;
}

/** A transition `onOutcome` wrote: the branch as it was given, taken when the outcome is the one it is for */
export type OutcomeTransition<TBranch> = TBranch & { readonly guard: (args: { readonly event: unknown }) => boolean };

/**
 * The `onDone` transitions for an actor made with `fromOutcome`: one for work that succeeded, and one for each kind
 * of failure its outcome names.
 *
 * **Every kind has a branch, or it does not compile**, and a kind the outcome does not name is refused the same way:
 * the list of what can go wrong is the outcome's type, and this is where a machine is held to it. A failure kind
 * added to the work later fails the typecheck of every machine that invokes it until each says what it does.
 *
 * ```ts
 * invoke: {
 *   src: 'reset',
 *   onDone: onOutcome<ResetOutcome>()({
 *     done: { target: 'idle', actions: 'tellEveryone' },
 *     failed: {
 *       busy: { target: 'idle', actions: 'refuse' },
 *       incomplete: { target: 'idle', actions: ['tellEveryone', 'report'] },
 *     },
 *   }),
 * }
 * ```
 *
 * A branch is a transition as the machine would write it, without a `guard`: which branch is taken is this
 * function's. An action it names reads the outcome with `outcomeOf`.
 */
export function onOutcome<TOutcome extends Outcome<unknown, OutcomeFailure>>() {
  return <const TDone extends object, const TFailed extends { readonly [K in FailureOf<TOutcome>['kind']]: object }>(
    branches: { readonly done: TDone; readonly failed: TFailed & { readonly [K in Exclude<keyof TFailed, FailureOf<TOutcome>['kind']>]: never } },
  ): Array<OutcomeTransition<TDone | TFailed[keyof TFailed]>> => [
    { ...branches.done, guard: ({ event }) => outcomeIn(event)?.ok === true },
    ...Object.entries<object>(branches.failed).map(([kind, branch]) => ({
      ...branch,
      guard: ({ event }: { readonly event: unknown }) => {
        const outcome = outcomeIn(event);
        return outcome?.ok === false && outcome.failure.kind === kind;
      },
    })),
  ] as Array<OutcomeTransition<TDone | TFailed[keyof TFailed]>>;
}
