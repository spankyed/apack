// A surface answers whoever asked it, and the channel depends on where that asker is.
//
// This is the window's half of `tests/bus/reply.spec.ts`, which covers the backend's. Until 2026-10-06 there was
// nothing to cover: `sendToSurfaceActor` opened a delivery naming only the surface, so every one of its nine call
// sites handed a surface's handler `reply: undefined` — including `connection.ts`, where the asking system's ref
// had arrived on the wire and was destructured away.
//
// Two askers can reach a surface and they are answered through different channels, which is the whole subject:
// a **backend system** is answered out over this window's connection, and a **surface in this window** is
// answered beside it, never touching the bus. A bare ref cannot tell them apart, since a feature's system and
// surface share one — so `_Asker` carries the way back, and the `does not go out onto the bus` case is what
// fails if that distinction is ever collapsed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, setup, type AnyEventObject, type MachineContext } from 'xstate';
import type { Surface } from '@apackdev/sdk/fe';
import { _currentDelivery, _replyTo, type Reply } from '@apackdev/sdk/events';
import { defineHandlers } from '@apackdev/sdk/framework';
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import { createShellMachine } from '../../../../src/fe/index.ts';
import { fakeShell, settle } from './fakes.ts';

const NOTES = 'default-setup/notes';
const THREADS = 'default-setup/threads';
/** A backend system, which is deliberately not the ref of the surface that answers — the two would otherwise be one string */
const MEMOS = 'memo-pack/memos';

/** Whether each handled event arrived with an answer to give, which is the one thing every case here reads */
let handed: Array<{ surface: string; type: string; canAnswer: boolean }>;
/** What a surface beside the answerer heard, so a local answer can be told from one that went nowhere */
let heard: Array<{ surface: string; type: string }>;

const handlers = defineHandlers<MachineContext, AnyEventObject>();

/**
 * The answer for `event`, where it is the message being delivered: what an ask's answer is sent through, read as
 * the `answers` table reads it, and nothing for an event the machine made itself
 */
const answerFor = (event: AnyEventObject): Reply | undefined => {
  const delivery = _currentDelivery();
  return delivery?.event === event ? _replyTo(delivery) : undefined;
};

/** A surface that answers an `ASK` and records whether its delivery gave it an answer to send */
function answering(id: string): Surface {
  const state = setup({
    actions: handlers.actions({
      note: ({ event }) => {
        const reply = answerFor(event);
        handed.push({ surface: id, type: event.type, canAnswer: reply !== undefined });
        if (event.type !== 'ASK') return;
        reply?.({ type: 'ANSWER', asked: event.tag as string });
      },
      overhear: ({ event }) => { heard.push({ surface: id, type: event.type }); },
    }),
  }).createMachine({
    on: {
      ASK: { actions: 'note' },
      SURFACE_ACTIVATED: { actions: 'note' },
      NEWS: { actions: 'note' },
      ANSWER: { actions: 'overhear' },
    },
  });
  return { id, label: id, icon: 'Zap', state, canvas: {} } as unknown as Surface;
}

/** One window: its shell, its subscription, its own copies of both surfaces' actors */
function windowWithSurfaces() {
  const shell = fakeShell({ surfaces: [answering(NOTES), answering(THREADS)] });
  const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: false } }).start();
  shell.client.connect();
  return { shell, app };
}

let main: ReturnType<typeof windowWithSurfaces>;
/** A second window, to prove an answer reaches one of them. It binds no frontend host: a process is one window */
let popout: ReturnType<typeof windowWithSurfaces>;

const answersOut = () => main.shell.client.send.mock.calls.map(([message]) => message);

beforeEach(async () => {
  handed = [];
  heard = [];
  main = windowWithSurfaces();
  popout = windowWithSurfaces();
  // The SDK's frontend sends and `_replyTo` read the bound host; the renderer binds one per window at boot
  startFeTestRuntime({ application: main.app, client: main.shell.client });
  // The shell opens on a surface as it starts, which is traffic no case here is about: let it finish, then forget it
  await settle();
  handed = [];
  heard = [];
  main.shell.client.send.mockClear();
  popout.shell.client.send.mockClear();
});

afterEach(() => {
  stopFeTestRuntime();
  main.app.stop();
  popout.app.stop();
});

