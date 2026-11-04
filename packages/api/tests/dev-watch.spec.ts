// tsup watches directories rather than the module graph, so a workspace package the API bundle inlines and
// `build:dev:watch` does not name gives an edit that rebuilds nothing, and a running API on the old code with no
// warning. This derives what the bundle reads from the bundler and compares it with what the script names.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import tsupConfig from '../tsup.config.ts';

const API_DIR = path.join(REPO_ROOT, 'packages/api');

/** The `packages/<name>/src` trees among a bundle's inputs (relative to the API package), repo-relative. */
function workspaceSourceTrees(inputs: readonly string[]): string[] {
  const trees = new Set<string>();
  for (const input of inputs) {
    const relative = path.relative(REPO_ROOT, path.resolve(API_DIR, input)).split(path.sep).join('/');
    const tree = /^packages\/[^/]+\/src(?=\/)/.exec(relative)?.[0];
    if (tree) trees.add(tree);
  }
  return [...trees].sort();
}

/** The directories a `tsup … --watch <dir>` script names, repo-relative. */
function watchedTrees(script: string): string[] {
  return [...script.matchAll(/--watch\s+(\S+)/g)]
    .map(([, directory]) => path.relative(REPO_ROOT, path.resolve(API_DIR, directory!)).split(path.sep).join('/'));
}

function unwatchedTrees(inputs: readonly string[], script: string): string[] {
  const watched = new Set(watchedTrees(script));
  return workspaceSourceTrees(inputs).filter(tree => !watched.has(tree));
}

async function bundledInputs(): Promise<string[]> {
  const config = await (tsupConfig as (options: object) => { external: string[]; esbuildOptions(options: { conditions?: string[] }): void })(
    { env: { NODE_ENV: 'development' } });
  const options: { conditions?: string[] } = {};
  config.esbuildOptions(options);
  const { metafile } = await build({
    absWorkingDir: API_DIR, entryPoints: ['src/server.ts'], bundle: true, write: false, metafile: true, logLevel: 'silent',
    format: 'esm', platform: 'node', outdir: 'unwritten', conditions: options.conditions,
    // What is left outside changes nothing here: only the workspace's own sources are compared
    external: [...config.external, '*.node', 'electron', 'vue'],
    plugins: [{ name: 'externalize-vue', setup(bundler) { bundler.onResolve({ filter: /\.vue$/ }, () => ({ path: '__vue_stub__', external: true })); } }],
  });
  return Object.keys(metafile.inputs);
}

const script = (): string =>
  (JSON.parse(fs.readFileSync(path.join(API_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['build:dev:watch']!;

describe('the API dev watch', () => {
  it('names every workspace source the API bundle inlines', async () => {
    const inputs = await bundledInputs();
    expect(workspaceSourceTrees(inputs)).toEqual(expect.arrayContaining(['packages/api/src', 'packages/apack-host/src']));
    expect(unwatchedTrees(inputs, script())).toEqual([]);
  });

  it('reports a bundled tree the script does not name', () => {
    const inputs = ['src/server.ts', '../apack-ears/src/index.ts', '../apack-sdk/src/index.ts', '../../node_modules/zod/index.js'];
    expect(unwatchedTrees(inputs, 'tsup --watch src --watch ../apack-sdk/src')).toEqual(['packages/apack-ears/src']);
  });
});
