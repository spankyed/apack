import { afterEach, expect, it, vi } from 'vitest';
import { state } from '@apackdev/state';
import { resolveName } from '@apackdev/sdk/ids';
import type { NativePackDeclaration } from '@apackdev/sdk/framework';
import { createFePackRegistry } from '../../../../src/fe/pack-store.ts';
import { createShell, type ShellRuntime } from '../../../../src/features/application/fe/machine.ts';
import type { SurfaceCatalogEntry } from '../../../../src/packs/catalog.ts';
import { fakeShell } from './fakes.ts';

let app: ShellRuntime | undefined;
afterEach(() => { app?.stop(); app = undefined; });

const emptyState = () => state<{}, never>()({});

function fixture() {
  const packs = createFePackRegistry();
  const native: NativePackDeclaration = { id: 'host', features: { settings: { description: 'Host settings.',
    surface: { label: 'Settings', state: 'native/state.ts', canvas: 'native/settings.vue' } } } };
  packs.registerPackFE({ kind: 'native', declaration: native }, { id: 'host', features: {
    settings: { surface: { label: 'Settings', state: emptyState(), canvas: {} } },
  } });
  const shell = fakeShell({ surfaces: packs.getRegisteredSurfaces() });
  const entries: SurfaceCatalogEntry[] = [{ featureRef: resolveName('settings', 'host'), packId: 'host', origin: 'native', enabled: true,
    declaration: native.features!.settings!.surface! }];
  const listeners = new Set<() => void>();
  const catalog = { status: vi.fn<() => 'loading' | 'ready' | 'disconnected'>(() => 'ready'), surfaces: () => entries,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  app = createShell({ ...shell.options, packs, catalog }, {}).start();
  const publish = () => { for (const listener of listeners) listener(); };
  const candidate = (id: string, isDefault = false, enabled = true) => {
    const declaration = { label: id, state: 'src/state.ts', canvas: 'src/view.vue', ...(isDefault && { default: true as const }) };
    const manifest = { id, name: id, version: '1.0.0', features: { view: { description: 'External view.', surface: declaration } } };
    const pack = { id, name: id, version: '1.0.0', manifest, declarationRevision: `declaration-${id}`, registrationId: `runtime-${id}`, buildRevision: 'a'.repeat(64) };
    const entry: SurfaceCatalogEntry = { featureRef: resolveName('view', id), packId: id, declaration, origin: 'installed', enabled,
      declarationRevision: pack.declarationRevision, buildRevision: pack.buildRevision };
    const registration = { id, declarationRevision: pack.declarationRevision, features: { view: {
      surface: { label: id, state: emptyState(), canvas: {} }, ...(isDefault && { default: true as const }),
    } } };
    return { entry, pack, registration, declare() { entries.push(entry); publish(); },
      accept() { const surfaces = packs.registerPackFE({ kind: 'loaded', pack }, registration);
        app!.send({ type: 'PACK_FRONTEND_LOADED', packId: id, registrationId: pack.registrationId, surfaces }); return surfaces; } };
  };
  return { packs, shell, entries, catalog, listeners, candidate, publish };
}

it('chooses the declared default independently of frontend delivery order, retaining host settings while it loads', () => {
  const f = fixture(); const first = f.candidate('alpha', true); const second = f.candidate('zeta', true);
  first.declare(); second.declare(); second.accept();
  expect(app!.getSnapshot().context.activeSurface.id).toBe('host/settings');
  expect(app!.getSnapshot().context.defaultSurface).toBeNull();
  first.accept();
  expect(app!.getSnapshot().context.activeSurface.id).toBe('alpha/view');
  expect(app!.getSnapshot().context.defaultSurface?.id).toBe('alpha/view');
  app!.stop(); expect(f.listeners.size).toBe(0);
});

it('preserves saved selection and explicit navigation over a later default', () => {
  const f = fixture(); const preferred = f.candidate('preferred'); const defaultView = f.candidate('default', true);
  preferred.declare(); defaultView.declare();
  f.shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', surfaceVisibility: {}, lastActiveSurface: 'preferred/view' } });
  defaultView.accept(); expect(app!.getSnapshot().context.activeSurface.id).toBe('host/settings');
  preferred.accept(); expect(app!.getSnapshot().context.activeSurface.id).toBe('preferred/view');
  app!.send({ type: 'SELECT_SURFACE', surface: 'host/settings' });
  f.publish(); expect(app!.getSnapshot().context.activeSurface.id).toBe('host/settings');
});

it('distinguishes unknown, disabled and failed destinations, without waiting for unrelated frontend imports', () => {
  const f = fixture(); const disabled = f.candidate('disabled', false, false); disabled.declare();
  app!.send({ type: 'OPEN_SURFACE', surface: 'unknown/view', events: [] });
  expect(app!.getSnapshot().context.awaitingSurface).toEqual([]);
  expect(f.shell.notify.error).toHaveBeenLastCalledWith("Couldn't open unknown/view", 'No surface is declared at "unknown/view".');
  app!.send({ type: 'OPEN_SURFACE', surface: 'disabled/view', events: [] });
  expect(f.shell.notify.error).toHaveBeenLastCalledWith("Couldn't open disabled/view", 'The pack providing "disabled/view" is disabled.');
  const failed = f.candidate('failed'); failed.declare();
  app!.send({ type: 'OPEN_SURFACE', surface: 'failed/view', events: [] });
  expect(app!.getSnapshot().context.awaitingSurface).toHaveLength(1);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { app!.send({ type: 'PACK_FRONTENDS_SETTLED', failedPacks: [{ packId: 'failed', error: 'Import failed' }] }); }
  finally { warn.mockRestore(); }
  expect(f.shell.notify.error).toHaveBeenCalledWith("Couldn't open failed/view", 'The surface "failed/view" could not be loaded.');
  expect(app!.getSnapshot().context.awaitingSurface).toEqual([]);
});

it('reconciles admission before the catalog frame and rejects a stale completion without replacing the current actor', () => {
  const f = fixture(); const next = f.candidate('external', true);
  f.catalog.status.mockReturnValue('loading'); const surfaces = next.accept();
  expect(app!.surface('external/view')).toBeUndefined();
  f.entries.push(next.entry); f.catalog.status.mockReturnValue('ready'); f.publish();
  const actor = app!.surface('external/view'); expect(actor).toBeDefined();
  expect(app!.getSnapshot().context.activeSurface.id).toBe('external/view');
  app!.send({ type: 'PACK_FRONTEND_LOADED', packId: 'external', registrationId: 'retired', surfaces });
  expect(app!.surface('external/view')).toBe(actor);
  expect(app!.getSnapshot().context.acceptedPackRuntimes.external).toBe(next.pack.registrationId);
  f.catalog.status.mockReturnValue('disconnected'); f.publish();
  app!.send({ type: 'SELECT_SURFACE', surface: 'host/settings' });
  expect(app!.getSnapshot().context.activeSurface.id).toBe('host/settings');
  app!.send({ type: 'OPEN_SURFACE', surface: 'external/view', events: [] });
  expect(app!.getSnapshot().context.activeSurface.id).toBe('host/settings');
});

it('does not route new requests to an actor while its replacement binding awaits shell admission', () => {
  const f = fixture(); const next = f.candidate('external'); next.declare(); next.accept();
  const old = app!.surface('external/view')!; const sent = vi.spyOn(old, 'send');
  f.packs.replacePackFE({ kind: 'loaded', pack: { ...next.pack, registrationId: 'replacement' } }, next.registration);
  app!.send({ type: 'SELECT_SURFACE', surface: 'external/view' });
  expect(app!.getSnapshot().context.activeSurface.id).toBe('host/settings');
  app!.send({ type: 'SEND_TO_SURFACE', surface: 'external/view', events: [{ type: 'DO_WORK' }] });
  expect(sent).not.toHaveBeenCalled();
  expect(app!.getSnapshot().context.awaitingSurface).toHaveLength(1);
});

it('steps the switch-surface hotkeys over a declared tab whose frontend has not loaded', () => {
  const f = fixture(); const alpha = f.candidate('alpha'); const beta = f.candidate('beta'); const gamma = f.candidate('gamma');
  alpha.declare(); beta.declare(); gamma.declare();
  alpha.accept(); gamma.accept();
  app!.send({ type: 'SELECT_SURFACE', surface: 'alpha/view' });
  app!.send({ type: 'SWITCH_SURFACE_DOWN' });
  expect(app!.getSnapshot().context.activeSurface.id).toBe('gamma/view');
  app!.send({ type: 'SWITCH_SURFACE_UP' });
  expect(app!.getSnapshot().context.activeSurface.id).toBe('alpha/view');
});

it('takes back a frontend whose pack the catalog disabled while it loaded, and ignores one only while the catalog settles', () => {
  const f = fixture(); const disabled = f.candidate('gone', false, false); const settling = f.candidate('later');
  disabled.declare();
  disabled.accept();
  expect(f.shell.packFrontends.unload).toHaveBeenCalledWith('gone');
  expect(app!.surface('gone/view')).toBeUndefined();
  expect(app!.getSnapshot().context.acceptedPackRuntimes).not.toHaveProperty('gone');
  f.catalog.status.mockReturnValue('loading');
  settling.declare();
  settling.accept();
  expect(f.shell.packFrontends.unload).not.toHaveBeenCalledWith('later');
});

it('starts every newly loaded surface actor before notifying shell subscribers', async () => {
  const f = fixture();
  const next = f.candidate('external');
  next.declare();
  f.shell.client.loadedPacks.mockResolvedValue([next.pack as any]);
  f.shell.packFrontends.load.mockImplementation(async () => f.packs.registerPackFE({ kind: 'loaded', pack: next.pack }, next.registration));

  const missingOnNotify: string[] = [];
  const sub = app!.subscribe((snapshot) => {
    for (const surface of snapshot.context.surfaces) {
      if (!app!.surface(surface.id)) missingOnNotify.push(surface.id);
    }
  });
  try {
    f.shell.client.connect();
    await vi.waitFor(() => expect(app!.getSnapshot().context.surfaces.some((s) => s.id === resolveName('view', 'external'))).toBe(true));
    expect(missingOnNotify).toEqual([]);
  } finally {
    sub.unsubscribe();
  }
});
