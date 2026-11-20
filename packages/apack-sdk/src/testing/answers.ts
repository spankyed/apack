import { _callOn, type AskAnswered, type AskFailed } from '../events/index.ts';

/**
 * The answer to `call`, as a delivery door would deliver it: `event` with the call it answers on it.
 *
 * ```ts
 * actor.send(answerTo(theAskWasSentUnder, { type: 'DONE', data }));
 * ```
 *
 * **For a spec that drives a machine directly**, where there is no door to put the call there. The key it
 * writes is reserved and `@internal`, so without this a spec would have to name it — which the
 * `reserved-event-keys` pack rule refuses, and rightly: that key is the app's.
 *
 * It takes the call rather than minting one, because the asker mints: a spec asserts both that the machine
 * takes the answer to the ask it made and that it ignores one for an ask it abandoned, and each half needs
 * the spec to say which call it means. Only an answer carries a call, so there is no twin for the other
 * direction — a notification is sent as the plain event it is.
 */
export function answerTo<E extends { type: string }>(call: string, event: E): E {
  return { ...event, ..._callOn({ answering: call }) };
}

/**
 * The answer to an ask a machine made and goes on from — a surface's write over a view it shows — as the asked
 * system's handler gives it, for a spec that drives the machine directly: `actor.send(askAnswered(call, 'RENAME_ITEM', answer))`.
 */
export function askAnswered<K extends string, A>(call: string, asked: K, answer: A): AskAnswered<K, A> {
  return answerTo(call, { type: 'ASK_ANSWERED', asked, answer });
}

/**
 * The refusal of an ask, as the asked system's handler or the bus gives it, for a spec that drives the asking machine
 * directly: `actor.send(askFailed(call, 'RENAME_ITEM', { kind: 'name-taken', message: 'Taken', existing: id }))`.
 */
export function askFailed<K extends string, F extends { kind: string; message: string }>(call: string, asked: K, failure: F): AskFailed<K, F> {
  return answerTo(call, { type: 'ASK_FAILED', asked, failure });
}
