import { eventContractsFixture } from './build-fixture.ts';
import { sealBuild, sealPack } from './build-fixture.ts';
import { _declarationRevision, type PackManifest } from '@apackdev/sdk/build';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from './test-host.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { clearPackRequireCache, loadAppPacks, loadExternalPacks, type LoadedPack } from '../../../src/packs/runtime/loader.ts';
import type { PackRegistration } from '@apackdev/sdk/framework';
import { applyPacks, contentRevision, type PackContentTarget } from '../../../src/packs/runtime/apply.ts';
import { appliedContent, appState } from '../../../src/app-state/index.ts';
import { readAppPackSources } from '../../../src/packs/app-sources.ts';
import { getLoadedPackEntries } from '../../../src/packs/layout.ts';
import { resetTestData, testRootEvents as rootEvents } from '@apackdev/sdk/testing';
import { PACK_SNAPSHOT_FORMAT, contentFile } from '@apackdev/sdk/build';
import type { ApplyRecord } from '@apackdev/sdk/utils';
import { recordInstalled, setPackEnabled, readInstalledPacks } from '../../../src/packs/installed.ts';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT, PACK_LAYOUT_VERSION, readPackBuild } from '../../../src/packs/layout.ts';


/** The features of a loaded pack that have a system */
const systemFeatures = (pack: LoadedPack) =>
  Object.entries(pack.registration.features ?? {}).filter(([, feature]) => feature.system).map(([featureId]) => featureId);


let tmpDir: string;
let origEnv: { env?: string; userDataDir?: string };

/** An installed pack: its manifest, integrity.json and a runtime/index.cjs registering `featuresSource` */
function makePack(
  packsDir: string,
  id: string,
  manifest: Record<string, unknown>,
  featuresSource = '{}',
) {
  const declarationRevision = _declarationRevision(manifest as PackManifest);
  const packDir = path.join(packsDir, id);
  fs.mkdirSync(path.join(packDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
  fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision, format: PACK_SNAPSHOT_FORMAT, manifest, eventContracts: eventContractsFixture(manifest as PackManifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), `module.exports = { registration: { id: ${JSON.stringify(manifest.id)}, declarationRevision: '${declarationRevision}', features: ${featuresSource} } };`);
  fs.writeFileSync(path.join(packDir, 'runtime', 'fe.js'), 'export default {};');
  sealPack(packDir);
  return packDir;
}

beforeEach(() => {
  // Content hashes live in AppState
  resetTestData();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-loader-test-'));
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = tmpDir;
});

afterEach(() => {
  for (const [key, value] of [['APACK_ENV', origEnv.env], ['APACK_USER_DATA_DIR', origEnv.userDataDir]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pack-loader', () => {
  describe('loadExternalPacks', () => {
    it('returns empty array when packs dir does not exist', () => {
      process.env.APACK_USER_DATA_DIR = path.join(tmpDir, 'nonexistent');
      const result = loadExternalPacks(registry);
      expect(result).toEqual([]);
    });

    it('returns empty array when packs dir is empty', () => {
      fs.mkdirSync(path.join(_appDirOf(tmpDir), 'packs'), { recursive: true });
      const result = loadExternalPacks(registry);
      expect(result).toEqual([]);
    });

    it('refuses malformed snapshot declarations before executing the runtime', () => {
      const dir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'broken-data', { id: 'broken-data', name: 'Broken', version: '1.0.0' });
      const marker = path.join(tmpDir, 'runtime-executed');
      fs.writeFileSync(path.join(dir, 'runtime', 'index.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT, manifest: { id: 'broken-data' } }));
      sealPack(dir);
      const warnings: string[] = [];
      const unsubscribe = rootEvents.onLog(event => {
        if (event.level === 'warn' && event.source === 'pack-loader') warnings.push(event.message);
      });
      try {
        expect(loadExternalPacks(registry)).toEqual([]);
        expect(warnings.some(message => message.includes('snapshot.json manifest.name'))).toBe(true);
        expect(fs.existsSync(marker)).toBe(false);
      } finally { unsubscribe(); }
    });

    it.each(['missing', 'disabled', 'wrong-owner'] as const)('refuses a %s required service before executing pack code', condition => {
      const packsDir = path.join(_appDirOf(tmpDir), 'packs');
      const dir = makePack(packsDir, 'consumer', { id: 'consumer', name: 'Consumer', version: '1.0.0',
        dependencies: { provider: '*' }, consumes: { services: ['provider/search'] } });
      if (condition !== 'missing') {
        makePack(packsDir, 'provider', { id: 'provider', name: 'Provider', version: '1.0.0',
          ...(condition === 'disabled' && { extensions: { services: { search: 'unavailable.ts#search' } } }) });
        if (condition === 'disabled') setPackEnabled('provider', false);
      }
      const marker = path.join(tmpDir, 'consumer-executed');
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); throw new Error('Must not execute');`);
      sealPack(dir);
      const recordLoadProblem = vi.fn();
      const loaded = loadExternalPacks({ ...registry, recordLoadProblem });
      expect(loaded.some(pack => pack.origin.id === 'consumer')).toBe(false);
      expect(recordLoadProblem).toHaveBeenCalledWith('consumer', expect.stringContaining('provider "provider"'));
      expect(fs.existsSync(marker)).toBe(false);
    });

    it('refuses directory owner mismatches before executing a runtime', () => {
      const dir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'local-pack', { id: 'other-pack', name: 'Other', version: '1.0.0' });
      const marker = path.join(tmpDir, 'owner-mismatch-executed');
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes');`);
      sealPack(dir);
      const recordLoadProblem = vi.fn();
      expect(loadExternalPacks({ ...registry, recordLoadProblem })).toEqual([]);
      expect(recordLoadProblem).toHaveBeenCalledWith('local-pack', 'Installed directory "local-pack" contains pack "other-pack"');
      expect(fs.existsSync(marker)).toBe(false);
    });

    it('retains a disabled choice and update provenance while an installed manifest is unreadable', () => {
      const packsDir = path.join(_appDirOf(tmpDir), 'packs');
      const manifest = { id: 'kept-pack', name: 'Kept', version: '1.0.0' };
      const dir = makePack(packsDir, manifest.id, manifest);
      recordInstalled(manifest.id, 'owner/kept-pack');
      setPackEnabled(manifest.id, false);
      recordInstalled('removed-pack', 'owner/removed-pack');
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), '{');
      const problems = vi.fn();
      expect(loadExternalPacks({ ...registry, recordLoadProblem: problems })).toEqual([]);
      expect(readInstalledPacks()).toEqual([expect.objectContaining({ id: manifest.id, enabled: false, installedFrom: 'owner/kept-pack' })]);
      makePack(packsDir, manifest.id, manifest);
      expect(loadExternalPacks(registry)).toEqual([]);
      expect(readInstalledPacks()[0].enabled).toBe(false);
    });

    it('discovers and loads a valid pack, with the system events its manifest adds', () => {
      const packsDir = path.join(_appDirOf(tmpDir), 'packs');
      makePack(packsDir, 'test-pack', {
        id: 'test-pack',
        name: 'Test Pack',
        version: '1.0.0',
        features: {
          myFeature: { description: 'Feature declaration fixture.', system: { entry: 'src/features/myFeature/be/system.ts', events: { incoming: ['DO_THING'] } } },
        },
      }, "{ myFeature: { system: { machine: { id: 'test-system' }, receives: ['DO_THING'] } } }");

      const result = loadExternalPacks(registry);

      expect(result).toHaveLength(1);
      expect(result[0].origin.id).toBe('test-pack');
      expect(systemFeatures(result[0])).toEqual(['myFeature']);
    });

    it('refuses undeclared features despite a matching stamp, before initializing compiled content', () => {
      const marker = path.join(tmpDir, 'compiled-content-initialized');
      const dir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'undeclared', {
        id: 'undeclared', name: 'Undeclared', version: '1.0.0',
      }, '{ ghost: {} }');
      fs.appendFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `\nmodule.exports.setCompiledDir = () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'initialized');`);
      sealPack(dir);
      expect(loadExternalPacks(registry)).toEqual([]);
      expect(fs.existsSync(marker)).toBe(false);
    });

    it("refuses an unsealed pack directory with its build diagnostic", () => {
      const packDir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'unbundled', { id: 'unbundled', name: 'Unbundled', version: '1.0.0' });
      fs.rmSync(path.join(packDir, PACK_LAYOUT.integrity));
      const warnings: string[] = [];
      const unsubscribe = rootEvents.onLog(event => {
        if (event.level === 'warn' && event.source === 'pack-loader') warnings.push(event.message);
      });
      try {
        expect(loadExternalPacks(registry)).toEqual([]);
        expect(warnings).toEqual([expect.stringMatching(/^Skipping unbundled: Not a pack layout: no integrity\.json in .*; rebuild the complete pack$/)]);
      } finally {
        unsubscribe();
      }
    });

    it('skips a pack without runtime/index.cjs', () => {
      const packDir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'no-runtime', { id: 'no-runtime', name: 'No Runtime', version: '1.0.0' });
      fs.rmSync(path.join(packDir, 'runtime', 'index.cjs'));
      expect(loadExternalPacks(registry)).toEqual([]);
    });

    it('skips packs without apack.json', () => {
      fs.mkdirSync(path.join(_appDirOf(tmpDir), 'packs', 'no-manifest'), { recursive: true });
      const result = loadExternalPacks(registry);
      expect(result).toEqual([]);
    });

    it('skips packs with invalid manifest (missing id)', () => {
      makePack(path.join(_appDirOf(tmpDir), 'packs'), 'bad-pack', {
        name: 'Bad',
        version: '1.0.0',
      });
      const result = loadExternalPacks(registry);
      expect(result).toEqual([]);
    });

    it('skips packs that require a newer host version', () => {
      makePack(path.join(_appDirOf(tmpDir), 'packs'), 'future-pack', {
        id: 'future-pack',
        name: 'Future',
        version: '1.0.0',
        hostVersion: '>=99.0.0',
      });
      const result = loadExternalPacks(registry);
      expect(result).toEqual([]);
    });

    it('skips packs whose hostVersion range excludes this host, not only >= ranges', () => {
      makePack(path.join(_appDirOf(tmpDir), 'packs'), 'old-range-pack', {
        id: 'old-range-pack',
        name: 'Old Range',
        version: '1.0.0',
        hostVersion: '>=0.0.1 <0.0.2',
      });
      expect(loadExternalPacks(registry)).toEqual([]);
    });

    it('loads packs whose hostVersion is satisfied', () => {
      makePack(path.join(_appDirOf(tmpDir), 'packs'), 'compat-pack', {
        id: 'compat-pack',
        name: 'Compatible',
        version: '1.0.0',
        hostVersion: '>=0.1.0',
      });
      const result = loadExternalPacks(registry);
      expect(result).toHaveLength(1);
    });

    it("loads a runtime requiring subpaths of the packages the host provides (the AI SDK's zod/v4)", () => {
      const packDir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'zod-pack', { id: 'zod-pack', name: 'Zod', version: '1.0.0' });
      // An installed pack has no node_modules: the host's copy is the only one there is, subpaths included, and
      // no list of them exists — the bridge resolves whatever the pack asks for
      fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), [
        "const zod = require('zod');",
        "const { z } = require('zod/v4');",
        "const { createMachine } = require('xstate');",
        "const { and } = require('xstate/guards');",
        `module.exports = { registration: { id: 'zod-pack', declarationRevision: '${_declarationRevision({ id: 'zod-pack', name: 'Zod', version: '1.0.0' })}' }, parsed: z.string().parse('ok'),`,
        "  sameZod: require('zod/v4') === require('zod/v4'), hostZod: zod === require('zod'),",
        "  machine: typeof createMachine, guard: typeof and };",
      ].join('\n'));
      sealPack(packDir);
      const [pack] = loadExternalPacks(registry);
      expect(pack?.origin.id).toBe('zod-pack');

      // The modules the runtime got are the host's own, not a second copy
      const runtime = require(path.join(packDir, 'runtime', 'index.cjs')) as Record<string, unknown>;
      expect(runtime).toMatchObject({ parsed: 'ok', sameZod: true, hostZod: true, machine: 'function', guard: 'function' });
      expect(runtime.zodIsHost ?? require('zod/v4')).toBe(require('zod/v4'));
    });

    it('handles packs with no features array', () => {
      makePack(path.join(_appDirOf(tmpDir), 'packs'), 'data-pack', {
        id: 'data-pack',
        name: 'Data Only',
        version: '1.0.0',
      });
      const result = loadExternalPacks(registry);
      expect(result).toHaveLength(1);
      expect(systemFeatures(result[0])).toEqual([]);
    });

  });

});

