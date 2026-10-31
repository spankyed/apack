import { describe, expect, it } from 'vitest';
import { graphCommunities } from '../../src/sqlite/communities.ts';
import { graphComponents, rankGraph, type SqliteGraph } from '../../src/sqlite/graph-algorithms.ts';

function graph(nodes: number, edges: number[][]): SqliteGraph {
  const ids = Array.from({ length: nodes }, (_, at) => `Node-${at}`);
  const out: number[][] = Array.from(ids, () => []), incoming: number[][] = Array.from(ids, () => []);
  for (const [a, b] of edges) { out[a!]!.push(b!); incoming[b!]!.push(a!); }
  return { ids, out, incoming };
}

describe('SQLite graph algorithms', () => {
  it('handles a long directed chain and cycle without recursive stack growth', () => {
    const n = 20_000, edges = Array.from({ length: n - 1 }, (_, at) => [at, at + 1]);
    const chain = graph(n, edges);
    expect(graphComponents(chain, true)).toEqual(chain.ids.map(id => [id]));
    expect(graphComponents(chain, false)).toEqual([chain.ids]);
    edges.push([n - 1, 0]);
    const cycle = graph(n, edges);
    expect(graphComponents(cycle, true)).toEqual([cycle.ids]);
  });

  it('agrees with independent reachability on every four-node directed graph', () => {
    const possible = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b) => [a, b])).flat().filter(([a, b]) => a !== b);
    for (let mask = 0; mask < 1 << possible.length; mask++) {
      const edges = possible.filter((_, at) => mask & (1 << at));
      const g = graph(4, edges), reach = Array.from({ length: 4 }, (_, at) => Array.from({ length: 4 }, (_, far) => at === far));
      for (const [a, b] of edges) reach[a!]![b!] = true;
      for (let k = 0; k < 4; k++) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
        reach[a]![b] ||= reach[a]![k]! && reach[k]![b]!;
      const groups = graphComponents(g, true), owner = new Map(groups.flatMap((ids, at) => ids.map(id => [id, at] as const)));
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
        expect(owner.get(g.ids[a]!) === owner.get(g.ids[b]!), `graph ${mask}: ${a},${b}`).toBe(reach[a]![b]! && reach[b]![a]!);
    }
  });

  it('preserves community order, repeated edges, unchecked loops and explicit controls', () => {
    const g = graph(7, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [2, 3], [0, 1], [1, 0], [0, 0]]);
    expect(graphCommunities(g, 0)).toEqual([g.ids.slice(0, 6), [g.ids[6]]]);
    expect(graphCommunities(g)).toEqual(graphCommunities(g, 1, 0));
    expect(graphCommunities(g, 1, 0xffffffff).flat().sort()).toEqual([...g.ids].sort());
    expect(graphCommunities(graph(3, []))).toEqual([['Node-0'], ['Node-1'], ['Node-2']]);
    expect(graphCommunities(graph(0, []))).toEqual([]);
    for (const resolution of [-1, NaN, Infinity]) expect(() => graphCommunities(g, resolution)).toThrow();
    for (const seed of [-1, 1.5, 2 ** 32, NaN]) expect(() => graphCommunities(g, 1, seed)).toThrow();
  });

  it('normalizes dangling mass and duplicate seeds and refuses invalid rank controls', () => {
    const g = graph(3, [[0, 1], [0, 1], [1, 1]]);
    const scores = rankGraph(g, undefined)!;
    expect(scores.reduce((a, b) => a + b)).toBeCloseTo(1, 12);
    expect(scores[1]).toBeGreaterThan(scores[0]!);
    expect(rankGraph(g, ['Node-0', 'Node-0'])).toEqual(rankGraph(g, ['Node-0']));
    expect(rankGraph(g, ['missing'])).toBeUndefined();
    for (const damping of [0, 1, NaN, Infinity]) expect(() => rankGraph(g, undefined, damping)).toThrow();
    for (const rounds of [0, -1, 1.5, 2 ** 32]) expect(() => rankGraph(g, undefined, .85, rounds)).toThrow();
  });
});
