import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { publishRunningApp, findDatabaseWriter, openAppDatabase, openDatabaseStore, readInstalledSchema } from '@apackdev/host/database';
import { installShippedPacks, readInstalledPacks, recordHostCompatibility, readPackBuild,
  sealPackBuild, writeInstalledPacks, stagePack, createPackArchive } from '@apackdev/host/packs';
import { restore } from '../../src/commands/pack-restore';
import { replace } from '../../src/commands/pack-replace';
import { install } from '../../src/commands/pack-install';
import { uninstall } from '../../src/commands/pack-uninstall';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { type EARS } from '@apackdev/ears';
import { untypedUpsert, _bindEars } from '@apackdev/sdk/ears';
import { openProfile } from '../../src/app/profiles';

let tmp: string;
vi.mock('../../src/app/pack-host', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/app/pack-host')>(),
  cliDirs: () => ({ cache: path.join(tmp, 'cache'), data: path.join(tmp, 'cli-data') }),
}));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-restore-'));
  vi.stubEnv('APACK_USER_DATA_DIR', path.join(tmp, 'data'));
  vi.stubEnv('APACK_CLI_CHANNEL', 'production');
  for (const key of ['APACK_HOST', 'APACK_HOST_ROOT', 'APACK_HOST_EXECUTABLE', 'APACK_APP', 'APACK_CHANNEL', 'APACK_BUILD']) vi.stubEnv(key, '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function builtPack(dir: string, id = 'default-pack', version = '1.0.0', hostVersion = '>=0.4.0') {
  const manifest = { id, name: id, version, hostVersion };
  const write = (file: string, value: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), value);
  };
  write('apack.json', JSON.stringify(manifest));
  // Reading, replacing and restoring builds must not activate executable pack code.
  write('dist/runtime/index.cjs', 'throw new Error("pack execution is forbidden in this command fixture");');
  write('dist/types/snapshot.json', JSON.stringify({ format: PACK_SNAPSHOT_FORMAT,
    declarationRevision: _declarationRevision(manifest), manifest, types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
  }));
  sealPackBuild(path.join(dir, 'dist'), manifest);
  return dir;
}

function fixture() {
  const host = path.join(tmp, 'host');
  const source = builtPack(path.join(host, 'packages', 'a-different-folder-name'));
  const context = resolveAppEnvironment({ env: 'production', userDataDir: path.join(tmp, 'data') });
  recordHostCompatibility(context.userDataDir, { version: '0.4.0', packFormat: PACK_SNAPSHOT_FORMAT });
  return { host, source, context };
}

it('replaces deliberately, survives boot refresh, then restores a removed default while preserving LMDB preferences', async () => {
  const { host, context } = fixture();
  await restore(['default-pack', '--host', host]);
  const settingsId = 'Settings-app' as EARS.EntityId;
  const choices = { app: { personal: { name: 'Keep' } }, packs: { 'default-pack': { assistant: { name: 'Keep override' } } } };
  const paths = _appDataPaths(context.userDataDir);
  const { database: store, engine } = openDatabaseStore({ path: paths.lmdb,
    schema: readInstalledSchema(context),
  });
  const previousEngine = _bindEars(engine);
  try {
    untypedUpsert('Settings', { id: settingsId, data: choices });
  } finally {
    _bindEars(previousEngine);
    store.close();
  }
  expect(readInstalledPacks(context.installedPacksFile)[0]).toMatchObject({ enabled: true, updatesWith: 'app' });
  const fork = builtPack(path.join(tmp, 'fork'), 'default-pack', '2.0.0');
  await expect(install([fork, '--host', host])).rejects.toThrow('apack pack replace');
  await replace(['default-pack', fork]);
  expect(readInstalledPacks(context.installedPacksFile)[0]).toMatchObject({ updatesWith: 'user' });
  expect(await installShippedPacks(path.join(host, 'packages'), context.packsDir, { installedPacksFile: context.installedPacksFile }))
    .toMatchObject([{ outcome: 'preserved' }]);
  expect(readPackBuild(path.join(context.packsDir, 'default-pack')).snapshot.manifest.version).toBe('2.0.0');
  await uninstall(['default-pack']);
  expect(await installShippedPacks(path.join(host, 'packages'), context.packsDir, { installedPacksFile: context.installedPacksFile }))
    .toMatchObject([{ outcome: 'suppressed' }]);
  await restore(['default-pack', '--host', host]);
  expect(readPackBuild(path.join(context.packsDir, 'default-pack')).snapshot.manifest.version).toBe('1.0.0');
  expect(readInstalledPacks(context.installedPacksFile)[0]).toMatchObject({ enabled: true, updatesWith: 'app' });
  expect(readInstalledPacks(context.installedPacksFile)[0]).not.toHaveProperty('suppressAppInstall');
  const reopened = await openAppDatabase({ env: context.env, userDataDir: context.userDataDir, readOnly: true });
  try { expect(reopened.ears.query.ids(settingsId).pickOne()?.data).toEqual(choices); }
  finally { reopened.close(); }
  expect(findDatabaseWriter(context.userDataDir)).toBeNull();
});

