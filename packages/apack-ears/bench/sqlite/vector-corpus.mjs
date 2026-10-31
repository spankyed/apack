// Independent deterministic fixtures and exact cosine truth; no database imports or search results.
import assert from 'node:assert/strict';
export const DIMENSIONS = 1536;
function random(seed) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) + 0.5) / 4294967296; };
}
function gaussian(seed) {
  const next = random(seed); let spare;
  return () => {
    if (spare !== undefined) { const value = spare; spare = undefined; return value; }
    const radius = Math.sqrt(-2 * Math.log(next())), angle = 2 * Math.PI * next();
    spare = radius * Math.sin(angle); return radius * Math.cos(angle);
  };
}
function normalize(values) {
  let norm = 0; for (const value of values) norm += value * value;
  const scale = 1 / Math.sqrt(norm); return Float32Array.from(values, value => value * scale);
}
export function corpusGenerator(distribution, dimensions = DIMENSIONS) {
  assert(['clustered', 'mixed'].includes(distribution));
  const centers = Array.from({ length: 64 }, (_, i) => {
    const next = gaussian(0x3178ab ^ Math.imul(i + 1, 0x9e3779b1));
    return normalize(Array.from({ length: dimensions }, next));
  });
  return (ordinal, query = false, revision = 0) => {
    const next = gaussian((query ? 0x7519dc : 0x892abcd) ^ Math.imul(ordinal + 1, 0x85ebca6b) ^ Math.imul(revision, 0xc2b2ae35));
    const noise = normalize(Array.from({ length: dimensions }, next));
    if (distribution === 'mixed' && ordinal % 2) return noise;
    const center = centers[ordinal % centers.length];
    return normalize(Float64Array.from(noise, (value, dimension) => 0.6 * center[dimension] + 0.8 * value));
  };
}
export function norm(vector) { let sum = 0; for (const value of vector) sum += value * value; return Math.sqrt(sum); }
export function exactTop(vectors, norms, query, dimensions, eligible, k = 10) {
  const top = [], queryNorm = norm(query);
  for (let i = 0; i < norms.length; i++) {
    if (!eligible(i)) continue;
    let dot = 0; const start = i * dimensions;
    for (let j = 0; j < dimensions; j++) dot += vectors[start + j] * query[j];
    const score = dot / (norms[i] * queryNorm);
    let at = 0; while (at < top.length && (top[at].score > score || top[at].score === score && top[at].ordinal < i)) at++;
    if (at < k) { top.splice(at, 0, { ordinal: i, score }); if (top.length > k) top.pop(); }
  }
  return top;
}
export function checkCorpusMath() {
  const vectors = new Float32Array([1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 1, 0]);
  const norms = Float64Array.from([1, 1, 1, Math.sqrt(2)]);
  const result = exactTop(vectors, norms, [1, 0, 0], 3, () => true, 4);
  assert.deepEqual(result.map(row => row.ordinal), [0, 3, 1, 2]);
  assert(Math.abs(result[1].score - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(exactTop(vectors, norms, [1, 0, 0], 3, i => i % 2 === 1, 2).map(row => row.ordinal), [3, 1]);
  for (const distribution of ['clustered', 'mixed']) {
    const generate = corpusGenerator(distribution), regenerated = corpusGenerator(distribution), sums = new Float64Array(DIMENSIONS), squares = new Float64Array(DIMENSIONS);
    for (let i = 0; i < 128; i++) {
      const vector = generate(i); assert.deepEqual(vector, regenerated(i));
      assert(Math.abs(norm(vector) - 1) < 1e-6); assert.notDeepEqual(vector, generate(i, true));
      for (let j = 0; j < DIMENSIONS; j++) { sums[j] += vector[j]; squares[j] += vector[j] ** 2; }
    }
    // Every coordinate carries independent noise; this is a sanity check, not a proof of isotropy.
    for (let j = 0; j < DIMENSIONS; j++) assert(squares[j] / 128 - (sums[j] / 128) ** 2 > 0.00005);
  }
}
