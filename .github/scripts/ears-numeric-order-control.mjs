// Disposable Linux CI control: the real cost witness must reject removing the admitted-type hint.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { boundedSpawn } from '../../scripts/lib/bounded-spawn.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.platform, 'linux');
assert.equal(process.cwd(), process.env.GITHUB_WORKSPACE);
const output = path.resolve('.temp/sqlite-watch/order-control');
assert(!existsSync(output)); mkdirSync(output, { recursive: true });
const file = 'packages/apack-ears/src/sqlite/query.ts', original = readFileSync(file);
const needle = 'knownType: specificTypes && types.length === 1 ? types[0] : undefined,';
assert.equal(original.toString().split(needle).length, 2);
const expected = 'SQLite ordering work uses keyed sort-value reads for a single type (inline)';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { source: process.env.GITHUB_SHA, completed: false, originalSha256: sha(original), expected };
async function run(name, pattern) {
  const args = ['test', '-w', '@apackdev/ears', '--', 'tests/sqlite/query-cost.spec.ts', '--maxWorkers', '2',
    '--reporter=default', '--reporter=json', '--outputFile=' + path.join(output, name + '.json'),
    ...(pattern ? ['--testNamePattern', pattern] : [])];
  const child = await boundedSpawn('npm', args, 120000, { env: { ...process.env, EARS_EVALUATION_BACKEND: 'sqlite' } });
  writeFileSync(path.join(output, name + '.log'), child.output);
  assert(!child.timedOut && !child.stalled && !child.aborted, 'Owned cost-test process tree must finish normally');
  return { status: child.code, report: JSON.parse(readFileSync(path.join(output, name + '.json'), 'utf8')) };
}
try {
  const positive = await run('ordinary');
  assert.equal(positive.status, 0); assert.equal(positive.report.numFailedTests, 0);
  assert.equal(positive.report.numPendingTests, 0); assert(positive.report.numPassedTests >= 28);
  assert(readFileSync(file).equals(original), 'Ordinary tests must preserve authored source');
  writeFileSync(file, original.toString().replace(needle, 'knownType: undefined,'));
  const negative = await run('old-discovery', 'uses keyed sort-value reads for a single type [(]inline[)]');
  assert.notEqual(negative.status, 0); assert.equal(negative.report.numPassedTests, 0);
  assert.equal(negative.report.numFailedTests, 1);
  const failed = negative.report.testResults.flatMap(file => file.assertionResults).filter(test => test.status === 'failed');
  assert.equal(failed.length, 1); assert.equal(failed[0].fullName, expected);
  assert(failed[0].failureMessages.some(message => message.includes('expected true to be false')),
    'Failure must be the retained discovery-cost assertion, not an unrelated setup/loader failure');
  report.ordinaryPassed = positive.report.numPassedTests;
  report.negativeFailed = expected; report.completed = true;
} finally {
  writeFileSync(file, original);
  assert(readFileSync(file).equals(original), 'Mutation control must restore source byte-for-byte');
  execFileSync('git', ['diff', '--exit-code', '--', file]);
  report.restoredSha256 = sha(readFileSync(file));
  writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