it('refuses mismatched identity and incompatible restoration before changing the incumbent', async () => {
  const { host, source, context } = fixture();
  await restore(['default-pack', '--host', host]);
  const before = readPackBuild(path.join(context.packsDir, 'default-pack'));
  const record = readInstalledPacks(context.installedPacksFile);
  const wrong = builtPack(path.join(tmp, 'wrong'), 'another-pack');
  await expect(replace(['default-pack', wrong])).rejects.toThrow('Replacement expected pack');
  expect(fs.existsSync(path.join(context.packsDir, 'another-pack'))).toBe(false);
  builtPack(source, 'default-pack', '3.0.0', '>=9.0.0');
  await expect(restore(['default-pack', '--host', host])).rejects.toThrow('>=9.0.0');
  expect(readPackBuild(path.join(context.packsDir, 'default-pack'))).toEqual(before);
  expect(readInstalledPacks(context.installedPacksFile)).toEqual(record);
});

it('refuses both operations while the selected app runs', async () => {
  const { host, source, context } = fixture();
  await restore(['default-pack', '--host', host]);
  const before = readPackBuild(path.join(context.packsDir, 'default-pack'));
  const stop = publishRunningApp(context.userDataDir);
  try {
    await expect(replace(['default-pack', source])).rejects.toThrow('Quit the app');
    await expect(restore(['default-pack', '--host', host])).rejects.toThrow('Quit the app');
    expect(readPackBuild(path.join(context.packsDir, 'default-pack'))).toEqual(before);
  } finally { stop(); }
  expect(findDatabaseWriter(context.userDataDir)).toBeNull();
});

it('restores into an explicit custom profile without changing another profile, re-enabling the pack', async () => {
  const { host, context } = fixture();
  const dirs = { cache: path.join(tmp, 'cache'), data: path.join(tmp, 'cli-data') };
  const chosen = openProfile(dirs, 'chosen');
  const selected = resolveAppEnvironment({ env: 'production', userDataDir: chosen.dir });
  writeInstalledPacks([{ id: 'default-pack', enabled: false, suppressAppInstall: true }], selected.installedPacksFile);
  await restore(['default-pack', '--host', host, '--profile', 'chosen']);
  expect(readInstalledPacks(selected.installedPacksFile)[0]).toMatchObject({ enabled: true, updatesWith: 'app' });
  expect(fs.existsSync(context.installedPacksFile)).toBe(false);
  expect(fs.existsSync(path.join(context.packsDir, 'default-pack'))).toBe(false);
});

it('requires an explicit or associated source and refuses an uncached beta without downloading', async () => {
  fixture();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('network is forbidden in this fixture'); });
  await expect(restore(['default-pack'])).rejects.toThrow('Select the source app');
  await expect(restore(['default-pack', '--host', 'beta'])).rejects.toThrow('no compatible cached build');
  expect(fetch).not.toHaveBeenCalled();
});

it('an explicit host wins over the associated host handoff; missing and duplicate ids are refused', async () => {
  const { host, context } = fixture();
  vi.stubEnv('APACK_HOST_ROOT', path.join(tmp, 'missing-handoff'));
  await restore(['default-pack', '--host', host]);
  const before = readPackBuild(path.join(context.packsDir, 'default-pack'));
  await expect(restore(['missing-pack', '--host', host])).rejects.toThrow('found 0');
  builtPack(path.join(host, 'packages', 'duplicate'));
  await expect(restore(['default-pack', '--host', host])).rejects.toThrow('Duplicate app-shipped pack "default-pack"');
  expect(readPackBuild(path.join(context.packsDir, 'default-pack'))).toEqual(before);
});


