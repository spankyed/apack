import { createNativePackTestRegistry } from '@apackdev/host/testing';
// A system can ask one window as well as all of them, which is the other half of being answerable.
//
// `reply` let a window answer a system. Asking was still a broadcast, so one question collected one answer
// per open window — the system got N replies to a thing it asked once. `sendToWindow` addresses one
// connection instead, and the connection is **given** to it: a handler is handed the window it is serving
// (`client`, beside `reply`), which is what lets the address outlive an `await`.
//
// The pair is the subject. `broadcastToSurface` is news every window needs; `sendToWindow` is for what only
// the window that asked should act on, and the cases below are the same send differing in `Message.client`.
//
// Which window a handler is *handed* is `apack-sdk`'s `define-system-actions.spec.ts`; this file is what
// the send does with one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { untypedBroadcastToSurface, untypedSendToWindow, type Message } from '@apackdev/sdk/events';
import { startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { deliverAs } from '../../src/bus/delivery.ts';

startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: createNativePackTestRegistry() });

const MEMOS = 'memo-pack/memos';
/** A window's ask: the API stamps the connection it arrived on, which is what makes it addressable */
const FROM_A_WINDOW = { to: MEMOS, sender: MEMOS, client: 'c-main' };

let sent: Message[];
let stop: () => void;

beforeEach(() => {
  sent = [];
  stop = testRootEvents.onSurfaceSend((message) => { sent.push(message); });
});
afterEach(() => stop());

const addressed = () => sent.map(({ to, client }) => ({ to, client }));

describe('a system serving one window', () => {
  it('reaches that window alone', () => {
    deliverAs(FROM_A_WINDOW, { type: 'ASKED' }, () => {
      untypedSendToWindow('c-main', MEMOS, { type: 'MEMO_ADDED' });
    });

    expect(addressed()).toEqual([{ to: MEMOS, client: 'c-main' }]);
  });

  // The pair: the same send, broadcast, names no connection — which is how the bus reaches every window
  it('reaches every window when it broadcasts instead', () => {
    deliverAs(FROM_A_WINDOW, { type: 'ASKED' }, () => {
      untypedBroadcastToSurface(MEMOS, { type: 'MEMO_ADDED' });
    });

    expect(sent.map(({ client }) => client), 'absent means every connection').toEqual([undefined]);
  });

  // It is a send like any other, so it still says who made it — the window can answer it
  it('carries the handling feature as its sender', () => {
    deliverAs(FROM_A_WINDOW, { type: 'ASKED' }, () => {
      untypedSendToWindow('c-main', MEMOS, { type: 'MEMO_ADDED' });
    });

    expect(sent[0].sender, 'so the window it asks can answer *it*').toBe(MEMOS);
  });

  /** A reply goes to the asker; this goes to a surface of the sender's choosing in that same window */
  it('addresses a different surface on that connection', () => {
    deliverAs({ to: MEMOS, sender: MEMOS, client: 'c-popout' }, { type: 'ASKED' }, () => {
      untypedSendToWindow('c-popout', 'memo-pack/sidebar', { type: 'MEMO_ADDED' });
    });

    expect(addressed()).toEqual([{ to: 'memo-pack/sidebar', client: 'c-popout' }]);
  });

  // Two windows asking the same thing are served separately, which is what one-answer-per-ask means
  it('serves each window on its own connection', () => {
    for (const client of ['c-main', 'c-popout']) {
      deliverAs({ to: MEMOS, sender: MEMOS, client }, { type: 'ASKED' }, () => {
        untypedSendToWindow(client, MEMOS, { type: 'MEMO_ADDED' });
      });
    }

    expect(sent.map(({ client }) => client)).toEqual(['c-main', 'c-popout']);
  });
});

/**
 * **The reason the connection is a parameter.** A handler that awaits before it acts is the ordinary shape
 * of backend work, and the delivery is gone by the time it resumes — so a send that looked the connection
 * up when called would reach nothing here. Handed, the address is still right.
 *
 * What does *not* survive is `Message.sender`, which `answerAddress()` reads when the send is made. So the
 * window gets the event and cannot answer it. That is the documented limit of the sender stamp rather than
 * a fault in this send, and it is pinned here because surviving the await is this change's whole point.
 */
describe('after the delivery has ended', () => {
  it('still reaches the window it was serving', async () => {
    let later: (() => void) | undefined;
    deliverAs(FROM_A_WINDOW, { type: 'ASKED' }, () => {
      const client = 'c-main';
      later = () => untypedSendToWindow(client, MEMOS, { type: 'MEMO_ADDED' });
    });

    await Promise.resolve();
    later!();

    expect(addressed(), 'the address was carried, not looked up').toEqual([{ to: MEMOS, client: 'c-main' }]);
  });

  it('carries no sender, so that window cannot answer it', async () => {
    let later: (() => void) | undefined;
    deliverAs(FROM_A_WINDOW, { type: 'ASKED' }, () => {
      later = () => untypedSendToWindow('c-main', MEMOS, { type: 'MEMO_ADDED' });
    });

    await Promise.resolve();
    later!();

    expect(sent[0].sender, 'the stamp is read at send time, and nothing is being handled now').toBeUndefined();
  });
});

/**
 * No connection is refused rather than widened.
 *
 * The type says `string`, so a handler holding `client?: string` cannot call this until it has said what it
 * does without a window — reaching here takes a cast or untyped code. It is still worth refusing, because
 * the one wrong value turns a send to one window into a send to all of them, which nothing at the call site
 * would show.
 */
describe('given no connection', () => {
  it('refuses rather than reaching every window', () => {
    expect(() => deliverAs(FROM_A_WINDOW, { type: 'ASKED' }, () => {
      untypedSendToWindow(undefined as unknown as string, MEMOS, { type: 'MEMO_ADDED' });
    })).toThrow(/was given no connection/);

    expect(sent, 'and nothing was sent in its place').toEqual([]);
  });

  // The error names where a handler gets one, and the verb that does reach every window
  it('says where a connection comes from and what to use instead', () => {
    expect(() => untypedSendToWindow('', MEMOS, { type: 'MEMO_ADDED' }))
      .toThrow(/handed the one it is serving as `client`[\s\S]*broadcastToSurface/);
  });
});
