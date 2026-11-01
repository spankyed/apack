import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { encodeLogicalSnapshot, type LogicalRecord } from '../../src/sqlite/logical-format.ts';
import { exportLogicalSnapshot } from '../../src/sqlite/logical-export.ts';
import { stageLogicalSnapshot } from '../../src/sqlite/logical-stage.ts';

const roots: string[] = [], databases: SqliteDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const root = () => { const path = mkdtempSync(join(tmpdir(), 'ears-logical-stage-test-')); roots.push(path); return path; };
function fixture() {
  const path = root(), db = new SqliteDatabase({ path: join(path, 'source'), syncs: false,
    schema: toElmdbSchema({ types: { Row: { required: [], fields: { negative: { type: 'number' } },
      embed: { from: ['title'], model: 'fixture', dims: 3 } } }, relations: {}, roles: [] }) }); databases.push(db);
  const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-one', negative: -0, title: 'one', bytes: new Uint8Array([0, 255]) });
  const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
  return { db, e, path, destination: join(path, 'spool') };
}
async function bytes(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const value of source) chunks.push(Buffer.from(value)); return Buffer.concat(chunks);
}
async function* one(value: Uint8Array) { yield value; }

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('sealed logical archive ingestion', () => {
  it('seals a complete real snapshot with raw values and embeddings, leaving the source unchanged', async () => {
    const f = fixture(), before = f.e.lastCommit();
    const result = await stageLogicalSnapshot(exportLogicalSnapshot(f.db), f.destination);
    expect(result.sequence).toBe(before); expect(result.counts).toMatchObject({ entity: 1, embedding: 1 });
    const spool = new NativeDatabase(join(result.path, 'archive.sqlite3'), { readonly: true });
    try {
      expect(spool.prepare("SELECT value FROM archive_state WHERE key='sealed'").get()).toEqual({ value: 1 });
      expect(spool.prepare("SELECT kind,value FROM logical_values WHERE field='negative'").get()).toEqual({ kind: 'zero', value: 0 });
      expect(spool.prepare('SELECT embedding FROM embeddings').get()).toEqual(f.db.get('SELECT embedding FROM embedding_values'));
      expect(spool.prepare('SELECT value FROM meta WHERE key=?').get('schema')).toEqual(f.db.get('SELECT value FROM meta WHERE key=?', ['schema']));
    } finally { spool.close(); }
    expect(f.e.lastCommit()).toBe(before); expect(Object.is(f.e.getAttr('Row-one', 'negative'), -0)).toBe(true);
  });
  it.each(['truncated', 'trailing'] as const)('removes staging after a %s stream, even after records were decoded', async fault => {
    const f = fixture(), data = await bytes(exportLogicalSnapshot(f.db));
    const input = fault === 'truncated' ? data.subarray(0, -2) : Buffer.concat([data, Buffer.from([0])]);
    await expect(stageLogicalSnapshot(one(input), f.destination)).rejects.toMatchObject({ code: 'DUMP_INVALID' });
    expect(existsSync(f.destination)).toBe(false);
    await expect(stageLogicalSnapshot(one(data), f.destination)).resolves.toMatchObject({ sequence: f.e.lastCommit() });
  });
  it('refuses duplicate identities without publishing a seal or modifying the source', async () => {
    const f = fixture(), duplicate: LogicalRecord = { kind: 'meta', key: 'same', value: f.db.pack(1) };
    await expect(stageLogicalSnapshot(encodeLogicalSnapshot(0, [duplicate, duplicate]), f.destination)).rejects.toMatchObject({ code: 'DUMP_INVALID' });
    expect(existsSync(f.destination)).toBe(false); expect(f.e.query('Row').count()).toBe(1);
  });
  it('refuses a counter behind the stored identities after verifying the stream', async () => {
    const f = fixture();
    const records: LogicalRecord[] = [{ kind: 'meta', key: 'seq', value: f.db.pack(1) },
      { kind: 'entity', id: 'Row-one', type: 'Row', seq: 1, trashed: false, shortCode: null }];
    await expect(stageLogicalSnapshot(encodeLogicalSnapshot(0, records), f.destination)).rejects.toThrow('Invalid logical archive identity counter');
    expect(existsSync(f.destination)).toBe(false);
  });
  it('refuses an existing destination without taking ownership of its files', async () => {
    const f = fixture(), existing = root(), marker = join(existing, 'incumbent'); writeFileSync(marker, 'retained');
    await expect(stageLogicalSnapshot(exportLogicalSnapshot(f.db), existing)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(marker, 'utf8')).toBe('retained');
  });
  it('retains the original input IO error and removes partial staging', async () => {
    const f = fixture(), failure = Object.assign(new Error('source IO failure'), { code: 'EIO' });
    async function* records(): AsyncGenerator<LogicalRecord> { yield { kind: 'meta', key: 'first', value: f.db.pack(1) }; throw failure; }
    await expect(stageLogicalSnapshot(encodeLogicalSnapshot(0, records()), f.destination)).rejects.toBe(failure);
    expect(existsSync(f.destination)).toBe(false);
  });
});
