import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { exportLogicalSnapshot } from '../../src/sqlite/logical-export.ts';
import { stageLogicalSnapshot } from '../../src/sqlite/logical-stage.ts';
import { restoreLogicalStage } from '../../src/sqlite/logical-restore.ts';
import { encodeLogicalSnapshot, type LogicalRecord } from '../../src/sqlite/logical-format.ts';
const paths: string[] = [], stores: SqliteDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
const root = () => { const path = mkdtempSync(join(tmpdir(), 'ears-logical-restore-')); paths.push(path); return path; };
function fixture() {
  const path = root(), db = new SqliteDatabase({ path: join(path, 'source'), syncs: false, schema: toElmdbSchema({ types: {
    Row: { required: [], shortCode: 'ROW', indexes: ['title'], search: { fields: { title: 1 } }, substrings: ['title'],
      embed: { from: ['title'], model: 'fixture', dims: 3 } }, Empty: { required: [], indexes: ['absent'] },
  }, relations: { edge: {} }, roles: [] }) }); stores.push(db);
  const e = createEarsEngine({ database: db });
  e.create('Row', { id: 'Row-one', title: 'needle first', negative: -0, nil: null, at: new Date(1234), bytes: new Uint8Array([0, 255]),
    nested: JSON.parse('{"__proto__":{"own":true},"list":[null,false,3]}') });
  e.create('Row', { id: 'Row-two', title: 'second' }); e.write('Row-two').trash(); e.write('Row-one').link('edge', 'Row-two', { info: { raw: new Uint8Array([1, 0]) } });
  e.nextLabel('Row', 'item'); const pending = e.pendingEmbeddings('Row');
  e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
  db.bulkLoad([{ load: 'entity', id: 'Undeclared-one', fields: { Case: 'UPPER', case: 'lower', '__proto__': null } }]);
  const raw = Buffer.from([0x91, 0xcb, 0x80, 0, 0, 0, 0, 0, 0, 0]);
  db.values.restoreCell(db.values.layout('Row')!, 'Row-one', 'rawNegative', 'array', raw);
  db.embeddings.restore({ id: 'Row-one', index: 'oldIndex', chunk: 5, hash: 'old-hash', model: 'old-model', dimensions: 2,
    bytes: Buffer.from(new Float32Array([0, 1]).buffer) });
  return { path, db, e, spool: join(path, 'spool'), destination: join(path, 'restored') };
}
function reopen(path: string) { const db = new SqliteDatabase({ path, syncs: false }); stores.push(db); return { db, e: createEarsEngine({ database: db }) }; }
async function spool(f: ReturnType<typeof fixture>) { await stageLogicalSnapshot(exportLogicalSnapshot(f.db), f.spool); }

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('restored logical stores', () => {
  it('reopens an audited real store preserving raw values, vectors, order and counters', async () => {
    const f = fixture(); await spool(f); const before = f.e.lastCommit();
    const result = await restoreLogicalStage(f.spool, f.destination, { syncs: false });
    expect(result).toMatchObject({ path: f.destination, sequence: before, audit: { ok: true, checkedEntities: 3, checkedRelations: 1 } });
    const { db, e } = reopen(f.destination);
    expect(db.all('SELECT * FROM entities ORDER BY seq')).toEqual(f.db.all('SELECT * FROM entities ORDER BY seq'));
    expect(db.all('SELECT * FROM relations ORDER BY seq')).toEqual(f.db.all('SELECT * FROM relations ORDER BY seq'));
    for (const row of f.db.all("SELECT key,value FROM meta WHERE key!='schemaRevision' ORDER BY key"))
      expect(db.get('SELECT value FROM meta WHERE key=?', [row.key])!.value).toEqual(row.value);
    expect(db.all('SELECT entity_id,index_name,chunk,hash,model,dims,embedding FROM embedding_values ORDER BY entity_id,index_name,chunk'))
      .toEqual(f.db.all('SELECT entity_id,index_name,chunk,hash,model,dims,embedding FROM embedding_values ORDER BY entity_id,index_name,chunk'));
    expect(Object.is(e.getAttr('Row-one', 'negative'), -0)).toBe(true);
    expect(Object.is((e.getAttr('Row-one', 'rawNegative') as number[])[0], -0)).toBe(true);
    expect(db.get("SELECT value FROM value_overflow WHERE entity_id='Row-one' AND field='rawNegative'")!.value)
      .toEqual(f.db.get("SELECT value FROM value_overflow WHERE entity_id='Row-one' AND field='rawNegative'")!.value);
    expect(Object.hasOwn(e.getAttr('Row-one', 'nested') as object, '__proto__')).toBe(true);
    expect(db.row('Undeclared-one')).toMatchObject({ Case: 'UPPER', case: 'lower' });
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
    expect(e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    expect(e.pendingEmbeddings('Row').count).toBe(0); expect(e.query('Row').near([1, 0, 0]).ids()).toEqual(['Row-one']);
    expect(e.query('Empty').count()).toBe(0); expect(e.query.trashed('Row').ids()).toEqual(['Row-two']);
    expect(e.lastCommit()).toBe(before); expect(e.nextLabel('Row', 'item')).toBe('item 2');
    const created = e.create('Row', { title: 'third' }).id(); expect(e.getAttr(created, 'shortCode')).toBe('ROW-3');
    expect(f.e.lastCommit()).toBe(before); expect(f.e.query('Row').count()).toBe(1);
  });
  it('keeps mismatched restored vectors primary but pending until current content is embedded', async () => {
    const f = fixture(); f.e.write('Row-one').set('title', 'changed content'); await spool(f);
    await restoreLogicalStage(f.spool, f.destination, { syncs: false }); const { db, e } = reopen(f.destination);
    expect(e.pendingEmbeddings('Row')).toMatchObject({ count: 1, chunks: [{ id: 'Row-one', text: 'changed content' }] });
    expect(db.get("SELECT count(*) n FROM embedding_values WHERE entity_id='Row-one'")!.n).toBe(2);
    expect(e.query('Row').near([1, 0, 0]).ids()).toEqual([]);
  });
  it('refuses an unsealed spool and removes only its reserved destination', async () => {
    const f = fixture(); await spool(f); const sql = new NativeDatabase(join(f.spool, 'archive.sqlite3'));
    sql.exec("DELETE FROM archive_state WHERE key='sealed'"); sql.close();
    await expect(restoreLogicalStage(f.spool, f.destination)).rejects.toThrow('not sealed');
    expect(existsSync(f.destination)).toBe(false); expect(existsSync(f.spool)).toBe(true);
  });
  it.each(['cell', 'embedding', 'catalog', 'schema'] as const)('refuses invalid %s semantics after wire ingestion', async fault => {
    const f = fixture(); await spool(f); const sql = new NativeDatabase(join(f.spool, 'archive.sqlite3'));
    if (fault === 'cell') sql.prepare("UPDATE logical_values SET kind='object',value=? WHERE field='nested'").run(Buffer.from([0x81]));
    if (fault === 'embedding') sql.exec('UPDATE embeddings SET embedding=zeroblob(dims*4)');
    if (fault === 'catalog') sql.exec("UPDATE entities SET trashed=1 WHERE id='Row-one'");
    if (fault === 'schema') sql.prepare("UPDATE meta SET value=? WHERE key='schema'").run(f.db.pack({ bad: true }));
    sql.close();
    await expect(restoreLogicalStage(f.spool, f.destination, { syncs: false })).rejects.toThrow();
    expect(existsSync(f.destination)).toBe(false); expect(f.e.query('Row').count()).toBe(1);
  });
  it('preserves an existing destination and keeps the verified spool reusable after an IO refusal', async () => {
    const f = fixture(); await spool(f); const existing = root(), marker = join(existing, 'incumbent'); writeFileSync(marker, 'retained');
    await expect(restoreLogicalStage(f.spool, existing)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(marker, 'utf8')).toBe('retained');
    const run = SqliteDatabase.prototype.run;
    const error = Object.assign(new Error('restore IO refusal'), { code: 'SQLITE_IOERR_WRITE' });
    const fault = vi.spyOn(SqliteDatabase.prototype, 'run').mockImplementation(function(this: SqliteDatabase, sql, parameters) {
      if (sql === 'INSERT INTO entities VALUES (?,?,?,?,?)' && this.path === f.destination) throw error;
      return run.call(this, sql, parameters);
    });
    await expect(restoreLogicalStage(f.spool, f.destination, { syncs: false })).rejects.toBe(error); fault.mockRestore();
    expect(existsSync(f.destination)).toBe(false);
    await expect(restoreLogicalStage(f.spool, f.destination, { syncs: false })).resolves.toMatchObject({ audit: { ok: true } });
  });
  it('restores an empty schemaless snapshot without inventing a logical commit', async () => {
    const path = root(), stage = join(path, 'stage'), destination = join(path, 'store');
    await stageLogicalSnapshot(encodeLogicalSnapshot(0, [] as LogicalRecord[]), stage);
    await expect(restoreLogicalStage(stage, destination, { syncs: false })).resolves.toMatchObject({ sequence: 0, audit: { ok: true } });
    const { db } = reopen(destination); expect(db.schema).toBeNull(); expect(db.sequence).toBe(0);
  });
});
