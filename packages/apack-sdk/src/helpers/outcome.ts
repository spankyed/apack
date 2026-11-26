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
