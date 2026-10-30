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

// Require named safety witnesses, so added passing cases cannot mask a missing or skipped invariant.
function requirePassingCases(cases, required, label) {
  const named = new Map(cases.map(test => [test.fullName, test]));
  assert.equal(named.size, cases.length, `${label}: duplicate witness names`);
  for (const name of required) assert.equal(named.get(name)?.status, 'passed', `${label}: required case must execute: ${name}`);
  for (const test of cases) assert.equal(test.status, 'passed', `${label}: selected case must pass: ${test.fullName}`);
}
const requiredPublicationCases = [
  "excludes writable elmdb/1 handles from physical recovery until close",
  "excludes writable sqlite/1 handles from physical recovery until close",
  "refuses a new writable open during publication (readOnly=false)",
  "refuses a new writable open during publication (readOnly=undefined)",
  "a store-only publication excludes that store but permits an unrelated sibling handle",
  "a store-only publication refuses claims whose database identity is unresolved",
  "refuses managed database-leaf aliases before opening (readOnly=true)",
  "refuses managed database-leaf aliases before opening (readOnly=false)",
  "excludes physical directory identity even when its claim uses another leaf spelling",
  "quarantines corrupt elmdb/1 history while an unrelated primary handle stays open",
  "quarantines corrupt sqlite/1 history while an unrelated primary handle stays open",
  "refuses elmdb/1 history quarantine while a managed reader still holds the directory",
  "refuses sqlite/1 history quarantine while a managed reader still holds the directory",
  "never treats SQLITE_IOERR_READ as permission to replace a SQLite history directory",
  "never treats SQLITE_IOERR_FSYNC as permission to replace a SQLite history directory",
  "never treats SQLITE_CANTOPEN as permission to replace a SQLite history directory",
  "never treats SQLITE_PERM as permission to replace a SQLite history directory",
  "never treats SQLITE_FULL as permission to replace a SQLite history directory",
  "never treats SQLITE_BUSY as permission to replace a SQLite history directory",
  "never treats WRONG_FORMAT as permission to replace a SQLite history directory",
  "never treats SQLITE_CORRUPT_INDEX as permission to replace a SQLite history directory",
  "never treats SQLITE_CORRUPT_VTAB as permission to replace a SQLite history directory",
  "never treats CORRUPT as permission to replace a SQLite history directory",
  "never treats NATIVE_CHANGED as permission to replace a SQLite history directory",
  "retains the directory claim when a failed SQLite constructor could not close its connection",
  "preserves failed SQLite constructor authority without an AggregateError prototype",
  "refuses stale elmdb/1 history publication after another directory was installed",
  "refuses stale sqlite/1 history publication after another directory was installed",
  "refuses a foreign valid SQLite history without initialization or quarantine"
];
const requiredIdentityCases = [
  "SQLite database identity persists the application identity and current format before normal reopen",
  "SQLite database identity refuses a foreign valid SQLite database without initializing or changing it (readOnly=false)",
  "SQLite database identity refuses a foreign valid SQLite database without initializing or changing it (readOnly=true)",
  "SQLite database identity refuses an owned-looking database with application_id=0 without repairing its identity",
  "SQLite database identity refuses an owned-looking database with application_id=305419896 without repairing its identity",
  "SQLite database identity refuses an owned-looking database with user_version=0 without repairing its identity",
  "SQLite database identity refuses an owned-looking database with user_version=2 without repairing its identity",
  "SQLite database identity rolls back identity and every primary initializer together, preserving the original refusal",
  "SQLite database identity refuses missing authoritative meta without recreating it",
  "SQLite database identity refuses missing authoritative entities without recreating it",
  "SQLite database identity refuses missing authoritative relations without recreating it",
  "SQLite database identity refuses missing authoritative embedding_values without recreating it",
  "SQLite database identity refuses missing authoritative value_types without recreating it",
  "SQLite database identity refuses missing authoritative value_fields without recreating it",
  "SQLite database identity refuses missing authoritative value_overflow without recreating it",
  "SQLite database identity refuses missing authoritative admitted type values without recreating it",
  "SQLite database identity refuses an unclaimed empty file on a read-only open without initializing it",
  "SQLite database identity preserves a foreign committed WAL after its writer dies (readOnly=false)",
  "SQLite database identity preserves a foreign committed WAL after its writer dies (readOnly=true)"
];

