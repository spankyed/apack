// Real regression witnesses under isolated source reversions, never in an application profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { boundedSpawn } from '../../scripts/lib/bounded-spawn.ts';

assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.platform, 'linux');
assert.equal(process.cwd(), process.env.GITHUB_WORKSPACE);
const output = path.resolve('.temp/sqlite-api/hit-projection-control');
assert(!existsSync(output)); mkdirSync(output, { recursive: true });
const file = 'packages/apack-ears/src/sqlite/query.ts', original = readFileSync(file);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { source: process.env.GITHUB_SHA, completed: false, originalSha256: sha(original), cases: [] };
const controls = [
  { name: 'per-hit-sql', spec: 'tests/sqlite/query-cost.spec.ts',
    title: 'batches projected search hits across types without changing order, scores or highlights',
    fullName: 'SQLite ordering work batches projected search hits across types without changing order, scores or highlights',
    needle: 'const row = projected!.get(id)!;', replacement: 'const row = db.row(id, terminal.fields)!;',
    failure: 'not be called' },
  { name: 'missing-row-dependency', spec: 'tests/engine/watch.spec.ts',
    title: 'refreshes graph-ranked hit projections when only a returned field changes',
    fullName: 'watch refreshes graph-ranked hit projections when only a returned field changes',
    needle: 'if (projected) for (const id of projected.keys()) db.trackKey(`entity:${id}`);', replacement: '',
    failure: 'Projected hit rows must refresh after a row-only commit' },
];
async function run(control, stage) {
  const name = control.name + '-' + stage;
  const child = await boundedSpawn('npm', ['test', '-w', '@apackdev/ears', '--', control.spec,
    '--testNamePattern', control.title, '--maxWorkers', '2', '--reporter=default', '--reporter=json',
    '--outputFile=' + path.join(output, name + '.json')], 120000,
    { env: { ...process.env, EARS_EVALUATION_BACKEND: 'sqlite' } });
  writeFileSync(path.join(output, name + '.log'), child.output);
  assert(!child.timedOut && !child.stalled && !child.aborted, 'The owned test tree must exit normally');
  const result = JSON.parse(readFileSync(path.join(output, name + '.json'), 'utf8'));
  const executed = result.testResults.flatMap(file => file.assertionResults).filter(test => ['passed', 'failed'].includes(test.status));
  assert.equal(executed.length, 1); assert.equal(executed[0].fullName, control.fullName);
  if (stage === 'ordinary') {
    assert.equal(child.code, 0); assert.equal(result.numFailedTests, 0); assert.equal(result.numPassedTests, 1);
  } else {
    assert.notEqual(child.code, 0); assert.equal(result.numFailedTests, 1); assert.equal(result.numPassedTests, 0);
    assert(executed[0].failureMessages.some(message => message.includes(control.failure)),
      'The real behavioral/cost assertion must fail, not a setup or loader error');
  }
}
try {
  for (const control of controls) {
    assert.equal(original.toString().split(control.needle).length, 2);
    assert(readFileSync(file).equals(original));
    await run(control, 'ordinary');
    try {
      writeFileSync(file, original.toString().replace(control.needle, control.replacement));
      await run(control, 'reverted');
      report.cases.push({ name: control.name, ordinaryPassed: control.fullName, revertedFailed: control.fullName });
    } finally { writeFileSync(file, original); }
  }
  report.completed = true;
} finally {
  writeFileSync(file, original);
  assert(readFileSync(file).equals(original)); execFileSync('git', ['diff', '--exit-code', '--', file]);
  report.restoredSha256 = sha(readFileSync(file));
  writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
