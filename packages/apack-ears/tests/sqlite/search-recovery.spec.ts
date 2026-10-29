import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteSearch } from '../../src/sqlite/search.ts';
import { searchTable } from '../../src/sqlite/index-builds.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';
import { SqliteValues } from '../../src/sqlite/values.ts';

const schema: EngineSchema = { types: {
  Row: { required: [], search: { fields: { title: 1 } }, substrings: ['title'], embed: { from: ['title'], model: 'fixture', dims: 3 } },
  Other: { required: [] },
}, relations: {}, roles: [] };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open(path?: string, readOnly = false) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-search-recovery-')); paths.push(path); }
  const db = new SqliteDatabase({ path, readOnly, syncs: false, ...(!stores.some(s => s.path === path) ? { schema: toElmdbSchema(schema) } : {}) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}
function seed() {
  const { db, e } = open();
  e.create('Row', { id: 'Row-one', title: 'alpha needle' });
  e.create('Row', { id: 'Row-two', title: 'second marker' });
  e.create('Other', { id: 'Other-large', body: 'unrelated '.repeat(10000) });
  const { model, chunks } = e.pendingEmbeddings('Row');
  e.embed(chunks.map(c => ({ ...c, model, vector: c.id === 'Row-one' ? [1, 0, 0] : [0, 1, 0] })));
  const names = db.all("SELECT name FROM sqlite_schema WHERE type='table'").map(r => String(r.name));
  const text = names.find(n => /^fts_[a-f0-9]{24}$/.test(n))!;
  const tri = names.find(n => /^tri_[a-f0-9]{24}$/.test(n))!;
  return { db, e, text, tri };
}
const components: Array<[string, 'TABLE' | 'INDEX' | 'TRIGGER', (text: string, tri: string) => string]> = [
  ['trigram table', 'TABLE', (_t, g) => g],
  ['trigram documents', 'TABLE', (_t, g) => g + '_docs'],
  ['trigram owner index', 'INDEX', (_t, g) => g + '_docs_entity'],
  ...['ai', 'ad', 'au'].map(suffix => ['trigram trigger ' + suffix, 'TRIGGER', (_t: string, g: string) => g + '_docs_' + suffix] as typeof components[number]),
  ['text table', 'TABLE', t => t],
  ['text documents', 'TABLE', t => t + '_docs'],
  ['text owner index', 'INDEX', t => t + '_docs_entity'],
  ['text metadata', 'TABLE', () => 'text_meta'],
  ['vector chunks', 'TABLE', () => 'chunks'],
  ['pending vector index', 'INDEX', () => 'chunk_pending'],
  ['vector reuse index', 'INDEX', () => 'chunk_reuse'],
  ['vector retirement index', 'INDEX', () => 'chunk_generation'],
  ['text retirement index', 'INDEX', () => 'text_generation'],
  ['trigram shadow index', 'TABLE', (_t, g) => g + '_idx'],
  ['text shadow content', 'TABLE', t => t + '_content'],
];

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite missing search storage recovery', () => {
  it('rebuilds damaged postings in fresh generations without changing primary commits', async () => {
    const { db, e, text } = seed();
    const stale = open(db.path, true);
    const before = e.lastCommit();
    const old = db.indexBuilds.jobs().map(job => job.generation);
    db.run(`DELETE FROM ${text} WHERE rowid IN (SELECT rowid FROM ${text} WHERE ${text} MATCH ?)`, ['needle']);
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual([]);
    db.rebuildIndexes();
    expect(e.lastCommit()).toBe(before);
    expect(db.indexBuilds.jobs().every(job => !old.includes(job.generation))).toBe(true);
    expect(() => stale.e.query('Row').count()).toThrow(expect.objectContaining({ code: 'SCHEMA_CHANGED' }));
    expect(() => e.query('Row').search('needle').ids()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    await db.indexesReady();
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
    expect(e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    expect(e.pendingEmbeddings('Row').count).toBe(0);
    expect(e.query('Row').near([1, 0, 0], { k: 1 }).ids()).toEqual(['Row-one']);
    expect(e.getAttr('Other-large', 'body')).toBe('unrelated '.repeat(10000));
    expect(e.lastCommit()).toBe(before);
  });

  it('audits private reconstructed contents without repairing the incumbent', async () => {
    const { db, e, text } = seed(), before = e.lastCommit();
    const clean = await auditSqliteDatabase(db);
    expect(clean).toMatchObject({ ok: true, sequence: before, issues: [] });
    expect(clean.comparedIndexes).toBeGreaterThanOrEqual(3);
    db.run(`DELETE FROM ${text} WHERE rowid IN (SELECT rowid FROM ${text} WHERE ${text} MATCH ?)`, ['needle']);
    const damaged = await auditSqliteDatabase(db);
    expect(damaged.ok).toBe(false);
    expect(damaged.issues.some(issue => issue.includes('derived text contents differ'))).toBe(true);
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual([]);
    expect(e.lastCommit()).toBe(before);
    expect(e.getAttr('Row-one', 'title')).toBe('alpha needle');
  });

  it('detects missing external-content postings even when stored documents are unchanged', async () => {
    const { db, e, tri } = seed(), before = e.lastCommit();
    const docsBefore = db.all(`SELECT entity_id,raw,folded FROM ${tri}_docs ORDER BY id`);
    db.run(`INSERT INTO ${tri}(${tri},rowid,folded) SELECT 'delete',id,folded FROM ${tri}_docs WHERE entity_id=?`, ['Row-one']);
    expect(db.all(`SELECT entity_id,raw,folded FROM ${tri}_docs ORDER BY id`)).toEqual(docsBefore);
    expect(e.query('Row').containing('needle').ids()).toEqual([]);
    const report = await auditSqliteDatabase(db);
    expect(report.ok).toBe(false);
    expect(report.issues.some(issue => issue.includes('trigram posting integrity failed'))).toBe(true);
    expect(e.query('Row').containing('needle').ids()).toEqual([]);
    expect(e.lastCommit()).toBe(before);
    db.rebuildIndexes(); await db.indexesReady();
    expect(e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    expect(e.lastCommit()).toBe(before);
  });

  it('reports undecodable primary values outside every search input', async () => {
    const { db, e } = seed(), before = e.lastCommit();
    expect(db.run("UPDATE value_overflow SET kind='object',value=? WHERE entity_id=? AND field='body'",
      [Buffer.from([0x81]), 'Other-large']).changes).toBe(1); // Truncated one-entry MessagePack map.
    const report = await auditSqliteDatabase(db);
    expect(report).toMatchObject({ ok: false, checkedEntities: 3, issueCount: 1, comparedIndexes: 0 });
    expect(report.issues).toEqual(['Other-large: primary values cannot be decoded']);
    expect(e.lastCommit()).toBe(before);
    expect(() => e.getAttr('Other-large', 'body')).toThrow();
  });

  it('counts all orphan primary values while retaining at most 100 issue messages', async () => {
    const { db } = seed();
    for (let i = 0; i < 150; i++) db.run("INSERT INTO value_overflow VALUES (?,'field','text','orphan')", [`Other-orphan-${i}`]);
    const report = await auditSqliteDatabase(db);
    expect(report.ok).toBe(false);
    expect(report.issueCount).toBe(150);
    expect(report.issues).toHaveLength(100);
    expect(report.issues.every(issue => issue.includes('orphan overflow value'))).toBe(true);
    expect(db.get("SELECT count(*) n FROM value_overflow WHERE value='orphan'")!.n).toBe(150);
  });

  it('reports malformed stored embeddings instead of accepting identical corrupted copies', async () => {
    const { db, e } = seed(), before = e.lastCommit();
    expect(db.run("UPDATE embedding_values SET embedding=? WHERE entity_id=?", [Buffer.alloc(4), 'Row-one']).changes).toBe(1);
    const report = await auditSqliteDatabase(db);
    expect(report.ok).toBe(false);
    expect(report.issues).toContain('Row-one chunk 0: invalid Float32 cosine embedding');
    expect(e.lastCommit()).toBe(before);
  });

  it('reports an identity counter that could reuse existing primary sequences', async () => {
    const { db } = seed();
    db.run("UPDATE meta SET value=? WHERE key='seq'", [db.pack(1)]);
    const report = await auditSqliteDatabase(db);
    expect(report.ok).toBe(false);
    expect(report.issues).toContain('seq: next identity does not exceed stored primary sequences');
  });

  it('detects stale list membership independently of the copied acceleration table', async () => {
    const { db, e } = seed();
    e.write('Row-one').set('tags', ['needle', 'needle', null, false, 0, -0, 3, { nested: true }]);
    const persisted = e.getAttr('Row-one', 'tags');
    expect((await auditSqliteDatabase(db)).ok).toBe(true);
    const before = e.lastCommit();
    expect(db.run("DELETE FROM value_members WHERE entity_id=? AND field='tags' AND kind='text'", ['Row-one']).changes).toBe(1);
    const report = await auditSqliteDatabase(db);
    expect(report.ok).toBe(false);
    expect(report.issues).toContain('Derived list membership differs from primary arrays');
    expect(e.getAttr('Row-one', 'tags')).toEqual(persisted);
    expect(e.lastCommit()).toBe(before);
    expect(db.get("SELECT 1 FROM value_members WHERE entity_id=? AND field='tags' AND kind='text'", ['Row-one'])).toBeUndefined();
    expect(e.query('Row').where('tags', 'needle').ids()).toEqual([]);
    db.rebuildIndexes(); await db.indexesReady();
    expect(e.query('Row').where('tags', 'needle').ids()).toEqual(['Row-one']);
    expect(e.getAttr('Row-one', 'tags')).toEqual(persisted);
    expect(e.lastCommit()).toBe(before);
    expect((await auditSqliteDatabase(db)).ok).toBe(true);
  });

  it('proves absent value fields ready offline while preserving backfill of present fields', async () => {
    const { db, e } = seed();
    e.admin.bulkLoadAttr('Row-one', 'role', ['reader']);
    db.rebuildIndexes();
    const jobs = db.indexBuilds.jobs().filter(job => job.kind === 'value');
    expect(jobs.find(job => job.type === 'Row' && job.name === 'role')!.state).toBe('building');
    expect(jobs.filter(job => job.name === 'shortCode').every(job => job.state === 'ready')).toBe(true);
    await db.indexesReady();
    expect(e.query('Row').where('role', 'reader').ids()).toEqual(['Row-one']);
  });

  it('does not certify an absent field when its authoritative primary row is missing', async () => {
    const { db } = seed();
    const layout = db.values.layout('Row')!;
    expect(db.run(`DELETE FROM ${layout.table} WHERE entity_id=?`, ['Row-one']).changes).toBe(1);
    db.rebuildIndexes();
    expect(db.indexBuilds.index('Row', 'value', 'role').state).toBe('building');
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
  });

  it('rolls membership reconstruction back if later index admission fails', () => {
    const { db, e } = seed();
    e.write('Row-one').set('tags', ['fresh']);
    db.run("UPDATE value_members SET value='stale' WHERE entity_id=? AND field='tags'", ['Row-one']);
    const generations = db.indexBuilds.jobs(), before = e.lastCommit();
    const fault = vi.spyOn(db.search, 'ensure').mockImplementation(() => { throw Error('admission refused'); });
    expect(() => db.rebuildIndexes()).toThrow('admission refused'); fault.mockRestore();
    expect(db.sql.inTransaction).toBe(false);
    expect(db.indexBuilds.jobs()).toEqual(generations);
    expect(e.lastCommit()).toBe(before);
    expect(db.get("SELECT value FROM value_members WHERE entity_id=? AND field='tags'", ['Row-one'])!.value).toBe('stale');
    expect(e.query('Row').where('tags', 'fresh').ids()).toEqual([]);
  });

  it.each(['before', 'after'] as const)('retains atomic membership repair when killed %s its commit', async point => {
    const { db, e } = seed();
    e.write('Row-one').set('tags', ['fresh']);
    db.run("DELETE FROM value_members WHERE entity_id=? AND field='tags'", ['Row-one']);
    const original = db.indexBuilds.jobs().map(job => job.generation), before = e.lastCommit(), path = db.path;
    db.close();
    const module = new URL('../../src/sqlite/database.ts', import.meta.url).href;
    const code = `
      import {writeSync} from 'node:fs';
      const deadline=performance.now()+10000;
      const {SqliteDatabase}=await import(${JSON.stringify(module)});
      const db=new SqliteDatabase({path:process.argv[1],syncs:false});
      const commit=db.commitWrite.bind(db);
      const stop=()=>{
        writeSync(1,JSON.stringify({inTransaction:db.sql.inTransaction,
          members:db.get("SELECT count(*) n FROM value_members WHERE entity_id='Row-one' AND field='tags'").n})+'\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.max(0,deadline-performance.now()));
        process.exit(2);
      };
      db.commitWrite=()=>{if(${JSON.stringify(point)}==='before')stop();commit();if(${JSON.stringify(point)}==='after')stop();};
      db.rebuildIndexes();
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, path], { timeout: 10000, killSignal: 'SIGKILL' });
    const exited = once(child, 'exit'), lines = createInterface({ input: child.stdout }); let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    try {
      const [line] = await Promise.race([once(lines, 'line'), exited.then(([status, signal]) => {
        throw Error(`Repair child exited before witness: ${status}/${signal}: ${stderr}`);
      })]);
      expect(JSON.parse(String(line))).toEqual({ inTransaction: point === 'before', members: 1 });
      expect(child.kill('SIGKILL'), stderr).toBe(true);
      const [, signal] = await exited; expect(signal, stderr).toBe('SIGKILL');
      const resumed = open(path);
      expect(resumed.e.lastCommit()).toBe(before);
      if (point === 'before') expect(resumed.db.indexBuilds.jobs().map(job => job.generation)).toEqual(original);
      else expect(resumed.db.indexBuilds.jobs().every(job => !original.includes(job.generation))).toBe(true);
      expect(resumed.db.get("SELECT count(*) n FROM value_members WHERE entity_id=? AND field='tags'", ['Row-one'])!.n).toBe(point === 'before' ? 0 : 1);
      expect(resumed.e.getAttr('Row-one', 'tags')).toEqual(['fresh']);
      await resumed.db.indexesReady();
      resumed.db.rebuildIndexes(); await resumed.db.indexesReady();
      expect(resumed.e.query('Row').where('tags', 'fresh').ids()).toEqual(['Row-one']);
      expect(resumed.e.lastCommit()).toBe(before);
    } finally {
      lines.close();
      if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
  });

  it('removes failed audit scratch and releases write ownership after a snapshot failure', async () => {
    const { db, e } = seed(), failure = new Error('audit snapshot IO');
    let scratch = '';
    const fault = vi.spyOn(db, 'backup').mockImplementation(path => { scratch = dirname(path); throw failure; });
    await expect(auditSqliteDatabase(db)).rejects.toBe(failure); fault.mockRestore();
    expect(scratch).not.toBe(''); expect(existsSync(scratch)).toBe(false);
    e.create('Other', { id: 'Other-after-audit' });
    expect(e.query('Other').count()).toBe(2);
  });

  it('preserves the audit failure together with snapshot close failure and still removes scratch', async () => {
    const { db, e } = seed(), primary = new Error('private second snapshot failed'), cleanup = new Error('snapshot close failed');
    const backup = SqliteDatabase.prototype.backup, close = SqliteDatabase.prototype.close;
    let failed = false, scratch = '';
    const copying = vi.spyOn(SqliteDatabase.prototype, 'backup').mockImplementation(function(this: SqliteDatabase, path) {
      if (this !== db) { failed = true; scratch = dirname(path); throw primary; }
      return backup.call(this, path);
    });
    const closing = vi.spyOn(SqliteDatabase.prototype, 'close').mockImplementation(function(this: SqliteDatabase) {
      close.call(this); if (failed && this !== db) throw cleanup;
    });
    let error: unknown;
    try { await auditSqliteDatabase(db); } catch (failure) { error = failure; }
    copying.mockRestore(); closing.mockRestore();
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([primary, cleanup]);
    expect((error as AggregateError).cause).toBe(primary);
    expect(scratch).not.toBe(''); expect(existsSync(scratch)).toBe(false);
    expect(e.query('Row').count()).toBe(2);
    e.create('Other', { id: 'Other-after-cleanup' });
  });

  it('refuses rebuild on read-only, open-unit and stopped owners without changing the catalog', () => {
    const { db, e } = seed();
    const jobs = db.indexBuilds.jobs(), before = e.lastCommit();
    const reader = open(db.path, true);
    expect(() => reader.db.rebuildIndexes()).toThrow(expect.objectContaining({ code: 'READ_ONLY' }));
    const unit = db.begin();
    try { expect(() => db.rebuildIndexes()).toThrow(expect.objectContaining({ code: 'UNIT_OPEN' })); }
    finally { unit.abort(); }
    const failure = new Error('fatal scheduler failure');
    db.indexBuilds.stop(failure);
    expect(() => db.rebuildIndexes()).toThrow(failure);
    expect(db.indexBuilds.jobs()).toEqual(jobs);
    expect(e.lastCommit()).toBe(before);
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
  });

  it('rolls back failed rebuild admission and keeps current generations usable', () => {
    const { db, e } = seed();
    const jobs = db.indexBuilds.jobs(), before = e.lastCommit();
    const reader = open(db.path, true);
    const failure = new Error('rebuild physical admission failed');
    const fault = vi.spyOn(db.search, 'ensure').mockImplementation(() => { throw failure; });
    expect(() => db.rebuildIndexes()).toThrow(failure); fault.mockRestore();
    expect(db.sql.inTransaction).toBe(false);
    expect(db.indexBuilds.jobs()).toEqual(jobs);
    expect(db.get('SELECT 1 FROM index_gc LIMIT 1')).toBeUndefined();
    expect(e.lastCommit()).toBe(before);
    expect(reader.e.query('Row').count()).toBe(2);
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
    expect(e.query('Row').near([1, 0, 0], { k: 1 }).ids()).toEqual(['Row-one']);
  });

  it.each(components)('refuses read-only and reconstructs %s in a private background generation', async (_label, kind, name) => {
    const { db, text, tri } = seed(), path = db.path, sequence = db.sequence;
    db.close();
    const damage = new NativeDatabase(join(path, 'data.sqlite3'));
    try { damage.unsafeMode(true); damage.exec(`DROP ${kind} ${name(text, tri)}`); }
    finally { damage.close(); }
    expect(() => open(path, true)).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    const reads = vi.spyOn(SqliteValues.prototype, 'read');
    const { db: repaired, e } = open(path);
    expect(reads).not.toHaveBeenCalled();
    await repaired.indexesReady();
    expect(repaired.sequence, 'derived repair is not a logical mutation').toBe(sequence);
    expect(reads.mock.calls.every(([layout, , fields]) => layout.name === 'Row' && fields?.every(f => f === 'title'))).toBe(true);
    expect(e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    expect(e.query('Row').matching('second.*marker').ids()).toEqual(['Row-two']);
    expect(e.query('Row').search('needle').ids()).toEqual(['Row-one']);
    expect(e.query('Row').search('databse').ids()).toEqual([]);
    if (name(text, tri) === 'chunks') {
      expect(e.pendingEmbeddings('Row').count).toBe(2);
    } else {
      expect(e.pendingEmbeddings('Row').count).toBe(0);
      expect(e.query('Row').near([1, 0, 0], { k: 1 }).ids()).toEqual(['Row-one']);
    }
    repaired.close();
    const readonly = open(path, true); expect(readonly.e.query('Row').search('marker').ids()).toEqual(['Row-two']);
  });

  it('rebuilds stale external-content postings after a missing update trigger', async () => {
    const { db, e, tri } = seed(), path = db.path;
    db.sql.exec(`DROP TRIGGER ${tri}_docs_ai`);
    e.write('Row-one').set('title', 'new current text');
    db.close();
    const repaired = open(path); await repaired.db.indexesReady();
    expect(repaired.e.query('Row').containing('needle').ids()).toEqual([]);
    expect(repaired.e.query('Row').containing('current').ids()).toEqual(['Row-one']);
  });

  it('rolls back partial postings on a background repair failure, refuses incomplete reads and retries cleanly', async () => {
    const { db, text } = seed(), path = db.path, sequence = db.sequence;
    db.sql.exec(`DROP TABLE ${text}`); db.close();
    const repaired = open(path), job = repaired.db.indexBuilds.jobs().find(j => j.kind === 'text')!, table = searchTable(job);
    const original = SqliteSearch.prototype.refileIndex; let calls = 0;
    const refile = vi.spyOn(SqliteSearch.prototype, 'refileIndex').mockImplementation(function(this: SqliteSearch, ...args) {
      original.apply(this, args); if (++calls === 2) throw Error('injected repair failure');
    });
    expect(repaired.db.indexBuilds.step()).toBe('failed');
    expect(repaired.db.get(`SELECT count(*) n FROM ${table}`)!.n).toBe(0);
    expect(() => repaired.e.query('Row').search('needle').ids()).toThrow(expect.objectContaining({ code: 'INDEX_FAILED' }));
    await expect(repaired.db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    refile.mockRestore(); repaired.db.close();
    const retry = open(path); await retry.db.indexesReady(); expect(retry.db.sequence).toBe(sequence);
    expect(retry.e.query('Row').search('needle').ids()).toEqual(['Row-one']);
  });

  it('preserves repair and rollback errors, stops scheduling and discards the transaction on close', async () => {
    const { db, text } = seed(), path = db.path;
    db.sql.exec(`DROP TABLE ${text}`); db.close();
    const repaired = open(path), job = repaired.db.indexBuilds.jobs().find(j => j.kind === 'text')!, table = searchTable(job);
    const refile = vi.spyOn(repaired.db.search, 'refileIndex').mockImplementation(() => { throw Error('primary repair failure'); });
    const exec = repaired.db.sql.exec.bind(repaired.db.sql);
    const rollback = vi.spyOn(repaired.db.sql, 'exec').mockImplementation(sql => {
      if (sql === 'ROLLBACK') throw Error('secondary rollback failure'); return exec(sql);
    });
    expect(repaired.db.indexBuilds.step()).toBe('failed');
    expect(repaired.db.indexBuilds.lastError).toBeInstanceOf(AggregateError);
    expect((repaired.db.indexBuilds.lastError as AggregateError).errors.map((error: Error) => error.message))
      .toEqual(['primary repair failure', 'secondary rollback failure']);
    await expect(repaired.db.indexesReady()).rejects.toBe(repaired.db.indexBuilds.lastError);
    expect(repaired.db.indexBuilds.step()).toBe('paused');
    rollback.mockRestore(); refile.mockRestore(); repaired.db.close();
    const raw = new NativeDatabase(join(path, 'data.sqlite3'), { readonly: true });
    try { expect(raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 }); }
    finally { raw.close(); }
    const retry = open(path); await retry.db.indexesReady(); expect(retry.e.query('Row').search('needle').ids()).toEqual(['Row-one']);
  });

  it('opens healthy storage while another handle owns a write unit and reads only its committed state', () => {
    const { db, e } = seed();
    let second: ReturnType<typeof open> | undefined;
    e.transact(() => {
      e.write('Row-one').set('title', 'not committed yet');
      second = open(db.path);
      expect(second.e.getAttr('Row-one', 'title')).toBe('alpha needle');
      expect(second.e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    });
    expect(second!.e.getAttr('Row-one', 'title')).toBe('not committed yet');
    expect(second!.e.query('Row').containing('needle').ids()).toEqual([]);
  });

  it('pages only affected search inputs and leaves a healthy reopen free of hydration', async () => {
    const { db, e, tri } = seed(), path = db.path;
    e.transact(() => { for (let i = 0; i < 300; i++) e.create('Row', { id: `Row-${i}`, title: 'needle ' + i, body: 'large '.repeat(1000) }); });
    db.sql.exec(`DROP TABLE ${tri}`); db.close();
    const reads = vi.spyOn(SqliteValues.prototype, 'read');
    const repaired = open(path); expect(reads).not.toHaveBeenCalled(); await repaired.db.indexesReady();
    expect(Math.max(...reads.mock.calls.map(([, ids]) => ids.length))).toBeLessThanOrEqual(repaired.db.indexBuilds.batchRows);
    expect(reads.mock.calls.every(([layout, , fields]) => layout.name === 'Row' && fields?.every(f => f === 'title'))).toBe(true);
    expect(repaired.e.query('Row').containing('needle').count()).toBe(301);
    repaired.db.close(); reads.mockClear();
    open(path); expect(reads).not.toHaveBeenCalled();
  });
});
