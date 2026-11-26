import type { FeatureRef } from '@apackdev/sdk/ids';
import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
import { expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { _createFeSettings, type PackFERegistration } from '@apackdev/sdk/fe';
import { fakeSettings } from '@apackdev/sdk/testing';
import { createPackFrontends, createShell } from '../../../../src/fe/index.ts';
import { fakeShell, surface, settle } from './fakes.ts';

it.each(['reconnect', 'live publication'] as const)('rebinds the real shell, loader and generated settings to a cached module after %s', async mode => {
  const packs = createNativeFrontendTestRegistry();
  const { id: _hostId, ...hostSurface } = surface('host/notes');
  hostSurface.icon = {};
  packs.registerFixture({ id: 'host', features: { notes: { surface: hostSurface } } });
  const generated = _createFeSettings();
  const { id: _surfaceId, ...definition } = surface('ext/own');
  definition.icon = { render: vi.fn() };
  const registration: PackFERegistration = { id: 'ext', declarationRevision: 'current',
    features: { own: { surface: definition } }, bindSettings: generated.bindSettings };
  const sources = [1, 10].map(limit => fakeSettings({ features: { 'ext/own': { limit } } }));
  const disposed = sources.map(() => vi.fn());
  let attempt = 0;
  const imported = vi.fn(async () => ({ default: registration }));
  const frontends = createPackFrontends({
    importModule: imported,
    styles: { prepare: () => ({ ready: Promise.resolve(), commit() {}, dispose() {} }), remove() {} },
    settingsForPack: async () => { const index = attempt++; return { port: sources[index], dispose: disposed[index] }; },
  }, packs);
  const shell = fakeShell({ surfaces: packs.getRegisteredSurfaces() });
  const entry = { registrationId: 'first', id: 'ext', feEntry: 'runtime/fe.js', buildRevision: 'a'.repeat(64),
    declarationRevision: 'current', manifest: { id: 'ext', name: 'Example', version: '1.0.0',
      features: { own: { description: 'Feature declaration fixture.', surface: { label: 'ext/own', state: 'src/state.ts', icon: 'Zap', canvas: 'src/canvas.vue' } } } } };
  shell.catalog.status.mockReturnValue('ready');
  shell.declarations.set('host/notes', { ...shell.declarations.get('host/notes')!, declaration: packs.surfaceBindings().get('host/notes')!.declaration });
  shell.declarations.set('ext/own', { featureRef: 'ext/own' as FeatureRef,
    packId: 'ext', origin: 'installed', enabled: true, declarationRevision: entry.declarationRevision,
    buildRevision: entry.buildRevision, declaration: entry.manifest.features.own.surface });
  shell.client.loadedPacks.mockResolvedValue([entry]);
  const app = createShell({ ...shell.options, packs, packFrontends: frontends }, { ownsLastActiveSurface: false }).start();
  const scope = effectScope();
  const target = { kind: 'feature', featureRef: 'ext/own' } as const;
  try {
    shell.client.connect();
    await settle();
    app.send({ type: 'SELECT_SURFACE', surface: 'ext/own' });
    const actor = app.surface('ext/own');
    expect(actor).toBeDefined();
    const old = scope.run(() => generated.useSettings<{ limit: number }>(target))!;
    shell.client.loadedPacks.mockResolvedValue([{ ...entry, registrationId: 'second' }]);
    if (mode === 'reconnect') {
      shell.client.dropConnection();
      expect(app.surface('ext/own')).toBe(actor);
      shell.client.connect();
    } else {
      shell.client.receive({ to: 'host/application', event: { type: 'PACK_RUNTIMES_UPDATED', runtimes: { ext: 'second' } } });
      expect(app.surface('ext/own')).toBe(actor);
    }
    await settle();
    expect(shell.client.packClientReady.mock.calls).toEqual([['ext', 'first'], ['ext', 'second']]);
    expect(imported).toHaveBeenCalledTimes(2);
    expect(imported.mock.calls[0]).toEqual(imported.mock.calls[1]);
    expect(shell.notify.error).not.toHaveBeenCalled();
    expect(app.surface('ext/own')).not.toBe(actor);
    expect(actor?.getSnapshot().status).toBe('stopped');
    expect(app.getSnapshot().context.activeSurface.id).toBe('ext/own');
    expect(disposed[0]).toHaveBeenCalledOnce();
    expect(disposed[1]).not.toHaveBeenCalled();
    expect((await old.set({ path: ['limit'], value: 99 })).status).toBe('refused');
    const current = scope.run(() => generated.useSettings<{ limit: number }>(target))!;
    expect(current.value.value).toEqual({ limit: 10 });
    await current.set({ path: ['limit'], value: 11 });
    expect(sources[1].get(target)).toEqual({ limit: 11 });
    expect(sources[0].updates).toEqual([]);
  } finally {
    scope.stop();
    app.stop();
    frontends.unload('ext');
  }
});
