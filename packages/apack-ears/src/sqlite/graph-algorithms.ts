import type { SqliteDatabase } from './database.ts';
import { validRelationWeight } from './relation-weights.ts';
import type { QueryRankSeed } from '../storage.ts';
import type { EdgeDirection } from '../runtime.ts';

/** A query-owned graph: first-encounter node order and edge multiplicity are significant. */
export interface SqliteGraph { ids: string[]; out: number[][]; incoming: number[][]; outWeights?: number[][] }

export function projectGraph(db: SqliteDatabase, input: string[], kinds: string[], direction: EdgeDirection = 'out', weights = false): SqliteGraph {
  if (!['out', 'in', 'both'].includes(direction)) throw Object.assign(new Error('Invalid graph direction'), { code: 'VALUE_INVALID' });
  for (const kind of kinds) { db.relationDefinition(kind); db.trackRange(`kind:${kind}`); }
  const weightedKinds = new Set(weights ? kinds.filter(kind => db.relationDefinition(kind).weighted) : []);
  db.trackRange('membersAny');
  const ids = [...new Set(input)], place = new Map(ids.map((id, at) => [id, at]));
  const out: number[][] = Array.from(ids, () => []), incoming: number[][] = Array.from(ids, () => []);
  const outWeights: number[][] | undefined = weightedKinds.size ? Array.from(ids, () => []) : undefined;
  // SQLite restricts both endpoints before transport. One statement replaces per-node neighbor calls.
  const forward = direction === 'in' ? '' : 'SELECT source,target,kind,weight,kind_order,seq,0 side FROM edges';
  const backward = direction === 'out' ? '' : 'SELECT target source,source target,kind,weight,kind_order,seq,1 side FROM edges';
  const rows = db.all(`WITH members AS MATERIALIZED (SELECT value id FROM json_each(?)),
    edges AS MATERIALIZED (SELECT r.source,r.target,r.kind,${outWeights ? 'r.weight' : 'NULL'} weight,k.key kind_order,r.seq FROM json_each(?) k
      JOIN relations r ON r.kind=k.value JOIN members a ON a.id=r.source JOIN members b ON b.id=r.target)
    ${[forward, backward].filter(Boolean).join(' UNION ALL ')} ORDER BY kind_order,side,seq`,
    [JSON.stringify(ids), JSON.stringify(kinds)]);
  for (const row of rows) {
    const a = place.get(String(row.source))!, b = place.get(String(row.target))!;
    const weight = weightedKinds.has(row.kind) && row.weight !== null ? db.unpack(row.weight) : 1;
    if (!validRelationWeight(weight)) throw Object.assign(new Error('Invalid graph edge weight'), { code: 'CORRUPT' });
    out[a]!.push(b); incoming[b]!.push(a); outWeights?.[a]!.push(weight);
  }
  return { ids, out, incoming, ...(outWeights ? { outWeights } : {}) };
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

export function rankGraph(graph: SqliteGraph, seeds: readonly QueryRankSeed[] | undefined, damping = .85, iterations = 100, tolerance = 1e-6): number[] | undefined {
  if (!(damping > 0 && damping < 1 && tolerance > 0 && Number.isInteger(iterations) && iterations > 0 && iterations <= 0xffffffff))
    throw Object.assign(new Error('Invalid PageRank parameters'), { code: 'VALUE_INVALID' });
  const chosen = new Map<string, number>();
  for (const seed of seeds ?? graph.ids) {
    if (typeof seed !== 'string' && (!seed || typeof seed !== 'object' || typeof seed.id !== 'string' || typeof seed.weight !== 'number'))
      throw Object.assign(new Error('Rank seeds require an entity id and a numerical weight'), { code: 'BATCH_INVALID' });
    const id = typeof seed === 'string' ? seed : seed.id, weight = typeof seed === 'string' ? 1 : seed.weight;
    if (!validRelationWeight(weight) || weight <= 0)
      throw Object.assign(new Error('Rank seed weights must be above 0 and at most 2^960'), { code: 'BATCH_INVALID' });
    chosen.set(id, (chosen.get(id) ?? 0) + weight);
  }
  const teleport = graph.ids.map(id => chosen.get(id) ?? 0), count = teleport.reduce((a, b) => a + b, 0);
  if (!count) return;
  for (let at = 0; at < teleport.length; at++) teleport[at] = teleport[at]! / count;
  const totals = graph.out.map((neighbors, at) => graph.outWeights?.[at]?.reduce((a, b) => a + b, 0) ?? neighbors.length);
  let scores = [...teleport], next: number[] = Array(graph.ids.length).fill(0);
  for (let round = 0; round < iterations; round++) {
    next.fill(0); let dangling = 0;
    for (let at = 0; at < scores.length; at++) {
      const neighbors = graph.out[at]!;
      const total = totals[at]!;
      if (total === 0) dangling += scores[at]!;
      else for (let edge = 0; edge < neighbors.length; edge++) {
        const far = neighbors[edge]!, weight = graph.outWeights?.[at]?.[edge] ?? 1;
        next[far] = next[far]! + scores[at]! * (weight / total);
      }
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

/** Stable Kahn ordering of SCCs: O(V + E + C log C), including parallel inter-component edges. */
export function topologicalGraph(graph: SqliteGraph): string[] {
  const place = new Map(graph.ids.map((id, at) => [id, at]));
  const groups = graphComponents(graph, true).map(group => group.map(id => place.get(id)!));
  const owner = new Uint32Array(graph.ids.length), waiting = new Float64Array(groups.length);
  groups.forEach((group, at) => { for (const node of group) owner[node] = at; });
  for (let node = 0; node < graph.out.length; node++) for (const far of graph.out[node]!)
    if (owner[node] !== owner[far]) waiting[owner[far]!]!++;
  const ready: number[] = [];
  const before = (a: number, b: number) => groups[a]![0]! < groups[b]![0]!;
  const push = (value: number) => {
    let at = ready.length; ready.push(value);
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (!before(value, ready[parent]!)) break;
      ready[at] = ready[parent]!; at = parent;
    }
    ready[at] = value;
  };
  const pop = () => {
    const first = ready[0]!, last = ready.pop()!;
    if (ready.length) {
      let at = 0;
      while (2 * at + 1 < ready.length) {
        let child = 2 * at + 1;
        if (child + 1 < ready.length && before(ready[child + 1]!, ready[child]!)) child++;
        if (!before(ready[child]!, last)) break;
        ready[at] = ready[child]!; at = child;
      }
      ready[at] = last;
    }
    return first;
  };
  waiting.forEach((count, at) => { if (!count) push(at); });
  const ordered: string[] = [];
  while (ready.length) {
    const at = pop();
    for (const node of groups[at]!) {
      ordered.push(graph.ids[node]!);
      for (const far of graph.out[node]!) {
        const target = owner[far]!;
        if (target !== at && --waiting[target]! === 0) push(target);
      }
    }
  }
  return ordered;
}

/** Indexed two-hop candidate discovery; SQLite aggregates distinct neighbours before returning scored owners. */
export function similarGraph(db: SqliteDatabase, input: string[], to: string, kinds: string[], scope: 'live' | 'withTrashed' | 'trashed',
  direction: EdgeDirection = 'out', measure: 'jaccard' | 'adamicAdar' = 'jaccard'): Array<{ id: string; score: number; terms: string[] }> {
  if (!['out', 'in', 'both'].includes(direction) || !['jaccard', 'adamicAdar'].includes(measure))
    throw Object.assign(new Error('Invalid graph similarity controls'), { code: 'BATCH_INVALID' });
  for (const kind of kinds) { db.relationDefinition(kind); db.trackRange(`kind:${kind}`); }
  db.trackRange('membersAny'); db.trackRange(`entity:${to}`);
  const reachable = (alias: string) => scope === 'live' ? `${alias}.trashed=0` : '1';
  // Both orientations use endpoint indexes. A UNION (not UNION ALL) deduplicates neighbours across kinds/sides.
  const adjacency = (owners: string, reverse: boolean, ordered: boolean) => {
    const sides = direction === 'both' ? ['out', 'in'] : [direction];
    return sides.map((side, at) => {
      const out = (side === 'out') !== reverse, endpoint = out ? 'source' : 'target', far = out ? 'target' : 'source';
      return `SELECT ${ordered ? '' : 'DISTINCT '}o.id owner,r.${far} id${ordered ? `,k.key kind_order,${at} side,r.seq` : ''}
        FROM ${owners} o JOIN kinds k JOIN relations r ON r.${endpoint}=o.id AND r.kind=k.value
        JOIN entities e ON e.id=r.${far} WHERE r.${far}!=o.id AND ${reachable('e')}`;
    }).join(ordered ? ' UNION ALL ' : ' UNION ');
  };
  const score = measure === 'jaccard' ? '1.0*count(*) / (t.n+(SELECT count(*) FROM ours)-count(*))'
    : 'sum(1.0/ln(d.n) ORDER BY o.ord)';
  const rows = db.all(`WITH kinds AS MATERIALIZED (SELECT value,key FROM json_each(?)),
    candidates AS MATERIALIZED (SELECT value id,min(key) ord FROM json_each(?) GROUP BY value),
    target AS (SELECT id FROM entities WHERE id=? AND ${reachable('entities')}),
    ours_raw AS (${adjacency('target', false, true)}),
    ours AS MATERIALIZED (SELECT id,min(ord) ord FROM
      (SELECT id,row_number() OVER (ORDER BY kind_order,side,seq) ord FROM ours_raw) GROUP BY id),
    back AS MATERIALIZED (${adjacency('ours', true, false)}),
    degrees AS (SELECT owner,count(*) n FROM back GROUP BY owner),
    shared AS MATERIALIZED (SELECT b.id,c.ord FROM back b JOIN candidates c ON c.id=b.id
      WHERE b.id!=? GROUP BY b.id),
    theirs_raw AS (${adjacency('shared', false, false)}),
    theirs AS (SELECT owner,count(*) n FROM theirs_raw GROUP BY owner)
    SELECT s.id,${score} score FROM shared s JOIN back b ON b.id=s.id JOIN ours o ON o.id=b.owner
      JOIN degrees d ON d.owner=o.id JOIN theirs t ON t.owner=s.id
    GROUP BY s.id ORDER BY score DESC,s.ord`, [JSON.stringify(kinds), JSON.stringify(input), to, to]);
  return rows.map(row => ({ id: String(row.id), score: Number(row.score), terms: [] }));
}
