// The app shell's state (which surfaces' tabs show, the surface last open) belongs to the host's `application`
// feature, which keeps it in AppState. A window opens on its first surface, and each connection's CLIENT_CONNECTED
// brings the stored state; what the user changes here is sent back to be recorded, so every window agrees.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createShell, surfaceNavigationItems, withHostLast, type ShellRuntime } from '../../../../src/fe/index.ts';
import { fakeShell, surface } from './fakes.ts';

const notes = surface('default-setup/notes');
const threads = surface('default-setup/threads');
// What the shell sends the host goes over this window's client: the fake's `send`
let shell = fakeShell({ surfaces: [notes, threads] });
let fake = shell.client;
let mutate = fake.send;
let app: ShellRuntime;

beforeEach(() => {
  shell = fakeShell({ surfaces: [notes, threads] });
  fake = shell.client;
  mutate = fake.send;
  app = createShell(shell.options, { ownsLastActiveSurface: true }).start();
});

afterEach(() => app.stop());

const connect = (shell: { surfaceVisibility?: Record<string, boolean>; lastActiveSurface?: string }) => {
  fake.connect();
  fake.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: {}, ...shell } });
};
const context = () => app.getSnapshot().context;

it('opens on its first surface, then on the one last open once the host says which', () => {
  expect(context().activeSurface.id).toBe('default-setup/notes');

  connect({ lastActiveSurface: 'default-setup/threads' });

  expect(context().activeSurface.id).toBe('default-setup/threads');
});

it('stays where it is when the surface last open is not one it has', () => {
  connect({ lastActiveSurface: 'memo-pack/memos' });

  expect(context().activeSurface.id).toBe('default-setup/notes');
});

// An external pack's frontend loads after the window connects, so its surface arrives later
const memos = surface('memo-pack/memos');
const loadMemoPack = (target = app) => {
  shell.acceptSurface(memos);
  target.send({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'memo-pack', surfaces: [memos] });
};

it("opens on the surface last open once its pack's frontend adds it", () => {
  connect({ lastActiveSurface: 'memo-pack/memos' });
  loadMemoPack();

  expect(context().activeSurface.id).toBe('memo-pack/memos');
});

it('keeps the surface the user opened while that pack was loading', () => {
  connect({ lastActiveSurface: 'memo-pack/memos' });
  app.send({ type: 'SELECT_SURFACE', surface: 'default-setup/threads' });
  loadMemoPack();

  expect(context().activeSurface.id).toBe('default-setup/threads');
});

it("opens a popout on an external pack's surface once that pack's frontend adds it, without recording it as the app's", () => {
  const popout = createShell(shell.options, {
    initialSurfaceId: 'memo-pack/memos',
    ownsLastActiveSurface: false,
  }).start();

  loadMemoPack(popout);
  popout.send({ type: 'SELECT_SURFACE', surface: 'default-setup/threads' });

  expect(popout.getSnapshot().context.activeSurface.id).toBe('default-setup/threads');
  // The main window opens on the surface last open there, never on one a popout showed
  const recorded = mutate.mock.calls.filter(([message]) => (message as { event: { type: string } }).event.type === 'SET_LAST_ACTIVE_SURFACE');
  expect(recorded).toEqual([]);
  popout.stop();
});

it("shows the tabs the host's state says to", () => {
  connect({ surfaceVisibility: { 'default-setup/threads': false } });

  expect(surfaceNavigationItems(shell.options.catalog, shell.options.packs.surfaceBindings(), context().surfaceVisibility).filter(surface => surface.visible).map((p) => p.id)).toEqual(['default-setup/notes']);
});

it('hides a tab at once, and sends the host the choice to record', () => {
  app.send({ type: 'SET_SURFACE_VISIBILITY', surface: 'default-setup/threads', visible: false });

  expect(surfaceNavigationItems(shell.options.catalog, shell.options.packs.surfaceBindings(), context().surfaceVisibility).filter(surface => surface.visible).map((p) => p.id)).toEqual(['default-setup/notes']);
  expect(mutate).toHaveBeenCalledWith({ to: 'host/application', event: { type: 'SET_SURFACE_VISIBILITY', surface: 'default-setup/threads', visible: false } });
});

it('sends the host the surface opened, to open on next time', () => {
  app.send({ type: 'SELECT_SURFACE', surface: 'default-setup/threads' });

  expect(mutate).toHaveBeenCalledWith({ to: 'host/application', event: { type: 'SET_LAST_ACTIVE_SURFACE', surface: 'default-setup/threads' } });
});

// A pack's frontend loads after the window starts, and its surfaces join before the app's own (the Packs tab)
it("keeps the host's surfaces after every pack's, each group in its order", () => {
  const packsTab = surface('host/packs');
  expect(withHostLast([notes, packsTab, threads, surface('memo-pack/memos')]).map((p) => p.id))
    .toEqual(['default-setup/notes', 'default-setup/threads', 'memo-pack/memos', 'host/packs']);
});
