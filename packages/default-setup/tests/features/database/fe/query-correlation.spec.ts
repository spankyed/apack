// The console's two verbs: an answer is taken only by the ask that is waiting for it.
//
// `EXECUTE_QUERY` and `EXECUTE_TRANSACTION` are independent and each holds one outstanding call, so an
// answer is placed by the call it names (`Message.answering`, which a delivery door puts on the event) and
// not by anything in its payload. Two slots rather than one, because deleting a row chains a transaction
// into a follow-up query and a single slot would have the query overwrite the transaction it came from.
//
// The case worth reading is the last pair: an answer carrying **no** call, arriving when nothing is
// outstanding. Whether a hand-written comparison refuses it depends on how the empty slot is spelled —
// `undefined === null` is false and `undefined === undefined` is true — which is a correctness question
// settled by a sentinel, and the reason `answersCall` owns it instead and `_callOf` is not a pack's to
// call.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { askAnswered } from '@apackdev/sdk/testing';
import { sentCall } from '../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

const { default: databaseState } = await import('#features/database/fe/state.ts');

/** The call the nth send of `type` was asked under */
const callFor = (type: string, nth = 0) => sentCall(sendToSystem, type, nth);

const console_ = () => createActor(databaseState).start();

beforeEach(() => {
  sendToSystem.mockReset();
});

it('takes the result for the query it is waiting on', () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });

  actor.send(askAnswered(callFor('EXECUTE_QUERY'), 'EXECUTE_QUERY', { result: 'mine', executionTime: 1 }));

  expect(actor.getSnapshot().context.queryResult).toBe('mine');
});

it('ignores a result for a query it has stopped waiting on', () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
  const abandoned = callFor('EXECUTE_QUERY');
  // Asked again, so the first is no longer the outstanding one
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 2' });

  actor.send(askAnswered(abandoned, 'EXECUTE_QUERY', { result: 'stale', executionTime: 1 }));
  expect(actor.getSnapshot().context.queryResult, 'not taken').toBeNull();

  actor.send(askAnswered(callFor('EXECUTE_QUERY', 1), 'EXECUTE_QUERY', { result: 'current', executionTime: 1 }));
  expect(actor.getSnapshot().context.queryResult).toBe('current');
});

/**
 * The two verbs keep separate slots, which matters because they share the result field.
 *
 * A transaction's answer writes `queryResult`, so the only thing keeping a transaction's answer out of a
 * query's result is that it is matched against `pendingTransactionCall` — empty here, since no transaction
 * was asked. One slot for both would take this.
 */
it('does not let one verb take the other verb\'s answer', () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });

  // A transaction answer naming the *query's* call: the right call, the wrong slot
  actor.send(askAnswered(callFor('EXECUTE_QUERY'), 'EXECUTE_TRANSACTION', { result: 'wrong slot', executionTime: 1 }));

  expect(actor.getSnapshot().context.queryResult, 'no transaction was outstanding').toBeNull();
});

/**
 * An answer carrying no call at all, with nothing outstanding — refused.
 *
 * Held by two things independently — `answersCall` refuses an empty slot, and the slot is `null` — so this
 * fires only on losing both. `apack-sdk/tests/events/calls.spec.ts` holds the check itself.
 */
it('refuses a result carrying no call when no query is outstanding', () => {
  const actor = console_();

  actor.send({ type: 'ASK_ANSWERED', asked: 'EXECUTE_QUERY', answer: { result: 'nobody asked', executionTime: 1 } });

  expect(actor.getSnapshot().context.queryResult).toBeNull();
});

it('refuses one once the query it was waiting on has settled', () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
  actor.send(askAnswered(callFor('EXECUTE_QUERY'), 'EXECUTE_QUERY', { result: 'mine', executionTime: 1 }));

  actor.send({ type: 'ASK_ANSWERED', asked: 'EXECUTE_QUERY', answer: { result: 'stray', executionTime: 1 } });

  expect(actor.getSnapshot().context.queryResult, 'the settled answer still stands').toBe('mine');
});
