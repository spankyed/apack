import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { openEnvAt, closeEnv, makeLmdbAdapter, LmdbReader, type LmdbDbs } from '../../src/lmdb/index.ts';
import { OUT_OF_LINE_BYTES } from '../../src/index.ts';

function tmpDir(label: string) {
  return path.join(os.tmpdir(), `vitest-persistence-${label}-${crypto.randomBytes(4).toString('hex')}`);
}

// ---------------------------------------------------------------------------
// A. LMDB Adapter
// ---------------------------------------------------------------------------
describe('LMDB Adapter', () => {
  let dbs: LmdbDbs;
  let dir: string;

  beforeAll(() => {
    dir = tmpDir('adapter');
    dbs = openEnvAt(dir);
  });

  afterAll(() => {
    try { closeEnv(dbs); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('commits a write made outside a unit when the call returns, and a unit when it ends', () => {
    const commits: number[] = [];
    const adapter = makeLmdbAdapter(dbs, () => commits.push(commits.length));
    adapter.onCreateEntity('Entity-now', 'TestType');
    expect(dbs.rows.get('Entity-now')).toEqual({ type: 'TestType', fields: [], outOfLine: [] });
    adapter.onUnitStart();
    adapter.onCreateEntity('Entity-unit', 'TestType');
    adapter.onPutAttr('attr1', 'Entity-unit', ['v1', 'v2']);
    expect(dbs.rows.get('Entity-unit'), 'not before the unit ends').toBeUndefined();
    adapter.onUnitEnd();
    expect(dbs.rows.get('Entity-unit')).toEqual({ type: 'TestType', fields: [['attr1', ['v1', 'v2']]], outOfLine: [] });
    // One commit each: the call on its own, and the unit
    expect(commits).toHaveLength(2);
  });

  it("hard-deletes an entity's row and its attributes of every kind, and nothing of another entity", () => {
    const adapter = makeLmdbAdapter(dbs);
    for (const id of ['Task-1', 'Task-10', 'Note-1']) {
      adapter.onCreateEntity(id, id.split('-')[0]);
      adapter.onPutAttr('title', id, [`${id} title`]);
      adapter.onPutAttr('tags', id, ['a', 'b']);
    }
    adapter.onPutAttr('zeta', 'Task-1', 'z'.repeat(OUT_OF_LINE_BYTES + 1));
    adapter.onPutAttr('zeta', 'Task-10', 'z'.repeat(OUT_OF_LINE_BYTES + 1));
    adapter.onDestroyEntity('Task-1');

    const kindsOf = (id: string) => dbs.rows.get(id)?.fields.map(([kind]) => kind);
    expect(dbs.rows.get('Task-1')).toBeUndefined();
    expect(dbs.values.get('zeta\x1FTask-1'), 'its value kept out of line').toBeUndefined();
    expect(kindsOf('Task-10')).toEqual(['title', 'tags']);
    expect(dbs.values.get('zeta\x1FTask-10')).toHaveLength(OUT_OF_LINE_BYTES + 1);
    expect(kindsOf('Note-1')).toHaveLength(2);
  });

  it("gives an entity a typed record when it is created, an attribute alone a record of no type, and a relation none", () => {
    const adapter = makeLmdbAdapter(dbs);
    adapter.onCreateEntity('Task-typed', 'Task');
    adapter.onPutAttr('title', 'Task-attr-only', 'no entity');
    adapter.onAddRelation('Relation-rows', 'refs', 'Task-src-end', 'Task-tgt-end', undefined);

    expect(dbs.rows.get('Task-typed')).toEqual({ type: 'Task', fields: [], outOfLine: [] });
    expect(dbs.rows.get('Task-attr-only')).toEqual({ type: null, fields: [['title', 'no entity']], outOfLine: [] });
    for (const id of ['Task-src-end', 'Task-tgt-end', 'Relation-rows']) expect(dbs.rows.get(id), id).toBeUndefined();
  });

  it('keeps a large value in `values`, its size in the record, and moves it back into the record when it shrinks', () => {
    const adapter = makeLmdbAdapter(dbs);
    const large = Array.from({ length: OUT_OF_LINE_BYTES }, (_, i) => i);
    adapter.onCreateEntity('Task-large', 'Task');
    adapter.onPutAttr('body', 'Task-large', large);
    expect(dbs.rows.get('Task-large')).toEqual({ type: 'Task', fields: [], outOfLine: [['body', JSON.stringify(large).length, large.length]] });
    expect(dbs.values.get('body\x1FTask-large')).toEqual(large);
    expect(adapter.readAttr('body', 'Task-large')).toEqual(large);

    adapter.onPutAttr('body', 'Task-large', 'short');
    expect(dbs.rows.get('Task-large')).toEqual({ type: 'Task', fields: [['body', 'short']], outOfLine: [] });
    expect(dbs.values.get('body\x1FTask-large')).toBeUndefined();
    expect(adapter.readAttr('body', 'Task-large')).toBe('short');
  });

  /**
   * An lmdb range is a live cursor holding a read transaction, and an environment has 126 reader slots.
   * A read that stops early must release its cursor: one that reads the first entry with
   * `it[Symbol.iterator]().next()` never does, so every call that finds a row leaks a slot. The 127th throws `MDB_READERS_FULL`, and from
   * then on every read fails with "No transaction to renew" and every write with EINVAL — for the life of
   * the process.
   *
   * 200 is deliberately past 126: at 126 this passes whatever the implementation does.
   */
  it('does not leak a reader slot per call, however many times it is asked', async () => {
    const adapter = makeLmdbAdapter(dbs);
    adapter.onCreateEntity('Doc-readers', 'Doc');
    adapter.onPutAttr('tags', 'Doc-readers', ['a', 'b', 'c']);

    const query = new LmdbReader(dbs);
    for (let i = 0; i < 200; i++) {
      expect([...query.entitiesHavingAttr('tags', 1)], `call ${i}`).toEqual(['Doc-readers']);
      // A write transaction between reads, as the app does: it is what makes a leaked slot unrecoverable
      dbs.root.transactionSync(() => { dbs.values.put('Doc-readers-probe', { v: i }); });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  it('refuses a forbidden \\x1F separator in a key, storing nothing', () => {
    const adapter = makeLmdbAdapter(dbs);
    expect(() => adapter.onPutAttr('bad\x1Fkey', 'Entity-1', ['v'])).toThrow('forbidden separator');
  });

  it.each([
    { src: 'undefined', tgt: 'Document-1', label: '"undefined" as src' },
    { src: 'Document-1', tgt: 'undefined', label: '"undefined" as tgt' },
    { src: 'null', tgt: 'Document-1', label: '"null" as src' },
    { src: 'Document-1', tgt: 'null', label: '"null" as tgt' },
    { src: '', tgt: 'Document-1', label: 'empty src' },
    { src: 'Document-1', tgt: '', label: 'empty tgt' },
    { src: 'nohyphen', tgt: 'Document-1', label: 'no-hyphen src' },
    { src: 'Document-1', tgt: 'nohyphen', label: 'no-hyphen tgt' },
  ])('refuses a relation whose end is no entity id, storing nothing: $label', ({ src, tgt }) => {
    const adapter = makeLmdbAdapter(dbs);
    expect(() => adapter.onAddRelation('Relation-bad', 'TEST', src, tgt, null)).toThrow('is not an entity id');
    expect(dbs.relationRows.get('Relation-bad')).toBeUndefined();
  });

  it('stores every update made to a stored relation, each on the one before, in one unit or not', () => {
    const adapter = makeLmdbAdapter(dbs);
    adapter.onAddRelation('Relation-moved', 'TEST', 'Doc-a', 'Doc-b', null);
    adapter.onUnitStart();
    adapter.onUpdateRelation('Relation-moved', { target: 'Doc-c' });
    adapter.onUpdateRelation('Relation-moved', { info: { x: 1 } });
    adapter.onUnitEnd();
    expect(dbs.relationRows.get('Relation-moved')).toMatchObject({ source: 'Doc-a', target: 'Doc-c', info: { x: 1 } });
    // A relation added and updated in one unit: the update reads the add
    adapter.onUnitStart();
    adapter.onAddRelation('Relation-fresh', 'TEST', 'Doc-a', 'Doc-b', null);
    adapter.onUpdateRelation('Relation-fresh', { info: 'later' });
    adapter.onUnitEnd();
    expect(dbs.relationRows.get('Relation-fresh')).toMatchObject({ info: 'later' });
  });

  it('refuses an update to a relation that is not there, and the unit it is in stores nothing', () => {
    const adapter = makeLmdbAdapter(dbs);
    expect(() => adapter.onUpdateRelation('Relation-nonexistent', { info: 'test' })).toThrow('no relation has the id');
    adapter.onUnitStart();
    adapter.onCreateEntity('Document-with-a-bad-update', 'Document');
    adapter.onUpdateRelation('Relation-nonexistent', { info: 'test' });
    expect(() => adapter.onUnitEnd()).toThrow('no relation has the id');
    expect(dbs.rows.get('Document-with-a-bad-update')).toBeUndefined();
  });

  it.each([
    { patch: { source: 'undefined' }, label: 'source="undefined"' },
    { patch: { target: 'undefined' }, label: 'target="undefined"' },
    { patch: { source: 'null' }, label: 'source="null"' },
    { patch: { target: 'null' }, label: 'target="null"' },
    { patch: { source: 'nohyphen' }, label: 'source without hyphen' },
    { patch: { target: 'nohyphen' }, label: 'target without hyphen' },
  ])('refuses moving a relation to an end that is no entity id: $label', ({ patch }) => {
    const adapter = makeLmdbAdapter(dbs);
    adapter.onAddRelation('Relation-valid', 'TEST', 'Doc-1', 'Doc-2', null);
    expect(() => adapter.onUpdateRelation('Relation-valid', patch)).toThrow('is not an entity id');
    expect(dbs.relationRows.get('Relation-valid')).toMatchObject({ source: 'Doc-1', target: 'Doc-2' });
  });
});

describe('LMDB Adapter, a unit', () => {
  /** A real environment where writing `poisoned`'s row fails */
  function guardedEnv(label: string, poisoned: string) {
    const dir = tmpDir(label);
    const live = openEnvAt(dir);
    const guarded = {
      ...live,
      rows: Object.assign(Object.create(Object.getPrototypeOf(live.rows)), live.rows, {
        put: (key: string, value: unknown) => {
          if (key === poisoned) throw new Error('refused');
          return (live.rows as any).put(key, value);
        },
      }),
    } as unknown as LmdbDbs;
    const done = () => {
      try { closeEnv(live); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    };
    return { live, guarded, done };
  }

  it('is stored whole or not at all: one row refusing throws, and the unit stores none of its rows', () => {
    const { live, guarded, done } = guardedEnv('unit-whole', 'Document-poison');
    const adapter = makeLmdbAdapter(guarded);

    adapter.onCreateEntity('Document-before', 'Document');
    adapter.onUnitStart();
    adapter.onCreateEntity('Document-ok', 'Document');
    adapter.onCreateEntity('Document-poison', 'Document');
    expect(() => adapter.onUnitEnd()).toThrow('refused');

    expect(live.rows.get('Document-before'), 'its own unit, before').toBeTruthy();
    expect(live.rows.get('Document-ok'), 'part of the unit that was refused').toBeUndefined();
    // The next unit starts clean: nothing of the refused one is left to commit with it
    adapter.onUnitStart();
    adapter.onCreateEntity('Document-after', 'Document');
    adapter.onUnitEnd();
    expect(live.rows.get('Document-after')).toBeTruthy();
    expect(live.rows.get('Document-ok')).toBeUndefined();
    done();
  });

  it('runs a unit in the order its writes were made: a destroy, then the id created again', () => {
    const { live, guarded, done } = guardedEnv('unit-order', 'none');
    const adapter = makeLmdbAdapter(guarded);
    adapter.onCreateEntity('Document-1', 'Document');
    adapter.onPutAttr('title', 'Document-1', 'first');

    adapter.onUnitStart();
    adapter.onDestroyEntity('Document-1');
    expect(live.rows.get('Document-1'), 'still there inside the unit').toBeTruthy();
    adapter.onCreateEntity('Document-1', 'Document');
    adapter.onPutAttr('title', 'Document-1', 'second');
    adapter.onUnitEnd();
    expect(live.rows.get('Document-1')).toEqual({ type: 'Document', fields: [['title', 'second']], outOfLine: [] });
    done();
  });

  it('throws when the environment refuses a write, as a full disk would, and stores nothing', () => {
    const fail = () => { throw new Error('disk full'); };
    const db = { transactionSync: fail, put: fail, remove: fail, get: () => undefined, doesExist: () => false, getKeys: () => [], getRange: () => [] };
    const adapter = makeLmdbAdapter({ rows: db, values: db, relationRows: db, root: db } as unknown as LmdbDbs);
    expect(() => adapter.onDestroyEntity('Document-1')).toThrow('disk full');
    adapter.onUnitStart();
    adapter.onCreateEntity('Document-1', 'Document');
    expect(() => adapter.onUnitEnd()).toThrow('disk full');
  });
});

// ---------------------------------------------------------------------------
// C. Query Layer
// ---------------------------------------------------------------------------
describe('Query Layer', () => {
  let dbs: LmdbDbs;
  let dir: string;
  let query: LmdbReader;

  beforeAll(() => {
    dir = tmpDir('query');
    dbs = openEnvAt(dir);
    const adapter = makeLmdbAdapter(dbs);

    adapter.onCreateEntity('Entity-123', 'TestEntity');
    adapter.onPutAttr('TestKind', 'Entity-123', ['valid1', 'valid2', 'valid3']);
    // An attribute of an id no entity was created with: no read finds it
    adapter.onPutAttr('TestKind', 'Entity-untyped', ['valid2']);

    // Date attr
    const now = new Date('2025-06-01T00:00:00.000Z');
    adapter.onCreateEntity('Entity-456', 'TestEntity');
    adapter.onPutAttr('CreatedAt', 'Entity-456', now);

    // Complex object attr
    adapter.onCreateEntity('Entity-789', 'TestEntity');
    adapter.onPutAttr('Config', 'Entity-789', { nested: { value: 42 }, arr: [1, 2, 3] });

    // Entities + relations for neighbor tests
    adapter.onCreateEntity('Doc-1', 'Document');
    adapter.onCreateEntity('Doc-2', 'Document');
    adapter.onCreateEntity('Doc-3', 'Document');
    adapter.onAddRelation('Rel-1', 'LINKS', 'Doc-1', 'Doc-2', null);
    adapter.onAddRelation('Rel-2', 'LINKS', 'Doc-1', 'Doc-3', null);

    // Pagination entities
    for (let i = 0; i < 10; i++) {
      adapter.onCreateEntity(`Page-${i}`, 'Page');
      adapter.onPutAttr('Index', `Page-${i}`, i);
    }

    adapter.close?.(); // flush
    query = new LmdbReader(dbs);
  });

  afterAll(() => {
    try { closeEnv(dbs); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getAttr reads an attribute\'s one value, a list whole', () => {
    expect(query.getAttr('Entity-123', 'TestKind')).toEqual(['valid1', 'valid2', 'valid3']);
    expect(query.getAttr('Page-4', 'Index')).toBe(4);
    expect(query.getAttr('Page-none', 'Index')).toBeUndefined();
    expect(query.getAttr('Entity-untyped', 'TestKind')).toBeUndefined();
    expect(query.getEntityMeta('Entity-untyped')).toBeNull();
    expect(query.getEntityMeta('Page-4')).toEqual({ type: 'Page' });
  });

  it('findEntitiesByAttr matches a value or an element of a list, and a predicate sees the whole value', () => {
    expect(query.findEntitiesByAttr('TestKind', { equals: 'valid2' })).toEqual(['Entity-123']);
    expect(query.findEntitiesByAttr('Index', { predicate: (value) => (value as number) > 7 })).toEqual(['Page-8', 'Page-9']);
  });

  it('findEntitiesByAttr Date equality (instance + timestamp)', () => {
    const target = new Date('2025-06-01T00:00:00.000Z');
    const byDate = query.findEntitiesByAttr('CreatedAt', {
      equals: target,
      entityType: 'TestEntity',
    });
    expect(byDate).toContain('Entity-456');

    const byTimestamp = query.findEntitiesByAttr('CreatedAt', {
      equals: target.getTime(),
      entityType: 'TestEntity',
    });
    expect(byTimestamp).toContain('Entity-456');
  });

  it('findEntitiesByAttr deep equality for complex objects', () => {
    const found = query.findEntitiesByAttr('Config', {
      equals: { nested: { value: 42 }, arr: [1, 2, 3] },
      deepEquals: true,
    });
    expect(found).toContain('Entity-789');
  });

  it('neighbors() follows relations of a kind, out and in', () => {
    expect(query.neighbors('Doc-1', { kind: 'LINKS' }).sort()).toEqual(['Doc-2', 'Doc-3']);
    expect(query.neighbors('Doc-2', { kind: 'LINKS', direction: 'in' })).toEqual(['Doc-1']);
  });

  it('entitiesHavingAttr() and relations() respect limit', () => {
    const limited = [...query.entitiesHavingAttr('Index', 3)];
    expect(limited.length).toBe(3);

    let relCount = 0;
    for (const _ of query.relations({ limit: 1 })) relCount++;
    expect(relCount).toBeLessThanOrEqual(1);
  });
});
