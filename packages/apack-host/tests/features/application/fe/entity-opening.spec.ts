import { afterEach, expect, it, vi } from 'vitest';
import { state } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import { createShell, type ShellRuntime } from '../../../../src/fe/index.ts';
import { fakeShell, surface, settle } from './fakes.ts';

const running: ShellRuntime[] = [];
afterEach(() => running.splice(0).forEach((actor) => actor.stop()));

async function fixture(loading = false) {
  const received = vi.fn();
  const note = {
    ...surface('notes/view'),
    state: state<{}, OpenEntity>()({ on: { OPEN_ENTITY: (event) => { received(event); } } }),
  };
  const shell = fakeShell({ surfaces: [surface('host/home'), ...(loading ? [] : [note])] });
  if (loading) shell.acceptSurface(note);
  const declaration = { ...shell.declarations.get(note.id)!, opens: ['Note'] };
  shell.declarations.set(note.id, declaration);
  shell.bindings.set(note.id, { ...shell.bindings.get(note.id)!, opens: ['Note'] });
  let finishLoad!: (surfaces: typeof note[]) => void;
  if (loading) {
    shell.bindings.delete(note.id);
    shell.client.loadedPacks.mockResolvedValue([{ id: 'notes', feEntry: 'runtime/fe.js' }]);
    shell.packFrontends.load.mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));
  }
  const app = createShell(shell.options, { ownsLastActiveSurface: false }).start();
  running.push(app);
  shell.client.connect();
  shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: {} } });
  await settle();
  return { ...shell, app, received, note, declaration, finishLoad };
}

it('checks existence, opens the declared surface, delivers only the ID and releases the request', async () => {
  const shell = await fixture();
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' });
  await settle();
  expect(shell.client.entityExists).toHaveBeenCalledWith('Note-one', expect.any(AbortSignal));
  expect(shell.app.getSnapshot().context.activeSurface.id).toBe('notes/view');
  expect(shell.received).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN_ENTITY', id: 'Note-one' });
  expect(shell.app.entityOpening()?.data.request).toBeNull();
  shell.publishCatalog();
  expect(shell.notify.error).not.toHaveBeenCalled();
});

it('distinguishes missing entities, disabled destinations and unclaimed types without opening anything', async () => {
  const shell = await fixture();
  shell.client.entityExists.mockResolvedValue(false);
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-missing' }); await settle();
  expect(shell.notify.error).toHaveBeenLastCalledWith("Couldn't open Note-missing", expect.stringContaining('no longer exists'));
  shell.declarations.set('notes/view', { ...shell.declaration, enabled: false });
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-disabled' }); await settle();
  expect(shell.notify.error).toHaveBeenLastCalledWith("Couldn't open Note-disabled", expect.stringContaining('disabled'));
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Prompt-unclaimed' }); await settle();
  expect(shell.notify.error).toHaveBeenLastCalledWith("Couldn't open Prompt-unclaimed", expect.stringContaining('No enabled feature'));
  expect(shell.client.entityExists).toHaveBeenCalledTimes(1);
  expect(shell.received).not.toHaveBeenCalled();
});

it('waits for catalog authority before choosing a destination', async () => {
  const shell = await fixture();
  shell.catalog.status.mockReturnValue('loading');
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' }); await settle();
  expect(shell.client.entityExists).not.toHaveBeenCalled();
  shell.catalog.status.mockReturnValue('ready'); shell.publishCatalog(); await settle();
  expect(shell.received).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN_ENTITY', id: 'Note-one' });
});

it('aborts superseded checks and ignores late completions', async () => {
  const shell = await fixture();
  const results: Array<(exists: boolean) => void> = [];
  shell.client.entityExists.mockImplementation(() => new Promise(resolve => results.push(resolve)));
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-first' }); await settle();
  const firstSignal = shell.client.entityExists.mock.calls[0][1];
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-second' }); await settle();
  expect(firstSignal.aborted).toBe(true);
  results[0](true); await settle(); expect(shell.received).not.toHaveBeenCalled();
  results[1](true); await settle();
  expect(shell.received).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN_ENTITY', id: 'Note-second' });
});

