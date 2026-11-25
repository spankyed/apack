import { _packEntityTypes, _packRelationTypes } from '@apackdev/sdk/framework';
import { _declarationRevision } from '@apackdev/pack-format';
// A pack `apack pack init` scaffolds installs, and the app's pack loader loads it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { createPackRegistry, installPackFromLocal } from '@apackdev/host/packs';
import { loadExternalPacks } from '@apackdev/host/packs/runtime';
import { init } from '../../src/commands/init';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';

// The loader checks each pack's hostVersion against the app version
startTestRuntime({ appVersion: '1.0.0' });

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-install-load-'));
  origCwd = process.cwd();
  vi.stubEnv('APACK_ENV', 'test');
  vi.stubEnv('APACK_USER_DATA_DIR', tmpDir);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(origCwd);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Writes what `apack pack build` leaves in a pack's dist/: a runtime registering `featuresSource`, and a snapshot */
function writeBuild(packDir: string, id: string, featuresSource: string) {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(packDir, 'dist', rel)), { recursive: true });
    fs.writeFileSync(path.join(packDir, 'dist', rel), content);
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'));
  const appliers = Object.keys(manifest.content?.sources ?? {}).map(key => `{ key: ${JSON.stringify(key)}, apply: () => ({ created: 0, updated: 0, skipped: 0 }) }`).join(', ');
  write('runtime/index.cjs', (`module.exports = { registration: { id: ${JSON.stringify(id)}, features: ${featuresSource}, ears: ${JSON.stringify({ entities: _packEntityTypes(manifest), relKinds: _packRelationTypes(manifest) , roles: {}})}, appliers: [${appliers}] } };`) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
  write(PACK_LAYOUT.feEntry, 'export {};');
  const entries = Object.entries(manifest.content?.sources ?? {}).flatMap(([key, entry]) => {
    const source = entry as { path?: string; format?: string };
    if (typeof entry !== 'string' && source.path === undefined && source.format === undefined) return [];
    write(`${PACK_LAYOUT.contentDir}/${key}.content.json`, JSON.stringify({ records: [] }));
    return [{ key, written: true, count: 0, identity: [], items: [] }];
  });
  if (entries.length) write(`${PACK_LAYOUT.contentDir}/content.json`, JSON.stringify({ version: 1, packId: id, entries }));
  write(PACK_LAYOUT.snapshot, JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, eventContracts: { main: { system: { incoming: ['TEST_EVENT'], outgoing: [] }, surface: { receives: [] } } }, facades: {} }));
  sealPackBuild(path.join(packDir, 'dist'), JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf8')));
}

describe('pack full lifecycle: init → install → load', () => {
  it('scaffolded pack can be installed and loaded by the pack loader', async () => {
    process.chdir(tmpDir);
    await init(['my-test-pack']);

    const packDir = path.join(tmpDir, 'my-test-pack');
    expect(fs.existsSync(path.join(packDir, 'apack.json'))).toBe(true);

    // A built runtime with a simple system, standing in for apack pack build (which needs esbuild + SDK deps)
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'));
    delete manifest.hostVersion;
    manifest.features = {
      main: {
        description: 'Exercise the test system.',
        system: { entry: 'src/features/main/be/system.ts', events: { incoming: ['TEST_EVENT'] } },
        surface: { label: 'Fixture', state: 'src/features/main/fe/surface.ts' },
      },
    };
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify(manifest, null, 2));
    writeBuild(packDir, manifest.id, "{ main: { system: { machine: { id: 'my-test-pack-system' }, receives: ['TEST_EVENT'] }, surface: { receives: [] } } }");

    const packsDir = path.join(_appDirOf(tmpDir), 'packs');
    await installPackFromLocal(packDir, packsDir);

    const installedDir = path.join(packsDir, 'my-test-pack');
    expect(fs.existsSync(path.join(installedDir, 'apack.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedDir, PACK_LAYOUT.integrity))).toBe(true);
    expect(fs.existsSync(path.join(installedDir, 'runtime', 'index.cjs'))).toBe(true);

    // The loader finds it under APACK_USER_DATA_DIR
    const packs = loadExternalPacks(createPackRegistry());
    expect(packs).toHaveLength(1);
    expect(packs[0].origin.id).toBe('my-test-pack');
    expect(packs[0].origin.name).toBe('My Test Pack');
    // apack pack build put the manifest's incoming events beside the machine's
    const main = packs[0].registration.features?.main?.system;
    expect(main).toBeDefined();
    expect(main!.receives).toContain('TEST_EVENT');
  });
});
