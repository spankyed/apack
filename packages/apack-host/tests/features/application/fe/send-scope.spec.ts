// The two sends differ in reach, and nothing pinned it until now — which is how `OPEN_SURFACE_FROM_APP` came about:
// a backend `OPEN_SURFACE` reaches every window, so a popout would have followed the main window's navigation, and
// the event had to be renamed and guarded per window instead.
//
// `broadcastToSurface` (backend, over the bus) reaches **every** window showing that surface, because a surface runs
// once per window. The renderer's `sendToSurface` reaches this window's only. Two shells over one backend is the
// cheapest faithful way to say that: each shell is a window, and the bus delivers to both subscriptions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, setup } from 'xstate';
import type { Surface } from '@apackdev/sdk/fe';
import { createShellMachine } from '../../../../src/fe/index.ts';
import { _currentDelivery } from '@apackdev/sdk/events';
import { fakeShell, settle } from './fakes.ts';

/** What each window's copy of the surface heard */
let heard: Array<{ window: string; type: string }>;

function recording(id: string, window: string): Surface {
  const state = setup({}).createMachine({
    on: { '*': { actions: ({ event }) => { if (!event.type.startsWith('SURFACE_')) heard.push({ window, type: event.type }); } } },
  });
  return { id, label: id, icon: 'Zap', state, canvas: {} } as unknown as Surface;
}

/**
 * A window: its own shell, its own client subscription, its own copy of the surface's actor. Each `createActor` is
 * its own XState system, so two windows' surfaces can share an id — but the shell must be registered at
 * `host/application` in each, since that is the id its own code resolves surfaces against.
 */
function windowNamed(name: string) {
  const shell = fakeShell({ surfaces: [recording('default-setup/notes', name), recording('default-setup/threads', name)] });
  const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: false } }).start();
  shell.client.connect();
  return { shell, app };
}

let main: ReturnType<typeof windowNamed>;
let popout: ReturnType<typeof windowNamed>;

beforeEach(() => {
  heard = [];
  main = windowNamed('main');
  popout = windowNamed('popout');
});
afterEach(() => { main.app.stop(); popout.app.stop(); });

/**
 * The delivery scope on the shell's path, which is one of the four places a message gets named and the only one
 * that runs in a browser.
 *
 * Without it a surface's own `sendToSystem` carries no `Message.sender`, so the system it asks has no address to
 * answer and `reply` throws — for the commonest request in the app, a view asking its own system for data. The
 * scope is read here directly, because what this pins is whether it is set at all.
 */
describe('a surface handling what the shell gave it', () => {
  /** A window whose surface records the delivery in scope for every event it handles */
  function watching() {
    const seen: Array<{ type: string; receiver: string | undefined }> = [];
    const state = setup({}).createMachine({
      on: { '*': { actions: ({ event }) => { seen.push({ type: event.type, receiver: _currentDelivery()?.receiver }); } } },
    });
    const shell = fakeShell({
      surfaces: [{ id: 'default-setup/notes', label: 'notes', icon: 'Zap', state, canvas: {} } as unknown as Surface],
    });
    const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: false } }).start();
    shell.client.connect();
    return { seen, shell, app };
  }

  const receiverFor = (seen: Array<{ type: string; receiver: string | undefined }>, type: string) =>
    seen.find((entry) => entry.type === type)?.receiver;

  it('names it for a message the backend sent', async () => {
    const w = watching();
    try {
      await settle();

      w.shell.client.receive({ to: 'default-setup/notes', event: { type: 'SELECT_ARTIFACT', artifactId: 'a1' } });
      await settle();

      expect(receiverFor(w.seen, 'SELECT_ARTIFACT'), 'so a send the handler makes can be answered back here')
        .toBe('default-setup/notes');
    } finally {
      w.app.stop();
    }
  });

  /**
   * And for the lifecycle, which is where it matters most: a view that asks its system for data when it opens is
   * the commonest request in the app, and `SURFACE_ACTIVATED` is when it asks.
   */
  it('names it for the activation the shell raises itself', async () => {
    const w = watching();
    try {
      await settle();
      w.app.send({ type: 'SELECT_SURFACE', surface: 'default-setup/notes' });
      await settle();

      expect(receiverFor(w.seen, 'SURFACE_ACTIVATED')).toBe('default-setup/notes');
    } finally {
      w.app.stop();
    }
  });

  /**
   * And as soon as it starts, shown or not — where a surface asks for what it starts from. Its machine's own entry
   * runs in no delivery at all, so an ask made there carries no sender and its answer has nowhere to go.
   */
  it('names it for the start the shell hands every surface it spawns', async () => {
    const w = watching();
    try {
      await settle();
      expect(receiverFor(w.seen, 'SURFACE_STARTED')).toBe('default-setup/notes');
      expect(w.seen.filter((entry) => entry.type === 'SURFACE_STARTED'), 'once').toHaveLength(1);
    } finally {
      w.app.stop();
    }
  });

  /**
   * And for a surface spawned while the shell is running, which is every pack's: its frontend loads after the
   * window connects. The shell then runs its actions at once, before the child it spawned has started.
   */
  it('names it for the start of a surface a pack frontend brings later', async () => {
    const w = watching();
    try {
      await settle();
      const seen: Array<{ type: string; receiver: string | undefined }> = [];
      const state = setup({}).createMachine({
        on: { '*': { actions: ({ event }) => { seen.push({ type: event.type, receiver: _currentDelivery()?.receiver }); } } },
      });
      const later = { id: 'ext/own', label: 'own', icon: 'Zap', state, canvas: {} } as unknown as Surface;
      w.shell.acceptSurface(later);
      w.app.send({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [later] });
      await settle();

      expect(receiverFor(seen, 'SURFACE_STARTED')).toBe('ext/own');
      expect(seen.filter((entry) => entry.type === 'SURFACE_STARTED'), 'once').toHaveLength(1);
    } finally {
      w.app.stop();
    }
  });
});