it.each(['replace', 'disable', 'unload', 'disconnect', 'navigate', 'breadcrumb', 'back', 'forward', 'stop'] as const)('retires pending navigation on %s', async reason => {
  const shell = await fixture();
  let finish!: (exists: boolean) => void;
  shell.client.entityExists.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' }); await settle();
  const signal = shell.client.entityExists.mock.calls[0][1];
  switch (reason) {
    case 'replace': shell.bindings.set('notes/view', { ...shell.bindings.get('notes/view')! }); shell.publishCatalog(); break;
    case 'disable': shell.declarations.set('notes/view', { ...shell.declaration, enabled: false }); shell.publishCatalog(); break;
    case 'unload': shell.app.send({ type: 'PACK_SURFACES_UNLOADED', packId: 'notes' }); break;
    case 'disconnect': shell.client.dropConnection(); break;
    case 'navigate': shell.app.send({ type: 'OPEN_SURFACE', surface: 'host/home', events: [] }); break;
    case 'breadcrumb': shell.app.send({ type: 'TRAIL_CLICK', target: 'home' }); break;
    case 'back': shell.app.send({ type: 'NAVIGATE_BACK' }); break;
    case 'forward': shell.app.send({ type: 'NAVIGATE_FORWARD' }); break;
    case 'stop': shell.app.stop(); break;
  }
  expect(signal.aborted).toBe(true);
  finish(true); await settle();
  expect(shell.received).not.toHaveBeenCalled();
});

it('reports query failures and clears its request', async () => {
  const shell = await fixture(); shell.client.entityExists.mockRejectedValue(new Error('Database unavailable'));
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' }); await settle();
  expect(shell.notify.error).toHaveBeenLastCalledWith("Couldn't open Note-one", 'Database unavailable');
  expect(shell.app.entityOpening()?.data.request).toBeNull();
});

it('holds an entity request until its declared frontend is ready, then delivers once', async () => {
  const shell = await fixture(true);
  shell.catalog.status.mockReturnValue('ready'); shell.publishCatalog();
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' }); await settle();
  expect(shell.received).not.toHaveBeenCalled();
  expect(shell.app.getSnapshot().context.awaitingSurface).toHaveLength(1);
  shell.finishLoad([shell.note]); await settle(); await settle();
  expect(shell.received).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN_ENTITY', id: 'Note-one' });
  expect(shell.app.entityOpening()?.data.request).toBeNull();
});

it('does not deliver a queued request after its declared destination changes', async () => {
  const shell = await fixture(true);
  shell.catalog.status.mockReturnValue('ready'); shell.publishCatalog();
  shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' }); await settle();
  expect(shell.app.getSnapshot().context.awaitingSurface).toHaveLength(1);
  shell.declarations.set(shell.note.id, { ...shell.declaration, declaration: { ...shell.declaration.declaration, label: 'Replacement' } });
  shell.publishCatalog();
  shell.finishLoad([shell.note]); await settle(); await settle();
  expect(shell.received).not.toHaveBeenCalled();
  expect(shell.app.entityOpening()?.data.request).toBeNull();
  expect(shell.notify.error).toHaveBeenCalledTimes(1);
});

it('refuses delivery when the admitted destination actor is absent', async () => {
  const shell = await fixture();
  const getSurface = shell.app.surface.bind(shell.app);
  const lookup = vi.spyOn(shell.app, 'surface').mockImplementation((id) => (id === shell.note.id && shell.app.getSnapshot().context.activeSurface.id === shell.note.id ? undefined : getSurface(id)));
  try {
    shell.app.send({ type: 'OPEN_ENTITY', id: 'Note-one' }); await settle();
    expect(shell.received).not.toHaveBeenCalled();
    expect(shell.notify.error).toHaveBeenCalledExactlyOnceWith("Couldn't open Note-one", expect.stringContaining('destination actor "notes/view"'));
    expect(shell.app.entityOpening()?.data.request).toBeNull();
  } finally { lookup.mockRestore(); }
});
