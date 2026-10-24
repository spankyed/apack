// The engine's contract: what it tells its persistence sink, in order, for a sequence of writes; and hydration
// through bulk loading, which tells the sink nothing
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EARS, OUT_OF_LINE_BYTES, type PersistenceSink } from '../../src/index.ts';
import { engine, recordingSink, writesOf, type Id, type RelId } from './helpers.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('persistence sink', () => {
  it('receives each write, in order, with its payload: a created entity with its type, and the relations a destroy removes before the entity', () => {
    const { sink, calls } = recordingSink();
    const e = engine(sink);
    const a = e.create('Task').set('title', 'A').append('tag', 'x').append('tag', 'y').id();
    const b = e.create('Project').setMany({ title: 'P' }).id();
    e.write(a).merge('meta', { k: 1 }).removeAt('tag', 0).removeValue('tag', 'y').grant('lead');
    e.write(b).link('contains', a, { info: { order: 1 } });
    const rel = e.findRelations()[0].id;
    e.updateRelation(rel, { info: { order: 2 } });
    e.write(b).link('contains', a, { replace: true });
    e.write(a).set('title', 'B').delete('gone');
    e.write(a).destroy();

    expect(writesOf(calls)).toEqual([
      ['onCreateEntity', '#1', 'Task'],
      ['onPutAttr', 'createdAt', '#1', 1000],
      ['onPutAttr', 'updatedAt', '#1', 1000],
      ['onPutAttr', 'title', '#1', 'A'],
      ['onPutAttr', 'tag', '#1', ['x']],
      ['onPutAttr', 'tag', '#1', ['x', 'y']],
      ['onCreateEntity', '#2', 'Project'],
      ['onPutAttr', 'createdAt', '#2', 1000],
      ['onPutAttr', 'updatedAt', '#2', 1000],
      ['onPutAttr', 'title', '#2', 'P'],
      // A write's first attribute change stamps updatedAt, once for the builder
      ['onPutAttr', 'meta', '#1', { k: 1 }],
      ['onPutAttr', 'updatedAt', '#1', 1000],
      ['onPutAttr', 'tag', '#1', ['y']],
      ['onPutAttr', 'tag', '#1', []],
      ['onPutAttr', 'role', '#1', ['lead']],
      ['onAddRelation', '#3', 'contains', '#2', '#1', { order: 1 }],
      ['onUpdateRelation', '#3', { info: { order: 2 } }],
      ['onRemoveRelation', '#3'],
      ['onAddRelation', '#4', 'contains', '#2', '#1', undefined],
      ['onPutAttr', 'title', '#1', 'B'],
      ['onPutAttr', 'updatedAt', '#1', 1000],
      ['onRemoveRelation', '#4'],
      ['onDestroyEntity', '#1'],
    ]);
  });

  it('receives a moved relation\'s new ends, and the direct attribute and relation writes', () => {
    const { sink, calls } = recordingSink();
    const e = engine(sink);
    const [a, b, c] = ['Task', 'Task', 'Task'].map((type) => e.create(type).id());
    const rel = e.admin.addRelation(a, 'refs', b);
    e.admin.updateRelation(rel, { target: c, info: 'why' });
    e.admin.updateRelation('Relation-none' as RelId, { source: a });
    e.admin.putAttr(a, 'x', 1);
    e.admin.putAttr(a, 'x', [1, 2]);
    e.admin.deleteAttr(a, 'x');
    e.admin.deleteAttr(a, 'x');
    // Each create: the entity with its type, then its createdAt and updatedAt; `entityType` is the id's, never stored
    expect(writesOf(calls).slice(0, 3)).toEqual([
      ['onCreateEntity', '#1', 'Task'],
      ['onPutAttr', 'createdAt', '#1', 1000],
      ['onPutAttr', 'updatedAt', '#1', 1000],
    ]);
    // A relation's details reach the sink as its row (onAddRelation, onUpdateRelation), never as an attribute; the
    // admin's direct writes stamp nothing
    expect(writesOf(calls).slice(9)).toEqual([
      ['onAddRelation', '#4', 'refs', '#1', '#2', undefined],
      ['onUpdateRelation', '#4', { target: '#3', info: 'why' }],
      ['onPutAttr', 'x', '#1', 1],
      ['onPutAttr', 'x', '#1', [1, 2]],
      // Removing what isn't there tells the sink nothing
      ['onDropAttr', 'x', '#1'],
    ]);
    expect(e.query.ids(a).out('refs').ids()).toEqual([c]);
  });
});

