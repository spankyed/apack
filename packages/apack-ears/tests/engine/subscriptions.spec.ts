// Live queries: a subscription is called with its read's result now and after each commit that changes it, and a
// commit publishes what it changed. The harness (tests/harness/model-based.spec.ts) holds the exactness of it over
// random workloads; these are the cases by name.
import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '../../src/index.ts';
import { engine, type Id } from './helpers.ts';

/** A subscription's calls */
function watch<T>(e: ReturnType<typeof engine>, read: () => T) {
  const calls: T[] = [];
  const stop = e.subscribe(read, (value) => { calls.push(value); });
  return { calls, stop };
}

describe('subscribe', () => {
  it('is called with the result now, and again when a commit changes it', () => {
    const e = engine();
    const a = e.create('Task', { title: 'first' }).id();
    const titles = watch(e, () => e.query('Task').pick(['title']).map((row) => row.title));
    expect(titles.calls).toEqual([['first']]);
    e.create('Task', { title: 'second' });
    e.write(a).set('title', 'renamed');
    expect(titles.calls).toEqual([['first'], ['first', 'second'], ['renamed', 'second']]);
  });

  it('is not called for a commit that leaves its result the same, or writes nothing it read', () => {
    const e = engine();
    const a = e.create('Task', { title: 'kept', status: 'open' }).id();
    const p = e.create('Project', { title: 'elsewhere' }).id();
    const title = watch(e, () => e.getAttr(a, 'title'));
    e.write(a).set('title', 'kept');
    e.write(a).set('status', 'done');
    e.write(p).set('title', 'moved');
    expect(title.calls).toEqual(['kept']);
  });

  it('is called once for a unit, after it commits, and never for one that rolls back', () => {
    const e = engine();
    const count = watch(e, () => e.query('Task').count());
    e.transact(() => {
      e.create('Task');
      e.create('Task');
      expect(count.calls, 'nothing before the unit commits').toEqual([0]);
    });
    expect(() => e.transact(() => {
      e.create('Task');
      throw new Error('stop');
    })).toThrow('stop');
    expect(count.calls).toEqual([0, 2]);
  });

  it('follows the relations it walked, and an entity it read before it existed', () => {
    const e = engine();
    const p = e.create('Project').id();
    const later = 'Task-later' as Id;
    const linked = watch(e, () => e.query.ids(p).out('contains').ids());
    const missing = watch(e, () => e.getRow(later)?.title);
    const t = e.create('Task').id();
    e.write(p).link('contains', t);
    e.create('Task', { id: later, title: 'here now' });
    e.write(p).unlink('contains', t);
    expect(linked.calls).toEqual([[], [t], []]);
    expect(missing.calls).toEqual([undefined, 'here now']);
  });

  it('stops when told, and runs again when the data is replaced', () => {
    const e = engine();
    e.create('Task');
    const count = watch(e, () => e.query('Task').count());
    const stopped = watch(e, () => e.query('Task').count());
    stopped.stop();
    e.admin.clear();
    e.create('Task');
    expect(count.calls).toEqual([1, 0, 1]);
    expect(stopped.calls).toEqual([1]);
  });

  it("publishes each commit's change set: entities, types, kinds and relations", () => {
    const e = engine();
    const p = e.create('Project').id();
    const sets: ChangeSet[] = [];
    e.onCommit((changes) => { sets.push(changes); });
    const t = e.create('Task', { title: 'x' }).id();
    e.write(p).link('contains', t);
    expect(sets).toHaveLength(2);
    expect([...sets[0].entities]).toEqual([t]);
    expect([...sets[0].types]).toEqual(['Task']);
    expect(sets[0].kinds.has('title')).toBe(true);
    expect([...sets[1].relationKinds]).toEqual(['contains']);
    expect(new Set(sets[1].entities)).toEqual(new Set([p, t]));
  });
});