const requiredNamespaceCases = [
  "quarantine publication (elmdb/1) syncs the rename before opening a replacement and the parent after creating it",
  "quarantine publication (elmdb/1) reports publication uncertainty and retains the quarantine when parent sync 0 fails",
  "quarantine publication (elmdb/1) reports publication uncertainty and retains the quarantine when parent sync 1 fails",
  "quarantine publication (sqlite/1) syncs the rename before opening a replacement and the parent after creating it",
  "quarantine publication (sqlite/1) reports publication uncertainty and retains the quarantine when parent sync 0 fails",
  "quarantine publication (sqlite/1) reports publication uncertainty and retains the quarantine when parent sync 1 fails",
  "store exclusion (elmdb/1) permits a verified unrelated primary handle when history is absent (readOnly=false)",
  "store exclusion (elmdb/1) permits a verified unrelated primary handle when history is absent (readOnly=true)",
  "store exclusion (elmdb/1) refuses an existing history handle and releases failed exclusion (readOnly=false)",
  "store exclusion (elmdb/1) refuses an existing history handle and releases failed exclusion (readOnly=true)",
  "store exclusion (elmdb/1) refuses unknown claims even when history is absent",
  "store exclusion (elmdb/1) refuses stale identity claims even when history is absent",
  "store exclusion (elmdb/1) refuses target name claims even when history is absent",
  "store exclusion (elmdb/1) keeps profile exclusion broader than store exclusion",
  "store exclusion (sqlite/1) permits a verified unrelated primary handle when history is absent (readOnly=false)",
  "store exclusion (sqlite/1) permits a verified unrelated primary handle when history is absent (readOnly=true)",
  "store exclusion (sqlite/1) refuses an existing history handle and releases failed exclusion (readOnly=false)",
  "store exclusion (sqlite/1) refuses an existing history handle and releases failed exclusion (readOnly=true)",
  "store exclusion (sqlite/1) refuses unknown claims even when history is absent",
  "store exclusion (sqlite/1) refuses stale identity claims even when history is absent",
  "store exclusion (sqlite/1) refuses target name claims even when history is absent",
  "store exclusion (sqlite/1) keeps profile exclusion broader than store exclusion",
  "quarantine publication (elmdb/1) retains directory authority if publication cleanup cannot close the replacement",
  "quarantine publication (sqlite/1) retains directory authority if publication cleanup cannot close the replacement"
];
const requiredResetCases = [
  "refuses reset before changing SQLite primary data while history is open (readOnly=false)",
  "refuses reset before changing SQLite primary data while history is open (readOnly=true)",
  "resets a SQLite profile whose history is absent while retaining primary handle exclusion",
  "permits a SQLite reset dry run while history is held without deleting primary data"
];