describe('how far each send reaches', () => {
  it('delivers a backend send to that surface in every window', async () => {
    // What the bus does with a `broadcastToSurface`: it goes out on every window's subscription
    for (const w of [main, popout]) w.shell.client.receive({ to: 'default-setup/threads', event: { type: 'SELECT_ARTIFACT', artifactId: 'a1' } });
    await settle();

    expect(heard).toEqual([
      { window: 'main', type: 'SELECT_ARTIFACT' },
      { window: 'popout', type: 'SELECT_ARTIFACT' },
    ]);
  });

  /**
   * A backend send reaches the window whole — the subscription carries the message, not just its event — so the
   * one warning the shell has for an undeliverable one can name the sender too. This is the third of the three
   * places a sender is worth saying; the bus covers its own drops and `notify.error` covers the in-window send.
   */
  it('names the sending pack when a backend send reaches no running surface', async () => {
    await settle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    main.shell.client.receive({ to: 'memo-pack/memoz', from: 'memo-pack', event: { type: 'MEMO_ADDED' } });
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No surface is running at memo-pack/memoz for MEMO_ADDED sent by "memo-pack"'));
    warn.mockRestore();
  });

  // An action's send carries the action as well as its pack, and the subscription carries the whole message, so
  // this warning names both
  it('names the action too, for a send an action made', async () => {
    await settle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    main.shell.client.receive({ to: 'memo-pack/memoz', from: 'memo-pack', via: 'action:Add Memo', event: { type: 'MEMO_ADDED' } });
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sent by "memo-pack" (action:Add Memo)'));
    warn.mockRestore();
  });

  /**
   * `Message.from` is stamped by the sends `#generated/events` builds, and the in-window send carries it on the
   * shell's `SEND_TO_SURFACE`. It is worth carrying only if something reads it: this is the one place the renderer
   * can say who sent an event it couldn't deliver, and the backend's bus already does the same for its drops.
   */
  it('names the sending pack when the send reaches no surface', async () => {
    await settle();

    main.app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'ADD_MEMO' }], from: 'memo-pack' });
    await settle();

    expect(main.shell.notify.error).toHaveBeenCalledWith(
      "Couldn't reach memo-pack/memoz",
      'No surface is declared at "memo-pack/memoz". Sent by "memo-pack".',
    );
  });

  // The in-window send carries `via` on `SEND_TO_SURFACE` as it carries `from`, so this refusal names both too
  it('names the action too, for a send an action made', async () => {
    await settle();

    main.app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'ADD_MEMO' }], from: 'memo-pack', via: 'action:Add Memo' });
    await settle();

    expect(main.shell.notify.error).toHaveBeenCalledWith(
      "Couldn't reach memo-pack/memoz",
      'No surface is declared at "memo-pack/memoz". Sent by "memo-pack" (action:Add Memo).',
    );
  });

  // The host's own sends stamp nothing, so the message reads the same minus the clue rather than saying one is missing
  it('reads the same when the send carries no sender', async () => {
    await settle();

    main.app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'ADD_MEMO' }] });
    await settle();

    expect(main.shell.notify.error).toHaveBeenCalledWith(
      "Couldn't reach memo-pack/memoz",
      'No surface is declared at "memo-pack/memoz".',
    );
  });

  it("delivers the renderer's send to the window it was made in, and to no other", async () => {
    // Both windows have finished loading pack frontends, so neither has a reason to queue
    await settle();

    // What `_sendToLocalSurface` does: one window's shell, never the bus
    main.app.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'SELECT_ARTIFACT', artifactId: 'a1' }] });
    await settle();

    expect(heard).toEqual([{ window: 'main', type: 'SELECT_ARTIFACT' }]);
    // And it went nowhere near the backend: routing it through the bus would have reached the popout too
    expect(main.shell.client.send).not.toHaveBeenCalled();
    expect(popout.shell.client.send).not.toHaveBeenCalled();
  });
});
