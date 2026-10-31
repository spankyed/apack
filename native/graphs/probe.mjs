import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const directory = resolve(process.argv[2]);
const { communities } = createRequire(import.meta.url)(join(directory, 'ears_graph.js'));
// Zachary's 78 friendships, the same reference fixture as the native engine.
const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 10], [0, 11], [0, 12], [0, 13], [0, 17], [0, 19], [0, 21], [0, 31], [1, 2], [1, 3], [1, 7], [1, 13], [1, 17], [1, 19], [1, 21], [1, 30], [2, 3], [2, 7], [2, 8], [2, 9], [2, 13], [2, 27], [2, 28], [2, 32], [3, 7], [3, 12], [3, 13], [4, 6], [4, 10], [5, 6], [5, 10], [5, 16], [6, 16], [8, 30], [8, 32], [8, 33], [9, 33], [13, 33], [14, 32], [14, 33], [15, 32], [15, 33], [18, 32], [18, 33], [19, 33], [20, 32], [20, 33], [22, 32], [22, 33], [23, 25], [23, 27], [23, 29], [23, 32], [23, 33], [24, 25], [24, 27], [24, 31], [25, 31], [26, 29], [26, 33], [27, 33], [28, 31], [28, 33], [29, 32], [29, 33], [30, 32], [30, 33], [31, 32], [31, 33], [32, 33]];
const input = Float64Array.from(edges.flatMap(([a,b]) => [a,b,1,b,a,1]));
const first = Array.from(communities(input, 34, 1, 0));
assert.equal(first.length, 34);
assert.deepEqual(Array.from(communities(input, 34, 1, 0)), first);
const groups = new Map(); first.forEach((group, at) => {
  if (!groups.has(group)) groups.set(group, []); groups.get(group).push(at);
});
const degree = Array(34).fill(0), inside = new Map();
for (const [a,b] of edges) {
  degree[a]++; degree[b]++;
  if (first[a] === first[b]) inside.set(first[a], (inside.get(first[a]) ?? 0) + 1);
}
let modularity = 0;
for (const [group, members] of groups) {
  const total = members.reduce((n, at) => n + degree[at], 0);
  modularity += (inside.get(group) ?? 0) / edges.length - (total / (2 * edges.length)) ** 2;
}
assert(Math.abs(modularity - .4197896) < 1e-6, `Native fixture modularity: ${modularity}`);
assert.equal(groups.size, 4); assert.notEqual(first[0], first[33]);
assert.throws(() => communities(Float64Array.from([0, 34, 1]), 34, 1, 0));
assert.throws(() => communities(input, 34, NaN, 0));
assert.deepEqual(Array.from(communities(new Float64Array(), 0, 1, 0)), []);
const sha = name => createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
const report = { completed: true, modularity, communities: [...groups.values()],
  repeatable: true, truthfulErrorCases: 2, emptyGraph: true,
  wasmSha256: sha('ears_graph_bg.wasm'), loaderSha256: sha('ears_graph.js'), node: process.version };
writeFileSync(resolve(process.argv[3] ?? join(directory, 'report.json')), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
