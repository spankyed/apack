// Disposable qualification of precise query dependencies, with the actual old implementation as a control.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { boundedSpawn } from '../../scripts/lib/bounded-spawn.ts';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.platform, 'linux');
assert.equal(process.cwd(), process.env.GITHUB_WORKSPACE);
const output = path.resolve('.temp/sqlite-platform/watch-scope');
assert(!existsSync(output)); mkdirSync(output, { recursive: true });
const file = 'packages/apack-ears/src/sqlite/query.ts', original = readFileSync(file);
const before = 'c5d6f3ea66e61840a8d69a22e2174fc790c3be75';
const names = [
  'keeps explicit-ID filters and ordering scoped while tracking selected fields and missing IDs',
  'does not queue type-scoped ordering for another type’s fields or membership',
  'keeps fixed-endpoint link filters independent of unrelated entity births',
  'tracks typed one-hop target membership and fields after leaving an explicit-ID start',
  'retains untyped and deep intermediate membership dependencies',
];
const threadCase = "the threads views give a new message to the open thread's page, and end a deleted thread's page, tab and detail with null";
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { source: process.env.GITHUB_SHA, completed: false, before,
  originalSha256: hash(original), core: {}, threads: {}, negative: null };
const assertions = data => data.testResults.flatMap(result => result.assertionResults);
async function run(label, workspace, spec, backend, pattern) {
  const resultFile = path.join(output, label + '.json');
  const args = ['test', '-w', workspace, '--', spec, '--maxWorkers', '2', '--reporter=default',
    '--reporter=json', '--outputFile=' + resultFile, ...(pattern ? ['--testNamePattern', pattern] : [])];
  const child = await boundedSpawn('npm', args, 120000, { env: { ...process.env, EARS_EVALUATION_BACKEND: backend } });
  writeFileSync(path.join(output, label + '.log'), child.output);
  assert(!child.timedOut && !child.stalled && !child.aborted, 'Owned test process must finish normally');
  return { status: child.code, data: JSON.parse(readFileSync(resultFile, 'utf8')) };
}
function positive(result, required) {
  assert.equal(result.status, 0); assert.equal(result.data.numFailedTests, 0);
  assert.equal(result.data.numPendingTests, 0);
  const tests = new Map(assertions(result.data).map(test => [test.fullName, test]));
  for (const name of required) assert.equal(tests.get(name)?.status, 'passed', name);
  return { passed: result.data.numPassedTests, required };
}
try {
  execFileSync('git', ['diff', '--exit-code', '--', file]);
  for (const backend of ['elmdb', 'sqlite']) {
    report.core[backend] = positive(await run('core-' + backend, '@apackdev/ears',
      'tests/engine/watch.spec.ts', backend), names.map(name => 'watch ' + name));
    report.threads[backend] = positive(await run('threads-' + backend, '@app/default-setup',
      'tests/features/threads/be/views.spec.ts', backend), [threadCase]);
  }
  assert(readFileSync(file).equals(original));
  execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', before], { timeout: 60000 });
  const old = execFileSync('git', ['show', before + ':' + file]);
  assert.notEqual(hash(old), hash(original)); report.beforeSha256 = hash(old);
  writeFileSync(file, old);
  const pattern = names.slice(0, 4).join('|');
  const negative = await run('old-query-scope', '@apackdev/ears', 'tests/engine/watch.spec.ts', 'sqlite', pattern);
  assert.notEqual(negative.status, 0); assert.equal(negative.data.numFailedTests, 4);
  assert.equal(negative.data.numPassedTests, 0);
  const failed = assertions(negative.data).filter(test => test.status === 'failed');
  assert.deepEqual(failed.map(test => test.fullName).sort(), names.slice(0, 4).map(name => 'watch ' + name).sort());
  for (const test of failed) assert.match(test.failureMessages.join('\n'), /to be 1/,
    'The counterfactual must fail dependency precision, not setup or loading');
  report.negative = { failed: failed.map(test => test.fullName) }; report.completed = true;
} finally {
  writeFileSync(file, original); assert(readFileSync(file).equals(original));
  execFileSync('git', ['diff', '--exit-code', '--', file]);
  report.restoredSha256 = hash(readFileSync(file));
  writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
