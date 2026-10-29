// Built-workspace Node qualification; complete installed/signed distributions and app budgets are separate gates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadedNativeBindings } from '../../packages/apack-ears/bench/sqlite/load-metrics.ts';

const evidence = resolve('.temp/sqlite-platform'), mode = process.argv[2];
mkdirSync(evidence, { recursive: true });
const save = (file, value) => writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.EARS_EVALUATION_BACKEND, 'sqlite', 'Select the candidate explicitly');
assert.equal(arch(), process.env.EARS_PLATFORM_ARCH, 'Runner must match the declared native architecture');
if (mode === 'verify') {
  const report = file => JSON.parse(readFileSync(join(evidence, file), 'utf8'));
  const passedIn = (value, pattern) => value.testResults.flatMap(test => pattern.test(test.name.replaceAll('\\', '/'))
    ? test.assertionResults.filter(result => result.status === 'passed') : []).length;
  const ears = report('ears.json'), host = report('host.json'), cli = report('cli-maintenance.json');
  const selected = ears.testResults.flatMap(test => test.name.replaceAll('\\', '/').endsWith('/tests/sqlite/text-limits.spec.ts') ? test.assertionResults : []);
  const logical = host.testResults.flatMap(test => test.name.replaceAll('\\', '/').endsWith('/tests/backup/logical.spec.ts') ? test.assertionResults : []);
  const logicalSkipped = logical.filter(test => test.status !== 'passed');
  const result = { source, earsPassed: ears.numPassedTests, sqliteCasesPassed: passedIn(ears, /\/tests\/sqlite\//),
    selectedTextPassed: selected.filter(test => test.status === 'passed').length, selectedTextTotal: selected.length,
    maintenanceCasesPassed: passedIn(cli, /\/tests\/commands\/db-rebuild\.spec\.ts$/),
    logicalSnapshotCasesPassed: passedIn(ears, /\/tests\/sqlite\/logical-snapshot\.spec\.ts$/),
    logicalHostCasesPassed: logical.filter(test => test.status === 'passed').length,
    logicalHostSkipped: logicalSkipped.map(test => ({ name: test.fullName, status: test.status })),
    hostPassed: host.numPassedTests, recoveryCasesPassed: passedIn(host, /\/backup\/recovery\.spec\.ts$/) };
  save('verification.json', result);
  assert(result.maintenanceCasesPassed >= 9 && cli.numFailedTests === 0,
    'All nine actual offline maintenance command cases must execute and pass');
  assert.equal(result.logicalSnapshotCasesPassed, 5, 'All public snapshot API cases must execute');
  assert.equal(logical.length, 10, 'All host logical publication/preview/replacement cases must be collected');
  assert.equal(result.logicalHostCasesPassed, platform() === 'win32' ? 9 : 10, 'All platform-applicable logical archive cases must pass');
  assert(logicalSkipped.every(test => platform() === 'win32' && ['pending', 'skipped'].includes(test.status) &&
    test.fullName === 'reports a published but unsynchronized directory truthfully and retains its complete archive'),
    'Only Windows directory-sync qualification may be skipped in the logical archive cases');
  assert(selected.length > 0 && selected.every(test => test.status === 'passed') && result.recoveryCasesPassed > 0,
    'SQLite-selected text cases and recovery must execute and pass; native fallback is insufficient');
} else {
  assert.equal(mode, 'probe', 'Expected probe or verify');
  const entries = Object.fromEntries(['@apackdev/ears', '@apackdev/ears/sqlite'].map(name => [name, import.meta.resolve(name)]));
  assert(Object.values(entries).every(entry => entry.includes('/dist/')), 'Probe must use normal built packages');
  const { createEarsEngine } = await import('@apackdev/ears'), { openDatabase } = await import('@apackdev/ears/sqlite');
  const root = mkdtempSync(join(tmpdir(), 'ears-sqlite-platform-')), live = join(root, 'live'), backup = join(root, 'backup');
  let db;
  try {
    db = openDatabase({ path: live, syncs: false, schema: { types: { Doc: { required: [], search: { fields: { text: 1 } },
      substrings: ['text'], embed: { from: ['text'], model: 'platform-loader-fixture', dims: 3 } } }, relations: {}, roles: [] } });
    const e = createEarsEngine({ database: db });
    e.create('Doc', { id: 'Doc-old', text: 'needle old', at: 1000 });
    e.create('Doc', { id: 'Doc-new', text: 'needle new', at: new Date(99000) });
    await db.indexesReady();
    const pending = e.pendingEmbeddings('Doc');
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: chunk.id === 'Doc-old' ? [1, 0, 0] : [0, 1, 0] })));
    const check = engine => {
      const hit = engine.query('Doc').search('needle', { fuzzy: false, recency: { field: 'at', halfLife: 10000, now: 100000 } })
        .limit(1).hits({ fields: ['text'], highlights: true })[0];
      assert(hit, 'Recency search must return its winner'); assert.equal(hit.id, 'Doc-new'); assert.deepEqual(hit.highlights.text, [[0, 0, 6]]);
      assert.deepEqual(engine.query('Doc').matching('needle.*').ids(), ['Doc-old', 'Doc-new']);
      assert.deepEqual(engine.query('Doc').containing('eed').ids(), ['Doc-old', 'Doc-new']);
      assert.deepEqual(engine.query('Doc').near([1, 0, 0], { k: 1 }).ids(), ['Doc-old']);
    };
    check(e); db.backup(backup); db.close();
    db = openDatabase({ path: backup, readOnly: true }); check(createEarsEngine({ database: db }));
    const require = createRequire(entries['@apackdev/ears']), extension = require('sqlite-vec').getLoadablePath();
    const packageRoot = dirname(dirname(fileURLToPath(entries['@apackdev/ears'])));
    const hash = file => ({ path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
    save('runtime.json', { source, entries, node: process.version, platform: platform(), arch: arch(), release: release(), cpus: cpus().length,
      enginePin: readFileSync('vendor/elmdb.rev', 'utf8').trim(), sqlite: db.get('SELECT sqlite_version() version').version,
      nativeBindings: loadedNativeBindings([extension]), extension: hash(extension), regexAssets: ['rregex.cjs', 'rregex_bg.wasm']
        .map(file => hash(join(packageRoot, 'vendor/rregex', file))), qualification: 'Built Node packages, FTS/recency/regex/vec and read-only backup; no recall, packaging or durability claim' });
  } finally { db?.close(); rmSync(root, { recursive: true, force: true }); }
}
