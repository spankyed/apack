// Checked-in seed/client/inspection for the disposable converted-profile API acceptance gate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [mode, output] = process.argv.slice(2);
assert(output && !existsSync(output));
const save = value => writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const id = 'Prompt-converted-api', initialLabel = 'converted native Prompt';
const finalLabel = 'updated after API restart', settingsName = 'Converted Ada';
if (mode === 'client') {
  const { createWSClient, createTRPCClient, wsLink } = await import('@trpc/client');
  const { default: WebSocket } = await import('ws');
  class ApiSocket extends WebSocket { constructor(url) { super(url, ['apack', `apack-token.${process.env.APACK_API_TOKEN}`]); } }
  const ws = createWSClient({ url: `ws://127.0.0.1:${process.env.API_PORT}`, WebSocket: ApiSocket });
  const rpc = createTRPCClient({ links: [wsLink({ client: ws })] });
  let subscription, deadline;
  const updates = [], waiters = new Set();
  const wait = predicate => new Promise((resolve, reject) => {
    const held = updates.find(predicate);
    if (held) return resolve(held);
    const waiter = { predicate, resolve, reject, timer: undefined };
    waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Live pack view did not deliver the expected update')); }, 10000);
    waiters.add(waiter);
  });
  const failWaiters = error => { for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(error); } waiters.clear(); };
  try {
    const result = await Promise.race([(async () => {
      assert.equal(await rpc.entities.exists.query({ id }), true);
      assert.equal(await rpc.entities.exists.query({ id: 'AppState-app' }), true);
      const loaded = await rpc.packs.loaded.query(); assert(loaded.some(pack => pack.id === 'default-setup'));
      subscription = rpc.views.watch.subscribe({ ref: 'default-setup/prompts', view: 'byId', args: { id } }, {
        onData(update) {
          updates.push(update);
          for (const waiter of waiters) if (waiter.predicate(update)) { clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(update); }
        }, onError: failWaiters,
      });
      const first = await wait(() => true); assert.equal(first.ok, true, first.error); assert.equal(first.value.id, id);
      const trial = Number(process.env.CONVERTED_API_TRIAL);
      assert.equal(first.value.label, process.env.CONVERTED_API_EXPECT_LABEL ?? (trial === 1 ? initialLabel : 'updated through real pack'));
      const label = process.env.CONVERTED_API_WRITE_LABEL ?? (trial === 1 ? 'updated through real pack' : finalLabel);
      await rpc.bus.send.mutate({ to: 'default-setup/prompts', event: { type: 'UPDATE_PROMPT', promptId: id, label } });
      const changed = await wait(update => update.ok && update.value?.label === label);
      assert(changed.commit > first.commit); assert(updates.length >= 2);
      const credential = await rpc.settings.openHost.mutate(); assert.equal(typeof credential, 'string'); assert(credential.length > 0);
      await rpc.settings.close.mutate({ credential });
      return { trial, seeded: true, appStatePresent: true, loaded: loaded.map(pack => pack.id), view: { firstCommit: first.commit, changedCommit: changed.commit, label, updates: updates.length }, settingsLeaseOpenedAndClosed: true };
    })(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Authenticated converted-profile RPC timed out')), 20000); })]);
    save(result);
  } finally { clearTimeout(deadline); failWaiters(new Error('Client closed')); subscription?.unsubscribe(); await ws.close(); }
} else {
  const { _appDataPaths } = await import('@apackdev/sdk/utils');
  const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
  const { openDatabaseStore, readInstalledSchema, openRunHistory, openAppDatabase, storedSettings } = await import('@apackdev/host/database');
  const context = resolveAppEnvironment(), paths = _appDataPaths(context.userDataDir);
  if (mode === 'seed') {
    const shipped = resolve('packages/default-setup/dist'); assert(existsSync(join(shipped, 'integrity.json')));
    mkdirSync(context.packsDir, { recursive: true }); cpSync(shipped, join(context.packsDir, 'default-setup'), { recursive: true, errorOnExist: true, force: false });
    const { database, engine } = openDatabaseStore({ path: paths.lmdb, schema: readInstalledSchema(context), storageFormat: 'elmdb/1' });
    try {
      engine.create('Prompt', { id, label: initialLabel, inputs: {}, templateFn: 'return ""', markerBytes: new Uint8Array([0, 255, 42]), markerAt: new Date(1234), largeField: 'x'.repeat(256000) });
      engine.create('Settings', { id: 'Settings-app', data: { app: { personal: { name: settingsName } } } });
      await database.indexesReady(); await database.durable();
    } finally { database.close(); }
    const runs = openRunHistory(paths.runHistory, { storageFormat: 'elmdb/1' });
    try { runs.engine.create('RunNode', { id: 'RunNode-native-api', kind: 'flow', status: 'completed', label: 'native history retained', startedAt: 1 }); }
    finally { runs.database.close(); }
    mkdirSync(paths.media); writeFileSync(join(paths.media, 'asset.bin'), new Uint8Array([42, 0, 255]));
    save({ source: process.env.EARS_TEST_SOURCE, context, paths, hashes: { primary: sha(join(paths.lmdb, 'data.mdb')), runs: sha(join(paths.runHistory, 'data.mdb')), media: sha(join(paths.media, 'asset.bin')) }, shippedIntegritySha256: sha(join(shipped, 'integrity.json')) });
  } else {
    assert(['inspect', 'source-inspect'].includes(mode));
    const native = mode === 'source-inspect', format = native ? 'elmdb/1' : 'sqlite/1';
    const app = await openAppDatabase({ env: 'test', userDataDir: context.userDataDir, readOnly: true, storageFormat: format });
    let primary;
    try {
      assert.equal(app.database.format, format); const row = app.ears.getRow(id);
      assert.equal(row.label, native ? 'updated in native baseline' : finalLabel); assert(row.markerBytes instanceof Uint8Array); assert.deepEqual([...row.markerBytes], [0, 255, 42]);
      assert.deepEqual(row.markerAt, new Date(1234)); assert.equal(row.largeField, 'x'.repeat(256000));
      assert.equal(storedSettings(app.ears).app.personal.name, settingsName);
      assert(app.schema.packs.some(pack => pack.id === 'default-setup'));
      primary = { sequence: app.database.sequence, label: row.label, typedAndLargeFieldsRetained: true, settingsRetained: true };
    } finally { app.close(); }
    const runs = openRunHistory(paths.runHistory, { storageFormat: format, readOnly: true, replaceUnreadable: false });
    try { assert.equal(runs.engine.getAttr('RunNode-native-api', 'label'), 'native history retained'); }
    finally { runs.database.close(); }
    const file = native ? 'data.mdb' : 'data.sqlite3', foreign = native ? 'data.sqlite3' : 'data.mdb';
    assert(!existsSync(join(paths.lmdb, foreign)) && !existsSync(join(paths.runHistory, foreign)));
    save({ source: process.env.EARS_TEST_SOURCE, primary, historyRetained: true, mediaSha256: sha(join(paths.media, 'asset.bin')), format,
      hashes: { primary: sha(join(paths.lmdb, file)), runs: sha(join(paths.runHistory, file)) } });
  }
}
