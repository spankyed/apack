// Exact built-workspace CLI smoke, with real separate processes and independent reopened store checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { _RUN_HISTORY_SCHEMA } from '@apackdev/sdk/services';
const output = process.argv[2], installed = process.argv[3], packageDir = installed
  ? join(installed, 'node_modules/@apackdev/cli') : resolve('packages/apack-cli/dist/package');
const cli = join(packageDir, 'bin/apack.mjs'), bundle = join(packageDir, 'dist/cli.js');
assert(output && !existsSync(output) && existsSync(bundle));
const root = mkdtempSync(join(tmpdir(), 'ears-built-logical-cli-')), profile = join(root, 'profile'), paths = _appDataPaths(profile);
const primary = join(root, 'primary.ears'), runs = join(root, 'runs.ears');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { source: process.env.EARS_TEST_SOURCE, qualification: installed ? 'Small isolated npm-tarball CLI with native install scripts; not signed apps, Electron, power loss or large-profile acceptance'
    : 'Small staged CLI with workspace dependencies; not installed/signed CLI, Electron, power loss or large-profile resource acceptance',
  node: process.version, cli: { path: cli, sha256: hash(readFileSync(cli)) }, bundle: { path: bundle, sha256: hash(readFileSync(bundle)) },
  entries: Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite', '@apackdev/sdk/utils'].map(name => [name, import.meta.resolve(name)])), calls: [], checks: [] };
assert(Object.values(report.entries).every(path => path.includes('/dist/')));
const earsRoot = dirname(dirname(fileURLToPath(report.entries['@apackdev/ears'])));
report.regexAssets = ['rregex.cjs', 'rregex_bg.wasm'].map(file => {
  const path = join(earsRoot, 'vendor/rregex', file); return { path, sha256: hash(readFileSync(path)) };
});
if (installed) {
  assert(Object.values(report.entries).every(entry => fileURLToPath(entry).startsWith(join(installed, 'node_modules') + sep)));
  for (const name of ['ears', 'sdk', 'cli']) assert(!existsSync(join(installed, 'node_modules/@apackdev', name, 'src')));
  assert(!existsSync(join(installed, 'node_modules/@apackdev/host')));
}
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
const env = { ...process.env, NODE_OPTIONS: '', APACK_ENV: 'test', APACK_STORAGE_FORMAT: 'sqlite/1', APACK_USER_DATA_DIR: profile,
  ...(installed ? { EARS_INSTALLED_ROOT: installed, EARS_RUNTIME_RECEIPT: join(installed, 'runtime-receipts.jsonl') } : {}) };
function command(args, expected = 0) {
  const start = performance.now(), result = spawnSync(process.execPath, [...(installed ? ['--import', join(installed, 'runtime-receipt.mjs')] : []), cli, 'db', ...args], { env, cwd: root, encoding: 'utf8', timeout: 30000 });
  report.calls.push({ args, expected, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, ms: performance.now() - start }); save();
  assert.equal(result.status, expected, result.stderr); assert.equal(result.signal, null);
  return result;
}
function current() {
  const db = openDatabase({ path: paths.lmdb, readOnly: true });
  try { const e = createEarsEngine({ database: db }); return { sequence: e.lastCommit(), row: e.getRow('Row-one'), pending: e.pendingEmbeddings('Row').count,
    nearest: e.query('Row').near([1, 0, 0]).ids(), regex: e.query('Row').matching('needle').ids() }; } finally { db.close(); }
}
function history() {
  const db = openDatabase({ path: paths.runHistory, readOnly: true });
  try { return { sequence: db.sequence, ids: createEarsEngine({ database: db }).query('RunNode').ids() }; } finally { db.close(); }
}
try {
  const db = openDatabase({ path: paths.lmdb, syncs: false, schema: { types: { Row: { required: [], search: { fields: { title: 1 } }, substrings: ['title'],
    embed: { from: ['title'], model: 'built-cli', dims: 3 } } }, relations: {}, roles: [] } });
  try {
    const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-one', title: 'needle', negative: -0, bytes: new Uint8Array([0, 255]), big: 'x'.repeat(256000) });
    const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
    report.sqlite = db.get('SELECT sqlite_version() version');
  } finally { db.close(); }
  const run = openDatabase({ path: paths.runHistory, schema: _RUN_HISTORY_SCHEMA, syncs: false });
  try { createEarsEngine({ database: run }).create('RunNode', { id: 'RunNode-one', kind: 'flow', status: 'completed', label: 'one', startedAt: 1 }); } finally { run.close(); }
  command(['--help']);
  const dump = command(['dump', '--data-dir', profile, '--primary', primary, '--runs', runs]);
  assert(dump.stdout.includes('primary:') && dump.stdout.includes('runs:')); report.checks.push('built dump both stores');
  report.archiveHashes = { primary: hash(readFileSync(primary)), runs: hash(readFileSync(runs)) };
  const changed = openDatabase({ path: paths.lmdb, syncs: false });
  try { createEarsEngine({ database: changed }).write('Row-one').set('title', 'changed since dump'); } finally { changed.close(); }
  const later = openDatabase({ path: paths.runHistory, syncs: false });
  try { createEarsEngine({ database: later }).create('RunNode', { id: 'RunNode-two', kind: 'flow', status: 'completed', label: 'two', startedAt: 2 }); } finally { later.close(); }
  const before = current(), beforeHistory = history();
  assert(command(['load', '--data-dir', profile, '--primary', primary, '--runs', runs]).stdout.includes('Dry run: nothing was changed'));
  assert.deepEqual(current(), before); assert.deepEqual(history(), beforeHistory); report.checks.push('built dry run preserves both commits and values');
  const truncated = join(root, 'truncated.ears'), validHistory = readFileSync(runs); writeFileSync(truncated, validHistory.subarray(0, -1));
  command(['load', '--data-dir', profile, '--primary', primary, '--runs', truncated, '--force'], 1);
  assert.deepEqual(current(), before); assert.deepEqual(history(), beforeHistory); report.checks.push('built late input refusal preserves both stores');
  command(['load', '--data-dir', profile, '--primary', primary, '--runs', runs, '--force']);
  const restored = current(); assert.equal(restored.row.title, 'needle'); assert(Object.is(restored.row.negative, -0));
  assert.deepEqual(restored.row.bytes, new Uint8Array([0, 255])); assert.equal(restored.row.big, 'x'.repeat(256000));
  assert.equal(restored.pending, 0); assert.deepEqual(restored.nearest, ['Row-one']); assert.deepEqual(restored.regex, ['Row-one']); assert(restored.sequence > before.sequence);
  assert.deepEqual(history().ids, ['RunNode-one']); report.checks.push('built populated restore preserves bytes, embeddings and monotonic commit');
  command(['dump', '--data-dir', profile, '--primary', primary], 1);
  assert.equal(hash(readFileSync(primary)), report.archiveHashes.primary); assert.equal(hash(readFileSync(runs)), report.archiveHashes.runs);
  report.checks.push('built overwrite refusal preserves both archives');
  if (installed) {
    report.runtimeReceipts = readFileSync(join(installed, 'runtime-receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(report.runtimeReceipts.length, report.calls.length);
    for (const receipt of report.runtimeReceipts) {
      assert.equal(receipt.nodeOptions, '');
      assert(receipt.bindings.every(binding => binding.path.startsWith(join(installed, 'node_modules') + sep)));
    }
    const loaded = report.runtimeReceipts.flatMap(receipt => receipt.bindings);
    assert(loaded.some(binding => binding.path.includes(sep + 'better-sqlite3' + sep) && binding.path.endsWith('.node')));
    assert(loaded.some(binding => binding.path.includes('elmdb') && binding.path.endsWith('.node')));
    const extensions = report.runtimeReceipts.flatMap(receipt => receipt.extensionLoads);
    assert(extensions.length > 0 && extensions.every(extension => extension.path.startsWith(join(installed, 'node_modules') + sep) && extension.path.includes('sqlite-vec')));
  }
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { save(); rmSync(root, { recursive: true, force: true }); }
