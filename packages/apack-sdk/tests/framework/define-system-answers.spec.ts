// A system's asks: declared in its contract, answered by a table of handlers that return their answer and throw
// their refusal. The cases drive a real machine inside a delivery, as the bus does, and read what the asker was sent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, setup } from 'xstate';
import { defineSystem } from '../../src/framework/define-system.ts';
import { _runDelivery, type _AskDelivery } from '../../src/events/index.ts';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '../../src/testing/index.ts';

startTestRuntime();

type Contract = {
  context: { renamed: number };
  incoming: { type: 'TOLD' };
  outgoing: { type: 'NOTE_CHANGED' };
  asks: {
    GET_NOTE: { ask: { id: string }; answer: { text: string }; fails: { 'not-found': {} } };
    DELETE_NOTE: { ask: { id: string } };
    RENAME_NOTE: { ask: { id: string; name: string }; answer: { name: string }; fails: { 'name-taken': { existing: string } } };
  };
};

const spec = defineSystem<Contract>();

/** Notes on disk, as far as these cases go: one that reads, one that is missing, one that fails for no declared reason */
const notes: Record<string, () => Promise<string>> = {
  kept: async () => 'the text',
  gone: async () => { throw Object.assign(new Error("ENOENT: no such file, open 'gone.md'"), { code: 'ENOENT' }); },
  broken: async () => { throw new Error('the disk gave out'); },
};

const deleted: string[] = [];

const answers = spec.answers({
  GET_NOTE: async ({ ask }) => ({ text: await notes[ask.id]!() }),
  DELETE_NOTE: ({ ask }) => { deleted.push(ask.id); },
  RENAME_NOTE: ({ ask, failure }) => {
    if (ask.name === 'taken') throw failure('name-taken', 'Another note has that name', { existing: 'note-2' });
    return { name: ask.name };
  },
});

const machine = setup({ types: spec.types, actions: { ...answers.actions } })
  .createMachine({ context: { renamed: 0 }, on: { ...answers.on } });

let heard: Array<Record<string, unknown>>;
let stopListening: () => void;
beforeEach(() => {
  heard = [];
  deleted.length = 0;
  stopListening = testRootEvents.onSurfaceSend((message) => { heard.push({ ...message.event, to: message.to, client: message.client }); });
});
afterEach(() => { stopListening(); takeSystemErrors(); });

type Ask = { type: 'GET_NOTE'; id: string } | { type: 'DELETE_NOTE'; id: string } | { type: 'RENAME_NOTE'; id: string; name: string };

/**
 * Delivers `event` to a running system as the bus does: from a window that asked, or from nobody, with what the
 * contract declares the ask may fail as. Answers the record the bus reads afterwards to know whether it was taken.
 */
function deliver(event: Ask, from: 'a window' | 'nobody' = 'a window', kinds: readonly string[] = ['not-found']): _AskDelivery {
  const system = createActor(machine).start();
  const asker = from === 'a window' ? { asker: { kind: 'connection', ref: 'pack/notes', client: 'c-1' } } as const : {};
  const ask: _AskDelivery = { kinds, taken: false };
  _runDelivery({ receiver: 'pack/notes', event, ask, ...asker }, () => system.send(event));
  return ask;
}

/** Lets an asynchronous handler finish and its answer be sent */
const answered = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("a system's answers", () => {
  it('answers the window that asked with what the handler returned', async () => {
    deliver({ type: 'GET_NOTE', id: 'kept' });
    await answered();
    expect(heard).toEqual([{ type: 'ASK_ANSWERED', asked: 'GET_NOTE', answer: { text: 'the text' }, to: 'pack/notes', client: 'c-1' }]);
  });

  it('answers that it was done for a handler that returns nothing, before the delivery is over', () => {
    deliver({ type: 'DELETE_NOTE', id: 'kept' });
    expect(deleted).toEqual(['kept']);
    expect(heard).toEqual([expect.objectContaining({ type: 'ASK_ANSWERED', asked: 'DELETE_NOTE', answer: undefined })]);
  });

  it('answers a refusal the handler threw with its kind and the data the kind carries', () => {
    deliver({ type: 'RENAME_NOTE', id: 'kept', name: 'taken' });
    expect(heard).toEqual([expect.objectContaining({
      type: 'ASK_FAILED', asked: 'RENAME_NOTE', failure: { kind: 'name-taken', message: 'Another note has that name', existing: 'note-2' },
    })]);
  });

  it('answers an error from the disk with the kind it is, where the ask declares that kind', async () => {
    deliver({ type: 'GET_NOTE', id: 'gone' });
    await answered();
    expect(heard).toEqual([expect.objectContaining({ type: 'ASK_FAILED', failure: { kind: 'not-found', message: expect.stringContaining('gone.md') } })]);
  });

  it('answers an error from the disk as failed where the ask does not declare its kind', async () => {
    deliver({ type: 'GET_NOTE', id: 'gone' }, 'a window', []);
    await answered();
    expect(heard).toEqual([expect.objectContaining({ type: 'ASK_FAILED', failure: { kind: 'failed', message: expect.stringContaining('gone.md') } })]);
  });

  it('answers an error it cannot place as failed, with what went wrong', async () => {
    deliver({ type: 'GET_NOTE', id: 'broken' });
    await answered();
    expect(heard).toEqual([expect.objectContaining({ type: 'ASK_FAILED', failure: { kind: 'failed', message: 'the disk gave out' } })]);
  });

  it('marks the ask taken, so the bus does not answer it as well', () => {
    expect(deliver({ type: 'DELETE_NOTE', id: 'kept' }).taken).toBe(true);
  });

  it('does the work when nobody asked, and tells no window of it', () => {
    deliver({ type: 'DELETE_NOTE', id: 'kept' }, 'nobody');
    expect(deleted).toEqual(['kept']);
    expect(heard).toEqual([]);
  });

  it('reports a failure nobody asked about, which no window would show', async () => {
    deliver({ type: 'GET_NOTE', id: 'broken' }, 'nobody');
    await answered();
    expect(heard).toEqual([]);
    expect(takeSystemErrors()).toEqual([expect.objectContaining({ title: 'GET_NOTE failed' })]);
  });
});

// What the compiler holds a system to. Never called: the subject is whether each line compiles
export function contractIsHeld(): void {
  // @ts-expect-error -- RENAME_NOTE has no handler: the table covers every ask
  spec.answers({ GET_NOTE: async () => ({ text: '' }), DELETE_NOTE: () => {} });
  spec.answers({
    GET_NOTE: ({ failure }) => {
      // @ts-expect-error -- `misplaced` is no kind GET_NOTE declares
      throw failure('misplaced', 'nowhere to be found');
    },
    DELETE_NOTE: () => {},
    // @ts-expect-error -- `name-taken` carries `existing`, which is required
    RENAME_NOTE: ({ failure }) => { throw failure('name-taken', 'Taken'); },
  });
  spec.answers({
    // @ts-expect-error -- the answer is the declared payload, not another shape
    GET_NOTE: () => ({ body: 'wrong field' }),
    DELETE_NOTE: () => {},
    RENAME_NOTE: ({ ask }) => ({ name: ask.name }),
  });
  spec.answers({
    GET_NOTE: async () => ({ text: '' }),
    DELETE_NOTE: () => {},
    RENAME_NOTE: ({ ask }) => ({ name: ask.name }),
    // @ts-expect-error -- SAVE_NOTE is no ask this system declares
    SAVE_NOTE: () => {},
  });
}