describe('a surface asked by a backend system', () => {
  it('answers that system over its own connection', async () => {
    main.shell.client.receive({ to: NOTES, event: { type: 'ASK', tag: 'from-a-system' }, sender: MEMOS });
    await settle();

    expect(handed, 'the asking system arrived on the wire, so there is an answer to give')
      .toEqual([{ surface: NOTES, type: 'ASK', canAnswer: true }]);
    expect(answersOut()).toEqual([
      { to: MEMOS, call: expect.any(String), event: { type: 'ANSWER', asked: 'from-a-system' }, sender: NOTES, answering: undefined },
    ]);
  });

  /**
   * The reason the answer goes out rather than in, with the asker chosen so the two can be told apart.
   *
   * A feature's system and surface **share one ref**, so `default-setup/threads` names a backend system *and* a
   * surface running in this window. An answer handed to the window-local channel by mistake reaches that surface
   * and the system never hears it — and the ref alone cannot catch it, which is why the delivery carries the
   * way back. With `MEMOS` as the asker this case could not fail at all: nothing here is registered at that
   * ref, so a misrouted answer would be refused rather than delivered, and the case would pass over nothing.
   */
  it('does not hand the answer to the surface that shares the asking system\'s ref', async () => {
    main.shell.client.receive({ to: NOTES, event: { type: 'ASK', tag: 'outward' }, sender: THREADS });
    await settle();

    expect(heard, 'the surface at that ref is not who asked').toEqual([]);
    expect(answersOut(), 'the system at that ref is').toEqual([
      { to: THREADS, call: expect.any(String), event: { type: 'ANSWER', asked: 'outward' }, sender: NOTES, answering: undefined },
    ]);
  });

  // The other window's copy of the surface was not asked, so it neither answers nor hears one
  it('leaves the other window out of it', async () => {
    main.shell.client.receive({ to: NOTES, event: { type: 'ASK', tag: 'one-window' }, sender: MEMOS });
    await settle();

    expect(popout.shell.client.send).not.toHaveBeenCalled();
  });
});

describe('a surface asked by another surface in the same window', () => {
  /** What the renderer's `sendToSurface` builds: the shell's request, carrying the asking surface's address */
  const askLocally = (tag: string) => main.app.send({
    type: 'SEND_TO_SURFACE', surface: NOTES, events: [{ type: 'ASK', tag }], asker: { kind: 'window', ref: THREADS },
  });

  it('answers that surface beside it', async () => {
    askLocally('from-a-surface');
    await settle();

    expect(handed).toEqual([{ surface: NOTES, type: 'ASK', canAnswer: true }]);
    expect(heard, 'the asking surface in this window has its answer')
      .toEqual([{ surface: THREADS, type: 'ANSWER' }]);
  });

  /**
   * **The case the `_Asker` variant exists for.** Collapse `window` into `bus` in `_replyTo` and this is what
   * fails: the answer leaves for the backend, which would route it to every window showing that surface.
   */
  it('does not go out onto the bus', async () => {
    askLocally('stays-here');
    await settle();

    expect(answersOut(), 'a window answers a window without the backend hearing it').toEqual([]);
    expect(popout.shell.client.send).not.toHaveBeenCalled();
  });
});

/**
 * Nobody asked, which is most of what a surface handles and must stay distinguishable from an ask.
 *
 * `reply` being absent is how a handler knows to broadcast or do nothing instead, so a delivery that invents an
 * asker is worse than one that omits it: the six features' `answer()` helpers all branch on exactly this.
 */
describe('a surface that nobody asked', () => {
  it('is handed nothing for a backend send that named no sender', async () => {
    main.shell.client.receive({ to: NOTES, event: { type: 'NEWS' } });
    await settle();

    expect(handed).toEqual([{ surface: NOTES, type: 'NEWS', canAnswer: false }]);
  });

  // The shell's own lifecycle: an activation is a fact about the window, with nobody waiting on an answer.
  // THREADS rather than NOTES, which the shell already opened on as the default — selecting it again is a no-op
  it('is handed nothing for the activation the shell raises itself', async () => {
    main.app.send({ type: 'SELECT_SURFACE', surface: THREADS });
    await settle();

    expect(handed.filter(({ type }) => type === 'SURFACE_ACTIVATED'))
      .toEqual([{ surface: THREADS, type: 'SURFACE_ACTIVATED', canAnswer: false }]);
  });

  // An in-window send that named no asker, which is what the host's own `_sendToLocalSurface` callers make
  it('is handed nothing for an in-window send that named no sender', async () => {
    main.app.send({ type: 'SEND_TO_SURFACE', surface: NOTES, events: [{ type: 'NEWS' }] });
    await settle();

    expect(handed).toEqual([{ surface: NOTES, type: 'NEWS', canAnswer: false }]);
  });
});
