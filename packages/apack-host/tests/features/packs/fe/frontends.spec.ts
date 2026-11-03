import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
// Loading a pack's frontend: the URL its files are at (with the revision, so an updated pack isn't served from the
// cache), what a default export has to declare to count as a registration, and what unloading takes back. The
// window's part — the import and the stylesheet — is a fake here, so these are the rules alone.
import { createMachine } from 'xstate';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { PackFERegistration, Surface, SettingsPort } from '@apackdev/sdk/fe';
import { createPackFrontends, loadPackFEEntry, type PackFrontendIO } from '../../../../src/fe/index.ts';
import { type FePackRegistry } from '../../../../src/fe/pack-store.ts';

/** Expected backend declarations are authored independently of the imported frontend fixture. */
const declaration = (id: string) => ({ id, name: id, version: '1.0.0',
  ...(id === 'memo-pack' && { features: { memos: { description: 'Feature declaration fixture.', surface: { label: 'Memos', state: 'src/surface.ts' } } } }),
});

/** The window's half, recorded: each import by URL, and the stylesheets a pack has */
function fakeIO(modules: Record<string, unknown> = {}) {
  const styles: Array<{ packId: string; href: string }> = [];
  const imported: string[] = [];
  const owners = new WeakMap<object, Set<object>>();
  const io: PackFrontendIO = {
    importModule: async (url) => {
      imported.push(url);
      const bare = url.split('?')[0];
      if (!(url in modules) && !(bare in modules)) throw new Error(`Failed to fetch ${url}`);
      return { default: (url in modules ? modules[url] : modules[bare]) };
    },
    styles: {
      prepare: (packId, href) => {
        let held: { packId: string; href: string } | undefined;
        const lease = {
          ready: Promise.resolve(),
          commit() {
            held = styles.find(style => style.packId === packId && style.href === href);
            if (!held) { held = { packId, href }; styles.push(held); owners.set(held, new Set()); }
            owners.get(held)!.add(lease);
          },
          dispose() {
            if (!held) return;
            const shared = owners.get(held)!;
            shared.delete(lease);
            if (!shared.size) { const index = styles.indexOf(held); if (index >= 0) styles.splice(index, 1); }
            held = undefined;
          },
        };
        return lease;
      },
      remove: (packId) => { for (let i = styles.length - 1; i >= 0; i--) if (styles[i].packId === packId) styles.splice(i, 1); },
    },
  };
  return { io, styles, imported };
}

/** A registry that records what was registered and unregistered */
function fakeRegistry() {
  const registered: PackFERegistration[] = [];
  const unregistered: string[] = [];
  const active = new Set<string>();
  const registry = {
    registerFixture: (registration: PackFERegistration) => { registered.push(registration); active.add(registration.id); return [{ id: 'memo-pack/memos' }] as unknown as Surface[]; },
    hasPackFE: (id: string) => active.has(id),
    preparePackFE(_authority: unknown, registration: PackFERegistration, settings?: { dispose(): void }) {
      let committed = false;
      return {
        surfaces: [],
        commit(beforePublish?: () => void) { beforePublish?.(); committed = true; registered.push(registration); active.add(registration.id); return [{ id: 'memo-pack/memos' }] as unknown as Surface[]; },
        dispose() { if (!committed) { settings?.dispose(); committed = true; } },
      };
    },
    prepareUnregisterPackFE: (id: string) => ({ surfaces: [], commit(beforePublish?: () => void) { beforePublish?.(); registry.unregisterPackFE(id); return []; }, dispose() {} }),
    unregisterPackFE: (packId: string) => { active.delete(packId); unregistered.push(packId); return [] as Surface[]; },
  } as unknown as FePackRegistry;
  return { registry, registered, unregistered };
}

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
// Spying on console again returns the spy already there, with every earlier case's warnings in it
afterEach(() => { vi.restoreAllMocks(); });
const buildRevision = 'a'.repeat(64);
const warnings = () => warn.mock.calls.map(args => args.join(' '));

