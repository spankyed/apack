import { createNativePackTestRegistry } from '@apackdev/host/testing';
// The delivery scope lasts exactly as long as the call that delivers the message, and no longer.
//
// That is a decision, not a limitation left in place. It was an `AsyncLocalStorage` while `reply()` read the
// scope at the moment it was called, because a backend handler routinely answers after an `await`. A handler
// is handed its answer now — built synchronously as the handler is entered — so nothing reads the scope late,
// and the store bought one thing it should not have: anything the handler *created* inherited it, a timer
// included, so a send made minutes later carried an asker who had long stopped waiting.
//
// This file is what keeps the limit honest. Without it the next person to make a handler `await` before
// sending would find the sender missing and read it as a bug rather than as the shape.
import { beforeEach, describe, expect, it } from 'vitest';
import { startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { _currentDelivery, untypedSendToSystem } from '@apackdev/sdk/events';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { deliverAs } from '../../src/bus/delivery.ts';

startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: createNativePackTestRegistry() });

const ASKED = { to: 'pack/feature', sender: 'pack/asker', client: 'c-1' };

let sent: Array<string | undefined>;
let stop: () => void;

beforeEach(() => {
  sent = [];
  stop?.();
  stop = testRootEvents.onIncoming((message) => sent.push(message.sender));
});

const send = () => untypedSendToSystem('pack/other', { type: 'PING' });

/**
 * A timer a handler schedules, which is the subject of a case below rather than a wait for something else.
 *
 * The async store this replaced was inherited by anything the handler created, so a send from here carried
 * the asker — minutes later, in the general case, long after they had stopped waiting.
 */
const onATimer = (run: () => void) => new Promise<void>((done) => { setTimeout(() => { run(); done(); }, 1); });

describe('a send made while handling a message', () => {
  it('carries the handler as its sender', () => {
    deliverAs(ASKED, { type: 'ASKED' }, () => { send(); });

    expect(sent).toEqual(['pack/feature']);
  });

  it('carries none once the delivery has returned', () => {
    deliverAs(ASKED, { type: 'ASKED' }, () => {});
    send();

    expect(sent, 'nothing is being handled out here').toEqual([undefined]);
  });

  /**
   * The two the async store used to cover, and the reason it does not any more.
   *
   * An answer owed to this message is taken at entry and carried; what happens after the handler yields is no
   * longer part of handling it. A timer is the sharper of the two — the store would have named an asker who
   * stopped waiting long before it fired.
   */
  it('carries none after an await, because the handling has ended', async () => {
    await deliverAs(ASKED, { type: 'ASKED' }, async () => {
      await Promise.resolve();
      send();
    });

    expect(sent).toEqual([undefined]);
  });

  it('carries none from a timer the handler scheduled', async () => {
    let fired!: Promise<void>;
    deliverAs(ASKED, { type: 'ASKED' }, () => { fired = onATimer(send); });
    await fired;

    expect(sent).toEqual([undefined]);
  });

  // Two deliveries nested or in sequence each restore what was being handled before them
  it('restores the message that was being handled around it', () => {
    deliverAs(ASKED, { type: 'ASKED' }, () => {
      deliverAs({ to: 'pack/inner', sender: 'pack/outer-asker' }, { type: 'ASKED' }, () => { send(); });
      send();
    });

    expect(sent).toEqual(['pack/inner', 'pack/feature']);
    expect(_currentDelivery(), 'and leaves nothing behind').toBeUndefined();
  });
});
