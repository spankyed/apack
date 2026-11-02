// Snapshot of the corrected actual workflow metadata gate; run from the downloaded artifact root.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const summary=[];
const shared=[
  'runs the model against the selected real backend and independent empty stores',
  'links treats null optional relation info as omitted, preserving an existing keyed value',
  'links keeps keyed bytes, lists and own map fields distinct, and refuses scalar keyed info atomically',
  'links a keyed kind joins two ends by one edge per value of its key, a field the info lacks being null',
  'links uses string-keyed Maps as relation info and preserves distinct nested map keys',
  'links refuses invalid relation info values before changing an edge or its commit identity',
  'attribute writes stores string-keyed Map attributes as own-field objects and refuses invalid nested maps atomically',
];
for(const backend of ['elmdb','sqlite']) {
  const report=JSON.parse(readFileSync(`.temp/sqlite-api/${backend}-contracts.json`,'utf8'));
  const cases=report.testResults.flatMap(file=>file.assertionResults);
  const required=[...shared,...(backend==='sqlite'?[
    "SQLite commit outcome handling refuses malformed commit metadata without overwriting it ('null')",
    "SQLite commit outcome handling refuses malformed commit metadata without overwriting it ('numeric text')",
    'SQLite commit outcome handling commits the last representable identity then refuses further writes without data or watch changes',
    'SQLite commit outcome handling rolls back schema when the commit identity is exhausted',
    'SQLite commit outcome handling rolls back bulkLoad when the commit identity is exhausted',
    'SQLite commit outcome handling admits the last schema revision then refuses declaration and rebuild without rounding it',
    'restored logical stores audits unchecked duplicate edge identities and invalid keyed info without repairing them',
    'native text pipeline scopes uses posting estimates without reevaluating the candidate prefix and still scopes actual matches',
    'hybrid winner highlights formats only final lexical winners while preserving global fusion scores, list highlights and scoped mixed-type answers',
    'hybrid winner highlights keeps deferred text details in the ranking snapshot when an independent writer commits between phases',
    'SQLite relation identity work stops at a matching key and releases its cursor before mutation, refusal and exhaustion',
    'SQLite relation audit grouping groups distinct keys on disk and compares only colliding fingerprints without changing source data',
    'SQLite relation audit grouping checks existing equality after forced fingerprint collisions instead of inventing duplicates',
    'SQLite relation audit grouping closes and removes a failed private identity spool while preserving the original error and writable source',
    'SQLite relation audit grouping buckets persisted key values consistently with existing equality and skips nonreflexive decoded keys',
    'SQLite authoritative attribute layout projects a single-field page in one SQL call and patches a scalar without reading or encoding its large neighbors',
    'SQLite authoritative attribute layout projects each lossless kind with ordered duplicates, absent rows and fresh composite ownership',
    'SQLite authoritative attribute layout reopens existing layouts read-only and diagnoses missing or duplicate authoritative values',
    'SQLite structural schema admission accepts the empty maintained-rank map serialized by the current native schema',
    "SQLite structural schema admission refuses 'named rank index' before changing data, layouts, indexes or revision",
    'SQLite graph execution batches a width-16 frontier and closes an early-return cursor before the next write',
    'SQLite graph execution batches a width-256 frontier and closes an early-return cursor before the next write',
    ...['obsolete relation unique','duplicate relation key','invalid relation key name','non-map relation key'].map(name=>`SQLite structural schema admission refuses '${name}' before changing data, layouts, indexes or revision`),
  ]:[])];
  for(const name of required) {
    const found=cases.filter(test=>test.fullName===name);
    assert.equal(found.length,1,`${backend}: missing or duplicated witness: ${name}`);
    assert.equal(found[0].status,'passed',`${backend}: ${name}`);
  }
  const model=report.testResults.filter(file=>file.name.replaceAll('\\','/').endsWith('/tests/engine/model-based.spec.ts')).flatMap(file=>file.assertionResults);
  assert(model.length>=3,`${backend}: model cases must execute`);
  for(const test of model)assert.equal(test.status,'passed',`${backend}: ${test.fullName}`);
  summary.push({backend,required,modelCases:model.map(test=>test.fullName),passed:true});
}
writeFileSync('.temp/sqlite-api/relation-model-witnesses.json',JSON.stringify(summary,null,2)+'\n');
