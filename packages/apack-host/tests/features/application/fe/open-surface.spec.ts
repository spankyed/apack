// Opening a surface is the shell's command (OPEN_SURFACE), because only the shell knows which pack frontends are still
// loading: a surface asked for while its pack loads opens once it arrives, one no pack provides is refused once
// loading settles, and one whose pack goes away meanwhile is dropped.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, setup, type Actor } from 'xstate';
import type { Surface } from '@apackdev/sdk/fe';
import { createShellMachine, type ShellMachine } from '../../../../src/fe/index.ts';
import type { ShellEvent } from '../../../../src/features/application/fe/types.ts';
import { fakeShell, settle } from './fakes.ts';

/** What reached each surface, in order, and whether it was open then */
let heard: Array<{ surface: string; type: string; open: boolean }>;
let app: Actor<ShellMachine>;
let shell: ReturnType<typeof fakeShell>;

/** A surface whose actor records every event it receives, and whether the shell had it open */
function recording(id: string): Surface {
  const state = setup({}).createMachine({
    on: {
      '*': {
        actions: ({ event }) => {
          heard.push({ surface: id, type: event.type, open: app?.getSnapshot().context.activeSurface.id === id });
        },
      },
    },
  });
  return { id, label: id, icon: 'Zap', state, canvas: {} } as unknown as Surface;
}

const opened = () => app.getSnapshot().context.activeSurface.id;
const eventsOf = (surface: string) => heard.filter((h) => h.surface === surface && !h.type.startsWith('SURFACE_'));

beforeEach(() => {
  heard = [];
  shell = fakeShell({ surfaces: [recording('default-setup/notes'), recording('default-setup/settings')] });
  app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: false } }).start();
});

afterEach(() => app.stop());

/** The window connects and its pack frontend loader reads the loaded packs, loading `packs` */
async function connectLoading(packs: Array<{ id: string; surfaces: Surface[] }>, release?: Promise<void>) {
  shell.client.loadedPacks.mockResolvedValue(packs.map(({ id }) => ({ id, feEntry: 'runtime/fe.js' })));
  shell.packFrontends.load.mockImplementation(async (pack) => {
    await release;
    return packs.find((p) => p.id === pack.id)?.surfaces ?? null;
  });
  shell.client.connect();
}

it('opens a registered surface and hands it the events, once it is open', async () => {
  await connectLoading([]);
  await settle();

  app.send({ type: 'OPEN_SURFACE', surface: 'default-setup/settings', events: [{ type: 'FEATURE.SELECT', featureId: 'default-setup/logs' }] });

  expect(opened()).toBe('default-setup/settings');
  expect(eventsOf('default-setup/settings')).toEqual([{ surface: 'default-setup/settings', type: 'FEATURE.SELECT', open: true }]);
});

it("waits for a surface whose pack's frontend is still loading, and opens it with the events once it arrives", async () => {
  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);

  app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [{ type: 'MEMO.OPEN', id: 'm1' }] });
  expect(opened()).toBe('default-setup/notes');
  expect(shell.notify.error).not.toHaveBeenCalled();

  loaded();
  await settle();

  expect(opened()).toBe('memo-pack/memos');
  expect(eventsOf('memo-pack/memos')).toEqual([{ surface: 'memo-pack/memos', type: 'MEMO.OPEN', open: true }]);
  expect(shell.notify.error).not.toHaveBeenCalled();
});

it('refuses a surface no pack provides once loading settles, naming it', async () => {
  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);

  app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/memoz', events: [] });
  loaded();
  await settle();

  expect(opened()).toBe('default-setup/notes');
  expect(shell.notify.error).toHaveBeenCalledWith("Couldn't open memo-pack/memoz", 'No surface is declared at "memo-pack/memoz".');
});

it('refuses at once a surface no pack provides when no pack frontend is loading', async () => {
  await connectLoading([]);
  await settle();

  app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [] });

  expect(shell.notify.error).toHaveBeenCalledWith("Couldn't open memo-pack/memos", 'No surface is declared at "memo-pack/memos".');
});

it('drops a request whose pack is unloaded while it waits', async () => {
  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);

  app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [{ type: 'MEMO.OPEN', id: 'm1' }] });
  app.send({ type: 'PACK_SURFACES_UNLOADED', packId: 'memo-pack' });
  loaded();
  await settle();

  expect(app.getSnapshot().context.awaitingSurface).toEqual([]);
  expect(opened()).toBe('default-setup/notes');
  expect(eventsOf('memo-pack/memos')).toEqual([]);
  expect(shell.notify.error).not.toHaveBeenCalled();
});

