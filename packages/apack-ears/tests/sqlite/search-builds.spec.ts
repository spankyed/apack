import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { searchTable } from '../../src/sqlite/index-builds.ts';

const base: EngineSchema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
const indexed: EngineSchema = { ...base, types: { Row: { required: [],
  search: { fields: { title: 1 } }, substrings: ['title'], embed: { from: ['title'], model: 'fixture', dims: 3 },
} } };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open(path?: string, readOnly = false) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-search-builds-')); paths.push(path); }
  const db = new SqliteDatabase({ path, readOnly, syncs: false, ...(!stores.some(s => s.path === path) ? { schema: toElmdbSchema(base) } : {}) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}
function seed() {
  const result = open();
  result.e.transact(() => { for (let i = 0; i < 150; i++) result.e.create('Row', { id: `Row-${i}`, title: 'needle ' + i, body: 'unrelated '.repeat(1000) }); });
  return result;
}
const searchJobs = (db: SqliteDatabase) => db.indexBuilds.jobs().filter(job => job.kind !== 'value');
function drain(db: SqliteDatabase) {
  for (let i = 0; i < 1000; i++) { const result = db.indexBuilds.step(); if (result === 'idle') return; expect(result, String(db.indexBuilds.lastError)).toBe('progress'); }
  throw Error('Index queue did not drain');
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('shared background search generations', () => {
  it('admits without row hydration, refuses partial answers and reconciles writes behind and ahead of each cursor', async () => {
    const { db, e } = seed(), reads = vi.spyOn(db.values, 'read');
    e.admin.setSchema(indexed);
    expect(reads).not.toHaveBeenCalled();
    expect(searchJobs(db)).toHaveLength(3); expect(searchJobs(db).every(j => j.state === 'building')).toBe(true);
    expect(() => e.query('Row').search('needle').ids()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    expect(() => e.query('Row').containing('needle').ids()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    expect(() => e.pendingEmbeddings('Row')).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    expect(db.indexBuilds.step()).toBe('progress');
    const cursor = searchJobs(db)[0].afterSeq; expect(cursor).toBeGreaterThan(0); expect(cursor).toBeLessThanOrEqual(db.indexBuilds.batchRows);
    e.transact(() => {
      e.write('Row-0').set('title', 'changed behind'); e.write('Row-149').set('title', 'changed ahead');
      e.write('Row-1').destroy(); e.create('Row', { id: 'Row-new', title: 'inserted later' });
      expect(db.indexBuilds.step()).toBe('paused');
    });
    const sequence = db.sequence;
    await db.indexesReady();
    expect(db.sequence).toBe(sequence); expect(searchJobs(db).every(j => j.state === 'ready')).toBe(true);
    expect(e.query('Row').search('changed', { fuzzy: false }).ids()).toEqual(['Row-0', 'Row-149']);
    expect(e.query('Row').containing('needle 1').ids()).not.toContain('Row-1');
    expect(e.query('Row').containing('inserted').ids()).toEqual(['Row-new']);
    expect(e.pendingEmbeddings('Row').count).toBe(150);
    expect(e.pendingEmbeddings('Row').chunks.find(c => c.id === 'Row-0')!.text).toBe('changed behind');
  });

  it('uses FTS rowid point constraints for backfill, field replacement and destruction', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed);
    const run = db.run.bind(db), plans: string[] = [];
    vi.spyOn(db, 'run').mockImplementation((sql, args) => {
      if (/^DELETE FROM fts_[a-f0-9]+ WHERE/.test(sql)) plans.push(...db.all('EXPLAIN QUERY PLAN ' + sql, args)
        .map(row => String(row.detail)).filter(detail => detail.includes('VIRTUAL TABLE INDEX')));
      return run(sql, args);
    });
    await db.indexesReady(); e.write('Row-0').set('title', 'changed'); e.write('Row-1').destroy();
    expect(plans.length).toBeGreaterThan(150);
    expect(plans.every(detail => /VIRTUAL TABLE INDEX [^:]+:.*=/.test(detail))).toBe(true);
    expect(e.query('Row').search('needle').count()).toBe(148);
    const table = searchTable(searchJobs(db).find(job => job.kind === 'text')!);
    const unindexed = db.all(`EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE entity_id=?`, ['Row-0']);
    const scanned = unindexed.filter(row => String(row.detail).includes('VIRTUAL TABLE INDEX'));
    expect(scanned.length).toBeGreaterThan(0); expect(scanned.every(row => !String(row.detail).includes('='))).toBe(true);
  });

  it('indexes retirement by generation and keeps embedding payloads out of secondary keys', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    for (const table of ['text_meta', 'chunks']) {
      const plan = db.all(`EXPLAIN QUERY PLAN SELECT rowid FROM ${table} WHERE generation=? LIMIT ?`, [1, 32]);
      expect(plan.some(row => String(row.detail).includes('SEARCH') && String(row.detail).includes('generation=?'))).toBe(true);
    }
    for (const index of db.all("PRAGMA index_list('chunks')")) {
      expect(db.all(`PRAGMA index_info('${String(index.name)}')`).some(row => row.name === 'embedding')).toBe(false);
    }
    const vector = searchJobs(db).find(job => job.kind === 'vector')!;
    const pending = db.all('EXPLAIN QUERY PLAN SELECT entity_id,chunk FROM chunks WHERE type=? AND index_name=? AND generation=? AND embedding_id IS NULL ORDER BY entity_id,chunk LIMIT ?', ['Row', vector.name, vector.generation, 10]);
    expect(pending.some(row => String(row.detail).includes('chunk_pending'))).toBe(true);
  });

  it('executes exact vectors through a covering lookup without sorting the input groups', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const pending = e.pendingEmbeddings('Row', { limit: 1000 });
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
    const plans = () => {
      const explained = e.query('Row').near([1, 0, 0]).explain();
      if (explained.backend !== 'sqlite') throw Error('Expected SQLite vector plan');
      return explained.statements.flatMap(statement => statement.plan.map(row => row.detail));
    };
    const selected = plans();
    expect(selected.some(detail => detail.includes('COVERING INDEX chunk_vectors'))).toBe(true);
    expect(selected.some(detail => detail.includes('FOR GROUP BY'))).toBe(false);
    const before = e.query('Row').near([1, 0, 0]).ids();
    db.sql.exec('DROP INDEX chunk_vectors');
    const without = plans();
    expect(without.some(detail => detail.includes('FOR GROUP BY'))).toBe(true);
    expect(e.query('Row').near([1, 0, 0]).ids()).toEqual(before);
  });

  it('reruns a pending watch after readiness without inventing a logical commit or publishing a partial result', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed);
    const seen: string[][] = [], errors: unknown[] = [], commits: number[] = [];
    const watch = e.watch(() => e.query('Row').search('needle').ids(), {
      next: (ids, commit) => { seen.push([...ids]); commits.push(commit); }, error: error => errors.push(error),
    });
    try {
      await e.admin.watchesSettled(); expect(seen).toEqual([]); expect(errors).toEqual([expect.objectContaining({ code: 'INDEX_BUILDING' })]);
      const sequence = db.sequence;
      await db.indexesReady(); await e.admin.watchesSettled();
      expect(seen).toHaveLength(1); expect(seen[0]).toHaveLength(150); expect(commits).toEqual([sequence]); expect(db.sequence).toBe(sequence);
    } finally { watch.stop(); }
    expect((db as unknown as { indexListeners: Set<unknown> }).indexListeners.size).toBe(0);
  });

  it('keeps unrelated generations and embeddings ready when one text declaration changes', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const vector = searchJobs(db).find(j => j.kind === 'vector')!, tri = searchJobs(db).find(j => j.kind === 'trigram')!;
    const pending = e.pendingEmbeddings('Row', { limit: 1000 }); e.embed(pending.chunks.map(c => ({ ...c, model: pending.model, vector: [1, 0, 0] })));
    e.admin.setSchema({ ...indexed, types: { Row: { ...indexed.types.Row, search: { fields: { body: 1 } } } } });
    expect(db.indexBuilds.index('Row', 'vector', vector.name).generation).toBe(vector.generation);
    expect(db.indexBuilds.index('Row', 'trigram', tri.name).generation).toBe(tri.generation);
    expect(e.pendingEmbeddings('Row').count).toBe(0); expect(e.query('Row').containing('needle').count()).toBe(150);
    expect(() => e.query('Row').search('unrelated').count()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    await db.indexesReady(); expect(e.query('Row').search('unrelated').count()).toBe(150);
    expect(e.pendingEmbeddings('Row').count).toBe(0);
  });

  it('reuses unchanged embeddings during a vector replacement and leaves changed source text pending', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const pending = e.pendingEmbeddings('Row', { limit: 1000 });
    e.embed(pending.chunks.map(c => ({ ...c, model: pending.model, vector: [1, 0, 0] })));
    e.admin.setSchema({ ...indexed, types: { Row: { ...indexed.types.Row, embed: { from: ['title', 'absent'], model: 'fixture', dims: 3 } } } });
    e.write('Row-149').set('title', 'changed input');
    await db.indexesReady();
    expect(e.pendingEmbeddings('Row')).toMatchObject({ count: 1, chunks: [{ id: 'Row-149', text: 'changed input' }] });
    expect(e.query('Row').near([1, 0, 0], { k: 1000 }).count()).toBe(149);
    drain(db); expect(db.get('SELECT 1 FROM index_gc LIMIT 1')).toBeUndefined();
  });

  it('defers the last complete vector generation on failure without spinning and reuses it after reopen', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const pending = e.pendingEmbeddings('Row', { limit: 1000 });
    e.embed(pending.chunks.map(c => ({ ...c, model: pending.model, vector: [1, 0, 0] })));
    const old = searchJobs(db).find(j => j.kind === 'vector')!;
    e.admin.setSchema({ ...indexed, types: { Row: { ...indexed.types.Row, embed: { from: ['title', 'absent'], model: 'fixture', dims: 3 } } } });
    const fault = vi.spyOn(db.search, 'refileIndex').mockImplementation(() => { throw Error('vector backfill failure'); });
    expect(db.indexBuilds.step()).toBe('failed'); fault.mockRestore();
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    expect(db.indexBuilds.step()).toBe('idle');
    expect(db.get('SELECT count(*) n FROM chunks WHERE generation=? AND embedding_id IS NOT NULL', [old.generation])!.n).toBe(150);
    db.close(); const resumed = open(db.path); await resumed.db.indexesReady();
    expect(resumed.e.pendingEmbeddings('Row').count).toBe(0);
    drain(resumed.db); expect(resumed.db.get('SELECT 1 FROM index_gc LIMIT 1')).toBeUndefined();
  });

  it('keeps healthy search, watches and primary writes available beside a failed vector replacement', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const pending = e.pendingEmbeddings('Row', { limit: 1000 });
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
    const previous = searchJobs(db).find(job => job.kind === 'vector')!;
    e.admin.setSchema({ ...indexed, types: { Row: { ...indexed.types.Row,
      embed: { from: ['title', 'absent'], model: 'fixture', dims: 3 },
    } } });
    const refile = db.search.refileIndex.bind(db.search);
    const fault = vi.spyOn(db.search, 'refileIndex').mockImplementation((...args) => {
      if (args[2].kind === 'vector') throw Error('replacement failed');
      return refile(...args);
    });
    expect(db.indexBuilds.step()).toBe('failed'); fault.mockRestore();
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    expect(() => e.query('Row').near([1, 0, 0]).ids()).toThrow(expect.objectContaining({ code: 'INDEX_FAILED' }));
    expect(e.query('Row').search('needle', { fuzzy: false }).count()).toBe(150);
    expect(e.query('Row').containing('needle').count()).toBe(150);
    const seen: number[] = [];
    const watch = e.watch(() => e.query('Row').search('changed', { fuzzy: false }).count(), count => seen.push(count));
    try {
      await e.admin.watchesSettled();
      e.write('Row-0').set('title', 'changed title');
      await e.admin.watchesSettled();
      expect(seen).toEqual([0, 1]);
      expect(e.query('Row').search('needle', { fuzzy: false }).count()).toBe(149);
      expect(e.query('Row').containing('changed').ids()).toEqual(['Row-0']);
      expect(e.getAttr('Row-0', 'title')).toBe('changed title');
      expect(db.get('SELECT count(*) n FROM chunks WHERE generation=? AND embedding_id IS NOT NULL', [previous.generation])!.n).toBe(150);
      expect(db.indexBuilds.step()).toBe('idle');
    } finally { watch.stop(); }
    db.close(); const resumed = open(db.path); await resumed.db.indexesReady();
    expect(resumed.e.query('Row').search('changed', { fuzzy: false }).ids()).toEqual(['Row-0']);
    expect(resumed.e.pendingEmbeddings('Row')).toMatchObject({ count: 1, chunks: [{ id: 'Row-0', text: 'changed title' }] });
  });

  it('rolls back a failed batch and resumes its committed cursor on a fresh owner', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed);
    const job = searchJobs(db)[0], table = searchTable(job), refile = db.search.refileIndex.bind(db.search);
    let calls = 0;
    const failure = vi.spyOn(db.search, 'refileIndex').mockImplementation((...args) => { refile(...args); if (++calls === 3) throw Error('injected batch failure'); });
    expect(db.indexBuilds.step()).toBe('failed');
    expect(db.indexBuilds.index(job.type, job.kind, job.name)).toMatchObject({ state: 'failed', afterSeq: 0 });
    expect(db.get(`SELECT count(*) n FROM ${table}`)!.n).toBe(0);
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    failure.mockRestore(); db.close();
    const reopened = open(db.path); await reopened.db.indexesReady();
    expect(reopened.e.query('Row').search('needle').count()).toBe(150);
  });

  it('retires replaced generations with bounded cleanup and never reuses their physical tables', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const previous = searchJobs(db), tables = previous.filter(j => j.kind !== 'vector').map(searchTable);
    e.admin.setSchema(base); e.admin.setSchema(indexed);
    expect(searchJobs(db).every(j => !previous.some(old => old.generation === j.generation))).toBe(true);
    await db.indexesReady(); drain(db);
    expect(db.get('SELECT 1 FROM index_gc LIMIT 1')).toBeUndefined();
    for (const table of tables) expect(db.get('SELECT 1 FROM sqlite_schema WHERE name=?', [table])).toBeUndefined();
    expect(e.query('Row').containing('needle').count()).toBe(150);
  });

  it('makes retirement progress while replacement builds are still incomplete', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const old = searchJobs(db).find(job => job.kind === 'text')!, table = searchTable(old);
    e.admin.setSchema(base); e.admin.setSchema(indexed);
    for (let i = 0; i < 4; i++) expect(db.indexBuilds.step()).toBe('progress');
    expect(searchJobs(db).some(job => job.state === 'building')).toBe(true);
    expect(db.get(`SELECT count(*) n FROM ${table}`)!.n).toBeLessThan(150);
    await db.indexesReady(); drain(db); expect(e.query('Row').search('needle').count()).toBe(150);
  });

  it('rejects readiness and stops cleanly if status inspection fails after a committed batch', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); const waiting = db.indexesReady();
    const statusError = Object.assign(new Error('injected status IO'), { code: 'SQLITE_IOERR' }), all = db.all.bind(db);
    const status = vi.spyOn(db, 'all').mockImplementation((sql, args) => {
      if (sql === 'SELECT * FROM index_builds ORDER BY generation') throw statusError; return all(sql, args);
    });
    expect(db.indexBuilds.step()).toBe('progress');
    await expect(waiting).rejects.toBe(statusError); expect(db.indexBuilds.step()).toBe('paused');
    status.mockRestore(); db.close(); const resumed = open(db.path); await resumed.db.indexesReady();
    expect(resumed.e.query('Row').search('needle').count()).toBe(150);
  });

  it('preserves a backfill failure and a failure to record it without another uncontrolled status read', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); const waiting = db.indexesReady();
    const run = db.run.bind(db);
    const marker = vi.spyOn(db, 'run').mockImplementation((sql, args) => {
      if (sql.startsWith("UPDATE index_builds SET state='failed'")) throw Error('failure marker IO'); return run(sql, args);
    });
    const write = vi.spyOn(db.search, 'refileIndex').mockImplementation(() => { throw Error('backfill IO'); });
    expect(db.indexBuilds.step()).toBe('failed'); await expect(waiting).rejects.toBe(db.indexBuilds.lastError);
    expect((db.indexBuilds.lastError as AggregateError).errors.map((error: Error) => error.message)).toEqual(['backfill IO', 'failure marker IO']);
    expect(db.indexBuilds.step()).toBe('paused');
    marker.mockRestore(); write.mockRestore(); db.close();
    const resumed = open(db.path); await resumed.db.indexesReady(); expect(resumed.e.query('Row').search('needle').count()).toBe(150);
  });

  it('rolls back both catalog admission and new physical groups if precommit state publication fails', () => {
    const { db } = seed(), schema = db.schema;
    const state = vi.spyOn(db.indexBuilds, 'readState').mockImplementationOnce(() => { throw Error('injected admission failure'); });
    expect(() => db.setSchema(toElmdbSchema(indexed))).toThrow('injected admission failure');
    state.mockRestore(); expect(db.schema).toEqual(schema); expect(searchJobs(db)).toEqual([]);
    expect(db.all("SELECT name FROM sqlite_schema WHERE name GLOB 'fts_*' OR name GLOB 'tri_*'")).toEqual([]);
  });

  it('recovers a search cursor committed by a process killed before readiness', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); const path = db.path; db.close();
    const module = pathToFileURL(fileURLToPath(new URL('../../src/sqlite/database.ts', import.meta.url))).href;
    // Block the child's event loop after its committed witness: no background batch may finish before the parent kills it.
    const code = `import {writeSync} from 'node:fs';const deadline=performance.now()+10000;const {SqliteDatabase}=await import(${JSON.stringify(module)});const db=new SqliteDatabase({path:process.argv[1],syncs:false});db.indexBuilds.step();writeSync(1,JSON.stringify(db.indexBuilds.jobs().find(j=>j.kind==='text'))+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.max(0,deadline-performance.now()));process.exit(2);`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, path], { timeout: 10000, killSignal: 'SIGKILL' });
    const exited = once(child, 'exit'), lines = createInterface({ input: child.stdout }); let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    try {
      const [line] = await Promise.race([once(lines, 'line'), exited.then(([status, signal]) => { throw Error(`Child exited before its committed cursor: ${status}/${signal}: ${stderr}`); })]);
      const progress = JSON.parse(String(line)); expect(progress.state).toBe('building'); expect(progress.afterSeq).toBeGreaterThan(0);
      expect(child.kill('SIGKILL'), stderr).toBe(true);
      const [, signal] = await exited; expect(signal, stderr).toBe('SIGKILL');
      const resumed = open(path); expect(resumed.db.indexBuilds.index('Row', 'text', progress.name).afterSeq).toBe(progress.afterSeq);
      await resumed.db.indexesReady(); expect(resumed.e.query('Row').search('needle').count()).toBe(150);
    } finally {
      lines.close();
      if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
  });

  it('lets background-only work exit but keeps an explicit readiness wait alive until complete', () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); const path = db.path; db.close();
    const module = pathToFileURL(fileURLToPath(new URL('../../src/sqlite/database.ts', import.meta.url))).href;
    const prefix = `import {writeSync} from 'node:fs';const {SqliteDatabase}=await import(${JSON.stringify(module)});const db=new SqliteDatabase({path:process.argv[1],syncs:false});`;
    const background = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', prefix + `writeSync(1,'opened');`, path], { encoding: 'utf8', timeout: 10000 });
    expect(background.error).toBeUndefined(); expect(background.status, background.stderr).toBe(0); expect(background.stdout).toBe('opened');
    const raw = new NativeDatabase(join(path, 'data.sqlite3'), { readonly: true });
    try { expect(raw.prepare("SELECT 1 FROM index_builds WHERE state='building' LIMIT 1").get()).toBeDefined(); }
    finally { raw.close(); }
    const explicit = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', prefix + `await db.indexesReady();writeSync(1,JSON.stringify(db.indexBuilds.jobs().every(j=>j.state==='ready')));`, path], { encoding: 'utf8', timeout: 10000 });
    expect(explicit.error).toBeUndefined(); expect(explicit.status, explicit.stderr).toBe(0); expect(explicit.stdout).toBe('true');
  });

  it('invalidates stale owners when physical recovery replaces cached generations without inventing a data commit', async () => {
    const { db, e } = seed(); e.admin.setSchema({ ...indexed, types: { Row: { ...indexed.types.Row, indexes: ['title'] } } }); await db.indexesReady();
    const sequence = db.sequence, old = searchJobs(db).find(j => j.kind === 'text')!;
    const oldValue = db.indexBuilds.generation('Row', 'title');
    const raw = new NativeDatabase(join(db.path, 'data.sqlite3'));
    try { raw.exec(`DROP TABLE ${searchTable(old)}`); raw.prepare("DELETE FROM index_builds WHERE kind='value' AND name='title'").run(); } finally { raw.close(); }
    const repaired = open(db.path); await repaired.db.indexesReady();
    expect(repaired.db.sequence).toBe(sequence);
    expect(repaired.db.indexBuilds.generation('Row', 'title')).not.toBe(oldValue);
    expect(() => e.write('Row-0').set('title', 'stale owner write')).toThrow(expect.objectContaining({ code: 'SCHEMA_CHANGED' }));
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'SCHEMA_CHANGED' });
    expect(repaired.e.getAttr('Row-0', 'title')).toBe('needle 0');
  });

  it('detects a schema change between readiness inspection and publishing a wait', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); await db.indexesReady();
    const other = open(db.path), jobs = db.indexBuilds.jobs.bind(db.indexBuilds);
    const inspect = vi.spyOn(db.indexBuilds, 'jobs').mockImplementationOnce(() => {
      const snapshot = jobs(); other.e.admin.setSchema({ ...indexed, roles: ['visible'] }); return snapshot;
    });
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'SCHEMA_CHANGED' }); inspect.mockRestore();
  });

  it('preserves partial generations on read-only reopen and refuses to wait for work that reader cannot own', async () => {
    const { db, e } = seed(); e.admin.setSchema(indexed); db.indexBuilds.step(); db.close();
    const reader = open(db.path, true);
    expect(() => reader.e.query('Row').search('needle').ids()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    await expect(reader.db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_BUILDING' });
    const writer = open(db.path); await writer.db.indexesReady();
    expect(reader.e.query('Row').search('needle').count()).toBe(150);
    await reader.db.indexesReady();
  });
});