it('hears a destroyed relation as that relation removed, not as an entity destroyed', () => {
  const { sink, calls } = recordingSink();
  const e = engine(sink);
  const [a, b] = ['Task', 'Task'].map((type) => e.create(type).id());
  e.write(a).link('refs', b);
  const before = calls.length;
  e.removeRelation(e.findRelations()[0].id);
  expect(writesOf(calls.slice(before))).toEqual([['onRemoveRelation', '#3']]);
});

it('receives every write in a unit: a create, or one builder call, is one, its writes stored together or not at all', () => {
  const { sink, calls } = recordingSink();
  const e = engine(sink);
  const a = e.create('Task', { title: 'A' }).set('tag', 'x').id();
  e.write(a).setMany({ title: 'B', tag: 'y' });
  e.admin.putAttr(a, 'x', 1);
  expect(calls.map(([method]) => method)).toEqual([
    'onUnitStart', 'onCreateEntity', 'onPutAttr', 'onPutAttr', 'onPutAttr', 'onUnitEnd',
    'onUnitStart', 'onPutAttr', 'onUnitEnd',
    'onUnitStart', 'onPutAttr', 'onPutAttr', 'onPutAttr', 'onUnitEnd',
    // The admin face's direct writes are units too
    'onUnitStart', 'onPutAttr', 'onUnitEnd',
  ]);
});

it('undoes in memory a unit the sink refuses, and throws its refusal', () => {
  const { sink } = recordingSink();
  const refusing = { now: false };
  const e = engine({ ...sink, onUnitEnd: () => { if (refusing.now) throw new Error('disk full'); } });
  const [a, b] = [e.create('Task', { title: 'before' }).id(), e.create('Task', { title: 'other' }).id()];
  refusing.now = true;
  // A create leaves nothing behind
  expect(() => e.create('Task', { title: 'new' })).toThrow('disk full');
  expect(e.admin.getAllEntities()).toEqual([a, b]);
  // A write to what exists goes back to what was there, each builder call whole
  expect(() => e.write(a).set('title', 'after')).toThrow('disk full');
  expect(e.getRow(a)).toMatchObject({ title: 'before' });
  expect(() => e.write(a).link('refs', b)).toThrow('disk full');
  expect(e.findRelations()).toEqual([]);
  expect(() => e.write(b).destroy()).toThrow('disk full');
  expect(e.getRow(b)).toMatchObject({ title: 'other' });
});

