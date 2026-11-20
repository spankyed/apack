// A system's answers: a handler returns what it answers with, and whoever asked hears it whichever way the handler
// ends. The cases drive a real machine inside a delivery, as the bus does, and read what the asker was sent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, setup } from 'xstate';
import { defineSystem } from '../../src/framework/define-system.ts';
import { _runDelivery, type AskFailedEvent } from '../../src/events/index.ts';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '../../src/testing/index.ts';

startTestRuntime();

type Incoming =
  | { type: 'GET_NOTE'; id: string }
  | { type: 'DELETE_NOTE'; id: string }
  | { type: 'RENAME_NOTE'; id: string; name: string };

type Contract = {
  context: { deleted: string[] };
  incoming: Incoming;
  outgoing:
    | { type: 'NOTE_LOADED'; text: string }
    | { type: 'NOTE_WRITTEN' }
    | AskFailedEvent<'not-found' | 'locked', Incoming['type']>;
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
  GET_NOTE: async ({ event }) => ({ type: 'NOTE_LOADED', text: await notes[event.id]!() }),
  DELETE_NOTE: ({ event }) => { deleted.push(event.id); },
  RENAME_NOTE: ({ event }) => {
    if (event.name === '') throw spec.failure('locked', 'A note needs a name');
    return { type: 'NOTE_WRITTEN' };
  },
}, {
  landed: { type: 'NOTE_WRITTEN' },
  source: 'notes',
  kindOf: (error) => ((error as { code?: string }).code === 'ENOENT' ? 'not-found' : undefined),
});

const machine = setup({ types: spec.types, actions: { ...answers.actions } })
  .createMachine({ context: { deleted: [] }, on: { ...answers.on } });

let heard: Array<Record<string, unknown>>;
let stopListening: () => void;
beforeEach(() => {
  heard = [];
  deleted.length = 0;
  stopListening = testRootEvents.onSurfaceSend((message) => { heard.push({ ...message.event, to: message.to, client: message.client }); });
});
afterEach(() => { stopListening(); takeSystemErrors(); });

/** Delivers `event` to a running system as the bus does: from a window that asked, or from nobody */
function deliver(event: Incoming, from: 'a window' | 'nobody' = 'a window') {
  const system = createActor(machine).start();
  const asker = from === 'a window' ? { asker: { kind: 'connection', ref: 'pack/notes', client: 'c-1' } } as const : {};
  _runDelivery({ receiver: 'pack/notes', event, ...asker }, () => system.send(event));
}

/** Lets an asynchronous handler finish and its answer be sent */
const answered = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("a system's answers", () => {
  it('answers the window that asked with what the handler returned', async () => {
    deliver({ type: 'GET_NOTE', id: 'kept' });
    await answered();
    expect(heard).toEqual([{ type: 'NOTE_LOADED', text: 'the text', to: 'pack/notes', client: 'c-1' }]);
  });

  it('answers that it landed for a handler that returns nothing, before the delivery is over', () => {
    deliver({ type: 'DELETE_NOTE', id: 'kept' });
    expect(deleted).toEqual(['kept']);
    expect(heard).toEqual([{ type: 'NOTE_WRITTEN', to: 'pack/notes', client: 'c-1' }]);
  });

  it('answers a refusal the handler threw with the kind it named', () => {
    deliver({ type: 'RENAME_NOTE', id: 'kept', name: '' });
    expect(heard).toEqual([{ type: 'ASK_FAILED', asked: 'RENAME_NOTE', failure: { kind: 'locked', message: 'A note needs a name' }, to: 'pack/notes', client: 'c-1' }]);
  });

  it('answers an error it can place with the kind the system reads off it', async () => {
    deliver({ type: 'GET_NOTE', id: 'gone' });
    await answered();
    expect(heard).toEqual([expect.objectContaining({ type: 'ASK_FAILED', asked: 'GET_NOTE', failure: { kind: 'not-found', message: expect.stringContaining('gone.md') } })]);
  });

  it('answers an error it cannot place as failed, with what went wrong', async () => {
    deliver({ type: 'GET_NOTE', id: 'broken' });
    await answered();
    expect(heard).toEqual([expect.objectContaining({ type: 'ASK_FAILED', failure: { kind: 'failed', message: 'the disk gave out' } })]);
  });

  it('does the work when nobody asked, and tells no window of it', () => {
    deliver({ type: 'DELETE_NOTE', id: 'kept' }, 'nobody');
    expect(deleted).toEqual(['kept']);
    expect(heard).toEqual([]);
  });

  it('reports a failure nobody asked about, which no window would show', async () => {
    deliver({ type: 'GET_NOTE', id: 'broken' }, 'nobody');
    await answered();
    expect(heard.filter(event => event.type === 'ASK_FAILED')).toEqual([]);
    expect(takeSystemErrors()).toEqual([expect.objectContaining({ title: 'GET_NOTE failed' })]);
  });
});

// What the compiler holds a system to. Never called: the subject is whether each line compiles
export function contractIsHeld(): void {
  // @ts-expect-error -- `misplaced` is no kind this contract's asks fail as
  spec.failure('misplaced', 'nowhere to be found');
  // @ts-expect-error -- `SAVE_NOTE` is no event this system receives
  spec.answers({ SAVE_NOTE: () => {} }, { landed: { type: 'NOTE_WRITTEN' }, source: 'notes' });
  // @ts-expect-error -- a refusal is thrown, never returned: an answer is one of the system's other events
  spec.answers({ DELETE_NOTE: () => ({ type: 'ASK_FAILED', asked: 'DELETE_NOTE', failure: { kind: 'failed', message: '' } }) }, { landed: { type: 'NOTE_WRITTEN' }, source: 'notes' });
}
