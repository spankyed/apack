import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundledPackages, esbuildBundledPackages, packageOf, rollupBundledPackages, type BundledPackage,
} from '../../src/build/bundled-packages.ts';

/**
 * The packages a bundle inlined, as the bundler reports it (`src/build/bundled-packages.ts`), which the app's
 * third-party notices credit. Over module ids and package trees made here.
 */
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-')));
  made.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const manifest = (name: string, version = '1.0.0') => JSON.stringify({ name, version });

/** A repository with a workspace, two installed packages and a package linked in from another checkout */
function repository() {
  const root = tree({
    'package.json': manifest('apack'),
    'packages/renderer/package.json': manifest('@app/renderer'),
    'packages/renderer/src/main.ts': '',
    'node_modules/vue/package.json': manifest('vue', '3.5.0'),
    'node_modules/vue/dist/vue.js': '',
    'node_modules/vite/package.json': manifest('vite', '7.0.0'),
    'node_modules/esbuild/package.json': manifest('esbuild', '0.25.0'),
    'node_modules/tailwindcss/package.json': manifest('tailwindcss', '3.4.0'),
    'vendor-checkout/package.json': manifest('@apackdev/git', '0.1.0'),
    'vendor-checkout/dist/index.js': '',
  });
  fs.mkdirSync(path.join(root, 'node_modules', '@apackdev'));
  fs.symlinkSync(path.join(root, 'vendor-checkout'), path.join(root, 'node_modules', '@apackdev', 'git'));
  return root;
}

const names = (packages: BundledPackage[]) => packages.map((pkg) => `${pkg.name}@${pkg.version}`);

describe('the package a module id belongs to', () => {
  it('is the nearest named package of the file, found where a linked package really is', () => {
    const root = repository();
    expect(packageOf(path.join(root, 'node_modules/vue/dist/vue.js'), root)).toMatchObject({ name: 'vue', version: '3.5.0' });
    expect(packageOf(path.join(root, 'node_modules/@apackdev/git/dist/index.js'), root))
      .toMatchObject({ name: '@apackdev/git', dir: path.join(root, 'vendor-checkout') });
  });

  it('ignores a query, and maps a virtual id to the package that injects it', () => {
    const root = repository();
    expect(packageOf(`${path.join(root, 'node_modules/vue/dist/vue.js')}?vue&type=style`, root)).toMatchObject({ name: 'vue' });
    expect(packageOf('\0vite/preload-helper.js', root)).toMatchObject({ name: 'vite' });
  });

  it('is nothing for first-party code or an id naming no file', () => {
    const root = repository();
    expect(packageOf(path.join(root, 'packages/renderer/src/main.ts'), root)).toBeUndefined();
    expect(packageOf('\0some-other-virtual', root)).toBeUndefined();
    expect(packageOf('relative/path.js', root)).toBeUndefined();
  });

  it('lists each package once, sorted, with the named ones added', () => {
    const root = repository();
    const ids = [path.join(root, 'node_modules/vue/dist/vue.js'), path.join(root, 'node_modules/vue/package.json')];
    expect(names(bundledPackages(ids, root, ['tailwindcss']))).toEqual(['tailwindcss@3.4.0', 'vue@3.5.0']);
  });
});

describe('the plugins', () => {
  it("hand over every chunk's modules from a Rollup or Vite build, and ignore assets", () => {
    const root = repository();
    let recorded: BundledPackage[] = [];
    const plugin = rollupBundledPackages((packages) => { recorded = packages; }, { fromDir: root });
    plugin.generateBundle.call(undefined, {}, {
      'index.js': { type: 'chunk', moduleIds: [path.join(root, 'node_modules/vue/dist/vue.js'), '\0vite/preload-helper.js'] },
      'index.css': { type: 'asset' },
    });
    expect(names(recorded)).toEqual(['vite@7.0.0', 'vue@3.5.0']);
  });

  it("hand over an esbuild build's inputs, esbuild itself and its metafile turned on", () => {
    const root = repository();
    let recorded: BundledPackage[] = [];
    let onEnd: ((result: { metafile?: { inputs: Record<string, unknown> } }) => void) | undefined;
    const initialOptions: { metafile?: boolean; absWorkingDir?: string } = { absWorkingDir: root };
    esbuildBundledPackages((packages) => { recorded = packages; }, { fromDir: root })
      .setup({ initialOptions, onEnd: (callback) => { onEnd = callback; } });
    expect(initialOptions.metafile).toBe(true);
    onEnd!({ metafile: { inputs: { 'node_modules/vue/dist/vue.js': {}, 'virtual-ns:thing': {} } } });
    expect(names(recorded)).toEqual(['esbuild@0.25.0', 'vue@3.5.0']);
  });
});