describe('loadPackFEEntry', () => {
  it("imports the entry at the revision's URL, so a rebuilt frontend isn't served from the cache", async () => {
    const { io, imported } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: { features: {} } });

    await loadPackFEEntry(io, 'runtime/fe.js', `pack://ext/builds/${buildRevision}`);

    expect(imported).toEqual([`pack://ext/builds/${buildRevision}/runtime/fe.js`]);
  });

  it('warns when the entry has no default export and so registers nothing', async () => {
    const { io } = fakeIO({ 'pack://ext/fe.js': undefined });

    // Loaded with nothing, rather than its module namespace registered as a pack with no id
    expect(await loadPackFEEntry(io, 'fe.js', 'pack://ext')).toBeNull();
    expect(warnings()).toEqual([expect.stringMatching(/registers nothing[\s\S]*no default export/)]);
  });

  it('warns when the default export declares no registration fields', async () => {
    const { io } = fakeIO({ 'pack://ext/fe.js': { surface: { id: 'typo' } } });

    await loadPackFEEntry(io, 'fe.js', 'pack://ext');

    expect(warnings()).toEqual([expect.stringMatching(/registers nothing[\s\S]*default export declares none of them/)]);
  });

  it("doesn't warn for the generated entry of a pack without FE extensions", async () => {
    const { io } = fakeIO({ 'pack://ext/fe.js': { features: {} } });

    await loadPackFEEntry(io, 'fe.js', 'pack://ext');

    expect(warnings()).toEqual([]);
  });

  // The E2E fixture fails a pack under test on this line, so its text is a contract
  it('throws when the entry fails to import, logging which entry', async () => {
    const { io } = fakeIO();

    await expect(loadPackFEEntry(io, 'runtime/fe.js', 'pack://broken')).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[pack-loader] Failed to load FE entry pack://broken/runtime/fe.js'),
      expect.anything(),
    );
  });
});