// SEND_TO_SURFACE is the same wait with a different ending: the renderer's `sendToSurface` (`_sendToLocalSurface`)
// routes through here rather than reaching into the surface's actor, so one owner answers "is that surface here yet"
// for both channels. What it must not do is open the surface — a cross-feature command is not a navigation.
it('hands a registered surface its events without opening it', async () => {
  await connectLoading([]);
  await settle();

  app.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/settings', events: [{ type: 'FEATURE.SELECT', featureId: 'default-setup/logs' }] });
  await settle();

  expect(opened()).toBe('default-setup/notes');
  expect(eventsOf('default-setup/settings')).toEqual([{ surface: 'default-setup/settings', type: 'FEATURE.SELECT', open: false }]);
});

it("waits for a surface whose pack's frontend is still loading, and delivers once it arrives, still without opening it", async () => {
  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);

  app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memos', events: [{ type: 'MEMO.HIGHLIGHT', memoId: 'm1' }] });
  expect(eventsOf('memo-pack/memos')).toEqual([]);

  loaded();
  await settle();

  expect(eventsOf('memo-pack/memos')).toEqual([{ surface: 'memo-pack/memos', type: 'MEMO.HIGHLIGHT', open: false }]);
  expect(opened()).toBe('default-setup/notes');
  expect(shell.notify.error).not.toHaveBeenCalled();
});

/**
 * Refusing at once and refusing after a wait are two branches of the same answer, so they say the same thing.
 * One renderer makes divergence impossible; this is what fails if a second is ever written.
 */
it('says exactly the same thing whether it refuses at once or after waiting', async () => {
  const send: ShellEvent = { type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'X' }], from: 'other-pack', via: 'action:Add Memo' };

  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);
  app.send({ ...send });
  loaded();
  await settle();
  const afterWaiting = (shell.notify.error as ReturnType<typeof vi.fn>).mock.calls.at(-1);

  // Loading has settled, so the same send is now refused on the other branch
  app.send({ ...send });
  await settle();
  const atOnce = (shell.notify.error as ReturnType<typeof vi.fn>).mock.calls.at(-1);

  expect(atOnce).toEqual(afterWaiting);
});

// Waiting is where naming the sender helps most: the send waited precisely because the surface's pack was still
// loading, and it is refused because that pack never provided it
it('reports a send to a surface no pack provides once loading settles, naming who sent it', async () => {
  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);

  app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'X' }], from: 'other-pack', via: 'action:Add Memo' });
  loaded();
  await settle();

  expect(shell.notify.error).toHaveBeenCalledWith(
    "Couldn't reach memo-pack/memoz",
    'No surface is declared at "memo-pack/memoz". Sent by "other-pack" (action:Add Memo).',
  );
});

/**
 * **An answer that cannot be delivered is not the user's problem.** A toast exists to tell someone the thing
 * they just did failed; nobody did anything here — a surface asked a question and the pack that would have
 * taken the answer is not loaded. Telling the user interrupts work they are in the middle of with a sentence
 * about plumbing they cannot act on.
 *
 * It is still a loss, so it goes to the console where the bus's undeliverable sends go. Drop the `answering`
 * branch from `refuse` and this is what fails — on the toast, which is the assertion that matters.
 */
it('logs rather than toasts when an answer reaches no surface', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await connectLoading([]);
  await settle();

  // What `reply` builds for a `window` asker whose surface has gone
  app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'ANSWER' }], asker: { kind: 'window', ref: 'default-setup/notes' }, answering: 'c-asked', from: 'memo-pack' });
  await settle();

  expect(shell.notify.error, 'no toast for a machine-to-machine loss').not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropped an answer for "memo-pack/memoz"'));
  expect(warn, 'and it names who was answering').toHaveBeenCalledWith(expect.stringContaining('memo-pack'));
  warn.mockRestore();
});

/**
 * **The queued branch, which is why the flag travels with the request rather than only on the event.** An
 * answer for a surface whose pack is still loading waits like anything else, and the refusal comes later, read
 * off the queued request by `finishPackFrontendLoad` — not through the drain, which re-raises only the
 * requests whose surface *did* arrive and so never refuses anything. Take `answering` off `SurfaceRequest` and
 * every case above still passes while this one toasts.
 */
it('logs rather than toasts for an answer refused after waiting', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let loaded!: () => void;
  const release = new Promise<void>((resolve) => { loaded = resolve; });
  await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos')] }], release);

  app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'ANSWER' }], asker: { kind: 'window', ref: 'default-setup/notes' }, answering: 'c-asked', from: 'memo-pack' });
  expect(app.getSnapshot().context.awaitingSurface, 'it waited like any other send').toHaveLength(1);

  loaded();
  await settle();

  expect(shell.notify.error).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropped an answer for "memo-pack/memoz"'));
  warn.mockRestore();
});

