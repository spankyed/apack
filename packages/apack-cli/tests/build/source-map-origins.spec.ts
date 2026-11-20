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

  describe('under Windows path rules', () => {
    // The read tree mirrors each original path under a temporary directory on C:, as createCompilerReadTree does
    const temp = 'C:\\Users\\runner\\AppData\\Local\\Temp\\apack-build-inputs-x\\apack-inputs-1-y\\443a5c';
    const winTree = {
      sourcePath: (file: string) => (file.startsWith(`${temp}\\`) ? `${file.slice(temp.length + 1, temp.length + 2)}:${file.slice(temp.length + 2)}` : file),
    };
    const winMap = 'D:\\a\\apack\\packages\\default-setup\\.apack\\build\\runtime\\index.cjs.map';
    const winProject = (sources: string[]) =>
      (JSON.parse(sourceMapOrigins(JSON.stringify({ version: 3, sources }), winMap, winTree, path.win32)) as { sources: string[] }).sources;

    it('names a source the build read from C: by its path relative to the map on D:', () => {
      expect(winProject(['file:///C:/Users/runner/AppData/Local/Temp/apack-build-inputs-x/apack-inputs-1-y/443a5c/D/a/apack/packages/default-setup/src/__generated__/ref.ts']))
        .toEqual(['../../../src/__generated__/ref.ts']);
    });

    it('names an origin no relative path from the map reaches by its own file: URL', () => {
      expect(winProject(['file:///C:/Users/runner/AppData/Local/Temp/apack-build-inputs-x/apack-inputs-1-y/443a5c/E/vendored/view/index.ts']))
        .toEqual(['file:///E:/vendored/view/index.ts']);
    });
  });

  it('keeps a source outside the read tree, and one under another scheme, as they are', () => {
    const outside = pathToFileURL(path.join(pack, 'src', 'a.ts')).href;
    expect(project([outside, 'webpack://pack/a.ts', '../../../src/b.ts'])).toEqual([outside, 'webpack://pack/a.ts', '../../../src/b.ts']);
  });
});
