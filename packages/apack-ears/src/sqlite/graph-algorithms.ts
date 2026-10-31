import type { SqliteDatabase } from './database.ts';
import type { EdgeDirection } from '../runtime.ts';

/** A query-owned graph: first-encounter node order and edge multiplicity are significant. */
export interface SqliteGraph { ids: string[]; out: number[][]; incoming: number[][] }

export function projectGraph(db: SqliteDatabase, input: string[], kinds: string[], direction: EdgeDirection = 'out'): SqliteGraph {
  if (!['out', 'in', 'both'].includes(direction)) throw Object.assign(new Error('Invalid graph direction'), { code: 'VALUE_INVALID' });
  for (const kind of kinds) { db.relationDefinition(kind); db.trackRange(`kind:${kind}`); }
  db.trackRange('membersAny');
  const ids = [...new Set(input)], place = new Map(ids.map((id, at) => [id, at]));
  const out: number[][] = Array.from(ids, () => []), incoming: number[][] = Array.from(ids, () => []);
  // SQLite restricts both endpoints before transport. One statement replaces per-node neighbor calls.
  const forward = direction === 'in' ? '' : 'SELECT source,target,kind_order,seq,0 side FROM edges';
  const backward = direction === 'out' ? '' : 'SELECT target source,source target,kind_order,seq,1 side FROM edges';
  const rows = db.all(`WITH members AS MATERIALIZED (SELECT value id FROM json_each(?)),
    edges AS MATERIALIZED (SELECT r.source,r.target,k.key kind_order,r.seq FROM json_each(?) k
      JOIN relations r ON r.kind=k.value JOIN members a ON a.id=r.source JOIN members b ON b.id=r.target)
    ${[forward, backward].filter(Boolean).join(' UNION ALL ')} ORDER BY kind_order,side,seq`,
    [JSON.stringify(ids), JSON.stringify(kinds)]);
  for (const row of rows) {
    const a = place.get(String(row.source))!, b = place.get(String(row.target))!;
    out[a]!.push(b); incoming[b]!.push(a);
  }
  return { ids, out, incoming };
}

/** Iterative Kosaraju avoids consuming the JavaScript stack on long chains. */
export function graphComponents(graph: SqliteGraph, strong: boolean): string[][] {
  const { ids, out, incoming } = graph, seen = new Uint8Array(ids.length), order: number[] = [];
  if (strong) {
    for (let root = 0; root < ids.length; root++) {
      if (seen[root]) continue;
      seen[root] = 1;
      const stack: Array<[number, number]> = [[root, 0]];
      while (stack.length) {
        const frame = stack[stack.length - 1]!, neighbors = out[frame[0]]!;
        if (frame[1] === neighbors.length) { order.push(frame[0]); stack.pop(); continue; }
        const next = neighbors[frame[1]++]!;
        if (!seen[next]) { seen[next] = 1; stack.push([next, 0]); }
      }
    }
    seen.fill(0); order.reverse();
  } else for (let at = 0; at < ids.length; at++) order.push(at);
  const groups: number[][] = [];
  for (const root of order) {
    if (seen[root]) continue;
    seen[root] = 1;
    const group: number[] = [], stack = [root];
    while (stack.length) {
      const at = stack.pop()!; group.push(at);
      for (const next of incoming[at]!) if (!seen[next]) { seen[next] = 1; stack.push(next); }
      if (!strong) for (const next of out[at]!) if (!seen[next]) { seen[next] = 1; stack.push(next); }
    }
    group.sort((a, b) => a - b); groups.push(group);
  }
  groups.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  return groups.map(group => group.map(at => ids[at]!));
}

export function rankGraph(graph: SqliteGraph, seeds: string[] | undefined, damping = .85, iterations = 100, tolerance = 1e-6): number[] | undefined {
  if (!(damping > 0 && damping < 1 && tolerance > 0 && Number.isInteger(iterations) && iterations > 0 && iterations <= 0xffffffff))
    throw Object.assign(new Error('Invalid PageRank parameters'), { code: 'VALUE_INVALID' });
  const chosen = seeds === undefined ? new Set(graph.ids) : new Set(seeds);
  const teleport: number[] = graph.ids.map(id => chosen.has(id) ? 1 : 0), count = teleport.reduce((a, b) => a + b, 0);
  if (!count) return;
  for (let at = 0; at < teleport.length; at++) teleport[at] = teleport[at]! / count;
  let scores = [...teleport], next: number[] = Array(graph.ids.length).fill(0);
  for (let round = 0; round < iterations; round++) {
    next.fill(0); let dangling = 0;
    for (let at = 0; at < scores.length; at++) {
      const neighbors = graph.out[at]!;
      if (!neighbors.length) dangling += scores[at]!;
      else for (const far of neighbors) next[far] = next[far]! + scores[at]! / neighbors.length;
    }
    const back = damping * dangling + (1 - damping); let change = 0;
    for (let at = 0; at < next.length; at++) {
      next[at] = damping * next[at]! + back * teleport[at]!;
      change += Math.abs(next[at]! - scores[at]!);
    }
    [scores, next] = [next, scores];
    if (change < tolerance) break;
  }
  return scores;
}
