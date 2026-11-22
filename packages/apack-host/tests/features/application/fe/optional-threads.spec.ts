import { expect, it } from 'vitest';
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import { createActor } from 'xstate';
import { createShellMachine } from '../../../../src/fe/index.ts';
import { fakeShell, surface, settle } from './fakes.ts';

it.each([
  { role: undefined, ids: ['host/settings', 'host/packs'], selected: 'host/settings' },
  { role: undefined, ids: ['other/notes'], selected: 'other/notes' },
  { role: 'custom/inbox' as const, ids: ['other/notes', 'custom/inbox'], selected: 'custom/inbox' },
  { role: 'backend-only/inbox' as const, ids: ['other/notes'], selected: 'other/notes' },
])('closes Welcome with the current window role $role and surfaces $ids', ({ role, ids, selected }) => {
  const shell = fakeShell({ surfaces: ids.map(surface), designations: role ? { threads: resolveName(role) } : {} });
  const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: {} }).start();
  try {
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    expect(app.getSnapshot().hasTag('welcome')).toBe(true);
    app.send({ type: 'CLOSE_DEV_LETTER' });
    expect(app.getSnapshot().status).toBe('active');
    expect(app.getSnapshot().matches({ onboarding: 'wizard' })).toBe(true);
    expect(app.getSnapshot().context.activeSurface?.id).toBe(selected);
    expect(app.getSnapshot().context.awaitingSurface).toEqual([]);
    expect(shell.notify.error).not.toHaveBeenCalled();
  } finally { app.stop(); }
});

it('resolves the role when Welcome closes, after its provider was removed', () => {
  const designations: Record<string, FeatureRef> = { threads: resolveName('custom/inbox') };
  const shell = fakeShell({ surfaces: [surface('other/notes'), surface('custom/inbox')], designations });
  const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: {} }).start();
  try {
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    delete designations.threads;
    app.send({ type: 'CLOSE_DEV_LETTER' });
    expect(app.getSnapshot().matches({ onboarding: 'wizard' })).toBe(true);
    expect(app.getSnapshot().context.activeSurface.id).toBe('other/notes');
  } finally { app.stop(); }
});


it('resolves each window independently without a process-global designation', () => {
  const windows = ['one/inbox', 'two/inbox'].map(id => {
    const shell = fakeShell({ surfaces: [surface('host/settings'), surface(id)],
      designations: { threads: resolveName(id) },
    });
    const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: {} }).start();
    return { id, shell, app };
  });
  try {
    for (const { shell } of windows) {
      shell.client.connect();
      shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    }
    for (const { id, app } of windows) {
      app.send({ type: 'CLOSE_DEV_LETTER' });
      expect(app.getSnapshot().context.activeSurface.id).toBe(id);
      expect(app.getSnapshot().matches({ onboarding: 'wizard' })).toBe(true);
    }
  } finally { windows.forEach(({ app }) => app.stop()); }
});

it('leaves host Packs usable on a new profile with no welcome provider', async () => {
  const shell = fakeShell({ surfaces: [surface('host/packs'), surface('host/settings')] });
  const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: {} }).start();
  try {
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    await settle();
    expect(app.getSnapshot().matches({ running: 'connected' })).toBe(true);
    expect(app.getSnapshot().context.activeSurface.id).toBe('host/packs');
    expect(app.getSnapshot().context.panelSizes.chatMaximized).toBe(false);
    expect(shell.storage.savePanelSizes).not.toHaveBeenCalled();
  } finally { app.stop(); }
});

it('waits for a welcome from any pack and recovers navigation if that pack is unloaded', async () => {
  let hasWelcome = false;
  const shell = fakeShell({ surfaces: [surface('host/packs')], hasWelcome: () => hasWelcome });
  shell.client.loadedPacks.mockResolvedValue([{ id: 'alternate-starter', feEntry: 'runtime/fe.js' }]);
  let finishLoad!: () => void;
  const pendingLoad = new Promise<void>(resolve => { finishLoad = resolve; });
  shell.packFrontends.load.mockImplementation(async () => {
    await pendingLoad;
    hasWelcome = true;
    return [];
  });
  shell.packFrontends.unload.mockImplementation(() => { hasWelcome = false; });
  const app = createActor(createShellMachine(shell.options), { systemId: 'host/application', input: {} }).start();
  try {
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    await settle();
    expect(shell.packFrontends.load).toHaveBeenCalledOnce();
    expect(app.getSnapshot().hasTag('welcome')).toBe(true);

    finishLoad();
    await settle();
    expect(app.getSnapshot().context.packLoadRunning).toBe(false);
    expect(app.getSnapshot().hasTag('welcome')).toBe(true);

    app.send({ type: 'PACK_SURFACES_UNLOADED', packId: 'alternate-starter' });
    expect(app.getSnapshot().matches({ running: 'connected' })).toBe(true);
    expect(app.getSnapshot().context.activeSurface.id).toBe('host/packs');
  } finally { app.stop(); }
});