/**
 * The same send without `answering` is the ordinary refusal, so the flag is what decides and not the asker's
 * presence — a surface asking another surface is a command someone gave, and its failure is worth a toast.
 */
it('still toasts for an ordinary send that carries an asker', async () => {
  await connectLoading([]);
  await settle();

  app.send({ type: 'SEND_TO_SURFACE', surface: 'memo-pack/memoz', events: [{ type: 'ASK' }], asker: { kind: 'window', ref: 'default-setup/notes' }, from: 'memo-pack' });
  await settle();

  expect(shell.notify.error).toHaveBeenCalledWith(
    "Couldn't reach memo-pack/memoz",
    'No surface is declared at "memo-pack/memoz". Sent by "memo-pack".',
  );
});

// A pack's system or action asks the app to open a surface with broadcast('host/application', …); every window
// hears it, and only a main window acts: a popout shows its own surface
describe('a request from the app to open a surface', () => {
  it('opens the surface in a main window, with the events', async () => {
    // The fake client holds one window's subscription: this test's window is a main one
    app.stop();
    app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: true } }).start();
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: {} } });
    await settle();

    shell.client.receive({ to: 'host/application', event: { type: 'OPEN_SURFACE', surface: 'default-setup/settings', events: [{ type: 'FEATURE.SELECT', featureId: 'default-setup/logs' }] } });
    await settle();

    expect(opened()).toBe('default-setup/settings');
    expect(eventsOf('default-setup/settings')).toEqual([{ surface: 'default-setup/settings', type: 'FEATURE.SELECT', open: true }]);
  });

  // A pack builds the payload at runtime (an action, a flow), where its types don't reach: events that aren't
  // deliverable would crash the surface's actor, or the shell's
  it.each([
    ['events that are not an array', 'two'],
    ['an event that is not an object', [null]],
    ['an event without a type', [{ id: 'm1' }]],
  ])('refuses %s, and opens nothing', async (_, events) => {
    app.stop();
    app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: { ownsLastActiveSurface: true } }).start();
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: {} } });
    await settle();

    shell.client.receive({ to: 'host/application', event: { type: 'OPEN_SURFACE', surface: 'default-setup/settings', events } });
    await settle();

    expect(opened()).toBe('default-setup/notes');
    expect(eventsOf('default-setup/settings')).toEqual([]);
    expect(shell.notify.error).toHaveBeenCalledWith("Couldn't open a surface", expect.stringContaining('default-setup/settings'));
    expect(app.getSnapshot().status).toBe('active');
  });

  it('leaves a popout on the surface it shows', async () => {
    await connectLoading([]);
    await settle();

    shell.client.receive({ to: 'host/application', event: { type: 'OPEN_SURFACE', surface: 'default-setup/settings', events: [{ type: 'FEATURE.SELECT', featureId: 'default-setup/logs' }] } });
    await settle();

    expect(opened()).toBe('default-setup/notes');
    expect(eventsOf('default-setup/settings')).toEqual([]);
  });
});


describe('a later navigation supersedes an open still waiting for its pack', () => {
  async function waiting() {
    let loaded!: () => void;
    const release = new Promise<void>((resolve) => { loaded = resolve; });
    await connectLoading([{ id: 'memo-pack', surfaces: [recording('memo-pack/memos'), recording('memo-pack/drafts')] }], release);
    return loaded;
  }

  it('stays where the user went, and still delivers the waiting open its events', async () => {
    const loaded = await waiting();
    app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [{ type: 'MEMO.OPEN', id: 'm1' }] });
    app.send({ type: 'SELECT_SURFACE', surface: 'default-setup/settings' });

    loaded();
    await settle();

    expect(opened()).toBe('default-setup/settings');
    expect(eventsOf('memo-pack/memos')).toEqual([{ surface: 'memo-pack/memos', type: 'MEMO.OPEN', open: false }]);
  });

  it('opens only the last of several waiting opens', async () => {
    const loaded = await waiting();
    app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/memos', events: [] });
    app.send({ type: 'OPEN_SURFACE', surface: 'memo-pack/drafts', events: [] });
    const before = heard.length;

    loaded();
    await settle();

    expect(opened()).toBe('memo-pack/drafts');
    expect(heard.slice(before).filter((h) => h.type === 'SURFACE_ACTIVATED').map((h) => h.surface)).toEqual(['memo-pack/drafts']);
  });
});
