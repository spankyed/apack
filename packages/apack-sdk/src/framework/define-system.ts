import type { AllStarts, AnyEvent, AnyState, AsksOf, Each, EventsOf, ShapeOf } from '@apackdev/state';
import { ASK_ANSWER_TYPES, ASK_CANCELLED, type AskAnswered, type AskDeclaration, type AskFailed, type AskProgressed, type AskEventsOf, type ContractAsks, type IncomingOnlyEventsOf, type NormalizeAsks } from '../events/index.ts';
import type { ArrayChanges } from '../utils/change-detection.ts';
import { eventTypes } from '../events/event-types.ts';

/**
 * The host-pushed lifecycle events a backend system may opt into handling.
 *
 * Unlike `SystemEvents`, this excludes the ask wire plumbing (`AskAnswered`, `AskFailed`, `AskProgressed`,
 * `ASK_CANCELLED`), which `@apackdev/state` handles via `answers`, `loads`, and `calls`.
 */
export type HostLifecycleEvents =
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
  | { type: 'DATA_CHANGED_ELSEWHERE' };

/** The events every system accepts: the app sends them, so no system declares them */
export type SystemEvents =
  | HostLifecycleEvents
  /**
   * How the answers to this system's own asks of another system travel. The ask that was made takes them (`ask`), and
   * no system handles one directly: every system may ask, so every system receives them
   */
  | AskAnswered
  | AskFailed
  | AskProgressed
  /** An asker stopping an ask of this system's. The bus takes it, and the ask's handler's `signal` aborts */
  | { type: typeof ASK_CANCELLED };

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
 * `incoming`, `internal` and `context` may each be omitted.
 */
export interface SystemContract {
  context?: unknown;
  incoming?: { type: string };
  /**
   * The asks it answers, by name: each an event an asker sends (`{ type: name, ...ask }`), answered exactly once
   * with `answer` or with a failure of one of the kinds `refuses` declares (`AskDeclaration`).
   */
  asks?: Record<string, AskDeclaration>;
  internal?: { type: string };
  outgoing: { type: string };
}

/** The events a contract says the system receives from outside itself — what a sender may write */
export type ContractIncoming<C> = (C extends { incoming: infer Events } ? Events : never) | AskEventsOf<C>;
/** The events a contract says the system's own children send it; nobody else's to send */
export type ContractInternal<C> = C extends { internal: infer Events } ? Events : never;
/** The events a contract says the system sends to surfaces */
export type ContractOutgoing<C> = C extends { outgoing: infer Events } ? Events : never;
/** A contract's context, `{}` when it declares none */
export type ContractContext<C> = C extends { context: infer Context } ? Context : {};

/**
 * Whether a `@apackdev/state` backend system matches the contract `apack.json` names for its feature: `true`,
 * or a sentence saying how they differ.
 *
 * `State<S, E, A, G>` carries its type parameters covariantly on a phantom field, so every check below is
 * bidirectional and tuple-wrapped (so `never` cannot collapse a distributive conditional):
 * - Events: the state must accept every tell-only event in `C['incoming']`, and every event it accepts beyond
 *   `C['incoming']` must be an opt-in `HostLifecycleEvents` member, a private child-report event declared in
 *   `C['internal']`, or a report declared by one of its started children (`Shape['starts']` → child
 *   `Shape['reports']`). Private self-sent events belong in `Shape['internal']`, never in `E`.
 * - Asks: the state's asks must match `NormalizeAsks<ContractAsks<C>>` in both directions.
 */
export type StateMatchesContract<T, C extends SystemContract> =
  [T] extends [AnyState]
    ? [
        IncomingOnlyEventsOf<C>,
        Exclude<
          EventsOf<T>,
          | HostLifecycleEvents
          | ContractInternal<C>
          | (AllStarts<ShapeOf<T>> extends infer Starts
              ? [keyof Starts] extends [never]
                ? never
                : {
                    [K in keyof Starts]:
                      Starts[K] extends Each<infer Inner>
                        ? Inner extends AnyState
                          ? ShapeOf<Inner> extends { reports: infer R extends AnyEvent } ? R : never
                          : never
                        : Starts[K] extends AnyState
                          ? ShapeOf<Starts[K]> extends { reports: infer R extends AnyEvent } ? R : never
                          : never;
                  }[keyof Starts]
              : never)
        >
      ] extends [EventsOf<T>, IncomingOnlyEventsOf<C>]
      ? [AsksOf<T>, NormalizeAsks<ContractAsks<C>>] extends [NormalizeAsks<ContractAsks<C>>, AsksOf<T>]
        ? true
        : 'this system\'s @apackdev/state asks do not match the contract apack.json names for its feature'
      : 'this system\'s @apackdev/state events do not match the contract apack.json names for its feature'
    : 'this system\'s default export is not a @apackdev/state State';

/**
 * Whether a feature's backend system matches the contract `apack.json` names for its feature: `true`,
 * or a sentence saying how they differ.
 */
export type SystemMatchesContract<Entry, C extends SystemContract> = StateMatchesContract<Entry, C>;
