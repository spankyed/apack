// Disposable native-producer acceptance gate. Requires a matching elmdb CLI; never reads a user profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/lmdb';
import { _RUN_HISTORY_SCHEMA } from '@apackdev/sdk/services';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { findDatabaseWriter, holdDatabaseWriteLock, openAppDatabase, openRunHistory, publishRunningApp, storedSettings } from '@apackdev/host/database';
import { writeInstalledPackFixture, sealPack } from '../../packages/apack-host/tests/packs/runtime/build-fixture.ts';
import { convertSqliteProfile } from '../../scripts/convert-sqlite-profile.ts';

const [producer, receipt, ...extra] = process.argv.slice(2);
if (!producer || !receipt || extra.length) throw new Error('Usage: test-sqlite-profile-conversion.ts <matching-elmdb-cli> <new-receipt.json>');
assert(!existsSync(receipt));
const root = mkdtempSync(join(tmpdir(), 'ears-profile-conversion-'));
const report: { source?: string; producer: string; producerSha256: string; enginePin: string; runtime: {node: string; platform: string; arch: string}; checks: string[]; converted?: unknown; sourceHashes?: unknown } = {
  source: process.env.EARS_TEST_SOURCE, producer: resolve(producer),
  producerSha256: createHash('sha256').update(readFileSync(producer)).digest('hex'),
  enginePin: readFileSync('vendor/elmdb.rev', 'utf8').trim(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch }, checks: [],
};
const save = () => writeFileSync(receipt, JSON.stringify(report, null, 2) + '\n');
const bytes = new Uint8Array([0, 255, 42]), settings = { appearance: { theme: 'dark' }, developerConversion: true };
function hashes(profile: string) {
  const paths = _appDataPaths(profile), context = resolveAppEnvironment({ env: 'test', userDataDir: profile });
  return Object.fromEntries([join(paths.lmdb, 'data.mdb'), join(paths.runHistory, 'data.mdb'), join(paths.media, 'asset.bin'),
    paths.secretsFile, context.installedPacksFile, join(context.appDir, 'pack-data/example/value'),
    ...['marker','apack.json','integrity.json','types/snapshot.json','runtime/index.cjs','runtime/fe.js'].map(name => join(context.appDir, 'packs/materialized', name))]
    .filter(existsSync).map(file => [relative(profile, file), createHash('sha256').update(readFileSync(file)).digest('hex')]));
}
function fixture(name: string, history = true) {
  const source = join(root, name); mkdirSync(source);
  const context = resolveAppEnvironment({ env: 'test', userDataDir: source }), paths = _appDataPaths(source);
  const db = openDatabase({ path: paths.lmdb, schema: { types: {
    Row: { required: [], shortCode: 'ROW', search: { fields: { title: 1 } }, embed: { from: ['title'], model: 'profile-conversion', dims: 3 } },
    Settings: { required: ['data'] },
  }, relations: {}, roles: [] } });
  try {
    const e = createEarsEngine({ database: db });
    e.create('Row', { id: 'Row-one', title: 'needle retained', bytes, at: new Date(1234), large: 'x'.repeat(256000) });
    e.create('Settings', { id: 'Settings-app', data: settings });
    const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
  } finally { db.close(); }
  if (history) {
    const runs = openDatabase({ path: paths.runHistory, schema: _RUN_HISTORY_SCHEMA });
    try { createEarsEngine({ database: runs }).create('RunNode', { id: 'RunNode-one', kind: 'flow', status: 'completed', label: 'retained', startedAt: 1 }); }
    finally { runs.close(); }
  }
  mkdirSync(paths.media); writeFileSync(join(paths.media, 'asset.bin'), bytes);
  writeFileSync(paths.secretsFile, '{"encrypted":"opaque-fixture"}');
  mkdirSync(join(context.appDir, 'pack-data/example'), { recursive: true }); writeFileSync(join(context.appDir, 'pack-data/example/value'), 'pack-owned bytes');
  const pack = join(context.appDir, 'packs/materialized');
  writeInstalledPackFixture(pack, { id: 'materialized', name: 'Materialized data-only fixture', version: '1.0.0', data: { entities: { Row: {} } } });
  writeFileSync(join(pack, 'marker'), 'materialized pack bytes'); sealPack(pack);
  writeFileSync(context.installedPacksFile, JSON.stringify({ packs: [{ id: 'materialized', enabled: true, installedFrom: 'fixture/local' }] }));
  writeFileSync(context.apiTokenFile, 'stale runtime token, not a transferable secret');
  return { source, paths, context, output: join(root, name + '-converted') };
}
try {
  const f = fixture('both'), before = hashes(f.source);
  report.sourceHashes = before;
  const result = await convertSqliteProfile({ source: f.source, output: f.output, producer }); report.converted = result;
  assert.equal(result.path, join(f.output, 'profile')); assert.deepEqual(result.stores.map(store => store.name), ['primary', 'runs']);
  assert.deepEqual(hashes(f.source), before); assert.deepEqual(readdirSync(f.output), ['profile']);
  const converted = _appDataPaths(result.path), copied = resolveAppEnvironment({ env: 'test', userDataDir: result.path });
  for (const [from, to] of [[join(f.paths.media, 'asset.bin'), join(converted.media, 'asset.bin')], [f.paths.secretsFile, converted.secretsFile],
    [join(f.context.appDir, 'pack-data/example/value'), join(copied.appDir, 'pack-data/example/value')],
    [join(f.context.appDir, 'packs/materialized/marker'), join(copied.appDir, 'packs/materialized/marker')]]) assert.deepEqual(readFileSync(to), readFileSync(from));
  for (const [name, expected] of Object.entries(before)) if (!name.endsWith('data.mdb'))
    assert.equal(createHash('sha256').update(readFileSync(join(result.path, name))).digest('hex'), expected);
  assert(!existsSync(copied.apiTokenFile)); assert(!existsSync(join(converted.lmdb, 'data.mdb'))); assert(!existsSync(join(converted.runHistory, 'data.mdb')));
  const app = await openAppDatabase({ env: 'test', userDataDir: result.path, storageFormat: 'sqlite/1' });
  try {
    assert(app.schema.packs.some(pack => pack.id === 'materialized'));
    assert(app.schema.getRegisteredEntityTypes().has('Row'));
    assert.deepEqual(storedSettings(app.ears), settings);
    assert.deepEqual(app.ears.getAttr('Row-one', 'bytes'), bytes); assert.deepEqual(app.ears.getAttr('Row-one', 'at'), new Date(1234));
    assert.equal(app.ears.getAttr('Row-one', 'large'), 'x'.repeat(256000));
    assert.deepEqual(app.ears.query('Row').search('needle', { fuzzy: false }).ids(), ['Row-one']);
    assert.deepEqual(app.ears.query('Row').near([1, 0, 0]).ids(), ['Row-one']);
    app.ears.write('Row-one').set('afterConversion', 'committed');
  } finally { app.close(); }
  const reopened = await openAppDatabase({ env: 'test', userDataDir: result.path, storageFormat: 'sqlite/1' });
  try { assert.equal(reopened.ears.getAttr('Row-one', 'afterConversion'), 'committed'); assert.deepEqual(storedSettings(reopened.ears), settings); }
  finally { reopened.close(); }
  const runs = openRunHistory(converted.runHistory, { storageFormat: 'sqlite/1', replaceUnreadable: false });
  try { assert.deepEqual(runs.engine.query('RunNode').ids(), ['RunNode-one']); assert.equal(runs.engine.getAttr('RunNode-one', 'label'), 'retained'); }
  finally { runs.database.close(); }
  assert.deepEqual(hashes(f.source), before); report.checks.push('both native stores converted and reopened through host; settings, typed/search/vector data, history, media, secrets and pack-owned bytes retained; post-conversion write survives reopen'); save();

  const primary = fixture('primary-only', false);
  const primaryResult = await convertSqliteProfile({ source: primary.source, output: primary.output, producer });
  assert.deepEqual(primaryResult.stores.map(store => store.name), ['primary']); assert(!existsSync(_appDataPaths(primaryResult.path).runHistory));
  report.checks.push('absent history remains absent until normal host boot creates it'); save();

  const broken = fixture('broken-history'), brokenBytes = Buffer.from('invalid copied history'); writeFileSync(join(broken.paths.runHistory, 'data.mdb'), brokenBytes);
  const brokenHashes = hashes(broken.source);
  await assert.rejects(convertSqliteProfile({ source: broken.source, output: broken.output, producer }), /runs dump failed/);
  assert(!existsSync(broken.output)); assert.deepEqual(hashes(broken.source), brokenHashes);
  report.checks.push('late native history refusal removes owned output after primary conversion and preserves source'); save();

  const locked = fixture('locked'), claim = holdDatabaseWriteLock(locked.source, 'qualification incumbent');
  try {
    await assert.rejects(convertSqliteProfile({ source: locked.source, output: locked.output, producer }), /Another tool/);
    assert(findDatabaseWriter(locked.source)); assert(!existsSync(locked.output));
  } finally { claim.release(); }
  const stop = publishRunningApp(locked.source);
  try { await assert.rejects(convertSqliteProfile({ source: locked.source, output: locked.output, producer }), /Stop the source app/); assert(!existsSync(locked.output)); }
  finally { stop(); }
  report.checks.push('active managed writer and running app refuse without deleting incumbent claims'); save();

  await assert.rejects(convertSqliteProfile({ source: locked.source, output: join(locked.source, 'nested-output'), producer }), /separate trees/);
  const alias = join(root, 'source-alias'); symlinkSync(locked.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(convertSqliteProfile({ source: locked.source, output: join(alias, 'nested-output'), producer }), /separate trees/);
  const incumbent = join(root, 'incumbent'); mkdirSync(incumbent); writeFileSync(join(incumbent, 'marker'), 'retained');
  await assert.rejects(convertSqliteProfile({ source: locked.source, output: incumbent, producer }), /must not exist/);
  assert.equal(readFileSync(join(incumbent, 'marker'), 'utf8'), 'retained');
  const linked = fixture('linked'); symlinkSync(linked.paths.media, join(linked.context.appDir, 'outside-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(convertSqliteProfile({ source: linked.source, output: linked.output, producer }), /materialized source copy/);
  assert(!existsSync(linked.output)); report.checks.push('existing outputs, source overlap/aliases and linked source content refuse'); save();
} finally { rmSync(root, { recursive: true, force: true }); }
