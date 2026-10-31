// Explicit disposable interoperability gate: the producer must be the matching Rust elmdb CLI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { openDatabase as openElmdb } from '../../src/lmdb/database.ts';
import { openDatabase as openSqlite } from '../../src/sqlite/index.ts';
import { convertElmdbDump } from '../../scripts/convert-elmdb-dump.ts';

const [producer, receipt, ...extra] = process.argv.slice(2);
if (!producer || !receipt || extra.length) throw new Error('Usage: tsx elmdb-conversion-native.ts <matching-elmdb-cli> <receipt.json>');
const root = mkdtempSync(join(tmpdir(), 'ears-native-conversion-'));
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
// Compare semantic values without depending on the decoder's Buffer versus Uint8Array choice.
function value(input: unknown): unknown {
  if (input instanceof Date) return { date: input.toISOString() };
  if (input instanceof Uint8Array) return { bytes: [...input] };
  if (Object.is(input, -0)) return { negativeZero: true };
  if (Array.isArray(input)) return input.map(value);
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, held]) => [key, value(held)]));
  return input;
}
try {
  const original = join(root, 'original'), copy = join(root, 'copy'), dump = join(root, 'copy.dump');
  const native = openElmdb({ path: original, schema: { types: { Row: { required: [], shortCode: 'ROW', indexes: ['text'],
    search: { fields: { text: 1 } }, embed: { from: ['text'], model: 'native-conversion', dims: 3 } } }, relations: { edge: {} }, roles: [] } });
  let expected: unknown, expectedEdges: unknown;
  try {
    const e = createEarsEngine({ database: native });
    e.create('Row', { id: 'Row-first', text: 'needle retained', bytes: new Uint8Array([0, 255]), at: new Date(1234),
      nested: JSON.parse('{"__proto__":{"retained":true},"list":[null,false,3]}') });
    e.create('Row', { id: 'Row-second', text: 'second' });
    e.write('Row-first').link('edge', 'Row-second', { info: { at: new Date(4567), bytes: new Uint8Array([42]) } });
    e.write('Row-second').trash();
    await native.indexesReady();
    const pending = e.pendingEmbeddings('Row');
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
    e.nextLabel('Row', 'item');
    expected = value(e.query.withTrashed('Row').pickAll()); expectedEdges = value(e.findRelations({ kind: 'edge' }));
    await native.durable(); native.backup(copy);
  } finally { native.close(); }
  const originalHash = digest(join(original, 'data.mdb')), copyHash = digest(join(copy, 'data.mdb'));
  const producerResult = spawnSync(resolve(producer), ['dump', copy, dump], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(producerResult.status, 0, producerResult.stderr || String(producerResult.error));
  const converted = await convertElmdbDump(dump, join(root, 'converted'));
  const sqlite = openSqlite({ path: converted.path });
  try {
    const e = createEarsEngine({ database: sqlite });
    assert.deepEqual(value(e.query.withTrashed('Row').pickAll()), expected);
    assert.deepEqual(value(e.findRelations({ kind: 'edge' })), expectedEdges);
    assert.deepEqual(e.query('Row').search('needle', { fuzzy: false }).ids(), ['Row-first']);
    assert.equal(e.pendingEmbeddings('Row').count, 0);
    assert.deepEqual(e.query('Row').near([1, 0, 0]).ids(), ['Row-first']);
    assert.equal(e.nextLabel('Row', 'item'), 'item 2');
    const third = e.create('Row', { text: 'new' }).id(); assert.equal(e.getAttr(third, 'shortCode'), 'ROW-3');
  } finally { sqlite.close(); }
  assert.equal(digest(join(original, 'data.mdb')), originalHash);
  assert.equal(digest(join(copy, 'data.mdb')), copyHash);
  writeFileSync(receipt, JSON.stringify({ producer: resolve(producer), producerSha256: digest(producer), producerReport: producerResult.stdout,
    dumpSha256: digest(dump), originalUnchanged: true, copiedSourceUnchanged: true, converted,
    checks: ['typed rows and creation order', 'trash', 'relation info', 'search', 'reusable embeddings', 'label counter', 'short-code counter', 'source hashes'] }, null, 2) + '\n');
} finally { rmSync(root, { recursive: true, force: true }); }
