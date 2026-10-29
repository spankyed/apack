import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { decodeLogicalSnapshot, type LogicalHeader, type LogicalRecord } from '../../src/sqlite/logical-format.ts';
import { exportLogicalSnapshot } from '../../src/sqlite/logical-export.ts';

const opened: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of opened.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'ears-logical-source-')); paths.push(path);
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
    Row: { required: [], shortCode: 'ROW', fields: { negative: { type: 'number' }, at: { type: 'any' }, bytes: { type: 'any' } },
      embed: { from: ['title'], model: 'fixture', dims: 3 } },
  }, relations: { edge: {} }, roles: [] }) }); opened.push(db);
  const e = createEarsEngine({ database: db });
  e.create('Row', { id: 'Row-one', title: 'first', negative: -0, at: new Date(1234), bytes: new Uint8Array([0, 255]),
    big: 'x'.repeat(9000), nested: JSON.parse('{"__proto__":{"own":true},"list":[null,false,3]}') });
  e.create('Row', { id: 'Row-two', title: 'second', nil: null });
  e.write('Row-one').link('edge', 'Row-two'); e.write('Row-two').trash(); e.nextLabel('Row', 'item');
  const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
  return { db, e };
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<Array<LogicalHeader | LogicalRecord>> {
  const records: Array<LogicalHeader | LogicalRecord> = [];
  for await (const record of decodeLogicalSnapshot(source)) records.push(record);
  return records;
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('logical snapshot traversal', () => {
  it('preserves raw cells, schema/counters, live/trash ordering, relations and embeddings', async () => {
    const { db, e } = fixture(), before = e.lastCommit();
    const result = await collect(exportLogicalSnapshot(db));
    expect(result[0]).toEqual({ kind: 'header', sequence: before });
    const entities = result.filter(record => record.kind === 'entity');
    expect(entities.map(record => [record.id, record.trashed, record.shortCode])).toEqual([
      ['Row-one', false, 'ROW-1'], ['Row-two', true, 'ROW-2'],
    ]);
    const cells = result.filter(record => record.kind === 'value');
    expect(cells.find(record => record.id === 'Row-one' && record.field === 'negative')).toMatchObject({ storageKind: 'zero', value: 0 });
    expect(cells.find(record => record.field === 'at')).toMatchObject({ storageKind: 'date', value: 1234 });
    const bytes = cells.find(record => record.field === 'bytes')!;
    expect(bytes.storageKind).toBe('bytes'); expect(Array.from(bytes.value as Uint8Array)).toEqual([0, 255]);
    const nested = cells.find(record => record.field === 'nested')!;
    const original = db.get("SELECT value FROM value_overflow WHERE entity_id=? AND field='nested'", ['Row-one'])!.value;
    expect(Buffer.from(nested.value as Uint8Array)).toEqual(original);
    expect(cells.find(record => record.field === 'nil')).toMatchObject({ storageKind: 'null', value: null });
    expect(cells.find(record => record.field === 'big')!.value).toBe('x'.repeat(9000));
    const metadata = result.filter(record => record.kind === 'meta');
    expect(metadata.map(record => record.key)).toEqual(db.all('SELECT key FROM meta ORDER BY key').map(row => row.key));
    for (const entry of metadata) expect(Buffer.from(entry.value)).toEqual(db.get('SELECT value FROM meta WHERE key=?', [entry.key])!.value);
    expect(result.filter(record => record.kind === 'relation')).toMatchObject([{ relationKind: 'edge', source: 'Row-one', target: 'Row-two' }]);
    expect(result.filter(record => record.kind === 'embedding')).toMatchObject([{ dimensions: 3, model: 'fixture', hash: expect.any(String) }, { dimensions: 3, model: 'fixture' }]);
    expect(e.lastCommit()).toBe(before); expect(Object.is(e.getAttr('Row-one', 'negative'), -0)).toBe(true);
  });
  it('finishes from its private snapshot while later source writes continue', async () => {
    const { db, e } = fixture(), before = e.lastCommit(), stream = exportLogicalSnapshot(db);
    const first = await stream.next(); expect(first.done).toBe(false);
    e.create('Row', { id: 'Row-later', title: 'later' });
    async function* resumed() { yield first.value!; yield* stream; }
    const result = await collect(resumed());
    expect(result[0]).toEqual({ kind: 'header', sequence: before });
    expect(result.filter(record => record.kind === 'entity').map(record => record.id)).toEqual(['Row-one', 'Row-two']);
    expect(e.query('Row').count()).toBe(2);
  });
  it('closes the snapshot and removes scratch when a consumer cancels', async () => {
    const { db, e } = fixture(), original = db.backup.bind(db); let root = '';
    vi.spyOn(db, 'backup').mockImplementation(path => { root = dirname(path); original(path); });
    for await (const _chunk of exportLogicalSnapshot(db)) break;
    expect(root).not.toBe(''); expect(existsSync(root)).toBe(false);
    e.create('Row', { id: 'Row-after-cancel', title: 'after' });
    expect(e.query('Row').count()).toBe(2);
  });
  it('refuses malformed primary payloads instead of completing a truncated logical representation', async () => {
    const { db } = fixture();
    db.run("UPDATE value_overflow SET value=? WHERE entity_id=? AND field='nested'", [Buffer.from([0x81]), 'Row-one']);
    await expect(collect(exportLogicalSnapshot(db))).rejects.toThrow();
    expect(db.get("SELECT value FROM value_overflow WHERE entity_id=? AND field='nested'", ['Row-one'])!.value).toEqual(Buffer.from([0x81]));
  });
});
