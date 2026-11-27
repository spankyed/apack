import { createNativePackTestRegistry } from '@apackdev/host/testing';
// A send to a system that declares no such event is reported, not ignored in silence.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { untypedTell, type Message } from '@apackdev/sdk/events';
import { createAppBus, type BackendBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const MEMOS = 'memo-pack/memos';

/** A system that declares one event, which is what makes any other one undeclared */
const memos = state<{}, { type: 'PING' }>()({ on: { PING: () => {} } });

let bus: BackendBus;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const reported = () => takeSystemErrors()
  .filter((error) => error.operation === 'tell')
  .map((error) => error.message);

beforeEach(async () => {
  registry.registerPack({ id: 'memo-pack', features: { memos: { system: { machine: memos, receives: ['PING'] } } } });
  bus = createAppBus(registry).start();
  testRootEvents.emitConnected();
  await flush();
  takeSystemErrors();
});

afterEach(() => {
  bus.stop();
  registry.unregisterPack('memo-pack');
  takeSystemErrors();
});

const send = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

describe('a send to a system that declares no such event', () => {
  it('is reported, naming the system and the type', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    const [message] = reported();
    expect(message).toContain('Sent "NOT_DECLARED"');
    expect(message).toContain(`to the "${MEMOS}" system, which declares no such event`);
  });

  it('says what to do about it', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(reported()[0]).toContain("add it there, or send an event the system handles");
  });

  it('names who sent it when the send said', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' }, from: 'memo-pack', via: 'action:Do It' });
    await flush();

    expect(reported()[0]).toContain('by "memo-pack" (action:Do It)');
  });

  it('reports a repeat once', async () => {
    for (let i = 0; i < 3; i++) send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(reported()).toHaveLength(1);
  });
});

describe('what it leaves alone', () => {
  it('says nothing about an event the system declares', async () => {
    send({ to: MEMOS, event: { type: 'PING' } });
    await flush();

    expect(reported()).toEqual([]);
  });

  it('says nothing about an event every system receives', async () => {
    send({ to: MEMOS, event: { type: 'FEATURE_SETTINGS_UPDATED', settings: {} } });
    await flush();

    expect(reported()).toEqual([]);
  });

  it('says nothing to a system that declares a wildcard', async () => {
    registry.unregisterPack('memo-pack');
    registry.registerPack({
      id: 'memo-pack',
      features: { memos: { system: { machine: memos, receives: ['*'] } } },
    });
    bus.stop();
    bus = createAppBus(registry).start();
    testRootEvents.emitConnected();
    await flush();
    takeSystemErrors();

    send({ to: MEMOS, event: { type: 'ANYTHING_AT_ALL' } });
    await flush();

    expect(reported()).toEqual([]);
  });

  it('says nothing about a system that is not running', async () => {
    send({ to: 'memo-pack/absent', event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(reported()).toEqual([]);
  });

  it('reports an undeclared event to a system that handles it, and still delivers it', async () => {
    const seen: string[] = [];
    registry.unregisterPack('memo-pack');
    registry.registerPack({
      id: 'memo-pack',
      features: {
        memos: {
          system: {
            machine: state<{}, { type: 'PING' } | { type: 'NOT_DECLARED' }>()({
              on: {
                PING: () => {},
                NOT_DECLARED: (event) => { seen.push(event.type); },
              },
            }),
            receives: ['PING'],
          },
        },
      },
    });
    bus.stop();
    bus = createAppBus(registry).start();
    testRootEvents.emitConnected();
    await flush();

    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(seen, 'reported, and delivered as before').toContain('NOT_DECLARED');
    expect(reported()[0]).toContain('Sent "NOT_DECLARED"');
  });
});

describe('an answer to a system that declares no such event', () => {
  const answer = (type: string) => { send({ to: MEMOS, event: { type }, answering: 'c-asked' }); };
  const answers = () => reported();

  it('is marked as an answer, and still reported as this function\'s own', async () => {
    answer('NOT_DECLARED');
    await flush();

    const [error] = takeSystemErrors();
    expect(error?.answering).toBe(true);
    expect(error?.operation, 'so the direction filter above keeps finding it').toBe('tell');
  });

  it('says why an answer can be undeclared, rather than pointing at the contract alone', async () => {
    answer('NOT_DECLARED');
    await flush();

    const [message] = answers();
    expect(message).toContain('Answered "NOT_DECLARED"');
    expect(message, "the asking side's incoming is what reply cannot be checked against")
      .toContain("cannot be checked against the asking system's incoming");
  });

  it('reports a send and an answer of the same type separately', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    answer('NOT_DECLARED');
    await flush();

    const all = takeSystemErrors();
    expect(all).toHaveLength(2);
    expect(all.map((error) => error.answering)).toEqual([undefined, true]);
  });
});

describe('through the untyped send', () => {
  it('reports what untypedTell could not have been typed out of', async () => {
    untypedTell(MEMOS, { type: 'BUILT_FROM_DATA' });
    await flush();

    expect(reported()[0]).toContain('Sent "BUILT_FROM_DATA"');
  });
});
