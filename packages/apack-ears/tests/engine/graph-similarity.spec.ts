import { expect, it } from 'vitest';
import { freshEngine } from './engine-under-test.ts';

it('matches independent neighbour-set similarity across directions, scopes, kinds and restricted candidates', () => {
  let state = 7391;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let trial = 0; trial < 24; trial++) {
    const e = freshEngine({ types: ['Node', 'Other'], relationKinds: ['refs', 'extra'], roles: [] });
    const ids = Array.from({ length: 9 }, (_, at) => e.create(at < 7 ? 'Node' : 'Other').id());
    const edges: Array<[number, number, string]> = [], trashed = new Set<number>();
    e.transact(() => {
      for (let a = 0; a < ids.length; a++) {
        if (random() < .25) { trashed.add(a); e.write(ids[a]!).trash(); }
        for (let b = 0; b < ids.length; b++) if (a !== b)
          for (const kind of ['refs', 'extra']) if (random() < .2) {
            edges.push([a, b, kind]); e.write(ids[a]!).link(kind, ids[b]!);
          }
      }
    });
    const input = [5, 2, 1, 4, 3, 6], to = 0, kinds = ['refs', 'refs', 'extra'];
    for (const scope of ['live', 'trashed', 'withTrashed'] as const) {
      const alive = (at: number) => scope !== 'live' || !trashed.has(at);
      const admitted = (at: number) => scope === 'trashed' ? trashed.has(at) : alive(at);
      const query = scope === 'live' ? e.query : scope === 'trashed' ? e.query.trashed : e.query.withTrashed;
      for (const direction of ['out', 'in', 'both'] as const) {
        const neighbours = (at: number, reverse = false) => {
          const way = reverse ? direction === 'out' ? 'in' : direction === 'in' ? 'out' : 'both' : direction;
          const result = new Set<number>();
          for (const selected of kinds) for (const side of way === 'both' ? ['out', 'in'] : [way])
            for (const [a, b, kind] of edges) if (kind === selected) {
              const far = side === 'out' && a === at ? b : side === 'in' && b === at ? a : undefined;
              if (far !== undefined && alive(far)) result.add(far);
            }
          return result;
        };
        const ours = alive(to) ? neighbours(to) : new Set<number>();
        for (const measure of ['jaccard', 'adamicAdar'] as const) {
          const expected = input.filter(admitted).flatMap(at => {
            const theirs = neighbours(at), shared = [...ours].filter(far => theirs.has(far));
            if (!shared.length) return [];
            return [{ id: ids[at]!, score: measure === 'jaccard' ? shared.length / (ours.size + theirs.size - shared.length)
              : shared.reduce((sum, far) => sum + 1 / Math.log(neighbours(far, true).size), 0) }];
          }).sort((a, b) => b.score - a.score);
          const hits = query.ids(input.map(at => ids[at]!)).similar(ids[to]!, kinds, { direction, measure }).hits();
          const label = `${trial}/${scope}/${direction}/${measure}`;
          expect(hits.map(hit => hit.id).sort(), label).toEqual(expected.map(hit => hit.id).sort());
          const scores = new Map(expected.map(hit => [hit.id, hit.score]));
          hits.forEach((hit, at) => {
            // SQLite's compensated sum and the reference's ordinary sum can differ in their last bit.
            expect(hit.score, label).toBeCloseTo(scores.get(hit.id)!, 12);
            if (at > 0) {
              const previous = hits[at - 1]!;
              expect(previous.score, label).toBeGreaterThanOrEqual(hit.score);
              if (previous.score === hit.score)
                expect(input.indexOf(ids.indexOf(previous.id)), label).toBeLessThan(input.indexOf(ids.indexOf(hit.id)));
            }
          });
          expect(query.ids(input.map(at => ids[at]!)).similar(ids[to]!, kinds, { direction, measure }).hits()).toEqual(hits);
        }
      }
    }
  }
});

it('restricts a trash-only start without restricting the live entities its graph steps reach', () => {
  const e = freshEngine({ types: ['Node'], relationKinds: ['refs'], roles: [] });
  const root = e.create('Node').id(), live = e.create('Node').id(), tail = e.create('Node').id();
  e.write(root).link('refs', live); e.write(live).link('refs', tail);
  e.write(root).trash(); e.write(tail).trash();
  expect(e.query.trashed('Node').ids()).toEqual([root, tail]);
  expect(e.query.trashed.ids(root).out('refs').ids()).toEqual([live]);
  expect(e.query.trashed.ids(root).descendants('refs').ids()).toEqual([live, tail]);
  expect(e.query.trashed('Node').linkedTo('refs').ids()).toEqual([root]);
});
