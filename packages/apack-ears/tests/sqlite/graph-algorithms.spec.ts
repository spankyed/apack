import { describe, expect, it } from 'vitest';
import { graphCommunities } from '../../src/sqlite/communities.ts';
import { graphComponents, rankGraph, topologicalGraph, type SqliteGraph } from '../../src/sqlite/graph-algorithms.ts';

function graph(nodes: number, edges: number[][]): SqliteGraph {
  const ids = Array.from({ length: nodes }, (_, at) => `Node-${at}`);
  const out: number[][] = Array.from(ids, () => []), incoming: number[][] = Array.from(ids, () => []);
  for (const [a, b] of edges) { out[a!]!.push(b!); incoming[b!]!.push(a!); }
  return { ids, out, incoming };
}

describe('SQLite graph algorithms', () => {
  it('refuses malformed and coerced weighted seeds even when their entity is outside the graph', () => {
    const g = graph(1, []);
    const malformed = [null, undefined, 3, {}, { id: 3, weight: 1 },
      { id: 'missing', weight: '3' }, { id: 'Node-0', weight: true },
      { id: 'missing', weight: NaN }, { id: 'missing', weight: Infinity }];
    for (const seed of malformed) expect(() => rankGraph(g,
      [seed] as unknown as NonNullable<Parameters<typeof rankGraph>[1]>))
      .toThrow(expect.objectContaining({ code: 'BATCH_INVALID' }));
  });

  it('handles a long directed chain and cycle without recursive stack growth', () => {
    const n = 20_000, edges = Array.from({ length: n - 1 }, (_, at) => [at, at + 1]);
    const chain = graph(n, edges);
    expect(topologicalGraph(chain)).toEqual(chain.ids);
    expect(graphComponents(chain, true)).toEqual(chain.ids.map(id => [id]));
    expect(graphComponents(chain, false)).toEqual([chain.ids]);
    edges.push([n - 1, 0]);
    const cycle = graph(n, edges);
    expect(topologicalGraph(cycle)).toEqual(cycle.ids);
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
      // Independent SCC condensation from transitive closure, choosing the earliest ready component.
      const components: number[][] = [], assigned = new Set<number>();
      for (let a = 0; a < 4; a++) if (!assigned.has(a)) {
        const component = Array.from({ length: 4 }, (_, b) => b).filter(b => reach[a]![b] && reach[b]![a]);
        component.forEach(b => assigned.add(b)); components.push(component);
      }
      const expected: number[] = [], remaining = [...components];
      while (remaining.length) {
        const at = remaining.findIndex(group => !edges.some(([a, b]) => group.includes(b!) && !group.includes(a!) && remaining.some(other => other.includes(a!))));
        expected.push(...remaining.splice(at, 1)[0]!);
      }
      expect(topologicalGraph(g)).toEqual(expected.map(at => g.ids[at]!));
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

  it('matches the native known modularity on Zachary\'s karate club', () => {
    // The same 78 friendships used by elmdb's graph-algorithm reference fixture.
    const edges = [
      [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
      [0, 10], [0, 11], [0, 12], [0, 13], [0, 17], [0, 19], [0, 21], [0, 31],
      [1, 2], [1, 3], [1, 7], [1, 13], [1, 17], [1, 19], [1, 21], [1, 30],
      [2, 3], [2, 7], [2, 8], [2, 9], [2, 13], [2, 27], [2, 28], [2, 32],
      [3, 7], [3, 12], [3, 13], [4, 6], [4, 10], [5, 6], [5, 10], [5, 16],
      [6, 16], [8, 30], [8, 32], [8, 33], [9, 33], [13, 33], [14, 32], [14, 33],
      [15, 32], [15, 33], [18, 32], [18, 33], [19, 33], [20, 32], [20, 33], [22, 32],
      [22, 33], [23, 25], [23, 27], [23, 29], [23, 32], [23, 33], [24, 25], [24, 27],
      [24, 31], [25, 31], [26, 29], [26, 33], [27, 33], [28, 31], [28, 33], [29, 32],
      [29, 33], [30, 32], [30, 33], [31, 32], [31, 33], [32, 33],
    ];
    const g = graph(34, edges.flatMap(([a, b]) => [[a!, b!], [b!, a!]]));
    const groups = graphCommunities(g, 1, 0), owner = new Map(groups.flatMap((members, at) => members.map(id => [id, at] as const)));
    const degree = Array(34).fill(0) as number[], internal = Array(groups.length).fill(0) as number[];
    for (const [a, b] of edges) {
      degree[a!]!++; degree[b!]!++;
      if (owner.get(g.ids[a!]!) === owner.get(g.ids[b!]!)) internal[owner.get(g.ids[a!]!)!]!++;
    }
    // Independent undirected modularity, using the original edges rather than the library's score.
    const q = groups.reduce((sum, members, at) => {
      const totalDegree = members.reduce((n, id) => n + degree[Number(id.slice(5))]!, 0);
      return sum + internal[at]! / edges.length - (totalDegree / (2 * edges.length)) ** 2;
    }, 0);
    expect(q).toBeCloseTo(.4197896, 6);
    expect(groups).toHaveLength(4);
    expect(owner.get('Node-0')).not.toBe(owner.get('Node-33'));
    expect(graphCommunities(g, 1, 0)).toEqual(groups);
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