it.each(['absent', 'disabled', 'failed', 'removed', 'invalid-source'])('reserves selected app advertisements without an active registration: %s', async state => {
  const { host, source, context } = fixture();
  const fork = builtPack(path.join(tmp, 'fork'), 'default-pack', '2.0.0');
  if (state === 'disabled' || state === 'failed') {
    await replace(['default-pack', source]);
    writeInstalledPacks([{ id: 'default-pack', enabled: state !== 'disabled', lastError: state === 'failed' ? 'activation refused' : undefined }], context.installedPacksFile);
  }
  if (state === 'removed') writeInstalledPacks([{ id: 'default-pack', enabled: false, suppressAppInstall: true }], context.installedPacksFile);
  if (state === 'invalid-source') fs.rmSync(path.join(source, 'dist'), { recursive: true });
  const before = readInstalledPacks(context.installedPacksFile, { strict: true });
  const incumbent = fs.existsSync(path.join(context.packsDir, 'default-pack')) ? readPackBuild(path.join(context.packsDir, 'default-pack')).revision : undefined;
  await expect(install([fork, '--host', host])).rejects.toThrow('apack pack replace default-pack');
  expect(readInstalledPacks(context.installedPacksFile, { strict: true })).toEqual(before);
  if (incumbent) expect(readPackBuild(path.join(context.packsDir, 'default-pack')).revision).toBe(incumbent);
  else expect(fs.existsSync(path.join(context.packsDir, 'default-pack'))).toBe(false);
});

it('requires an offline source selection for ordinary install, while explicit replacement needs none', async () => {
  const { context } = fixture();
  const fork = builtPack(path.join(tmp, 'fork'), 'default-pack', '2.0.0');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted'); }));
  try {
    await expect(install([fork])).rejects.toThrow('Select the source app');
    await expect(install([fork, '--host', 'beta'])).rejects.toThrow('no compatible cached build');
    await replace(['default-pack', fork]);
    expect(readInstalledPacks(context.installedPacksFile, { strict: true })[0].updatesWith).toBe('user');
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it('uses explicit host precedence and keeps profile selection independent from advertisements', async () => {
  const { host } = fixture();
  const unrelated = builtPack(path.join(tmp, 'unrelated'), 'other-pack');
  vi.stubEnv('APACK_HOST_ROOT', path.join(tmp, 'missing-host'));
  const chosen = openProfile({ cache: path.join(tmp, 'cache'), data: path.join(tmp, 'cli-data') }, 'chosen');
  const selected = resolveAppEnvironment({ env: 'production', userDataDir: chosen.dir });
  await install([unrelated, '--host', host, '--profile', 'chosen']);
  expect(readInstalledPacks(selected.installedPacksFile, { strict: true })).toMatchObject([{ id: 'other-pack', updatesWith: 'user' }]);
  const fork = builtPack(path.join(tmp, 'fork'), 'default-pack');
  await expect(install([fork, '--host', host, '--profile', 'chosen'])).rejects.toThrow('apack pack replace');
  await expect(install([unrelated])).rejects.toThrow('no packages directory');
});


it('checks current advertisements after download before publishing the candidate', async () => {
  const { host, context } = fixture();
  const incoming = builtPack(path.join(tmp, 'incoming'), 'late-default');
  const stage = path.join(tmp, 'staged');
  stagePack(incoming, stage);
  const archive = await createPackArchive(stage, path.join(tmp, 'archive'));
  vi.stubGlobal('fetch', vi.fn(async () => {
    builtPack(path.join(host, 'packages', 'late'), 'late-default');
    return new Response(fs.readFileSync(archive.file));
  }));
  try {
    await expect(install(['https://example.test/pack.tgz', '--host', host])).rejects.toThrow('apack pack replace late-default');
    expect(fs.existsSync(path.join(context.packsDir, 'late-default'))).toBe(false);
    expect(readInstalledPacks(context.installedPacksFile, { strict: true })).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});