describe("a pack's frontend", () => {
  it.each(['unload', 'abort'] as const)('does not register an import completed after %s', async action => {
    const { io, styles } = fakeIO();
    let finish!: (value: { default: unknown }) => void;
    io.importModule = () => new Promise(resolve => { finish = resolve; });
    const { registry, registered } = fakeRegistry();
    const frontends = createPackFrontends(io, registry);
    const controller = new AbortController();
    const pending = frontends.load({ registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', name: 'Ext', version: '1.0.0',
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    }, controller.signal);
    const refused = expect(pending).rejects.toThrow('cancelled');
    if (action === 'unload') frontends.unload('ext');
    else controller.abort();
    finish({ default: { id: 'ext', declarationRevision: 'current', features: {} } });
    await refused;
    expect(registered).toEqual([]);
    expect(styles).toEqual([]);
  });

  it('disposes a settings grant completed after unload', async () => {
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: {
      id: 'ext', declarationRevision: 'current', features: {}, bindSettings: vi.fn(),
    } });
    const binding = { port: {} as SettingsPort, dispose: vi.fn() };
    let finish!: (value: typeof binding) => void;
    let requested!: () => void;
    const request = new Promise<void>(resolve => { requested = resolve; });
    io.settingsForPack = () => { requested(); return new Promise(resolve => { finish = resolve; }); };
    const { registry, registered } = fakeRegistry();
    const frontends = createPackFrontends(io, registry);
    const pending = frontends.load({ registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', name: 'Ext', version: '1.0.0',
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    });
    const refused = expect(pending).rejects.toThrow('cancelled');
    await request;
    frontends.unload('ext');
    finish(binding);
    await refused;
    expect(binding.dispose).toHaveBeenCalledOnce();
    expect(registered).toEqual([]);
    expect(styles).toEqual([]);
  });

  it('loads explicit development modules directly without installed styles or a disk fallback', async () => {
    const url = 'http://localhost:5199';
    const registration = { id: 'ext', declarationRevision: 'current', features: {} };
    const { io, imported, styles } = fakeIO({ [`${url}/runtime/fe.js`]: registration });
    const { registry, registered } = fakeRegistry();
    const pack = { registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', name: 'Ext', version: '1.0.0', declarationRevision: 'current',
      developmentBaseUrl: url, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css' };
    await createPackFrontends(io, registry).load(pack);
    expect(imported).toEqual([`${url}/runtime/fe.js`]);
    expect(styles).toEqual([]);
    expect(registered).toEqual([registration]);
    const failed = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    await expect(createPackFrontends(failed.io, registry).load({ ...pack, buildRevision })).rejects.toThrow('Failed to fetch');
    expect(failed.imported).toEqual([`${url}/runtime/fe.js`]);
  });

  it('refuses installed delivery without an accepted build before importing or adding styles', async () => {
    const { io, imported, styles } = fakeIO();
    const { registry, registered } = fakeRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', name: 'Ext', version: '1.0.0',
      declarationRevision: 'current', feEntry: 'runtime/fe.js' })).rejects.toThrow('no accepted build identity');
    expect(imported).toEqual([]);
    expect(styles).toEqual([]);
    expect(registered).toEqual([]);
  });

  it('refuses a failed stylesheet before registering the frontend or granting settings access', async () => {
    const registration = { id: 'ext', declarationRevision: 'current', features: {}, bindSettings: vi.fn() };
    const { io } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    io.styles.prepare = vi.fn(() => ({ ready: Promise.reject(new Error('Rejected build styles')), commit: vi.fn(), dispose: vi.fn() }));
    io.settingsForPack = vi.fn();
    const { registry, registered } = fakeRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', name: 'Ext', version: '1.0.0',
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    })).rejects.toThrow('Rejected build styles');
    expect(registered).toEqual([]);
    expect(io.settingsForPack).not.toHaveBeenCalled();
  });

  it('publishes the captured reference metadata checked by the installed loader', async () => {
    const manifest = { id: 'ext', name: 'Ext', version: '1.0.0', features: { refs: { description: 'Feature declaration fixture.', references: {
      types: { note: { category: 'notes', icon: 'NotebookText', svgElements: [] } },
      categories: { notes: { label: 'Notes', icon: 'NotebookText', useItems: 'src/ref.ts#useItems' } },
    } } } };
    const type = { category: 'notes', icon: {}, svgElements: [] };
    let reads = 0;
    Object.defineProperty(type, 'category', { enumerable: true, get: () => ++reads === 1 ? 'notes' : 'changed' });
    const registration = { id: 'ext', declarationRevision: 'current', features: { refs: { references: {
      types: { note: type }, categories: { notes: { label: 'Notes', icon: {}, useItems: vi.fn() } },
    } } } };
    const { io } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    const registry = createNativeFrontendTestRegistry();
    await createPackFrontends(io, registry).load({ registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0',
      manifest, declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js' });
    expect(registry.referenceTypes().get('note')).toMatchObject({ featureRef: 'ext/refs',
      declarationRevision: 'current', registrationId: 'runtime', buildRevision, binding: { category: 'notes' } });
    expect(reads).toBe(1);
  });

  it('registers what its entry exports, and answers with the surfaces it added', async () => {
    const registration = { id: 'memo-pack', declarationRevision: 'current', features: { memos: { surface: { label: 'Memos', state: createMachine({}) } } } };
    const { io } = fakeIO({ [`pack://memo-pack/builds/${buildRevision}/runtime/fe.js`]: registration });
    const { registry, registered } = fakeRegistry();

    const surfaces = await createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('memo-pack'), id: 'memo-pack', declarationRevision: 'current', buildRevision, name: 'Memos', version: '1.0.0', feEntry: 'runtime/fe.js' });

    expect(registered).toEqual([registration]);
    expect(surfaces).toEqual([{ id: 'memo-pack/memos' }]);
  });

  it('is null for a pack with no frontend code, whose systems were told already', async () => {
    const { io } = fakeIO();
    const { registry, registered } = fakeRegistry();

    expect(await createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('backend-only'), id: 'backend-only', declarationRevision: 'current', buildRevision, name: 'B', version: '1.0.0' })).toBeNull();
    expect(registered).toEqual([]);
  });

  it('adds its stylesheet once however often it loads, and takes it out when the pack goes', async () => {
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: { id: 'ext', declarationRevision: 'current', features: {} } });
    const { registry, unregistered } = fakeRegistry();
    const frontends = createPackFrontends(io, registry);
    // Its revision is in the stylesheet's URL too: a browser caches a stylesheet by URL, so an updated pack's
    // styles would be served from the cache without it
    const pack = { registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', declarationRevision: 'current', buildRevision, name: 'Ext', version: '1.0.0', feStyles: 'runtime/fe.css', feEntry: 'runtime/fe.js' };

    await frontends.load(pack);
    await frontends.load(pack);
    expect(styles).toEqual([{ packId: 'ext', href: `pack://ext/builds/${buildRevision}/runtime/fe.css` }]);

    frontends.unload('ext');
    expect(styles).toEqual([]);
    expect(unregistered).toEqual(['ext']);
  });

  it('keeps accepted styles when a same-pack candidate is refused after its stylesheet is ready', async () => {
    const nextRevision = 'b'.repeat(64);
    const registration = { id: 'ext', declarationRevision: 'current', features: {} };
    const { io, styles } = fakeIO({
      [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration,
      [`pack://ext/builds/${nextRevision}/runtime/fe.js`]: { ...registration, bindSettings: () => { throw new Error('candidate refused'); } },
    });
    io.settingsForPack = async () => ({ port: {} as SettingsPort, dispose: vi.fn() });
    const registry = createNativeFrontendTestRegistry();
    const frontends = createPackFrontends(io, registry);
    const pack = { registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0', manifest: declaration('ext'),
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css' };
    await frontends.load(pack);
    await expect(frontends.load({ ...pack, buildRevision: nextRevision })).rejects.toThrow('candidate refused');
    expect(styles).toEqual([{ packId: 'ext', href: `pack://ext/builds/${buildRevision}/runtime/fe.css` }]);
    expect(() => registry.registerPackFE({ kind: 'loaded', pack }, registration)).toThrow('already registered');
    frontends.unload('ext');
    expect(styles).toEqual([]);
  });

  it('keeps accepted styles when declaration validation refuses a candidate before style preparation', async () => {
    const nextRevision = 'b'.repeat(64);
    const { io, styles } = fakeIO({
      [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: { id: 'ext', declarationRevision: 'current', features: {} },
      [`pack://ext/builds/${nextRevision}/runtime/fe.js`]: { id: 'ext', declarationRevision: 'current', features: { ghost: {} } },
    });
    const { registry } = fakeRegistry();
    const frontends = createPackFrontends(io, registry);
    const pack = { registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0', manifest: declaration('ext'),
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css' };
    await frontends.load(pack);
    await expect(frontends.load({ ...pack, buildRevision: nextRevision })).rejects.toThrow('accepted declarations');
    expect(styles).toEqual([{ packId: 'ext', href: `pack://ext/builds/${buildRevision}/runtime/fe.css` }]);
  });

  it('removes a fresh registration if its binding aborts before styles commit', async () => {
    const controller = new AbortController();
    const revoke = vi.fn();
    const transportDispose = vi.fn();
    const registration = { id: 'ext', declarationRevision: 'current', features: {},
      bindSettings: () => { controller.abort(); return { activate() {}, dispose: revoke }; } };
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    io.settingsForPack = async () => ({ port: {} as SettingsPort, dispose: transportDispose });
    const registry = createNativeFrontendTestRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0',
      manifest: declaration('ext'), declarationRevision: 'current', buildRevision,
      feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    }, controller.signal)).rejects.toThrow('cancelled');
    expect(revoke).toHaveBeenCalledOnce();
    expect(transportDispose).toHaveBeenCalledOnce();
    expect(styles).toEqual([]);
    expect(() => registry.registerFixture({ id: 'ext', features: {} })).not.toThrow();
  });

  it('publishes replacement styles with the new registry view and retires old authority afterward', async () => {
    const nextRevision = 'b'.repeat(64);
    const revoke = vi.fn();
    const dispose = vi.fn();
    const old = { id: 'ext', declarationRevision: 'current', features: {}, bindSettings: () => ({ activate() {}, dispose: revoke }) };
    const next = { id: 'ext', declarationRevision: 'current', features: {} };
    const { io, styles } = fakeIO({
      [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: old,
      [`pack://ext/builds/${nextRevision}/runtime/fe.js`]: next,
    });
    io.settingsForPack = async () => ({ port: {} as SettingsPort, dispose });
    const registry = createNativeFrontendTestRegistry();
    const frontends = createPackFrontends(io, registry);
    const pack = { registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0', manifest: declaration('ext'),
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css' };
    await frontends.load(pack);
    const observations: string[] = [];
    registry.onChanged(() => observations.push(styles[0].href));
    await frontends.load({ ...pack, buildRevision: nextRevision });
    expect(observations).toEqual([`pack://ext/builds/${nextRevision}/runtime/fe.css`]);
    expect(styles).toHaveLength(1);
    expect(revoke).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(registry.hasPackFE('ext')).toBe(true);
  });

  it('retires an accepted frontend when the replacement has no executable frontend or stylesheet', async () => {
    const revoke = vi.fn();
    const dispose = vi.fn();
    const registration = { id: 'ext', declarationRevision: 'current', features: {}, bindSettings: () => ({ activate() {}, dispose: revoke }) };
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    io.settingsForPack = async () => ({ port: {} as SettingsPort, dispose });
    const registry = createNativeFrontendTestRegistry();
    const frontends = createPackFrontends(io, registry);
    const pack = { registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0', manifest: declaration('ext'),
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css' };
    await frontends.load(pack);
    expect(await frontends.load({ ...pack, feEntry: undefined, feStyles: undefined })).toBeNull();
    expect(registry.hasPackFE('ext')).toBe(false);
    expect(revoke).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(styles).toEqual([]);
  });

  it('loads styles-only packs without executing or registering a frontend', async () => {
    const { io, styles, imported } = fakeIO();
    const { registry, registered } = fakeRegistry();
    expect(await createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('theme'),
      id: 'theme', declarationRevision: 'current', buildRevision, name: 'Theme', version: '1.0.0', feStyles: 'runtime/fe.css',
    })).toBeNull();
    expect(styles).toEqual([{ packId: 'theme', href: `pack://theme/builds/${buildRevision}/runtime/fe.css` }]);
    expect(imported).toEqual([]);
    expect(registered).toEqual([]);
  });

  it.each([
    undefined,
    { id: 'other', declarationRevision: 'current', features: {} },
    { id: 'ext', declarationRevision: 'previous', features: {} },
  ])('rejects mismatched frontend bindings without registration or styles: %j', async registration => {
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    const { registry, registered } = fakeRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('ext'),
      id: 'ext', declarationRevision: 'current', buildRevision, name: 'Ext', version: '1.0.0', feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    })).rejects.toThrow('Pack "ext"');
    expect(registered).toEqual([]);
    expect(styles).toEqual([]);
  });

  it.each([
    { features: { ghost: {} } },
    { settingsForms: { foreign: {} } },
    { appExtensions: { foreign: {} } },
    { artifacts: [{ type: 'foreign' }] },
  ])('refuses same-stamp undeclared frontend contributions before styles, settings or registry effects: %j', async contributions => {
    const registration = { id: 'ext', declarationRevision: 'current', bindSettings: vi.fn(), ...contributions };
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    io.settingsForPack = vi.fn();
    io.styles.prepare = vi.fn();
    const { registry, registered } = fakeRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0',
      manifest: declaration('ext'), declarationRevision: 'current', buildRevision,
      feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    })).rejects.toThrow('does not match its accepted declarations');
    expect(io.styles.prepare).not.toHaveBeenCalled();
    expect(io.settingsForPack).not.toHaveBeenCalled();
    expect(registration.bindSettings).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
    expect(styles).toEqual([]);
  });

  it('requires accepted declaration data before importing executable frontend code', async () => {
    const { io, imported, styles } = fakeIO();
    const { registry, registered } = fakeRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', id: 'ext', name: 'Ext', version: '1.0.0',
      declarationRevision: 'current', buildRevision, feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    })).rejects.toThrow('no matching accepted declarations');
    expect(imported).toEqual([]);
    expect(styles).toEqual([]);
    expect(registered).toEqual([]);
  });

  it('obtains a settings binding only after frontend declaration acceptance', async () => {
    const registration = { id: 'ext', declarationRevision: 'current', features: {}, bindSettings: vi.fn() };
    const { io } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: registration });
    const binding = { port: {} as SettingsPort, dispose: vi.fn() };
    const settingsForPack = vi.fn(async () => binding);
    io.settingsForPack = settingsForPack;
    const registerFixture = vi.fn((_registration: PackFERegistration, _resource: unknown) => []);
    const packs = { hasPackFE: () => false, preparePackFE: (_admission: unknown, reg: PackFERegistration, resource: unknown) => ({
      commit: () => registerFixture(reg, resource), dispose: () => {},
    }) } as unknown as FePackRegistry;
    const pack = { registrationId: 'runtime', manifest: declaration('ext'), id: 'ext', declarationRevision: 'current', buildRevision, name: 'Ext', version: '1.0.0', feEntry: 'runtime/fe.js' };
    await createPackFrontends(io, packs).load(pack);
    expect(settingsForPack).toHaveBeenCalledWith(pack);
    expect(registerFixture).toHaveBeenCalledWith(registration, binding);
    settingsForPack.mockClear();
    registration.declarationRevision = 'stale';
    await expect(createPackFrontends(io, packs).load(pack)).rejects.toThrow('Pack "ext"');
    expect(settingsForPack).not.toHaveBeenCalled();
  });

  it('refuses a generated frontend without a host settings provider before adding styles', async () => {
    const { io, styles } = fakeIO({ [`pack://ext/builds/${buildRevision}/runtime/fe.js`]: { id: 'ext', declarationRevision: 'current', features: {}, bindSettings: vi.fn() } });
    const { registry, registered } = fakeRegistry();
    await expect(createPackFrontends(io, registry).load({ registrationId: 'runtime', manifest: declaration('ext'),
      id: 'ext', declarationRevision: 'current', buildRevision, name: 'Ext', version: '1.0.0', feEntry: 'runtime/fe.js', feStyles: 'runtime/fe.css',
    })).rejects.toThrow('requires host-bound settings');
    expect(registered).toEqual([]);
    expect(styles).toEqual([]);
  });
});

