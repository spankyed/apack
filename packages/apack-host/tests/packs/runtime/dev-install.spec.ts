// A development install is the app copying a pack's build in and starting it under one claim, so nothing
// else the app does to that pack can load a half-copied build.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { _appDirOf } from '@apackdev/sdk/env';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import './test-host.ts';
import { eventContractsFixture, sealBuild } from './build-fixture.ts';
import { PACK_LAYOUT } from '../../../src/packs/layout.ts';
import { installDevPack } from '../../../src/packs/runtime/dev-install.ts';
import { readInstalledPacks, writeInstalledPacks } from '../../../src/packs/installed.ts';

const ID = 'dev-pack';
let tmpDir: string;
let source: string;
let origEnv: { env?: string; userDataDir?: string };
const registry = createNativePackTestRegistry();
const bus = { send: vi.fn() };

const packDir = () => path.join(_appDirOf(tmpDir), 'packs', ID);
const recordsFile = () => path.join(_appDirOf(tmpDir), 'installed-packs.json');

/** A pack source directory holding a completed build of one feature with a system */
function writeSource() {
  const manifest = { id: ID, name: ID, version: '1.0.0', features: { widget: { description: 'Widget.', system: { entry: 'system.ts' } } } };
  fs.mkdirSync(path.join(source, 'dist', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(source, 'dist', 'types'), { recursive: true });
  fs.writeFileSync(path.join(source, 'apack.json'), JSON.stringify(manifest));
  const revision = _declarationRevision(manifest);
  fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.runtimeEntry), `module.exports = { registration: {
    id: '${ID}', declarationRevision: '${revision}',
    features: { widget: { system: { machine: { id: 'widget' }, receives: [] } } } } };`);
  fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({
    declarationRevision: revision, format: PACK_SNAPSHOT_FORMAT, manifest, eventContracts: eventContractsFixture(manifest),
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
  }));
  sealBuild(source);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-dev-install-'));
  source = path.join(tmpDir, 'source');
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = tmpDir;
  bus.send.mockReset();
  writeSource();
});

afterEach(() => {
  if (registry.getPackRegistration(ID)) registry.unregisterPack(ID);
  for (const [key, value] of [['APACK_ENV', origEnv.env], ['APACK_USER_DATA_DIR', origEnv.userDataDir]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('installs the build as the user\'s own copy and starts it', async () => {
  const installed = await installDevPack(registry, source, bus as never);

  expect(installed).toEqual({ id: ID, dir: packDir() });
  expect(registry.getRegisteredPackSystemIds(ID)).toEqual([`${ID}/widget`]);
  expect(readInstalledPacks(recordsFile()).find(record => record.id === ID)).toMatchObject({ enabled: true, updatesWith: 'user' });
  expect(bus.send.mock.calls.map(([event]) => event.type)).toContain('PACK_CHANGED');
  // The claim is released, so the next build can install
  using nextClaim = registry.claimPackOperation(ID);
  expect(nextClaim).not.toBeNull();
});

it('places nothing while another operation holds the pack', async () => {
  using claim = registry.claimPackOperation(ID);
  expect(claim).not.toBeNull();
  await expect(installDevPack(registry, source, bus as never)).rejects.toThrow(/already in progress for dev-pack/);
  expect(fs.existsSync(packDir())).toBe(false);
  expect(registry.getPackRegistration(ID)).toBeNull();
  // The other operation's claim is untouched
  expect(registry.claimPackOperation(ID)).toBeNull();
});

it('replaces a disabled pack\'s files without starting it', async () => {
  fs.mkdirSync(_appDirOf(tmpDir), { recursive: true });
  writeInstalledPacks([{ id: ID, enabled: false, updatesWith: 'user', installedAt: new Date(0).toISOString() }], recordsFile());

  await installDevPack(registry, source, bus as never);

  expect(fs.existsSync(path.join(packDir(), PACK_LAYOUT.runtimeEntry))).toBe(true);
  expect(registry.getPackRegistration(ID)).toBeNull();
  expect(readInstalledPacks(recordsFile()).find(record => record.id === ID)?.enabled).toBe(false);
  expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual(['PACK_CHANGED']);
});
