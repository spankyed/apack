import { loadGraphCommunityCore, type GraphCommunityCore } from './community-core.ts';
import { graphComponents, type SqliteGraph } from './graph-algorithms.ts';

/** Undirected weighted Leiden: every directed/parallel input edge contributes once. */
export function graphCommunities(graph: SqliteGraph, resolution = 1, seed = 0, core: () => GraphCommunityCore = loadGraphCommunityCore): string[][] {
  if (!Number.isFinite(resolution) || resolution < 0 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Object.assign(new Error('Communities requires a finite nonnegative resolution and an unsigned 32-bit seed'), { code: 'VALUE_INVALID' });
  if (resolution === 0) return graphComponents(graph, false);
  const edgeCount = graph.out.reduce((n, edges) => n + edges.length, 0);
  if (!edgeCount) return graph.ids.map(id => [id]);
  const edges = new Float64Array(edgeCount * 3); let cursor = 0;
  for (let at = 0; at < graph.ids.length; at++) for (const far of graph.out[at]!) {
    edges[cursor++] = at; edges[cursor++] = far; edges[cursor++] = 1;
  }
  const assignments = core().communities(edges, graph.ids.length, resolution, seed);
  if (assignments.length !== graph.ids.length) throw Object.assign(new Error('Graph core returned an invalid partition'), { code: 'CORRUPT' });
  const groups = new Map<number, number[]>();
  for (let at = 0; at < graph.ids.length; at++) {
    const key = assignments[at]!;
    let group = groups.get(key); if (!group) groups.set(key, group = []);
    group.push(at);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!)
    .map(group => group.map(at => graph.ids[at]!));
}