const requiredBackupPublicationCases = [
  "refuses a backup destination raced by a file without replacing it",
  "refuses a backup destination raced by a empty directory without replacing it",
  "refuses a backup destination raced by a populated directory without replacing it",
  "refuses a backup destination raced by a dangling symlink without replacing it",
  "publishes a backup whose path contains shell metacharacters as literal data",
  "preserves uncertain backup publication and cleanup errors while releasing the write lock",
  "reports the retained published backup when staging cleanup fails and releases the write lock",
  "preserves uncertain backup publication when releasing the write lock also fails"
];

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
  const nativeGeneration=report('native-generation/provenance.json');
  const nativeMembership=report('native-membership.json');
  const sdkBackend=report('sdk-backend.json'),queryWork=report('query-work.json');
  const sdkAll=platform()==='linux'?report('sdk-all-sqlite.json'):null;
  const apiStartup=platform()==='linux'?report('api-startup.json'):null;
  const ears = report('ears.json'), host = report('host.json'), cli = report('cli-maintenance.json'), builtCli = report('logical-cli.json'), profile = report('profile-conversion.json'), profileCrash = report('profile-crash.json');
  const selected = ears.testResults.flatMap(test => test.name.replaceAll('\\', '/').endsWith('/tests/sqlite/text-limits.spec.ts') ? test.assertionResults : []);
  const publication = host.testResults.flatMap(test => /\/tests\/(backup\/recovery|database\/storage)\.spec\.ts$/.test(test.name.replaceAll('\\', '/')) ? test.assertionResults : [])
    .filter(test => /excludes writable|refuses a new writable|store-only publication|quarantines corrupt|history quarantine|never treats|failed SQLite constructor|managed database-leaf aliases|excludes physical directory identity|refuses stale|foreign valid SQLite history/.test(test.fullName));
  const identity = ears.testResults.flatMap(test => test.name.replaceAll('\\', '/').endsWith('/tests/sqlite/database-identity.spec.ts') ? test.assertionResults : []);
  const namespace = host.testResults.flatMap(test => /\/tests\/database\/(recovery-exclusion|quarantine-publication)\.spec\.ts$/.test(test.name.replaceAll('\\', '/')) ? test.assertionResults : []);
  const reset = cli.testResults.flatMap(test => test.name.replaceAll('\\', '/').endsWith('/tests/commands/sqlite-profile.spec.ts') ? test.assertionResults : []);
  const logical = host.testResults.flatMap(test => test.name.replaceAll('\\', '/').endsWith('/tests/backup/logical.spec.ts') ? test.assertionResults : []);
  const logicalSkipped = logical.filter(test => test.status !== 'passed');
  const convertedApi = platform() === 'linux' ? report('converted-api/verification.json') : null;
  const result = { source, apiStartupCasesPassed:apiStartup?.numPassedTests??null, nativeMembershipChecks:nativeMembership.groups.reduce((n,group)=>n+group.checks,0),
    nativeMembershipPatchSha256:nativeGeneration.patchSha256, sdkSqliteCasesPassed:sdkAll?.numPassedTests??null,
    sdkContentRuntimeCasesPassed:sdkAll?passedIn(sdkAll,/\/tests\/testing\/content-runtime\.spec\.ts$/):null,
    sdkBackendCasesPassed:passedIn(sdkBackend,/\/tests\/testing\/database-backend\.spec\.ts$/),
    queryWorkCasesPassed:passedIn(queryWork,/\/tests\/features\/threads\/be\/query-work\.spec\.ts$/),
    nativeAuditCasesPassed:passedIn(ears,/\/tests\/sqlite\/vector-audit\.spec\.ts$/),
    nativeOwnerCasesPassed:passedIn(ears,/\/tests\/sqlite\/vector-owner\.spec\.ts$/),
    nativePackageCasesPassed:passedIn(ears,/\/tests\/sqlite\/native-extension\.spec\.ts$/),
    nativeGenerationCasesPassed:passedIn(ears,/\/tests\/sqlite\/vector-index\.spec\.ts$/),
    nativeTrainingCasesPassed:passedIn(ears,/\/tests\/sqlite\/vector-training\.spec\.ts$/),
    nativeModelCasesPassed:passedIn(ears,/\/tests\/sqlite\/vector-models\.spec\.ts$/),
    nativeGenerationExtensionSha256:nativeGeneration.extensionSha256, earsPassed: ears.numPassedTests, sqliteCasesPassed: passedIn(ears, /\/tests\/sqlite\//),
    selectedTextPassed: selected.filter(test => test.status === 'passed').length, selectedTextTotal: selected.length,
    maintenanceCasesPassed: passedIn(cli, /\/tests\/commands\/db-rebuild\.spec\.ts$/),
    logicalCommandCasesPassed: passedIn(cli, /\/tests\/commands\/db-logical\.spec\.ts$/),
    logicalCrashCasesPassed: passedIn(host, /\/tests\/backup\/logical-crash\.spec\.ts$/),
    builtLogicalChecks: builtCli.checks.length,
    profileConversionChecks: profile.checks.length, profileCrashCases: profileCrash.records.length, convertedApi,
    nativeDumpCasesPassed: passedIn(ears, /\/tests\/sqlite\/elmdb-conversion\.spec\.ts$/),
    logicalSnapshotCasesPassed: passedIn(ears, /\/tests\/sqlite\/logical-snapshot\.spec\.ts$/),
    logicalHostCasesPassed: logical.filter(test => test.status === 'passed').length,
    logicalHostSkipped: logicalSkipped.map(test => ({ name: test.fullName, status: test.status })),
    databaseIdentityCasesPassed: identity.filter(test => test.status === 'passed').length,
    namespaceCasesPassed: namespace.filter(test => test.status === 'passed').length,
    sqliteProfileCasesPassed: reset.filter(test => test.status === 'passed').length,
    managedPublicationCasesPassed: publication.filter(test => test.status === 'passed').length,
    hostPassed: host.numPassedTests, recoveryCasesPassed: passedIn(host, /\/backup\/recovery\.spec\.ts$/) };
  save('verification.json', result);
  assert.equal(result.sdkBackendCasesPassed,2,'Both SDK fixture stores must use SQLite');
  assert.equal(sdkBackend.numFailedTests,0);
  assert.equal(result.queryWorkCasesPassed,5,'All current app repository query contracts must execute on SQLite');
  assert.equal(queryWork.numFailedTests,0);
  if(sdkAll){
    assert(sdkAll.numPassedTests>=1320&&sdkAll.numFailedTests===0&&sdkAll.numPendingTests===0,'Complete prepared SDK contracts must execute on SQLite');
    assert.equal(result.sdkContentRuntimeCasesPassed,1,'The built pack content runtime must execute, not skip');
  }
  assert.equal(nativeGeneration.source,source,'Native lifecycle build must match the checkout');
  assert.equal(nativeGeneration.upstream.commit,'814fd8ef4d42d6567f1613a66f556c8194764d06');
  assert.equal(nativeGeneration.upstream.sha256,'b341c15fe10e41a9b96981ff3a9c217ea0774b4e04932b5acf3dac1320aeceb1');
  assert.equal(nativeGeneration.patchApplied,true);
  assert.equal(nativeGeneration.patchSha256,createHash('sha256').update(readFileSync('native/vectors/vec1-membership.patch')).digest('hex'));
  assert.equal(nativeGeneration.sourceSha256,'5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b');
  assert.equal(nativeMembership.source,source);
  assert.equal(nativeMembership.extensionSha256,nativeGeneration.extensionSha256);
  assert.equal(nativeMembership.completed,true);
  assert.equal(nativeMembership.groups.length,15);
  assert(nativeMembership.groups.every(group=>group.checks===37));
  assert.equal(result.nativeMembershipChecks,555,'All independent membership comparisons must execute');
  assert.equal(nativeGeneration.platform,platform());assert.equal(nativeGeneration.arch,arch());
  assert.equal(createHash('sha256').update(readFileSync(nativeGeneration.extension)).digest('hex'),nativeGeneration.extensionSha256);
  assert.equal(nativeGeneration.packagedExtensionSha256,nativeGeneration.extensionSha256,'Ordinary package and independent native build must match');
  assert.equal(createHash('sha256').update(readFileSync(nativeGeneration.packagedExtension)).digest('hex'),nativeGeneration.extensionSha256);
  assert.equal(result.nativeAuditCasesPassed,25,'All native audit and rebuild cases must execute');
  assert.equal(result.nativeOwnerCasesPassed,3,'All cross-process native service ownership cases must execute');
  assert.equal(result.nativePackageCasesPassed,5,'All ordinary package loading/integrity cases must execute');
  assert.equal(result.nativeGenerationCasesPassed,10,'All native generation lifecycle cases must execute');
  assert.equal(result.nativeTrainingCasesPassed,5,'All native worker ownership cases must execute');
  assert.equal(result.nativeModelCasesPassed,35,'All durable native model admission cases must execute');
  if(apiStartup){
    assert.equal(apiStartup.numFailedTests,0);assert.equal(apiStartup.numPendingTests,0);
    assert.equal(passedIn(apiStartup,/\/tests\/runtime\/sqlite-profile\.spec\.ts$/),5);
    assert.equal(passedIn(apiStartup,/\/tests\/transport\/shutdown\.spec\.ts$/),2);
    assert.equal(result.apiStartupCasesPassed,7,'All managed API startup and shutdown cases must execute');
  }

  assert(result.maintenanceCasesPassed >= 9 && cli.numFailedTests === 0,
    'All nine actual offline maintenance command cases must execute and pass');
  assert.equal(result.logicalCommandCasesPassed, 8, 'Every logical dump/load command case must execute');
  assert.equal(result.logicalCrashCasesPassed, 2, 'Both parent-issued archive publication kill cases must execute');
  assert.equal(builtCli.source, source, 'Built CLI must match the candidate source');
  assert(!builtCli.failure && result.builtLogicalChecks === 5, 'All separate-process staged CLI checks must pass');
  if (convertedApi) {
    assert.equal(convertedApi.source, source, 'Actual converted API gate must match source');
    assert.equal(convertedApi.nativeBaselineBoots, 1); assert.equal(convertedApi.sqliteBoots, 2);
    assert.equal(convertedApi.livePackUpdates, 3);
    for (const key of ['postRestartDataRetained', 'nativeSourceUnchanged', 'historyRetained', 'settingsRetained', 'mediaRetained'])
      assert.equal(convertedApi[key], true, `Actual API lifecycle must verify ${key}`);
  }
  assert.equal(profileCrash.source, source, 'Process-kill profile gate must match source');
  assert.equal(profileCrash.producerSha256, profile.producerSha256, 'Profile gates must use the same actual native producer');
  assert.equal(profileCrash.enginePin, profile.enginePin);
  assert.deepEqual(profileCrash.records.map(item => item.point), ['during-primary', 'before-primary', 'after-primary', 'before-profile', 'after-profile']);
  assert(profileCrash.records.every(item => item.signal === 'SIGKILL' && item.nativeSourceUnchanged && item.oldOutputBytesUnchanged && item.newContainerRetryVerified));
  assert.equal(profileCrash.records[0].witness.loadedEntities, 1000, 'Kill must occur after a real committed ingestion batch');
  assert(profileCrash.records.every(item => item.witness.finalExists === (item.point === 'after-profile')));
  assert.equal(profileCrash.records[4].completedProfileReopened, true);
  assert.equal(profile.source, source, 'Profile conversion must run against exact candidate source');
  assert.equal(profile.enginePin, readFileSync('vendor/elmdb.rev', 'utf8').trim());
  assert(/^[a-f0-9]{64}$/.test(profile.producerSha256), 'Retain the actual native dump producer hash');
  assert.equal(result.profileConversionChecks, 5, 'All real native profile conversion and refusal controls must run');
  assert.equal(profile.converted.format, 'sqlite/1');
  assert.deepEqual(profile.converted.stores.map(store => store.name), ['primary', 'runs']);
  assert(profile.converted.stores.every(store => store.audit.ok), 'Both converted stores must pass audit');
  assert.equal(result.nativeDumpCasesPassed, 7, 'All native dump framing and preservation cases must execute');
  assert.equal(result.logicalSnapshotCasesPassed, 5, 'All public snapshot API cases must execute');
  assert.equal(logical.length, 10, 'All host logical publication/preview/replacement cases must be collected');
  assert.equal(result.logicalHostCasesPassed, platform() === 'win32' ? 9 : 10, 'All platform-applicable logical archive cases must pass');
  assert(logicalSkipped.every(test => platform() === 'win32' && ['pending', 'skipped'].includes(test.status) &&
    test.fullName === 'reports a published but unsynchronized directory truthfully and retains its complete archive'),
    'Only Windows directory-sync qualification may be skipped in the logical archive cases');
  requirePassingCases(publication, requiredPublicationCases, 'Managed publication');
  requirePassingCases(identity, requiredIdentityCases, 'Database identity');
  requirePassingCases(namespace, requiredNamespaceCases, 'Namespace publication');
  requirePassingCases(reset, requiredResetCases, 'SQLite reset');
  requirePassingCases(reset, requiredBackupPublicationCases, 'Backup publication');
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
