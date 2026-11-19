import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceMapOrigins } from '../../src/build/be-bundler.ts';

/**
 * A pack's source maps name where each source came from, not the read tree the build read it from, which is gone
 * once the build is. The tree here is a temporary directory mapped to the pack's own, as `createCompilerReadTree`'s
 * `sourcePath` maps it; the pack and the read tree are on one filesystem, so a `file:` URL stands in for the one
 * esbuild writes on Windows, where they are on different drives.
 */
const pack = path.resolve('/work/apack/packages/default-setup');
const readTree = path.resolve('/tmp/apack-build-inputs-x/apack-inputs-1-y/hash');
const tree = {
  sourcePath: (file: string) => (file.startsWith(readTree) ? file.replace(readTree, '') : file),
};
const mapFile = path.join(pack, '.apack', 'build', 'runtime', 'index.cjs.map');
const project = (sources: string[]) =>
  (JSON.parse(sourceMapOrigins(JSON.stringify({ version: 3, sources }), mapFile, tree)) as { sources: string[] }).sources;

describe("a pack's source map origins", () => {
  const generated = path.join(pack, 'src', '__generated__', 'ref.ts');
  const read = path.join(readTree, generated);

  it('names a source read from the read tree where it came from, relative to the map', () => {
    const relative = path.relative(path.dirname(mapFile), read).split(path.sep).join('/');
    expect(project([relative])).toEqual(['../../../src/__generated__/ref.ts']);
  });

  it('names one the build wrote as a file: URL there too, as esbuild writes one across drives', () => {
    expect(project([pathToFileURL(read).href])).toEqual(['../../../src/__generated__/ref.ts']);
  });

  it('keeps a source outside the read tree, and one under another scheme, as they are', () => {
    const outside = pathToFileURL(path.join(pack, 'src', 'a.ts')).href;
    expect(project([outside, 'webpack://pack/a.ts', '../../../src/b.ts'])).toEqual([outside, 'webpack://pack/a.ts', '../../../src/b.ts']);
  });
});
