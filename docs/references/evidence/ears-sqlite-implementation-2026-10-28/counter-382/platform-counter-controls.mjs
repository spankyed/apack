import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
function requirePassingCases(cases, required, label) {
  const named = new Map(cases.map(test => [test.fullName, test]));
  assert.equal(named.size, cases.length, `${label}: duplicate witness names`);
  for (const name of required) assert.equal(named.get(name)?.status, 'passed', `${label}: required case must execute: ${name}`);
  for (const test of cases) assert.equal(test.status, 'passed', `${label}: selected case must pass: ${test.fullName}`);
}
const run = ears => {
  const counterCases = ears.testResults.flatMap(file => file.name.replaceAll('\\', '/').endsWith('/tests/sqlite/commit-outcomes.spec.ts') ? file.assertionResults : []);
  requirePassingCases(counterCases, [
    "SQLite commit outcome handling refuses malformed commit metadata without overwriting it ('null')",
    "SQLite commit outcome handling refuses malformed commit metadata without overwriting it ('numeric text')",
    'SQLite commit outcome handling commits the last representable identity then refuses further writes without data or watch changes',
    'SQLite commit outcome handling rolls back schema when the commit identity is exhausted',
    'SQLite commit outcome handling rolls back bulkLoad when the commit identity is exhausted',
    'SQLite commit outcome handling admits the last schema revision then refuses declaration and rebuild without rounding it',
  ], 'Commit and schema counter exhaustion');

};
const original=JSON.parse(readFileSync('.temp/sqlite-api/sqlite-contracts.json','utf8'));run(original);
const targets=original.testResults.flatMap(f=>f.assertionResults).filter(t=>t.title.includes('without overwriting'));assert.equal(targets.length,2);let negative=0;
for(const target of targets)for(const kind of ['missing','duplicate','skipped']) {const copy=structuredClone(original);const file=copy.testResults.find(f=>f.name.endsWith('/commit-outcomes.spec.ts'));const i=file.assertionResults.findIndex(t=>t.fullName===target.fullName);assert(i>=0);if(kind==='missing')file.assertionResults.splice(i,1);else if(kind==='duplicate')file.assertionResults.push(file.assertionResults[i]);else file.assertionResults[i].status='pending';assert.throws(()=>run(copy));negative++;}
console.log(JSON.stringify({positive:1,negative,scope:'Actual platform gate on real CI reports; metadata-only, no native workload'}));
