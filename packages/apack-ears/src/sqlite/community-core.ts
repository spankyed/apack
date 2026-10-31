import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';

export interface GraphCommunityCore {
  communities(edges: Float64Array, nodes: number, resolution: number, seed: number): Uint32Array;
}
const sourceSha256 = '80fd327d246bcbbb83fd5c489877dfe3573d11ae494a01a7daae13c02c41e60a';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const changed = (): never => { throw Object.assign(new Error('Packaged graph core does not match this build'), { code: 'NATIVE_CHANGED' }); };

/** Each owner gets a fresh generated module and WASM memory; Node's global require cache owns neither. */
export function loadGraphCommunityCore(directory = fileURLToPath(new URL('../../dist/sqlite/graph/', import.meta.url))): GraphCommunityCore {
  if (!isAbsolute(directory)) throw Object.assign(new Error('Graph artifact directory must be absolute'), { code: 'VALUE_INVALID' });
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    const loader = readFileSync(join(directory, 'ears_graph.js')), wasm = readFileSync(join(directory, 'ears_graph_bg.wasm'));
    if (manifest?.format !== 1 || manifest.leidenVersion !== '0.8.1' || manifest.sourceSha256 !== sourceSha256 ||
      manifest.loaderSha256 !== sha(loader) || manifest.wasmSha256 !== sha(wasm)) return changed();
    const module = { exports: {} as GraphCommunityCore };
    // Only integrity-checked package code is compiled. No path or code comes from stored metadata.
    // Supply the already checked bytes to the generated binding's sole filesystem import.
    const require = (name: string) => {
      if (name !== 'fs') return changed();
      return { readFileSync: (file: string) => resolve(file) === resolve(directory, 'ears_graph_bg.wasm') ? wasm : changed() };
    };
    compileFunction(loader.toString('utf8'), ['module', 'exports', 'require', '__dirname'])(module, module.exports, require, directory);
    if (typeof module.exports.communities !== 'function') return changed();
    return module.exports;
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    if (code === 'NATIVE_CHANGED' || code === 'VALUE_INVALID') throw cause;
    throw Object.assign(new Error('Packaged graph core is unavailable; build the matching EARS package', { cause }),
      { code: code === 'ENOENT' ? 'NATIVE_MISSING' : cause instanceof SyntaxError ? 'NATIVE_CHANGED' : 'IO' });
  }
}