describe('loadAppPacks deterministic registration', () => {
  afterEach(() => {
    for (const id of ['a-custom', 'z-default']) if (registry.getPackRegistration(id)) registry.unregisterPack(id);
    registry.catalog.setAppPackSources({ sources: [], problems: [] });
  });

  it('retains the verified selected fork identity even when the app advertises the same id', () => {
    const appManifest = { id: 'a-custom', name: 'App default', version: '1.0.0' };
    const staging = makePack(path.join(tmpDir, 'app-stage'), 'a-custom', appManifest);
    const sources = path.join(tmpDir, 'app-sources');
    const source = path.join(sources, 'default');
    fs.mkdirSync(source, { recursive: true });
    fs.cpSync(staging, path.join(source, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(staging, 'apack.json'), path.join(source, 'apack.json'));
    sealBuild(source);
    registry.catalog.setAppPackSources(readAppPackSources(sources));
    const selected = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'a-custom', { id: 'a-custom', name: 'User fork', version: '2.0.0' });
    const accepted = readPackBuild(selected);
    loadAppPacks(registry);
    expect(registry.packOrigin('a-custom')).toMatchObject({ name: 'User fork', version: '2.0.0', dir: selected,
      buildRevision: accepted.revision, buildFiles: accepted.integrity.files });
    expect(registry.catalog.getSnapshot().appPackSources[0].snapshot.manifest.name).toBe('App default');
  });

  it('reuses boot discovery but refuses a changed valid build before executing it', () => {
    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    const dir = makePack(packsDir, 'changed-build', { id: 'changed-build', name: 'Original', version: '1.0.0' });
    const discovered = registry.refreshCatalog({ packsDir, settings: 'inspect' });
    const marker = path.join(tmpDir, 'changed-build-executed');
    fs.appendFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `;require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    sealPack(dir);
    const refresh = vi.spyOn(registry, 'refreshCatalog');
    try {
      expect(loadExternalPacks(registry, discovered)).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
      expect(registry.loadProblem('changed-build')).toContain('build changed after discovery');
      expect(fs.existsSync(marker)).toBe(false);
    } finally { refresh.mockRestore(); }
  });

  it('orders by pack id and reports both owners when a designation conflicts', () => {
    const packs = path.join(_appDirOf(tmpDir), 'packs');
    makePack(packs, 'z-default', { id: 'z-default', name: 'Default', version: '1.0.0', features: { owner: { description: 'Feature declaration fixture.', designation: 'loader-spec-role' } } }, "{ owner: { designation: 'loader-spec-role' } }");
    makePack(packs, 'a-custom', { id: 'a-custom', name: 'Custom', version: '1.0.0', features: { taker: { description: 'Feature declaration fixture.', designation: 'loader-spec-role' } } }, "{ taker: { designation: 'loader-spec-role' } }");
    const { loaded } = loadAppPacks(registry);
    expect(registry.designation('loader-spec-role')).toBe('a-custom/taker');
    expect(loaded.map(pack => pack.origin.id)).toEqual(['a-custom']);
    expect(registry.loadProblem('z-default')).toContain('a-custom');
    expect(registry.loadProblem('z-default')).toContain('z-default');
    expect(registry.packOrigin('a-custom')?.buildRevision).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('pack-loader: bundled runtime (runtime/index.cjs)', () => {
  function makeBundledPack(id: string, registrationSource: string, manifestExtra: Record<string, unknown> = {}, incoming = ['PING', 'EXTRA']) {
    const packDir = path.join(_appDirOf(tmpDir), 'packs', id);
    fs.mkdirSync(path.join(packDir, 'runtime', 'content'), { recursive: true });
    fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
    const manifest = { id, name: id, version: '1.0.0', data: { entities: { Widget: {} } }, lifecycle: { onInit: 'hooks.ts#onInit' }, features: { widget: { description: 'Feature declaration fixture.', system: { entry: 'system.ts' } } }, extensions: { services: { hello: 'hello.ts#hello' } }, ...manifestExtra };
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify(manifest));
    const declarationRevision = _declarationRevision(manifest);
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision, format: PACK_SNAPSHOT_FORMAT, manifest, eventContracts: eventContractsFixture(manifest as PackManifest, { widget: { system: { incoming, outgoing: [] }, ...((manifest as PackManifest).features?.widget?.surface && { surface: { receives: [] } }) } }), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
    fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), `${registrationSource}\nif (module.exports.registration) module.exports.registration.declarationRevision = '${declarationRevision}';`);
    fs.writeFileSync(path.join(packDir, 'runtime', 'fe.js'), 'export default {};');
    sealPack(packDir);
    return packDir;
  }

  const registration = (id: string, extra = '') => `
    let compiledDir = null;
    const machine = { id: 'widget', events: ['PING'], config: {} };
    module.exports = {
      setCompiledDir(dir) { compiledDir = dir; module.exports.compiledDirSeen = dir; },
      registration: {
        id: '${id}',
        ${extra.includes('features:') ? '' : "features: { widget: { system: { machine, receives: ['PING', 'EXTRA'] } } },"}
        services: { hello: () => 'hi' },
        ears: {
          entities: { Widget: 'Widget' },
          relKinds: {}, roles: {},
        },
        lifecycle: {
          onInit() {},
        },
        ${extra}
      },
    };
  `;

  it('loads systems, services and EARS from the runtime registration', () => {
    const dir = makeBundledPack('bundled-pack', registration('bundled-pack'), {
      features: { widget: { description: 'Exercise the widget system.', system: { entry: 'src/x.ts', events: { incoming: ['EXTRA'] } } } },
    });

    const [pack] = loadExternalPacks(registry);
    expect(pack.origin.id).toBe('bundled-pack');
    expect(systemFeatures(pack)).toEqual(['widget']);
    expect(Object.keys(pack.registration.services ?? {})).toEqual(['hello']);
    expect(pack.registration.ears?.entities).toEqual({ Widget: 'Widget' });
    expect(pack.registration.lifecycle?.onInit).toBeTypeOf('function');

    // content live under runtime/content for bundled packs
    const mod = require(path.join(dir, 'runtime', 'index.cjs'));
    expect(mod.compiledDirSeen).toBe(path.join(dir, 'runtime', 'content'));
  });

  it('refuses omitted EARS bindings instead of filling them from the manifest', () => {
    makeBundledPack('missing-ears', registration('missing-ears', 'ears: undefined,'));
    const problems = { recordLoadProblem: vi.fn() };
    expect(loadExternalPacks({ ...registry, ...problems })).toEqual([]);
    expect(problems.recordLoadProblem).toHaveBeenCalledWith('missing-ears', expect.stringContaining('ears.entities'));
  });

  it("registers the runtime's content writers and feature settings with the pack", async () => {
    const { registerExternalPacks } = await import('../../../src/packs/runtime/loader.ts');
    const { getSettingsCatalog } = await import('@apackdev/sdk/framework');
    const { _contentWriterRegistry } = await import('@apackdev/sdk/content');
    makeBundledPack('settings-pack', registration('settings-pack', `
      contentWriters: { Widget: { find() { return undefined; } } },
      features: { widget: { system: { machine, receives: ['PING'] }, surface: { receives: [] }, settings: { defaults: { size: 3 }, schema: { type: 'object' } } } },
    `), { features: { widget: { description: 'Exercise the widget system.', system: { entry: 'system.ts' }, surface: { label: 'Fixture', state: 'surface.ts', defaultVisible: false }, settings: { defaults: { size: 3 }, schema: { type: 'object' } } } }, content: { writers: { Widget: 'writer.ts#writer' } } }, ['PING']);

    registry.refreshCatalog({ packsDir: path.join(_appDirOf(tmpDir), 'packs'), settings: 'enforce' });
    const [pack] = loadExternalPacks(registry);
    expect(registerExternalPacks(registry, [pack])).toEqual([pack]);
    try {
      expect(_contentWriterRegistry.get('Widget')).toEqual({ find: expect.any(Function) });
      expect(getSettingsCatalog().features).toEqual({ 'settings-pack/widget': { defaults: { size: 3 }, schema: { type: 'object' } } });
      expect(registry.surfaceDefaults()).toEqual({ 'settings-pack/widget': false });
    } finally {
      registry.unregisterPack('settings-pack');
    }
  });

  // Nothing is taken off an installed pack's registration: its boot hooks reach the host as the pack wrote
  // them, like a shipped pack's, both being loaded and written by one path
  it("keeps the pack's registration as the pack wrote it", () => {
    const dir = makeBundledPack('intact-pack', registration('intact-pack'));

    const [pack] = loadExternalPacks(registry);
    expect(pack.registration.lifecycle?.onInit).toBeDefined();

    const exported = (require(path.join(dir, 'runtime', 'index.cjs')) as { registration: PackRegistration }).registration;
    expect(exported.lifecycle?.onInit).toBeDefined();
  });

  it('refuses undeclared boot hooks before registration or startup effects', () => {
    const dir = makeBundledPack('smuggle-pack', registration('smuggle-pack').replace(
      'onInit() {},',
      'onInit() {}, apply() { module.exports.bootApplyCalls = 1; },',
    ));
    const problems = { recordLoadProblem: vi.fn() };
    expect(loadExternalPacks({ ...registry, ...problems })).toEqual([]);
    expect(problems.recordLoadProblem).toHaveBeenCalledWith('smuggle-pack', expect.stringContaining('lifecycle'));
    expect(registry.getPackRegistration('smuggle-pack')).toBeNull();
    expect(require(path.join(dir, 'runtime', 'index.cjs')).bootApplyCalls).toBeUndefined();
  });

  it('refuses a runtime built against an @apackdev/sdk module this app no longer provides, saying to rebuild it', async () => {
    const { onLog } = await import('@apackdev/sdk/logger');
    const errors: string[] = [];
    const stop = onLog((entry) => { if (entry.level === 'error') errors.push(entry.message); });
    try {
      makeBundledPack('stale-pack', `require('@apackdev/sdk/rpc');\n${registration('stale-pack')}`);
      makeBundledPack('current-pack', registration('current-pack'));

      expect(loadExternalPacks(registry).map(p => p.origin.id)).toEqual(['current-pack']);
      expect(errors).toEqual([expect.stringContaining("@apackdev/sdk/rpc isn't provided by this apack: rebuild the pack with the current @apackdev/cli")]);
    } finally {
      stop();
    }
  });

  it('reverifies a later pack after an earlier runtime changes its bytes', () => {
    const target = makeBundledPack('z-target', registration('z-target'));
    makeBundledPack('a-mutator', `require('node:fs').appendFileSync(${JSON.stringify(path.join(target, PACK_LAYOUT.runtimeEntry))}, '\\n// changed');\n${registration('a-mutator')}`);
    const problems = new Map<string, string>();
    expect(loadExternalPacks({ ...registry, recordLoadProblem: (id, problem) => problems.set(id, problem) }).map(pack => pack.origin.id)).toEqual(['a-mutator']);
    expect(problems.get('z-target')).toContain('checksum mismatch runtime/index.cjs');
  });

  it('refuses a runtime whose registration id does not match the manifest', () => {
    makeBundledPack('real-id', registration('other-id'));
    expect(loadExternalPacks(registry)).toEqual([]);
  });

  it('refuses stale bindings before passing the compiled directory to the runtime', () => {
    const dir = makeBundledPack('stale-pack', registration('stale-pack'));
    fs.appendFileSync(path.join(dir, 'runtime', 'index.cjs'), '\nmodule.exports.registration.declarationRevision = "previous";');
    sealPack(dir);
    expect(loadExternalPacks(registry)).toEqual([]);
    expect(require(path.join(dir, 'runtime', 'index.cjs')).compiledDirSeen).toBeUndefined();
  });

  it('clears runtime modules loaded through a symlink without clearing a sibling pack', () => {
    const dir = makeBundledPack('linked-pack', registration('linked-pack'));
    const sibling = makeBundledPack('linked-pack-other', registration('linked-pack-other'));
    const link = path.join(tmpDir, 'runtime-link');
    fs.symlinkSync(dir, link, 'dir');
    const entry = path.join(link, 'runtime', 'index.cjs');
    const otherEntry = path.join(sibling, 'runtime', 'index.cjs');
    require(entry);
    require(otherEntry);
    expect(require.cache[require.resolve(entry)]).toBeDefined();
    clearPackRequireCache(link);
    expect(require.cache[require.resolve(entry)]).toBeUndefined();
    expect(require.cache[require.resolve(otherEntry)]).toBeDefined();
  });

  it('refuses a changed manifest before executing runtime code', () => {
    const dir = makeBundledPack('changed-pack', 'throw new Error("runtime must not execute")');
    fs.writeFileSync(path.join(dir, 'apack.json'), JSON.stringify({ id: 'changed-pack', name: 'Changed', version: '1.0.0' }));
    sealPack(dir);
    const problems = new Map<string, string>();
    expect(loadExternalPacks({ ...registry, recordLoadProblem: (id, problem) => problems.set(id, problem) })).toEqual([]);
    expect(problems.get('changed-pack')).toContain('manifest does not match');
  });

  it.each(['runtime/index.cjs', 'runtime/fe.js', 'runtime/content/settings.json'])('refuses changed build bytes before runtime execution: %s', file => {
    const dir = makeBundledPack('changed-bytes', 'globalThis.apackBuildExecuted = true;');
    const target = path.join(dir, file);
    fs.writeFileSync(target, 'original bytes');
    // A valid descriptor for these bytes, then an edit without a new build.
    sealPack(dir);
    fs.writeFileSync(target, 'globalThis.apackBuildExecuted = true;');
    const problems = new Map<string, string>();
    expect(loadExternalPacks({ ...registry, recordLoadProblem: (id, problem) => problems.set(id, problem) })).toEqual([]);
    expect(problems.get('changed-bytes')).toContain(`checksum mismatch ${file}`);
    expect(Reflect.get(globalThis, 'apackBuildExecuted')).toBeUndefined();
  });

  it('refuses a layout version this host does not support', () => {
    const dir = makeBundledPack('future-format', registration('future-format'));
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.integrity), JSON.stringify({ formatVersion: PACK_LAYOUT_VERSION + 1, id: 'future-format', version: '1.0.0', files: {} }));
    expect(loadExternalPacks(registry)).toEqual([]);
  });

  // The layout's format is written by whoever staged the pack; the snapshot's by the CLI that built its runtime, whose
  // registration the loader is about to load. A pack an older CLI built fails in ways that name nothing to act on.
  it.each([
    ['an older', undefined, `its snapshot is format (none), written by an older apack CLI (SDK 0.1.0); this apack reads format ${PACK_SNAPSHOT_FORMAT}. Rebuild it with the apack CLI that matches this apack`],
    ['a newer', PACK_SNAPSHOT_FORMAT + 1, `its snapshot is format ${PACK_SNAPSHOT_FORMAT + 1}, written by a newer apack CLI (SDK 0.1.0); this apack reads format ${PACK_SNAPSHOT_FORMAT}. Update apack to use it`],
  ])('skips a pack %s apack CLI built, before loading its runtime, saying which side to move', (_side, format, reason) => {
    const dir = makeBundledPack('other-build', 'throw new Error("its runtime was loaded")');
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify({ format, sdkVersion: '0.1.0' }));
    sealPack(dir);
    const warnings: string[] = [];
    const unsubscribe = rootEvents.onLog((event) => { if (event.level === 'warn') warnings.push(event.message); });
    try {
      expect(loadExternalPacks(registry)).toEqual([]);
      expect(warnings).toContain(`Skipping other-build: ${reason}`);
    } finally {
      unsubscribe();
    }
  });

});

describe('applyPacks: failures', () => {
  function installedPack(id: string) {
    const dir = path.join(_appDirOf(tmpDir), 'packs', id);
    fs.mkdirSync(path.join(dir, 'runtime', 'content'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runtime', 'index.cjs'), '');
    fs.writeFileSync(path.join(dir, 'runtime', 'content', 'flows.content.json'), '{}');
    return { manifest: { id }, dir } satisfies PackContentTarget;
  }
  function registryEntry(id: string) {
    const registry = JSON.parse(fs.readFileSync(path.join(_appDirOf(tmpDir), 'installed-packs.json'), 'utf-8'));
    return registry.packs.find((p: any) => p.id === id);
  }
  function writeRegistry(ids: string[]) {
    fs.writeFileSync(path.join(_appDirOf(tmpDir), 'installed-packs.json'), JSON.stringify({
      packs: ids.map(id => ({ id, name: id, version: '1.0.0', dir: '', enabled: true, installedAt: '' })),
    }));
  }

  const failingContent = () => ({ flows: { created: 0, updated: 0, skipped: 0, errors: ['Flow "X" is invalid: missing event'] } });

  it('treats content errors as a failure and records lastError', () => {
    const pack = installedPack('bad-flows');
    writeRegistry(['bad-flows']);

    const failures = applyPacks([pack], failingContent);

    expect(failures).toEqual([{ packId: 'bad-flows', errors: ['flows: Flow "X" is invalid: missing event'] }]);
    expect(registryEntry('bad-flows').lastError).toBe('flows: Flow "X" is invalid: missing event');
  });

  it("doesn't re-import unchanged failing content on every boot, and keeps its lastError", () => {
    const pack = installedPack('bad-flows');
    writeRegistry(['bad-flows']);
    const applyFn = vi.fn(failingContent);

    applyPacks([pack], applyFn);
    applyPacks([pack], applyFn);

    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(registryEntry('bad-flows').lastError).toBe('flows: Flow "X" is invalid: missing event');
  });

  it('re-applies data that matches an earlier successful content after a failed one (rollback)', () => {
    const pack = installedPack('rollback');
    writeRegistry(['rollback']);
    const contentDir = path.join(pack.dir, 'runtime', 'content');
    const applyFn = vi.fn(() => ({}));

    applyPacks([pack], applyFn); // v1 content
    fs.writeFileSync(path.join(contentDir, 'flows.content.json'), '{"v2": {}}');
    applyPacks([pack], failingContent); // v2 fails
    fs.writeFileSync(path.join(contentDir, 'flows.content.json'), '{}');
    applyPacks([pack], applyFn); // back to v1's data

    expect(applyFn).toHaveBeenCalledTimes(2);
    expect(registryEntry('rollback')).not.toHaveProperty('lastError');
  });

  // What makes the retry possible without re-importing on every lifecycle: the hash says the pack's own data is
  // unchanged, and this says what its dependencies were when it failed. A pack that written cleanly has
  // nothing to compare against, so it keeps no entry.
  it('records what a failed apply faced, and keeps nothing once the pack content cleanly', () => {
    const pack = { ...installedPack('records'), manifest: { id: 'records', dependencies: { provider: '^1.0.0' } } };
    writeRegistry(['records']);

    applyPacks([pack], failingContent);
    expect(appState.get().failedAgainst).toEqual({ records: 'provider:' });

    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'flows.content.json'), '{"fixed": {}}');
    applyPacks([pack], () => ({}));

    expect(appState.get().failedAgainst).toEqual({});
  });

  // The failure this is all for: pack B's content reference what pack A content, B written first and failed, and
  // B's own data never changes again — so before this it stayed broken until it was reinstalled.
  it('content a pack again once a pack it depends on has written since it failed', () => {
    const dependency = installedPack('provider');
    const dependent = { ...installedPack('consumer'), manifest: { id: 'consumer', dependencies: { provider: '^1.0.0' } } };
    writeRegistry(['provider', 'consumer']);
    const applyFn = vi.fn(() => ({}));

    // The dependency isn't installed yet, so the dependent content against nothing and fails
    applyPacks([dependent], failingContent);
    expect(registryEntry('consumer').lastError).toBeTruthy();

    // Its own data is unchanged, so on its own it is still skipped
    applyPacks([dependent], applyFn);
    expect(applyFn).not.toHaveBeenCalled();

    // ...until the pack it depends on content, which is the thing that could change the outcome
    applyPacks([dependency, dependent], applyFn);

    expect(applyFn).toHaveBeenCalledTimes(2);
    expect(registryEntry('consumer')).not.toHaveProperty('lastError');
  });

  it('stops retrying a pack that failed once its dependencies settle again', () => {
    const dependency = installedPack('steady');
    const dependent = { ...installedPack('flaky'), manifest: { id: 'flaky', dependencies: { steady: '^1.0.0' } } };
    writeRegistry(['steady', 'flaky']);
    const applyFn = vi.fn(failingContent);

    applyPacks([dependency, dependent], applyFn);
    const attempts = applyFn.mock.calls.length;

    // Nothing has changed since: not the pack's data, and not what it failed against
    applyPacks([dependency, dependent], applyFn);

    expect(applyFn).toHaveBeenCalledTimes(attempts);
    expect(registryEntry('flaky').lastError).toBeTruthy();
  });

  it('forgets what a failed apply faced once the pack has no content to retry', () => {
    const pack = { ...installedPack('withdrawn'), manifest: { id: 'withdrawn', dependencies: { provider: '^1.0.0' } } };
    writeRegistry(['withdrawn']);
    applyPacks([pack], failingContent);
    expect(appState.get().failedAgainst).toHaveProperty('withdrawn');

    fs.rmSync(path.join(pack.dir, 'runtime', 'content'), { recursive: true });
    applyPacks([pack], vi.fn());

    expect(appState.get().failedAgainst).toEqual({});
  });

  it("clears an earlier version's lastError when the pack no longer has content", () => {
    const pack = installedPack('no-more-content');
    fs.rmSync(path.join(pack.dir, 'runtime', 'content'), { recursive: true });
    fs.writeFileSync(path.join(_appDirOf(tmpDir), 'installed-packs.json'), JSON.stringify({
      packs: [{ id: 'no-more-content', name: 'n', version: '1.0.1', dir: '', enabled: true, installedAt: '', lastError: 'v1.0.0 failure' }],
    }));

    applyPacks([pack], vi.fn());

    expect(registryEntry('no-more-content')).not.toHaveProperty('lastError');
  });

  // No content key is the host's: a pack's `settings` content is its own data, like any other key
  it('runs every applier the pack registered, a settings applier included', async () => {
    const { importCompiledContent } = await import('@apackdev/sdk/utils');
    const { testPacks } = await import('@apackdev/sdk/testing');
    const pack = installedPack('with-settings');
    writeRegistry(['with-settings']);
    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'settings.content.json'), '{"surfaces": {}}');
    const settingsContent = vi.fn(() => ({ created: 0, updated: 1, skipped: 0 }));
    const actionsContent = vi.fn(() => ({ created: 1, updated: 0, skipped: 0 }));
    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'content.json'), JSON.stringify({ version: 1, packId: 'with-settings', entries: [] }));
    // The appliers its registration carries
    testPacks.appliers.set('with-settings', [{ key: 'settings', apply: settingsContent }, { key: 'actions', apply: actionsContent }]);

    try {
      applyPacks([pack], importCompiledContent);
    } finally {
      testPacks.appliers.delete('with-settings');
    }

    expect(actionsContent).toHaveBeenCalledOnce();
    expect(settingsContent).toHaveBeenCalledOnce();
  });

  it('records a thrown applier as a failure too', () => {
    const pack = installedPack('throws');
    writeRegistry(['throws']);
    const failures = applyPacks([pack], () => { throw new Error('boom'); });
    expect(failures).toEqual([{ packId: 'throws', errors: ['boom'] }]);
    expect(registryEntry('throws').lastError).toBe('boom');
  });

  it('clears lastError after a successful apply', () => {
    const pack = installedPack('recovered');
    fs.writeFileSync(path.join(_appDirOf(tmpDir), 'installed-packs.json'), JSON.stringify({
      packs: [{ id: 'recovered', name: 'r', version: '1.0.0', dir: '', enabled: true, installedAt: '', lastError: 'old failure' }],
    }));
    const failures = applyPacks([pack], () => ({ flows: { created: 1, updated: 0, skipped: 0 } }));
    expect(failures).toEqual([]);
    expect(registryEntry('recovered')).not.toHaveProperty('lastError');
  });

  /** A writer that declares the given keys, writes them, and reports what it was told to */
  const contentDefining = (keys: string[], counts = { created: 1, updated: 0, skipped: 0 }) =>
    (options: { applied?: ApplyRecord }) => {
      seenBefore.push([...(options.applied?.before.keys() ?? [])]);
      for (const key of keys) {
        options.applied?.defined.add(key);
        options.applied?.written.set(key, { entityType: 'Note', parts: { title: key } });
      }
      return { notes: counts };
    };
  let seenBefore: string[][] = [];
  beforeEach(() => { seenBefore = []; });

  /**
   * **What the last apply wrote is what the next one is handed**, which is the half `applyPacks` owns: the
   * writers decide what to do about an item, and this decides what they get to decide it from. It is
   * deliberately what was *written* rather than what the content *declared*: those are different questions,
   * and only the first answers "did we ever put this in the database" — a declared key whose create failed
   * never did.
   */
  it('hands a run what the last one wrote', () => {
    const pack = installedPack('keys');
    writeRegistry(['keys']);

    applyPacks([pack], contentDefining(['keys:notes/a', 'keys:notes/b']));
    // Changed content, or the second run is skipped on its revision
    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'flows.content.json'), '{"v":2}');
    applyPacks([pack], contentDefining(['keys:notes/a', 'keys:notes/b']));

    expect(seenBefore).toEqual([[], ['keys:notes/a', 'keys:notes/b']]);
  });

  /**
   * **An entry stays until the removal pass drops it**, not until the content stops declaring its key: the
   * writer is what decides whether the entity goes, and it reports that as `removed`. An entry dropped here
   * on the strength of the key alone would make a removal indistinguishable from content never shipped.
   */
  it('drops the entry of an item the run reports having removed, and keeps the rest', () => {
    const pack = installedPack('dropped');
    writeRegistry(['dropped']);

    applyPacks([pack], contentDefining(['dropped:notes/a', 'dropped:notes/b']));
    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'flows.content.json'), '{"v":2}');
    applyPacks([pack], (options: { applied?: ApplyRecord }) => {
      options.applied?.defined.add('dropped:notes/a');
      options.applied?.removed.add('dropped:notes/b');
      return { notes: { created: 0, updated: 0, skipped: 0 } };
    });

    expect(Object.keys(appliedContent.get('dropped').items)).toEqual(['dropped:notes/a']);
  });

  /**
   * **An item the content no longer declares that the user edited keeps its entry**, since the entity is
   * still there holding what we wrote: that is what Phase 4 draws the flag from.
   */
  it('keeps the entry of an item the run flagged rather than removed', () => {
    const pack = installedPack('flagged');
    writeRegistry(['flagged']);

    applyPacks([pack], contentDefining(['flagged:notes/a']));
    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'flows.content.json'), '{"v":2}');
    applyPacks([pack], (options: { applied?: ApplyRecord }) => {
      options.applied?.offers.set('flagged:notes/a', { kind: 'removed', parts: ['title'] });
      return { notes: { created: 0, updated: 0, skipped: 0 } };
    });

    expect(Object.keys(appliedContent.get('flagged').items)).toEqual(['flagged:notes/a']);
  });

  /** A writer that reports having written the given items, as the real writers report what they stamped */
  const contentWriting = (items: Record<string, Record<string, string>>, counts = { created: 1, updated: 0, skipped: 0 }) =>
    (options: { applied?: ApplyRecord }) => {
      for (const [key, parts] of Object.entries(items)) options.applied?.written.set(key, { entityType: 'Note', parts });
      return { notes: counts };
    };

  it('records the revision it applied from, which is the hash the skip gate reads', () => {
    const pack = installedPack('rev');
    writeRegistry(['rev']);

    applyPacks([pack], contentWriting({ 'rev:notes/a': { title: 'h1' } }));

    expect(appliedContent.get('rev').revision).toBe(contentRevision(path.join(pack.dir, 'runtime', 'content')));
  });

  /**
   * **The revision is the skip gate, which is why it lives with the items it describes.** A revision
   * recorded without them, or the other way round, is the state in which every item of a pack reads as the
   * user's — so the two move in one write.
   */
  it('skips a pack whose recorded revision is what its content hashes to', () => {
    const pack = installedPack('gate');
    writeRegistry(['gate']);
    const applyFn = vi.fn(contentWriting({ 'gate:notes/a': { title: 'h1' } }));

    applyPacks([pack], applyFn);
    applyPacks([pack], applyFn);
    expect(applyFn, 'the content has not moved, so there is nothing to decide again').toHaveBeenCalledOnce();

    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'flows.content.json'), '{"v":2}');
    applyPacks([pack], applyFn);
    expect(applyFn).toHaveBeenCalledTimes(2);
  });

  /**
   * **The conflict is this phase's whole user-visible value**, so an apply that found one says so: a line
   * per item with the parts that differ, and the content keys in the event's meta for whoever is tracing
   * one. Named rather than keyed — a content key is `%5B%22Action%22...`, which nobody reads.
   */
  it('logs the items with the user’s edits, named, and the keys in the meta', async () => {
    const { onLog } = await import('@apackdev/sdk/logger');
    const pack = installedPack('conflicted');
    writeRegistry(['conflicted']);
    const key = `${'conflicted'}:actions/${encodeURIComponent(JSON.stringify(['Action', 'Echo']))}`;
    const logged: Array<{ message: string; meta?: unknown }> = [];
    const stop = onLog((event) => { logged.push({ message: event.message, ...(event.meta !== undefined && { meta: event.meta }) }); });

    try {
      applyPacks([pack], (options: { applied?: ApplyRecord }) => {
        options.applied?.offers.set(key, { kind: 'update', parts: ['actionFn', 'inputs'], contentHash: 'echo-v2' });
        return { actions: { created: 0, updated: 0, skipped: 1 } };
      });
    } finally {
      stop();
    }

    const entry = logged.find((event) => event.message.includes('have your edits'));
    expect(entry?.message, 'the item, by name, with the parts that differ')
      .toBe('1 of conflicted\'s items have your edits and a newer version waiting:\n  actions / Action "Echo" (actionFn, inputs)');
    expect(entry?.meta).toMatchObject({
      packId: 'conflicted',
      items: { [key]: { kind: 'update', parts: ['actionFn', 'inputs'], contentHash: 'echo-v2' } },
    });
  });

  /**
   * **An item a run did not write keeps the entry the last one gave it**, because the entity still holds what
   * that run wrote. Without the carry-forward the record would describe only the latest run's writes, which
   * is not what it claims to be.
   */
  it('keeps the entry of an item this run did not write', () => {
    const pack = installedPack('carry');
    writeRegistry(['carry']);

    applyPacks([pack], contentWriting({ 'carry:notes/a': { title: 'h1' }, 'carry:notes/b': { title: 'h2' } }));
    fs.writeFileSync(path.join(pack.dir, 'runtime', 'content', 'flows.content.json'), '{"v":2}');
    applyPacks([pack], contentWriting({ 'carry:notes/a': { title: 'h1-changed' } }));

    expect(appliedContent.get('carry').items).toEqual({
      'carry:notes/a': { entityType: 'Note', parts: { title: 'h1-changed' } },
      'carry:notes/b': { entityType: 'Note', parts: { title: 'h2' } },
    });
  });

  /**
   * **A run that failed still wrote whatever it got through**, and the revision has already moved with them,
   * so nothing will re-import those items until the content changes again. Leaving them out would make a
   * later apply read every one of them as the user's.
   */
  it('records what a failed run wrote, since its writes landed anyway', () => {
    const pack = installedPack('partial');
    writeRegistry(['partial']);

    applyPacks([pack], contentWriting({ 'partial:notes/a': { title: 'h1' } }, { created: 1, updated: 0, skipped: 1, errors: ['the next one failed'] } as never));

    expect(appliedContent.get('partial').items).toEqual({ 'partial:notes/a': { entityType: 'Note', parts: { title: 'h1' } } });
  });

  it('records nothing for a pack with no content', () => {
    const pack = installedPack('empty');
    fs.rmSync(path.join(pack.dir, 'runtime', 'content'), { recursive: true });
    writeRegistry(['empty']);

    applyPacks([pack], vi.fn());

    expect(appliedContent.get('empty')).toEqual({ revision: '', items: {} });
  });

  /** A pack id holds a dash, and an entity's type is the text before its first one */
  it('records a pack whose id holds a dash', () => {
    const pack = installedPack('default-setup');
    writeRegistry(['default-setup']);

    applyPacks([pack], contentWriting({ 'default-setup:notes/a': { title: 'h1' } }));

    expect(Object.keys(appliedContent.get('default-setup').items)).toEqual(['default-setup:notes/a']);
  });
});

describe('applyPacks', () => {
  function makePackWithContent(
    packsDir: string,
    id: string,
    contentFiles?: Record<string, any>,
  ) {
    const packDir = path.join(packsDir, id);
    const distDir = path.join(packDir, 'runtime', 'content');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({
      id, name: id, version: '1.0.0',
    }));
    if (contentFiles) {
      for (const [name, data] of Object.entries(contentFiles)) {
        fs.writeFileSync(path.join(distDir, name), JSON.stringify(data));
      }
    }
    return {
      manifest: { id, name: id, version: '1.0.0' },
      dir: packDir,
      systems: new Map(),
    } as any;
  }

  it('calls applyFn for packs with compiled content in runtime/content', () => {
    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    const pack = makePackWithContent(packsDir, 'data-pack', {
      [contentFile('actions')]: [{ label: 'test-action', actionFn: 'return true' }],
    });

    const applyFn = vi.fn().mockReturnValue({});

    applyPacks([pack], applyFn);

    expect(applyFn).toHaveBeenCalledOnce();
    // No `include`: every key a pack declares is applied. What an apply leaves alone it decides from the
    // merge over what it last wrote, what the content says now and what the database holds; never from a
    // policy naming keys
    expect(applyFn).toHaveBeenCalledWith({
      compiledDir: path.join(pack.dir, 'runtime', 'content'),
      mode: 'replace-on-collision',
      applied: {
        before: new Map(), defined: new Set(), written: new Map(),
        removed: new Set(), offers: new Map(),
      },
    });
  });

  it('skips packs without runtime/content', () => {
    const packDir = path.join(_appDirOf(tmpDir), 'packs', 'no-dist');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({
      id: 'no-dist', name: 'No Dist', version: '1.0.0',
    }));

    const pack = {
      manifest: { id: 'no-dist', name: 'No Dist', version: '1.0.0' },
      dir: packDir,
      systems: new Map(),
    } as any;

    const applyFn = vi.fn().mockReturnValue({});
    applyPacks([pack], applyFn);

    expect(applyFn).not.toHaveBeenCalled();
  });

  it('skips packs whose recorded revision has not changed', () => {
    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    const pack = makePackWithContent(packsDir, 'cached-pack', {
      [contentFile('actions')]: [{ label: 'cached' }],
    });

    const distDir = path.join(pack.dir, 'runtime', 'content');
    appliedContent.record('cached-pack', { revision: contentRevision(distDir), wrote: new Map() });

    const applyFn = vi.fn().mockReturnValue({});
    applyPacks([pack], applyFn);

    expect(applyFn).not.toHaveBeenCalled();
  });

  it('re-applies when pack content changes', () => {
    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    const pack = makePackWithContent(packsDir, 'updated-pack', {
      [contentFile('actions')]: [{ label: 'v1' }],
    });

    appliedContent.record('updated-pack', { revision: 'old-hash', wrote: new Map() });
    appliedContent.record('disabled-pack', { revision: 'its-hash', wrote: new Map() });
    const applyFn = vi.fn().mockReturnValue({});

    applyPacks([pack], applyFn);

    expect(applyFn).toHaveBeenCalledOnce();
    expect(appliedContent.get('updated-pack').revision).toBe(contentRevision(path.join(pack.dir, 'runtime', 'content')));
    // A pack not loaded this boot (disabled) keeps its revision, so enabling it doesn't re-apply its content
    expect(appliedContent.get('disabled-pack').revision).toBe('its-hash');
  });

  it('continues applying other packs when one fails', () => {
    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    const pack1 = makePackWithContent(packsDir, 'fail-pack', {
      [contentFile('actions')]: [{ label: 'will-fail' }],
    });
    const pack2 = makePackWithContent(packsDir, 'ok-pack', {
      [contentFile('actions')]: [{ label: 'will-succeed' }],
    });

    let callCount = 0;
    const applyFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('content failed');
      return {};
    });

    applyPacks([pack1, pack2], applyFn);

    expect(applyFn).toHaveBeenCalledTimes(2);
    // A failed content's revision is recorded too, so the same failing data isn't retried every boot
    expect(appliedContent.get('fail-pack').revision).toEqual(expect.any(String));
    expect(appliedContent.get('ok-pack').revision).toEqual(expect.any(String));
  });
});

describe('contentRevision', () => {
  it('returns empty string for a directory with no content files', () => {
    const emptyDir = path.join(tmpDir, 'empty-dist');
    fs.mkdirSync(emptyDir, { recursive: true });
    expect(contentRevision(emptyDir)).toBe('');
  });

  it('returns the same hash for files nothing has touched', () => {
    const distDir = path.join(tmpDir, 'hash-test');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, contentFile('actions')), '[]');

    const hash1 = contentRevision(distDir);
    const hash2 = contentRevision(distDir);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe('');
  });

  // The names as well as the bytes, which is the half a byte-only hash would miss: the same records moved from one
  // content file to another are a different applying, and nothing else here tells those apart — adding or changing a
  // file moves the bytes too, so only a rename isolates it.
  it('changes when the same bytes move to a different file', () => {
    const distDir = path.join(tmpDir, 'hash-renamed');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, contentFile('actions')), '[{"label":"same"}]');
    const before = contentRevision(distDir);

    fs.rmSync(path.join(distDir, contentFile('actions')));
    fs.writeFileSync(path.join(distDir, contentFile('prompts')), '[{"label":"same"}]');

    expect(contentRevision(distDir)).not.toBe(before);
  });

  // **The hash is content, so a rewrite with the same bytes is not a change.** It used to be: file times were in
  // here so that reinstalling a pack would re-apply it, since `placePack` replaces every file. That made a `touch`
  // re-apply too, and made every `apack pack dev` backend rebuild re-import every item, because that loop reinstalls.
  // Asking for a pack's data to be put back is `IMPORT_PACK_CONTENT` now, which says so.
  it('returns the same hash when the same bytes are put back in new files', () => {
    const distDir = path.join(tmpDir, 'hash-replaced');
    fs.mkdirSync(distDir, { recursive: true });
    const file = path.join(distDir, contentFile('actions'));
    fs.writeFileSync(file, '[{"label":"same"}]');
    const before = contentRevision(distDir);

    // What placePack leaves behind: the same content, in a file that wasn't there a moment ago
    fs.writeFileSync(file, '[{"label":"same"}]');
    const replaced = new Date(Date.now() + 5_000);
    fs.utimesSync(file, replaced, replaced);

    expect(contentRevision(distDir)).toBe(before);
  });

  // The same property through a real install, which is the one that used to carry the old contract: `placePack`
  // really does leave new files, and that is now not a reason to apply again
  it('does not change after installing the same pack source over itself', async () => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');
    const source = path.join(tmpDir, 'reinstall-source');
    fs.mkdirSync(path.join(source, 'dist', 'runtime', 'content'), { recursive: true });
    fs.writeFileSync(path.join(source, 'apack.json'), JSON.stringify({ id: 'reinstalled', name: 'R', version: '1.0.0' }));
    fs.writeFileSync(path.join(source, 'dist', 'runtime', 'index.cjs'), 'module.exports = {};');
    fs.mkdirSync(path.join(source, 'dist', 'types'), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf8'));
    fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT, manifest, declarationRevision: _declarationRevision(manifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
    fs.writeFileSync(path.join(source, 'dist', 'runtime', 'content', contentFile('actions')), '[{"label":"same"}]');

    sealBuild(source);
    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    const { dir } = await installPackFromLocal(source, packsDir);
    const content = path.join(dir, 'runtime', 'content');
    const before = contentRevision(content);

    await installPackFromLocal(source, packsDir);

    expect(contentRevision(content), 'a reinstall of identical bytes read as changed data').toBe(before);
  });

  it('returns different hash when content changes', () => {
    const distDir = path.join(tmpDir, 'hash-change');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, contentFile('actions')), '[{"label":"v1"}]');
    const hash1 = contentRevision(distDir);

    fs.writeFileSync(path.join(distDir, contentFile('actions')), '[{"label":"v2"}]');
    const hash2 = contentRevision(distDir);

    expect(hash1).not.toBe(hash2);
  });

  it('hashes any JSON file, not just known content types', () => {
    const distDir = path.join(tmpDir, 'custom-content');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'compiled-widgets.json'), '[{"id":"w1"}]');

    const hash = contentRevision(distDir);
    expect(hash).not.toBe('');
  });

  // **Everything in the pack's content directory, media included.** The directory holds what `apack pack build`
  // compiled there and nothing else, so there is no file kind to exclude — and a changed image is changed
  // content, which a hash over `.json` alone called unchanged
  it('hashes every file under the content directory, media and all', () => {
    const contentDir = path.join(tmpDir, 'with-media');
    fs.mkdirSync(contentDir, { recursive: true });
    expect(contentRevision(contentDir), 'an empty directory has nothing to apply').toBe('');

    fs.writeFileSync(path.join(contentDir, 'notes.content.json'), '[]');
    const withoutMedia = contentRevision(contentDir);
    expect(withoutMedia).not.toBe('');

    fs.mkdirSync(path.join(contentDir, 'media', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'media', 'notes', 'diagram.png'), 'first');
    const withMedia = contentRevision(contentDir);
    expect(withMedia, 'a media file is content').not.toBe(withoutMedia);

    fs.writeFileSync(path.join(contentDir, 'media', 'notes', 'diagram.png'), 'second');
    expect(contentRevision(contentDir), "a media file's content is content").not.toBe(withMedia);
  });
});

describe('loaded packs: accepted frontend assets', () => {
  it('publishes the file membership and identities accepted by the installed backend loader', () => {
    const dir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'identity', { id: 'identity', name: 'Identity', version: '1.0.0' });
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'export default {};');
    sealPack(dir);
    const [accepted] = loadExternalPacks(registry);
    expect(accepted.origin.buildRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(accepted.origin.buildFiles?.[PACK_LAYOUT.feEntry]).toMatch(/^[a-f0-9]{64}$/);
    expect(getLoadedPackEntries({ loadedPacks: () => [accepted.origin], getPackRuntime: () => ({ origin: accepted.origin, registrationId: 'runtime' }) })[0]).toMatchObject({
      id: 'identity', declarationRevision: accepted.origin.declarationRevision, buildRevision: accepted.origin.buildRevision,
      feEntry: PACK_LAYOUT.feEntry,
    });
  });

  it('lists every runtime using admitted membership, without reading the current filesystem', () => {
    const revision = 'a'.repeat(64);
    const pack = (id: string, files: string[]) => ({ declarationRevision: 'fixture-revision', buildRevision: revision,
      buildFiles: Object.fromEntries(files.map(file => [file, 'b'.repeat(64)])),
      manifest: { id, name: id, version: '2.0.0' },
      id, name: id, version: '2.0.0', dir: '/not-an-installed-directory' });
    const origins = [pack('with-fe', [PACK_LAYOUT.feEntry, PACK_LAYOUT.feStyles]), pack('be-only', [])];
    const loaded = { loadedPacks: () => origins, getPackRuntime: (id: string) => { const origin = origins.find(pack => pack.id === id); return origin ? { origin, registrationId: 'runtime' } : null; } };
    expect(getLoadedPackEntries(loaded)).toEqual([
      { id: 'with-fe', registrationId: 'runtime', declarationRevision: 'fixture-revision', buildRevision: revision, name: 'with-fe', version: '2.0.0', manifest: { id: 'with-fe', name: 'with-fe', version: '2.0.0' }, feEntry: PACK_LAYOUT.feEntry, feStyles: PACK_LAYOUT.feStyles },
      { id: 'be-only', registrationId: 'runtime', declarationRevision: 'fixture-revision', buildRevision: revision, name: 'be-only', version: '2.0.0' },
    ]);
  });

  it('hands the renderer an owned declaration copy rather than a mutable backend origin', () => {
    const manifest = { id: 'copy', name: 'Copy', version: '1.0.0' };
    const origin = { id: manifest.id, name: manifest.name, version: manifest.version, manifest,
      declarationRevision: _declarationRevision(manifest), buildRevision: 'a'.repeat(64),
      buildFiles: { [PACK_LAYOUT.feEntry]: 'b'.repeat(64) }, dir: '/packs/copy' };
    const loaded = { loadedPacks: () => [origin], getPackRuntime: () => ({ origin, registrationId: 'runtime' }) };
    getLoadedPackEntries(loaded)[0].manifest!.name = 'Changed by reader';
    expect(manifest.name).toBe('Copy');
    expect(getLoadedPackEntries(loaded)[0].manifest?.name).toBe('Copy');
  });

  it('keeps the accepted frontend identity and membership after files change or disappear', () => {
    const dir = makePack(path.join(_appDirOf(tmpDir), 'packs'), 'identity', { id: 'identity', name: 'Identity', version: '1.0.0' });
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'export default {};');
    sealPack(dir);
    const [accepted] = loadExternalPacks(registry);
    const loaded = { loadedPacks: () => [accepted.origin], getPackRuntime: () => ({ origin: accepted.origin, registrationId: 'runtime' }) };
    const previous = getLoadedPackEntries(loaded);
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'export default { changed: true };');
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.feStyles), 'body {}');
    expect(getLoadedPackEntries(loaded)).toEqual(previous);
    sealPack(dir);
    const [replacement] = loadExternalPacks(registry);
    expect(replacement.origin.buildRevision).not.toBe(accepted.origin.buildRevision);
    expect(getLoadedPackEntries({ loadedPacks: () => [replacement.origin], getPackRuntime: () => ({ origin: replacement.origin, registrationId: 'replacement' }) })[0].feStyles).toBe(PACK_LAYOUT.feStyles);
    fs.rmSync(path.join(dir, PACK_LAYOUT.feEntry));
    expect(getLoadedPackEntries(loaded)).toEqual(previous);
  });
});
