// All original app usefulness judgments; inference is prepared locally by the pinned recipe.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { createTemporaryDatabases } from '../../src/lmdb/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const [fixtureFile, vectorsFile, output, backend] = process.argv.slice(2);
assert(fixtureFile && vectorsFile && output && !existsSync(output) && ['elmdb', 'sqlite'].includes(backend));
const bytes = readFileSync(fixtureFile), fixture = JSON.parse(bytes), vectors = JSON.parse(readFileSync(vectorsFile));
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(bytes), vectors.fixtureSha256);
assert.equal(fixture.documents.length, 214); assert.equal(fixture.cases.length, 25);
assert.equal(vectors.dimensions, 384); assert.equal(vectors.documents.length, 214); assert.equal(vectors.queries.length, 25);
const byId = new Map(vectors.documents.map(row => [row.id, row.vector])); assert.equal(byId.size, 214);
const schema = { types: { Document: { required: [], search: { fields: { name: 3, body: 1 } },
  embed: { from: ['name', 'body'], model: `fixture:minilm-${vectors.modelRevision}`, dims: 384, chunk: 'whole' } } }, relations: {}, roles: [] };
const report = { protocol: 'ears-app-hybrid-usefulness/1', completed: false, qualification: false, backend,
  source: process.env.GITHUB_SHA, fixtureSha256: sha(bytes), vectorsSha256: sha(readFileSync(vectorsFile)),
  modelRevision: vectors.modelRevision, scope: 'Frozen 214-section public app corpus, original 25 top-five judgments; small-corpus model-specific usefulness, not performance or complete search acceptance',
  containsPayload: false, cases: [] };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const directory = mkdtempSync(join(tmpdir(), 'ears-app-relevance-'));
let database, temporary;
try {
  if (backend === 'sqlite') database = new SqliteDatabase({ path: directory, schema: toElmdbSchema(schema), syncs: false });
  else { temporary = createTemporaryDatabases(); database = temporary.open(schema).database; }
  const e = createEarsEngine({ database });
  e.transact(() => { for (const document of fixture.documents) e.create('Document', document); });
  if (backend === 'sqlite') await database.indexesReady();
  const pending = e.pendingEmbeddings('Document', { limit: 256 });
  assert.equal(pending.chunks.length, 214);
  for (const chunk of pending.chunks) {
    const document = fixture.documents.find(row => row.id === chunk.id);
    assert.equal(chunk.text, (document.name + '\n\n' + document.body).trim());
    assert.equal(byId.get(chunk.id)?.length, 384);
  }
  assert.equal(e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: byId.get(chunk.id) }))).stored, 214);
  for (const [ordinal, test] of fixture.cases.entries()) {
    const at = performance.now();
    const hits = e.query('Document').hybrid(test.query, vectors.queries[ordinal], { ...test.options, k: test.topK }).hits({ highlights: !!test.highlight });
    const ms = performance.now() - at, relevant = hits.find(hit => test.relevant.includes(hit.id));
    let highlightPassed = true;
    if (test.highlight) {
      highlightPassed = false;
      if (relevant) {
        const document = fixture.documents.find(row => row.id === relevant.id);
        const source = test.highlight.field === 'body' ? document.body : document.name;
        const ranges = relevant.highlights?.[test.highlight.field] ?? [];
        const valid = ranges.length && ranges.every(([element, start, end]) => element === 0 && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= source.length);
        highlightPassed = !!valid && ranges.map(([, start, end]) => source.slice(start, end)).join(' ').toLowerCase().includes(test.highlight.text.toLowerCase());
      }
    }
    report.cases.push({ ordinal, matchedRelevant: !!relevant, returned: hits.length, highlightExpected: !!test.highlight, highlightPassed, ms });
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  report.completed = true;
  report.usefulnessPassed = report.cases.every(row => row.matchedRelevant && row.highlightPassed);
} finally {
  try { if (temporary) temporary.disposeAll(); else database?.close(); }
  finally { rmSync(directory, { recursive: true, force: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
}
if (!report.usefulnessPassed) process.exitCode = 1;
