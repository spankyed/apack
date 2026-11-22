// The console's two verbs: the result shown is the one last asked for.
//
// `EXECUTE_QUERY` and `EXECUTE_TRANSACTION` are independent, one of each under way at a time: asking again gives up
// the ask under way, so its answer is nobody's. Two rather than one, because deleting a row chains a transaction into
// a follow-up query.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

/** The asks the machine has made, in order: what each was, what it carried, and the spec's way to end it */
const asks = vi.hoisted(() => [] as Array<{ type: string; input: Record<string, unknown>; stopped: boolean; settle(outcome: unknown): void }>);
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    fromAsk: (_to: string, type: string) => fromPromise(({ input, signal }) => new Promise((resolve) => {
      const ask = { type, input: input as Record<string, unknown>, stopped: false, settle: resolve };
      signal.addEventListener('abort', () => { ask.stopped = true; });
      asks.push(ask);
    })),
  };
});
// The schema is not these cases' subject: a view that is never delivered
vi.mock('#generated/fe.ts', async () => {
  const { fromCallback } = await import('xstate');
  return { fromView: () => fromCallback(() => {}) };
});

const { default: databaseState, isRunningCode } = await import('#features/database/fe/state.ts');

/** The nth ask of `type` the machine made */
const asked = (type: string, nth = 0) => {
  const ask = asks.filter((made) => made.type === type)[nth];
  if (!ask) throw new Error(`no ${type} #${nth} was asked`);
  return ask;
};

/** Ends an ask as its system would, unless the machine gave it up, and waits for the machine to have heard */
async function end(ask: (typeof asks)[number], outcome: unknown) {
  // An ask that was stopped is never answered: its answer, when it comes, is nobody's
  if (!ask.stopped) ask.settle(outcome);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const answer = (ask: (typeof asks)[number], value: unknown) => end(ask, { ok: true, value });
const fail = (ask: (typeof asks)[number], failure: { kind: string; message: string; [key: string]: unknown }) => end(ask, { ok: false, failure });

const console_ = () => createActor(databaseState).start();

beforeEach(() => {
  asks.length = 0;
});

it('takes the result for the query it is waiting on', async () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
  expect(asked('EXECUTE_QUERY').input).toEqual({ code: 'return 1' });
  expect(isRunningCode(actor.getSnapshot().context.making), 'running until it is answered').toBe(true);

  await answer(asked('EXECUTE_QUERY'), { result: 'mine', executionTime: 1 });

  expect(actor.getSnapshot().context.queryResult).toBe('mine');
  expect(isRunningCode(actor.getSnapshot().context.making)).toBe(false);
});

it('gives up a query when another is asked for, and takes the later one', async () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
  // Asked again, so the first is no longer waited on
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 2' });
  expect(asked('EXECUTE_QUERY').stopped, 'the first was given up').toBe(true);

  await answer(asked('EXECUTE_QUERY'), { result: 'stale', executionTime: 1 });
  expect(actor.getSnapshot().context.queryResult, 'not taken').toBeNull();

  await answer(asked('EXECUTE_QUERY', 1), { result: 'current', executionTime: 1 });
  expect(actor.getSnapshot().context.queryResult).toBe('current');
});

// The two verbs are asked for independently: a transaction does not give up the query under way
it('keeps a query under way through a transaction', async () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
  actor.send({ type: 'TRANSACTION.EXECUTE', code: 'return 2' });
  expect(asked('EXECUTE_QUERY').stopped).toBe(false);

  await answer(asked('EXECUTE_TRANSACTION'), { result: 'written', executionTime: 1 });
  expect(isRunningCode(actor.getSnapshot().context.making), 'the query is still running').toBe(true);
  await answer(asked('EXECUTE_QUERY'), { result: 'read', executionTime: 1 });
  expect(actor.getSnapshot().context.queryResult).toBe('read');
  expect(isRunningCode(actor.getSnapshot().context.making)).toBe(false);
});

it('shows why a query could not run', async () => {
  const actor = console_();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return nope' });

  await fail(asked('EXECUTE_QUERY'), { kind: 'failed', message: 'nope is not defined' });

  expect(actor.getSnapshot().context.error).toBe('nope is not defined');
  expect(isRunningCode(actor.getSnapshot().context.making)).toBe(false);
});

// Deleting a row is a transaction, and the query in the editor is run again once it is done
it('runs the current query again after a row is deleted', async () => {
  const actor = console_();
  actor.send({ type: 'QUERY.UPDATE', code: 'return rows' });
  actor.send({ type: 'ENTITY.DELETE', entityId: 'Note-1' });

  await answer(asked('EXECUTE_TRANSACTION'), { result: { deleted: 'Note-1' }, executionTime: 1 });

  expect(asked('EXECUTE_QUERY').input).toEqual({ code: 'return rows' });
  await answer(asked('EXECUTE_QUERY'), { result: 'what is left', executionTime: 1 });
  expect(actor.getSnapshot().context.queryResult).toBe('what is left');
});