it.each(['identity', 'declaration'])('pins accepted backend %s before asynchronous frontend delivery', async change => {
  const registry = createNativeFrontendTestRegistry();
  const { io } = fakeIO({});
  const frontends = createPackFrontends(io, registry);
  const registration = { id: 'ext', declarationRevision: 'current', steps: [{ type: 'memo', node: { label: 'Memo' } }] };
  let deliver!: (value: { default: unknown }) => void;
  io.importModule = vi.fn(() => new Promise<{ default: unknown }>(resolve => { deliver = resolve; }));
  const pack = { id: 'ext', name: 'Ext', version: '1.0.0', registrationId: 'accepted-runtime', declarationRevision: 'current',
    buildRevision, feEntry: 'runtime/fe.js', manifest: { ...declaration('ext'), extensions: { steps: { memo: { node: { label: 'Memo' } } } } } };
  const pending = frontends.load(pack);
  pack.registrationId = 'changed-runtime'; pack.buildRevision = 'b'.repeat(64);
  if (change === 'declaration') pack.manifest.extensions.steps.memo.node.label = 'Changed';
  deliver({ default: registration });
  await pending;
  expect(registry.stepBindings().get('memo')).toMatchObject({
    registrationId: 'accepted-runtime', buildRevision, declaration: { node: { label: 'Memo' } },
  });
  expect(io.importModule).toHaveBeenCalledWith(`pack://ext/builds/${buildRevision}/runtime/fe.js`);
  frontends.unload('ext');
});
