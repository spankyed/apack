import { eventContractsFixture } from './runtime/build-fixture.ts';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { createPackRegistry } from '../../src/packs/registry.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExternalPacks, loadSingleExternalPack } from '../../src/packs/runtime/loader.ts';
import { PACK_LAYOUT } from '../../src/packs/layout.ts';
import { sealPack, writeInstalledPackFixture } from './runtime/build-fixture.ts';
import { expect, it, vi } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { createContributionCatalog } from '../../src/packs/catalog.ts';
import { appSettingsDefinition } from '../../src/features/settings/be/app-definition.ts';

startTestRuntime({ appVersion: '1.0.0' });

const feature = { description: 'Open actions', surface: { label: 'Actions', state: 'missing.ts' } };
function source(id: string, enabled = true) {
  const manifest = { id, name: id, version: '1.0.0', features: { view: feature } };
  return { dir: `/missing/${id}`, enabled, snapshot: { manifest, declarationRevision: _declarationRevision(manifest),
    format: PACK_SNAPSHOT_FORMAT, types: { entities: {}, relKinds: {}, roles: {} }, facades: {}, eventContracts: eventContractsFixture(manifest), entityDestinations: { Action: 'view' } } };
}

it('projects compiled claims without source or activation, leaving source previews unbuilt', () => {
  const catalog = createContributionCatalog(appSettingsDefinition);
  catalog.setNative([{ id: 'native', features: { view: feature }, entityDestinations: { Prompt: 'view' } }]);
  catalog.replace([source('installed', false)]);
  const manifest = { ...source('source').snapshot.manifest, id: 'source' };
  catalog.setSources([{ dir: '/no-sources', manifest, declarationRevision: _declarationRevision(manifest) }]);
  expect(catalog.surfaces()).toMatchObject([
    { featureRef: 'native/view', opens: ['Prompt'] }, { featureRef: 'installed/view', enabled: false, opens: ['Action'] },
    { featureRef: 'source/view', origin: 'source' },
  ]);
  expect(catalog.surfaces()[2]).not.toHaveProperty('opens');
  expect(Reflect.set(catalog.surfaces()[0].opens!, 0, 'Action')).toBe(false);
});

it('refuses enabled conflicts atomically, naming both owners; disabled claims do not compete', () => {
  const catalog = createContributionCatalog(appSettingsDefinition);
  const first = source('first'), second = source('second', false);
  catalog.replace([first, second]);
  const before = catalog.getSnapshot();
  expect(() => catalog.assertPackEnabled('second', true)).toThrow(/Action.*first\/view.*second\/view/);
  expect(() => catalog.replace([first, { ...second, enabled: true }])).toThrow(/Action.*first\/view.*second\/view/);
  expect(() => catalog.assertPackDestinations(second)).toThrow(/Action.*first\/view.*second\/view/);
  expect(catalog.getSnapshot()).toBe(before);
  expect(catalog.get('second')!.enabled).toBe(false);
  catalog.replace([{ ...first, enabled: false }, { ...second, enabled: true }]);
  expect(catalog.get('second')!.enabled).toBe(true);
});

it('checks native destinations and conflicts before publishing composition changes', () => {
  const catalog = createContributionCatalog(appSettingsDefinition);
  catalog.replace([source('installed')]);
  const before = catalog.getSnapshot();
  const invalid: Record<string, string>[] = [{ Action: 'view' }, { Missing: 'view' }, { Prompt: 'constructor' }];
  for (const entityDestinations of invalid) {
    expect(() => catalog.setNative([{ id: 'native', features: { view: feature }, entityDestinations }])).toThrow(/Entity destination/);
    expect(catalog.getSnapshot()).toBe(before);
  }
});


