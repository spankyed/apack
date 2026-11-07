import { compileSettingsCatalog } from '../../src/features/settings/validation.ts';
import { assertPackSettings } from '../../src/packs/settings-admission.ts';
import { installPackFromLocal } from '../../src/packs/installer.ts';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
// Settings discovery uses verified declarations regardless of whether executable code can activate.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, type PackManifest } from '@apackdev/sdk/build';
import { PACK_LAYOUT } from '../../src/packs/layout.ts';
import { sealPack } from './runtime/build-fixture.ts';

let packsDir: string;
beforeEach(() => { packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-settings-discovery-')); });
afterEach(() => fs.rmSync(packsDir, { recursive: true, force: true }));
const definition = { defaults: { name: '' }, schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } };

function install(id: string, name = ''): string {
  const dir = path.join(packsDir, id);
  fs.mkdirSync(path.join(dir, 'types'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  const manifest: PackManifest = { id, name: id, version: '1.0.0',
    extensions: { settings: { assistant: { ...definition, defaults: { name } } } },
    features: { memos: { description: 'Feature declaration fixture.', settings: definition } },
  };
  const snapshot = { format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest), manifest, types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} };
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), 'throw new Error("must not activate during discovery");');
  sealPack(dir);
  return dir;
}

it('discovers verified disabled and activation-failed definitions without executing code', () => {
  install('disabled');
  install('failed');
  const registry = createNativePackTestRegistry();
  registry.refreshCatalog({ packsDir, disabled: new Set(['disabled']), settings: 'enforce' });
  expect(Object.keys(registry.settingsCatalog().features)).toEqual(['disabled/memos', 'failed/memos']);
  expect(registry.catalog.get('disabled')?.enabled).toBe(false);
  registry.recordLoadProblem('failed', 'runtime throws');
  expect(registry.settingsCatalog().packs.failed.assistant.defaults).toEqual({ name: '' });
  expect(registry.loadedPacks()).toEqual([]);
  expect(registry.getPackRegistration('disabled')).toBeNull();
  expect(registry.getPackRegistration('failed')).toBeNull();
});

it('retains accepted declarations and reports a malformed replacement instead of silently removing settings', () => {
  const dir = install('memo-pack', 'Accepted');
  const registry = createNativePackTestRegistry();
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' });
  const previous = registry.settingsCatalog();
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), '{ broken');
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' });
  expect(registry.settingsCatalog()).toBe(previous);
  expect(registry.settingsCatalog().packs['memo-pack'].assistant.defaults).toEqual({ name: 'Accepted' });
  expect(registry.loadProblem('memo-pack')).toContain('declarations were refused');
  install('memo-pack', 'Rebuilt');
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' });
  expect(registry.settingsCatalog().packs['memo-pack'].assistant.defaults).toEqual({ name: 'Rebuilt' });
  expect(registry.loadProblem('memo-pack')).toBeUndefined();
});

it('publishes removal only after the installed directory is gone', () => {
  const dir = install('memo-pack');
  const registry = createNativePackTestRegistry();
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' });
  fs.rmSync(dir, { recursive: true });
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' });
  expect(registry.settingsCatalog().features).toEqual({});
  expect(registry.settingsCatalog().packs).toEqual({});
});

it('refuses invalid native declarations atomically and retains other contributions', () => {
  const registry = createNativePackTestRegistry();
  registry.registerPack({ id: 'accepted', features: { memos: { settings: definition } } });
  const previous = registry.settingsCatalog();
  expect(() => registry.registerPack({ id: 'bad-pack', features: { memos: { settings: { ...definition, defaults: { name: 1 } } } } })).toThrow('features.memos.settings.defaults.name: must be string');
  expect(registry.settingsCatalog()).toBe(previous);
  expect(registry.getPackRegistration('accepted')).not.toBeNull();
  expect(registry.getPackRegistration('bad-pack')).toBeNull();
});


