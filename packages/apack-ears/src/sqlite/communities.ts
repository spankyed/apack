import { Graph, leiden } from 'leiden-ts';
import { graphComponents, type SqliteGraph } from './graph-algorithms.ts';

/** Undirected weighted Leiden: every directed/parallel input edge contributes once. */
export function graphCommunities(graph: SqliteGraph, resolution = 1, seed = 0): string[][] {
  if (!Number.isFinite(resolution) || resolution < 0 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Object.assign(new Error('Communities requires a finite nonnegative resolution and an unsigned 32-bit seed'), { code: 'VALUE_INVALID' });
  if (resolution === 0) return graphComponents(graph, false);
  // The library rejects duplicate undirected edges. Aggregate their weights without losing multiplicity,
  // including opposite directed edges and repeated relation kinds from the caller's projection.
  const weights = new Map<number, Map<number, number>>();
  for (let at = 0; at < graph.ids.length; at++) for (const far of graph.out[at]!) {
    const a = Math.min(at, far), b = Math.max(at, far);
    let row = weights.get(a); if (!row) weights.set(a, row = new Map());
    row.set(b, (row.get(b) ?? 0) + 1);
  }
  if (!weights.size) return graph.ids.map(id => [id]);
  const edges: Array<[number, number, number]> = [];
  for (const [a, row] of weights) for (const [b, weight] of row) edges.push([a, b, weight]);
  const input = Graph.fromEdgeList(graph.ids.length, edges, { selfLoops: 'allow' });
  const assignments = leiden(input, { seed, resolution }).partition.assignments;
  const groups = new Map<number, number[]>();
  for (let at = 0; at < graph.ids.length; at++) {
    const key = assignments[at]!;
    let group = groups.get(key); if (!group) groups.set(key, group = []);
    group.push(at);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!)
    .map(group => group.map(at => graph.ids[at]!));
}
