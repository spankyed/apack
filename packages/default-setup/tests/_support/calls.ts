// Reading the call a surface's machine asked under, for a spec that drives one with `tell` mocked.
//
// A machine mints its own call and hands it to `tell` as the third argument, so this is the only
// place a spec can learn what the real backend's `reply` would echo — there is no field on the event to read
// it from, which is the design. Pair it with `answerTo` (`@apackdev/sdk/testing`) to build the answer.
import type { CallOptions } from '@apackdev/sdk/events';

/** A mocked `tell`, read structurally so this needs no vitest types */
interface SendMock {
  mock: { calls: unknown[][] };
}

/**
 * The call the nth send of `type` carried.
 *
 * **It throws rather than returning `undefined`**, because a missing call means the machine never asked —
 * a different failure from taking the wrong answer, and one that would otherwise surface as `undefined`
 * reaching an assertion several lines later.
 */
export function sentCall(tell: SendMock, type: string, nth = 0): string {
  const sends = tell.mock.calls.filter(([, event]) => (event as { type: string }).type === type);
  const { call } = (sends[nth]?.[2] ?? {}) as CallOptions;
  if (call === undefined) throw new Error(`no ${type} #${nth} carrying a call; sent ${sends.length}`);
  return call;
}