it('refuses a conflicting verified candidate before importing its executable entry', () => {
  const catalog = createContributionCatalog(appSettingsDefinition);
  catalog.replace([source('incumbent')]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-destination-admission-'));
  const dir = path.join(root, 'candidate');
  try {
    const candidate = source('candidate');
    writeInstalledPackFixture(dir, candidate.snapshot.manifest);
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify(candidate.snapshot));
    const marker = path.join(dir, 'executed');
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('Activated');`);
    sealPack(dir);
    const previous = catalog.getSnapshot();
    expect(loadSingleExternalPack({ catalog }, dir)).toMatchObject({ problem: expect.stringMatching(/Action.*incumbent\/view.*candidate\/view/) });
    expect(fs.existsSync(marker)).toBe(false);
    expect(catalog.getSnapshot()).toBe(previous);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


it('reports every competing installed owner without stopping boot or importing its runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-destination-boot-'));
  vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_USER_DATA_DIR', root);
  try {
    const { packsDir } = resolveAppEnvironment();
    for (const id of ['first', 'second']) {
      const dir = path.join(packsDir, id), candidate = source(id);
      writeInstalledPackFixture(dir, candidate.snapshot.manifest);
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify(candidate.snapshot));
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, id))}, 'executed');`);
      sealPack(dir);
    }
    const registry = createPackRegistry();
    expect(loadExternalPacks(registry)).toEqual([]);
    expect(registry.loadProblem('first')).toMatch(/Action.*first\/view.*second\/view/);
    expect(registry.loadProblem('second')).toMatch(/Action.*first\/view.*second\/view/);
    expect(registry.catalog.getSnapshot().problems.map(problem => problem.id)).toEqual(['first', 'second']);
    expect(loadSingleExternalPack(registry, path.join(packsDir, 'first'))).toMatchObject({ problem: expect.stringContaining('second/view') });
    expect(fs.existsSync(path.join(root, 'first'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'second'))).toBe(false);
    registry.refreshCatalog({ packsDir, disabled: new Set(['second']), settings: 'enforce' });
    expect(registry.catalog.getSnapshot().problems).toEqual([]);
    expect(registry.catalog.get('first')?.enabled).toBe(true);
    expect(registry.catalog.get('second')?.enabled).toBe(false);
  } finally { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});

function referencing(id: string, enabled = true) {
  const references = { types: {}, categories: { files: { label: 'Files', icon: 'File', useItems: 'src/files.ts#useItems' } } };
  const manifest = { id, name: id, version: '1.0.0', features: { view: { ...feature, references } } };
  return { dir: `/missing/${id}`, enabled, snapshot: { manifest, declarationRevision: _declarationRevision(manifest),
    format: PACK_SNAPSHOT_FORMAT, types: { entities: {}, relKinds: {}, roles: {} }, facades: {}, eventContracts: eventContractsFixture(manifest), entityDestinations: {} } };
}

it('refuses an enabled reference-name conflict atomically, as it does a destination conflict', () => {
  const catalog = createContributionCatalog(appSettingsDefinition);
  const first = referencing('first'), second = referencing('second', false);
  catalog.replace([first, second]);
  const before = catalog.getSnapshot();
  expect(() => catalog.assertPackEnabled('second', true)).toThrow('Reference category "files" claimed by both "first/view" and "second/view"');
  expect(() => catalog.replace([first, { ...second, enabled: true }])).toThrow(/files.*first\/view.*second\/view/);
  expect(catalog.getSnapshot()).toBe(before);
});

it('withholds every installed owner of a shared reference name at boot, without importing either runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-reference-boot-'));
  vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_USER_DATA_DIR', root);
  try {
    const { packsDir } = resolveAppEnvironment();
    for (const id of ['first', 'second']) {
      const dir = path.join(packsDir, id), candidate = referencing(id);
      writeInstalledPackFixture(dir, candidate.snapshot.manifest);
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify(candidate.snapshot));
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, id))}, 'executed');`);
      sealPack(dir);
    }
    const registry = createPackRegistry();
    expect(loadExternalPacks(registry)).toEqual([]);
    expect(registry.loadProblem('first')).toBe('Reference category "files" claimed by both "first/view" and "second/view"');
    expect(registry.loadProblem('second')).toBe(registry.loadProblem('first'));
    expect(fs.existsSync(path.join(root, 'first'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'second'))).toBe(false);
    registry.refreshCatalog({ packsDir, disabled: new Set(['second']), settings: 'enforce' });
    expect(registry.catalog.getSnapshot().problems).toEqual([]);
  } finally { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});