it('refuses incompatible declarations before publication and retains every accepted projection', () => {
  install('memo-pack');
  const registry = createNativePackTestRegistry();
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' });
  const previous = registry.catalog.getSnapshot();
  const settings = registry.settingsCatalog();
  registry.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate({ packs: { 'memo-pack': { assistant: { name: 'My choice' } } } }));
  const manifest: PackManifest = { id: 'memo-pack', name: 'Memo', version: '2.0.0', extensions: { settings: {
    assistant: { defaults: { name: 'Only' }, schema: { type: 'object', properties: { name: { enum: ['Only'] } }, required: ['name'] } },
  } } };
  expect(() => registry.catalog.assertPackSettings(manifest)).toThrow('memo-pack/assistant');
  const sourceRegistry = createNativePackTestRegistry();
  const accepted = { ...manifest, extensions: { settings: { assistant: definition } } };
  sourceRegistry.catalog.setSources([{ manifest: accepted, dir: '/source', declarationRevision: _declarationRevision(accepted) }]);
  const sourceBefore = sourceRegistry.catalog.getSnapshot();
  sourceRegistry.catalog.setSettingsAdmission(candidate => compileSettingsCatalog(candidate).validate({ packs: { 'memo-pack': { assistant: { name: 'My choice' } } } }));
  expect(() => sourceRegistry.catalog.setSources([{ manifest, dir: '/source', declarationRevision: _declarationRevision(manifest) }])).toThrow('memo-pack/assistant');
  expect(sourceRegistry.catalog.getSnapshot()).toBe(sourceBefore);
  expect(registry.catalog.getSnapshot()).toBe(previous);
  expect(registry.settingsCatalog()).toBe(settings);
});

it('checks orphan overrides against new owners without importing executable pack code', () => {
  const manifest: PackManifest = { id: 'new-pack', name: 'New', version: '1.0.0', features: {
    memos: { description: 'Memos', settings: definition },
  } };
  expect(() => assertPackSettings(manifest, { features: { 'new-pack/memos': { name: 42 } } })).toThrow('new-pack/memos');
  expect(() => assertPackSettings(manifest, { features: { 'new-pack/memos': { name: 'Valid' }, 'absent/memos': { untouched: 42 } } })).not.toThrow();
});

it('refuses installation before moving incumbent files or updating their record', async () => {
  const dir = install('memo-pack');
  const source = path.join(packsDir, 'candidate');
  fs.cpSync(dir, source, { recursive: true });
  const marker = path.join(dir, 'incumbent');
  fs.writeFileSync(marker, 'retain');
  const recordFile = path.join(packsDir, 'installed.json');
  fs.writeFileSync(recordFile, '[]');
  await expect(installPackFromLocal(source, packsDir, {
    installedPacksFile: recordFile, packFormat: PACK_SNAPSHOT_FORMAT,
    settingsOverrides: () => ({ features: { 'memo-pack/memos': { name: 42 } } }),
  })).rejects.toThrow('Pack "memo-pack" settings were refused');
  expect(fs.readFileSync(marker, 'utf8')).toBe('retain');
  expect(fs.readFileSync(recordFile, 'utf8')).toBe('[]');
});

it('makes boot inspection explicit while live discovery enforces settings even on its first call', () => {
  install('memo-pack');
  const registry = createNativePackTestRegistry();
  registry.catalog.setSettingsAdmission(() => { throw new Error('stored settings need recovery'); });
  const before = registry.catalog.getSnapshot();
  expect(() => registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'enforce' })).toThrow('stored settings need recovery');
  expect(registry.catalog.getSnapshot()).toBe(before);
  registry.refreshCatalog({ packsDir, disabled: new Set(), settings: 'inspect' });
  expect(registry.settingsCatalog().packs['memo-pack']).toBeDefined();
  expect(registry.loadedPacks()).toEqual([]);
});
