// Separate language configuration experiment; frozen unstemmed acceptance remains unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { createTemporaryDatabases } from '../../src/lmdb/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const [fixtureFile, output] = process.argv.slice(2);
assert(fixtureFile && output && !existsSync(output));
const bytes = readFileSync(fixtureFile), fixture = JSON.parse(bytes);
const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(fixtureSha256, '29d79b6060b21ca68d3bb5dd491cc2e3cfff36a11c2f10b28d6df62c9acc3527');
assert.equal(fixture.documents.length, 214); assert.equal(fixture.cases.length, 25);
const report = { protocol: 'ears-text-language-diagnostic/1', completed: false, qualification: false,
  source: process.env.GITHUB_SHA, fixtureSha256, node: process.version, containsPayload: false,
  scope: 'Fixed English public guide corpus; compare no stemming with explicit English stemming. Not a waiver or production configuration decision.', groups: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
for (const backend of ['elmdb', 'sqlite']) for (const stem of ['none', 'en']) {
  const schema = { types: { Document: { required: [], search: { fields: { name: 3, body: 1 }, ...(stem === 'en' ? { stem } : {}) } } }, relations: {}, roles: [] };
  const group = { backend, stem, fields: { name: 3, body: 1 }, completed: false, cases: [] };
  report.groups.push(group); save();
  let database, temporary, directory;
  try {
    if (backend === 'sqlite') {
      directory = mkdtempSync(join(tmpdir(), 'ears-language-'));
      database = new SqliteDatabase({ path: directory, schema: toElmdbSchema(schema), syncs: false });
    } else {
      temporary = createTemporaryDatabases(); database = temporary.open(schema).database; directory = database.path;
    }
    const e = createEarsEngine({ database });
    e.transact(() => { for (const document of fixture.documents) e.create('Document', document); });
    if (backend === 'sqlite') await database.indexesReady();
    for (const [ordinal, test] of fixture.cases.entries()) {
      const at = performance.now();
      const query = e.query('Document').search(test.query, test.options).limit(test.topK);
      const hits = query.hits({ highlights: !!test.highlight }), relevant = hits.find(hit => test.relevant.includes(hit.id));
      let highlightPassed = !test.highlight;
      if (test.highlight && relevant) {
        const document = fixture.documents.find(row => row.id === relevant.id);
        const text = document[test.highlight.field], ranges = relevant.highlights?.[test.highlight.field] ?? [];
        highlightPassed = !!ranges.length && ranges.every(([element, start, end]) => element === 0 && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length) &&
          ranges.map(([, start, end]) => text.slice(start, end)).join(' ').toLowerCase().includes(test.highlight.text.toLowerCase());
      }
      group.cases.push({ ordinal, returned: hits.length, matchedRelevant: !!relevant,
        highlightExpected: !!test.highlight, highlightPassed, ms: performance.now() - at });
      save();
    }
    group.completed = true;
    group.passed = group.cases.filter(row => row.matchedRelevant && row.highlightPassed).length;
    group.failed = 25 - group.passed;
  } finally {
    try { if (temporary) temporary.disposeAll(); else database?.close(); }
    finally { if (backend === 'sqlite' && directory) rmSync(directory, { recursive: true, force: true });
      group.databaseScratchRemoved = !!directory && !existsSync(directory); save(); }
  }
}
report.completed = true; save();
