import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraphCommunityCore } from '../../src/sqlite/community-core.ts';

const held: string[] = [];
afterEach(() => { for (const path of held.splice(0)) rmSync(path, { recursive: true, force: true }); });
const original = fileURLToPath(new URL('../../dist/sqlite/graph/', import.meta.url));
function copy() {
  const path = mkdtempSync(join(tmpdir(), 'ears-graph-core-')); held.push(path);
  for (const file of ['ears_graph.js', 'ears_graph_bg.wasm', 'manifest.json']) cpSync(join(original, file), join(path, file));
  return path;
}

describe('packaged graph core', () => {
  it('owns independent linear memory and returns truthful invalid-input failures', () => {
    const a = loadGraphCommunityCore() as ReturnType<typeof loadGraphCommunityCore> & { __wasm: { memory: object } };
    const b = loadGraphCommunityCore() as typeof a;
    expect(a.__wasm.memory).not.toBe(b.__wasm.memory);
    const edges = Float64Array.from([0, 1, 1]);
    expect([...a.communities(edges, 2, 1, 0)]).toEqual([...b.communities(edges, 2, 1, 0)]);
    expect(() => a.communities(Float64Array.from([0, 2, 1]), 2, 1, 0)).toThrow();
    expect(() => a.communities(edges, 2, NaN, 0)).toThrow();
  });

  it.each(['loader', 'wasm', 'source'] as const)('refuses changed %s before executing it', kind => {
    const path = copy();
    if (kind === 'source') {
      const file = join(path, 'manifest.json'), manifest = JSON.parse(readFileSync(file, 'utf8'));
      manifest.sourceSha256 = '0'.repeat(64); writeFileSync(file, JSON.stringify(manifest));
    } else {
      const file = join(path, kind === 'loader' ? 'ears_graph.js' : 'ears_graph_bg.wasm');
      writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from('changed')]));
    }
    expect(() => loadGraphCommunityCore(path)).toThrow(expect.objectContaining({ code: 'NATIVE_CHANGED' }));
  });

  it('refuses absent artifacts and relative executable paths', () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-graph-missing-')); held.push(path);
    expect(() => loadGraphCommunityCore(path)).toThrow(expect.objectContaining({ code: 'NATIVE_MISSING' }));
    expect(() => loadGraphCommunityCore('relative')).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
  });
});
