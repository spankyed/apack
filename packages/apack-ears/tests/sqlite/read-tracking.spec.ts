import { describe, expect, it } from 'vitest';
import { SqliteReadTracking } from '../../src/sqlite/read-tracking.ts';

describe('SQLite read dependency subscriptions', () => {
  it('matches an independent scan model through registration, removal and repeated dependencies', () => {
    const tracking = new SqliteReadTracking();
    const model = new Map<number, { keys: Set<string>; ranges: Set<string> }>();
    let seed = 0x7ab921;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let round = 0; round < 4000; round++) {
      const token = random(70), action = random(10);
      if (action < 7) {
        let read = model.get(token);
        if (!read) model.set(token, read = { keys: new Set(), ranges: new Set() });
        const kind = random(2) ? 'keys' : 'ranges', tag = random(20) === 0 ? 'all' : `field:${random(90)}`;
        read[kind].add(tag); tracking.add(tracking.track(token), kind, tag);
      } else if (action < 9) { model.delete(token); tracking.untrack(token); }
      else { model.clear(); tracking.clear(); }
      const changes = new Set([random(40) === 0 ? 'all' : `field:${random(90)}`, `field:${random(90)}`]);
      const expected = [...model].filter(([, read]) => [...read.keys, ...read.ranges]
        .some(tag => changes.has('all') || tag === 'all' || changes.has(tag))).map(([token]) => token);
      expect(tracking.affected(changes)).toEqual(expected);
      expect(tracking.stats()).toEqual({ owners: model.size,
        keys: [...model.values()].reduce((n, read) => n + read.keys.size, 0),
        ranges: [...model.values()].reduce((n, read) => n + read.ranges.size, 0) });
    }
  });

  it('deduplicates key/range subscriptions and rejects removed recording contexts', () => {
    const tracking = new SqliteReadTracking(), first = tracking.track(7);
    tracking.add(first, 'keys', 'same'); tracking.add(first, 'ranges', 'same');
    tracking.untrack(7);
    const replacement = tracking.track(7);
    tracking.add(first, 'keys', 'obsolete'); tracking.add(replacement, 'keys', 'current');
    expect(tracking.affected(new Set(['obsolete', 'same']))).toEqual([]);
    expect(tracking.affected(new Set(['current']))).toEqual([7]);
    expect(tracking.stats()).toEqual({ owners: 1, keys: 1, ranges: 0 });
  });

  it('finds a selective change without enumerating unrelated reader registrations', () => {
    const tracking = new SqliteReadTracking();
    for (let token = 0; token < 10000; token++) tracking.add(tracking.track(token), 'keys', `field:${token}`);
    const original = Map.prototype[Symbol.iterator];
    let affected: number[];
    try {
      Map.prototype[Symbol.iterator] = () => { throw Error('Commit scanned the reader registry'); };
      affected = tracking.affected(new Set(['field:9999']));
    } finally { Map.prototype[Symbol.iterator] = original; }
    expect(affected!).toEqual([9999]);
  });

  it('retains global invalidation and ignores empty reader registrations', () => {
    const tracking = new SqliteReadTracking();
    tracking.track(1); tracking.add(tracking.track(2), 'ranges', 'all');
    tracking.add(tracking.track(3), 'keys', 'x');
    expect(tracking.affected(new Set())).toEqual([2]);
    expect(tracking.affected(new Set(['x']))).toEqual([2, 3]);
    expect(tracking.affected(new Set(['all']))).toEqual([2, 3]);
  });
});
