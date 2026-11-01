import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const schema: EngineSchema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
const indexed: EngineSchema = { ...schema, types: { Row: { required: [], indexes: ['slug'] } } };
const held: SqliteDatabase[] = [];
const paths: string[] = [];
afterEach(() => { for (const db of held.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); vi.restoreAllMocks(); });
function open(path?: string, readOnly = false): SqliteDatabase {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-index-build-')); paths.push(path); }
  const db = new SqliteDatabase({ path, readOnly, syncs: false, ...(held.some(value => value.path === path) ? {} : { schema: toElmdbSchema(schema) }) });
  held.push(db);
  return db;
}
function seed(db: SqliteDatabase, n = 150) {
  db.write({ ops: Array.from({ length: n }, (_, i) => ({ op: 'create', type: 'Row', id: `Row-${i}`, fields: { slug: `slug-${i}` } })) });
}
function finish(db: SqliteDatabase) {
  for (let i = 0; i < 10000; i++) {
    const result = db.indexBuilds.step();
    if (result === 'idle') return;
    expect(result, String(db.indexBuilds.lastError)).toBe('progress');
  }
  throw new Error('Index queue did not drain');
}
const status = (db: SqliteDatabase) => db.indexBuilds.statuses().find(index => index.field === 'slug')!;

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('yielding value-index admission', () => {
  it('admits without hydrating primary rows, falls back while partial, and reconciles intervening writes', () => {
    const db = open(); seed(db);
    const e = createEarsEngine({ database: db });
    const reads = vi.spyOn(db.values, 'read');
    e.admin.setSchema(indexed);
    expect(reads).not.toHaveBeenCalled();
    expect(status(db)).toMatchObject({ state: 'building', afterSeq: 0 });
    const ids = (slug: string) => e.query('Row').where('slug', slug).ids();
    expect(ids('slug-149')).toEqual(['Row-149']);
    expect(e.query('Row').where('slug', 'slug-149').explain()).toMatchObject({ backend: 'sqlite' });
    expect(db.indexBuilds.step()).toBe('progress');
    expect(status(db).afterSeq).toBeGreaterThan(0);
    expect(status(db).afterSeq).toBeLessThanOrEqual(db.indexBuilds.batchRows);
    expect(ids('slug-149')).toEqual(['Row-149']);
    e.transact(() => {
      e.write('Row-0').set('slug', 'changed-behind');
      e.write('Row-149').set('slug', 'changed-ahead');
      e.write('Row-1').destroy();
      e.create('Row', { id: 'Row-new', slug: 'inserted-after-admission' });
      expect(db.indexBuilds.step()).toBe('paused');
    });
    const sequence = db.sequence;
    finish(db);
    expect(db.sequence, 'derived readiness is not a logical commit').toBe(sequence);
    expect(status(db).state).toBe('ready');
    expect(ids('slug-0')).toEqual([]);
    expect(ids('slug-1')).toEqual([]);
    expect(ids('changed-behind')).toEqual(['Row-0']);
    expect(ids('changed-ahead')).toEqual(['Row-149']);
    expect(ids('inserted-after-admission')).toEqual(['Row-new']);
    const explanation = e.query('Row').where('slug', 'changed-ahead').explain();
    expect(explanation.backend).toBe('sqlite');
    if (explanation.backend === 'sqlite') expect(explanation.statements.some(statement => statement.plan.some(step => step.detail.includes('field_lookup')))).toBe(true);
  });

  it('keeps a single-type fallback page in insertion order without sorting the entire candidate set', () => {
    const db = open(); seed(db);
    const e = createEarsEngine({ database: db });
    e.admin.setSchema(indexed);
    const explained = e.query('Row').has('slug').limit(10).explain();
    expect(explained.ids).toEqual(Array.from({ length: 10 }, (_, i) => `Row-${i}`));
    expect(explained.backend).toBe('sqlite');
    if (explained.backend === 'sqlite') expect(explained.statements.flatMap(statement => statement.plan)
      .filter(step => step.detail.includes('TEMP B-TREE FOR ORDER BY'))).toEqual([]);
  });

  it('rolls back schema admission if preparing the generation cache fails before commit', () => {
    const db = open(); seed(db);
    const before = db.schema, sequence = db.sequence;
    vi.spyOn(db.indexBuilds, 'readState').mockImplementationOnce(() => { throw new Error('injected catalog read failure'); });
    expect(() => db.setSchema(toElmdbSchema(indexed))).toThrow('injected catalog read failure');
    expect(db.schema).toEqual(before);
    expect(db.sequence).toBe(sequence);
    expect(db.indexBuilds.generation('Row', 'slug')).toBeUndefined();
    expect(db.indexBuilds.statuses().some(index => index.field === 'slug')).toBe(false);
    db.setSchema(toElmdbSchema(indexed)); finish(db);
    expect(createEarsEngine({ database: db }).query('Row').where('slug', 'slug-149').ids()).toEqual(['Row-149']);
  });

  it('rolls back failed batches, reports failure, and resumes the committed cursor on reopen', () => {
    const db = open(); seed(db);
    const e = createEarsEngine({ database: db }); e.admin.setSchema(indexed);
    const run = db.run.bind(db);
    let inserts = 0;
    vi.spyOn(db, 'run').mockImplementation((sql, args) => {
      if (sql.startsWith('INSERT OR IGNORE INTO field_index') && ++inserts === 3) throw new Error('injected backfill failure');
      return run(sql, args);
    });
    expect(db.indexBuilds.step()).toBe('failed');
    expect(status(db)).toMatchObject({ state: 'failed', afterSeq: 0, error: 'injected backfill failure' });
    expect(db.get('SELECT count(*) n FROM field_index WHERE field=? AND generation=?', ['slug', status(db).generation])!.n).toBe(0);
    expect(e.query('Row').where('slug', 'slug-149').ids()).toEqual(['Row-149']);
    db.close();
    const reopened = open(db.path); finish(reopened);
    expect(status(reopened).state).toBe('ready');
    expect(createEarsEngine({ database: reopened }).query('Row').where('slug', 'slug-149').ids()).toEqual(['Row-149']);
  });

  it('admits a healthy type despite an unrelated failed retained index while global readiness still refuses', async () => {
    const db = open(); seed(db);
    const e = createEarsEngine({ database: db });
    e.admin.setSchema(indexed);
    const read = vi.spyOn(db.values, 'read').mockImplementationOnce(() => { throw new Error('unrelated backfill failure'); });
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    read.mockRestore();
    expect(status(db).state).toBe('failed');
    e.admin.setSchema({ ...indexed, types: { ...indexed.types, Healthy: { required: [] } } });
    e.create('Healthy', { id: 'Healthy-1', slug: 'healthy' });
    e.admin.setSchema({ ...indexed, types: { ...indexed.types, Healthy: { required: [], indexes: ['slug'] } } });
    await expect(db.indexesReady(['Healthy'])).resolves.toBeUndefined();
    expect(db.indexBuilds.statuses().find(index => index.type === 'Healthy' && index.field === 'slug')?.state).toBe('ready');
    expect(e.query('Healthy').where('slug', 'healthy').ids()).toEqual(['Healthy-1']);
    await expect(db.indexesReady(['Row'])).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    expect(status(db).state).toBe('failed');
  });

  it('rejects scoped readiness when its admitted generation is retired instead of accepting its replacement', async () => {
    const db = open(); seed(db);
    const e = createEarsEngine({ database: db }); e.admin.setSchema(indexed);
    const waiting = expect(db.indexesReady(['Row'])).rejects.toMatchObject({ code: 'CANCELLED' });
    e.admin.setSchema(schema);
    e.admin.setSchema(indexed);
    await waiting;
    await expect(db.indexesReady(['Row'])).resolves.toBeUndefined();
    expect(status(db).state).toBe('ready');
  });

  it('keeps closed and open-unit refusals even for an empty readiness scope', async () => {
    const db = open();
    const unit = db.begin();
    await expect(db.indexesReady([])).rejects.toMatchObject({ code: 'UNIT_OPEN' });
    unit.abort();
    db.close();
    await expect(db.indexesReady([])).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('stops the owner when rollback fails instead of repeatedly scheduling an uncertain transaction', () => {
    const db = open(); seed(db); createEarsEngine({ database: db }).admin.setSchema(indexed);
    const run = db.run.bind(db), exec = db.sql.exec.bind(db.sql);
    vi.spyOn(db, 'run').mockImplementation((sql, args) => {
      if (sql.startsWith('INSERT OR IGNORE INTO field_index')) throw new Error('injected write failure');
      return run(sql, args);
    });
    vi.spyOn(db.sql, 'exec').mockImplementation(sql => {
      if (sql === 'ROLLBACK') throw new Error('injected rollback failure');
      return exec(sql);
    });
    expect(db.indexBuilds.step()).toBe('failed');
    expect(db.indexBuilds.lastError).toBeInstanceOf(AggregateError);
    expect((db.indexBuilds.lastError as AggregateError).errors.map(error => (error as Error).message))
      .toEqual(['injected write failure', 'injected rollback failure']);
    expect(db.indexBuilds.step()).toBe('paused');
    exec('ROLLBACK');
  });

  it('cancels removed generations and collects them without deleting a replacement generation', () => {
    const db = open(); seed(db);
    const e = createEarsEngine({ database: db }); e.admin.setSchema(indexed);
    db.indexBuilds.step();
    const previous = status(db).generation;
    e.admin.setSchema(schema);
    expect(db.isIndexed('Row', 'slug')).toBe(false);
    e.admin.setSchema(indexed);
    expect(status(db).generation).toBeGreaterThan(previous);
    finish(db);
    expect(db.get('SELECT count(*) n FROM field_index WHERE field=? AND generation=?', ['slug', previous])!.n).toBe(0);
    expect(e.query('Row').where('slug', 'slug-149').ids()).toEqual(['Row-149']);
  });

  it('uses authoritative reads on a read-only reopen and never lets a stale builder fail a newer generation', () => {
    const db = open(); seed(db);
    const stale = open(db.path);
    createEarsEngine({ database: db }).admin.setSchema(indexed);
    expect(stale.indexBuilds.step()).toBe('failed');
    expect(stale.indexBuilds.lastError).toMatchObject({ code: 'SCHEMA_CHANGED' });
    expect(status(db).state).toBe('building');
    db.indexBuilds.step(); db.close(); stale.close();
    const reader = open(db.path, true);
    expect(reader.indexBuilds.step()).toBe('paused');
    expect(createEarsEngine({ database: reader }).query('Row').where('slug', 'slug-149').ids()).toEqual(['Row-149']);
    reader.close();
    const resumed = open(db.path); finish(resumed);
    expect(status(resumed).state).toBe('ready');
  });

  it('resumes a committed batch cursor after a real killed process', () => {
    const db = open(); seed(db); createEarsEngine({ database: db }).admin.setSchema(indexed); db.close();
    const module = new URL('../../src/sqlite/database.ts', import.meta.url).href;
    const code = `import {writeSync} from 'node:fs';process.on('exit',()=>writeSync(1,'CLEAN_EXIT'));const {SqliteDatabase}=await import(${JSON.stringify(module)});const db=new SqliteDatabase({path:process.argv[1],syncs:false});db.indexBuilds.step();writeSync(1,JSON.stringify(db.indexBuilds.statuses().find(x=>x.field==='slug')));process.kill(process.pid,'SIGKILL');writeSync(1,'KILL_RETURNED');`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, db.path], { encoding: 'utf8', timeout: 10000 });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.stdout).not.toContain('CLEAN_EXIT');
    expect(child.stdout).not.toContain('KILL_RETURNED');
    // Windows reports TerminateProcess through an exit status rather than a POSIX signal.
    if (process.platform === 'win32' && child.signal === null) expect(child.status).toBeGreaterThan(0);
    else expect(child.signal, child.stderr).toBe('SIGKILL');
    const cursor = JSON.parse(child.stdout);
    expect(cursor.afterSeq).toBeGreaterThan(0);
    expect(cursor.afterSeq).toBeLessThanOrEqual(32);
    const resumed = open(db.path);
    expect(status(resumed).afterSeq).toBe(cursor.afterSeq);
    finish(resumed);
    expect(createEarsEngine({ database: resumed }).query('Row').where('slug', 'slug-149').ids()).toEqual(['Row-149']);
  });

  it('refuses competing foreground writers promptly and retries a busy backfill without failing its job', () => {
    const db = open(); seed(db); createEarsEngine({ database: db }).admin.setSchema(indexed);
    const other = open(db.path);
    other.sql.exec('BEGIN IMMEDIATE');
    try {
      expect(db.indexBuilds.step()).toBe('busy');
      const start = performance.now();
      expect(() => db.write({ ops: [{ op: 'create', type: 'Row', id: 'Row-refused', fields: {} }] })).toThrow(expect.objectContaining({ code: 'SQLITE_BUSY' }));
      expect(performance.now() - start).toBeLessThan(250);
      expect(status(db).state).toBe('building');
    } finally { other.sql.exec('ROLLBACK'); }
    finish(db);
    expect(status(db).state).toBe('ready');
  });
});