describe('large values out of memory', () => {
  /**
   * A sink that stores what it is given and can read it back, as the LMDB store does: a unit's writes are stored when it
   * ends, or none of them when it is refused (`refuse`)
   */
  function storingSink() {
    const stored = new Map<string, unknown>();
    const reads: string[] = [];
    const state = { refusing: false };
    let pending: Array<() => void> = [];
    const sink: PersistenceSink = {
      ...recordingSink().sink,
      onUnitStart: () => { pending = []; },
      onUnitEnd: () => {
        const unit = pending;
        pending = [];
        if (state.refusing) throw new Error('disk full');
        for (const write of unit) write();
      },
      onPutAttr: (kind, id, value) => { pending.push(() => stored.set(`${kind}|${id}`, structuredClone(value))); },
      onDropAttr: (kind, id) => { pending.push(() => stored.delete(`${kind}|${id}`)); },
      readAttr: (kind, id) => { reads.push(`${kind}|${id}`); return stored.get(`${kind}|${id}`); },
    };
    return { sink, stored, reads, state };
  }
  const big = (n: number) => `${n}`.repeat(OUT_OF_LINE_BYTES + 1);

  it('reads a committed large value back from the store once the cache has dropped it, and a small one never', () => {
    const { sink, reads } = storingSink();
    const e = engine(sink);
    const a = e.create('Task', { title: big(1), small: 'kept' }).id();
    // Enough large values to push the first out of the cache
    for (let i = 0; i < 20; i++) e.create('Task', { title: 'x'.repeat(1024 * 1024) });
    expect(e.getRow(a)).toMatchObject({ title: big(1), small: 'kept' });
    expect(reads).toEqual([`title|${a}`]);
    expect(Object.isFrozen(e.getAttr(a, 'title'))).toBe(true);
  });

  it('reports what memory holds per type, what it keeps out of it, and the reads the cache answered', () => {
    const { sink } = storingSink();
    const e = engine(sink);
    const a = e.create('Task', { title: big(1), small: 'kept' }).id();
    e.create('Task', { small: 'only' });
    const held = e.admin.memoryStats();
    expect(held.outOfLine).toEqual({ values: 1, bytes: big(1).length });
    // Its two entities, their attributes (the engine's times included), and the large title counted as its marker
    expect(held.types.Task).toMatchObject({ entities: 2, attributes: 7 });
    expect(held.types.Task.bytes).toBeLessThan(OUT_OF_LINE_BYTES);
    expect(held.cache).toMatchObject({ values: 1, bytes: big(1).length, hits: 0, misses: 0 });

    e.getAttr(a, 'title');
    for (let i = 0; i < 20; i++) e.create('Task', { title: 'x'.repeat(1024 * 1024) });
    e.getAttr(a, 'title');
    expect(e.admin.memoryStats().cache).toMatchObject({ hits: 1, misses: 1 });
  });

  it('keeps every value in memory when the sink cannot read one back', () => {
    const e = engine(recordingSink().sink);
    const a = e.create('Task', { title: big(1) }).id();
    for (let i = 0; i < 20; i++) e.create('Task', { title: 'x'.repeat(1024 * 1024) });
    expect(e.getAttr(a, 'title')).toBe(big(1));
  });

  it('reads a unit\'s own large write from memory, and puts back what the store holds when the store refuses it', () => {
    const { sink, reads, state } = storingSink();
    const e = engine(sink);
    const a = e.create('Task', { title: big(1) }).id();
    e.transact(() => {
      e.write(a).set('title', big(2));
      // More large writes than the cache holds: the first is still the unit's own until it commits
      for (let i = 0; i < 20; i++) e.create('Task', { title: 'x'.repeat(1024 * 1024) });
      expect(e.getAttr(a, 'title')).toBe(big(2));
    });
    expect(reads).not.toContain(`title|${a}`);
    state.refusing = true;
    expect(() => e.write(a).set('title', big(3))).toThrow('disk full');
    expect(e.getAttr(a, 'title')).toBe(big(2));
  });
});

describe('hydration', () => {
  it('bulk loads attributes and relations without telling the sink, then answers queries', () => {
    const { sink, calls } = recordingSink();
    const e = engine(sink);
    const [a, b, p] = ['Task-a1', 'Task-b1', 'Project-p1'] as Id[];
    const rel = 'Relation-r1' as RelId;
    e.admin.bulkLoadAttr(a, 'title', 'A');
    e.admin.bulkLoadAttr(a, 'tag', ['first', 'second']);
    e.admin.bulkLoadAttr(a, 'meta', { x: 1, y: 2 });
    e.admin.bulkLoadAttr(b, 'title', 'B');
    e.admin.bulkLoadAttr(p, 'title', 'P');
    e.admin.bulkLoadAttr(p, EARS.AttrKind.Role, ['current']);
    e.admin.bulkLoadRelation(rel, 'contains', p, a, { order: 1 });
    e.admin.bulkLoadRelation(rel, 'contains', p, a, { order: 1 });

    expect(calls).toEqual([]);
    expect(e.admin.getAllEntities()).toEqual([a, b, p]);
    expect(e.query.ids(a).pickOne()).toEqual({ id: a, entityType: 'Task', title: 'A', tag: ['first', 'second'], meta: { x: 1, y: 2 } });
    expect(e.query('Task').orderBy('title', 'desc').pick(['title'])).toEqual([{ id: b, title: 'B' }, { id: a, title: 'A' }]);
    expect(e.query.all().withRole('current').ids()).toEqual([p]);
    expect(e.query.ids(p).out('contains').ids()).toEqual([a]);
    expect(e.findRelations({ target: a })).toEqual([{ id: rel, source: p, target: a, kind: 'contains', info: { order: 1 } }]);

    // Writes after hydration reach the sink
    e.write(b).link('contains', a);
    expect(writesOf(calls).map(([method]) => method)).toEqual(['onAddRelation']);

    e.admin.clear();
    expect(e.admin.getAllEntities()).toEqual([]);
    expect(Object.keys(e.getSchemaStats().attributes)).toEqual([]);
    expect(e.findRelations()).toEqual([]);
    expect(writesOf(calls)).toHaveLength(1);
  });
});
