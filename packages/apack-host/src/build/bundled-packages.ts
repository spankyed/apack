/**
 * The third-party packages a bundle inlined, as the bundler that inlined them reports it.
 *
 * A bundle carries the code of the packages it inlines and none of their license files, so whatever ships the bundle
 * owes their notices itself, and to owe them it has to know which packages they are. Every bundler here already
 * knows: Rollup lists the modules of each chunk it writes (`chunk.moduleIds`), esbuild the inputs of each build
 * (`metafile.inputs`). These plugins take that list and reduce it to packages, so nothing is inferred from the output.
 *
 * **What no module id names is added by name.** A bundler's own helpers carry no id of a package: esbuild's runtime
 * helpers, Vite's preload helper (`\0vite/preload-helper`), plugin-vue's export helper (`\0plugin-vue:export-helper`)
 * and the CommonJS helpers Vite bundles. The virtual ids map to the package that injected them; esbuild is added to
 * every esbuild build; and a caller names what a step outside the module graph injects, such as the CSS Tailwind
 * writes.
 *
 * Workspace packages are first-party and left out: `@app/*`, `@apackdev/*` and the repository's root package.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** A third-party package a bundle inlined: its name and version, and where its files are */
export interface BundledPackage {
  name: string;
  version: string;
  dir: string;
}

/** The virtual-id prefixes of code a bundler injects itself, and the package each is from */
const VIRTUAL_PACKAGES: readonly (readonly [prefix: string, packageName: string])[] = [
  ['vite/', 'vite'],
  ['plugin-vue:', '@vitejs/plugin-vue'],
  ['commonjsHelpers', 'vite'],
  ['commonjs-', 'vite'],
];

/** First-party: a workspace of this repository, or the repository's root package */
const isFirstParty = (name: string): boolean => name === 'apack' || name.startsWith('@app/') || name.startsWith('@apackdev/');

/** The nearest `package.json` naming a package at or above `dir`, or `undefined` past the filesystem's root */
function namedPackageAt(dir: string): BundledPackage | undefined {
  for (let current = dir; ; current = path.dirname(current)) {
    const manifest = path.join(current, 'package.json');
    if (fs.existsSync(manifest)) {
      const { name, version } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string; version?: string };
      if (name) return { name, version: version ?? '0.0.0', dir: current };
    }
    if (path.dirname(current) === current) return undefined;
  }
}

/** The installed package `name` as seen from `fromDir`, found the way Node finds one: up through `node_modules` */
export function installedPackage(name: string, fromDir: string): BundledPackage {
  for (let current = path.resolve(fromDir); ; current = path.dirname(current)) {
    const dir = path.join(current, 'node_modules', name);
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const found = namedPackageAt(fs.realpathSync(dir));
      if (found) return found;
    }
    if (path.dirname(current) === current) throw new Error(`${name} isn't installed above ${fromDir}`);
  }
}

/**
 * The third-party package a module id belongs to, or `undefined` for a first-party module or an id naming no file.
 * The id is a bundler's: a `\0` virtual id, a path with a query (`?vue&type=style`), or a plain path, which is
 * resolved to its real path so a linked package is found where its files are.
 */
export function packageOf(id: string, fromDir: string): BundledPackage | undefined {
  if (id.startsWith('\0')) {
    const virtual = VIRTUAL_PACKAGES.find(([prefix]) => id.slice(1).startsWith(prefix));
    if (virtual) return installedPackage(virtual[1], fromDir);
    id = id.slice(1);
  }
  const file = id.split('?')[0];
  if (!path.isAbsolute(file) || !fs.existsSync(file)) return undefined;
  const found = namedPackageAt(path.dirname(fs.realpathSync(file)));
  return found && !isFirstParty(found.name) ? found : undefined;
}

/** The distinct packages of some module ids plus the named ones, sorted by name and then version */
export function bundledPackages(ids: Iterable<string>, fromDir: string, named: readonly string[] = []): BundledPackage[] {
  const byDir = new Map<string, BundledPackage>();
  for (const id of ids) {
    const found = packageOf(id, fromDir);
    if (found) byDir.set(found.dir, found);
  }
  for (const name of named) {
    const found = installedPackage(name, fromDir);
    byDir.set(found.dir, found);
  }
  // A fixed order whatever the machine's locale
  const key = (pkg: BundledPackage) => `${pkg.name}@${pkg.version}`;
  return [...byDir.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** The part of a Rollup or Vite plugin this needs, so neither package has to be a dependency of this one */
export interface BundleRecordingPlugin {
  name: string;
  generateBundle(this: unknown, options: unknown, bundle: Record<string, { type: string; moduleIds?: readonly string[] }>): void;
}

/**
 * A Rollup (or Vite) plugin handing `record` the packages of every chunk the build writes, plus `named`. A Vite build
 * bundles each `?worker` import separately with `worker.plugins`, so a config with workers lists it there too.
 */
export function rollupBundledPackages(
  record: (packages: BundledPackage[]) => void,
  options: { fromDir: string; named?: readonly string[] },
): BundleRecordingPlugin {
  return {
    name: 'apack:bundled-packages',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((output) => (output.type === 'chunk' ? output.moduleIds ?? [] : []));
      record(bundledPackages(ids, options.fromDir, options.named));
    },
  };
}

/** The part of an esbuild plugin this needs */
export interface EsbuildRecordingPlugin {
  name: string;
  setup(build: {
    initialOptions: { metafile?: boolean; absWorkingDir?: string };
    onEnd(callback: (result: { metafile?: { inputs: Record<string, unknown> } }) => void): void;
  }): void;
}

/**
 * An esbuild plugin handing `record` the packages of each build's inputs, plus esbuild, whose runtime helpers every
 * bundle it writes may hold, plus `named`. It turns the metafile on, which a build computes anyway.
 */
export function esbuildBundledPackages(
  record: (packages: BundledPackage[]) => void,
  options: { fromDir: string; named?: readonly string[] },
): EsbuildRecordingPlugin {
  return {
    name: 'apack:bundled-packages',
    setup(build) {
      build.initialOptions.metafile = true;
      const workingDir = build.initialOptions.absWorkingDir ?? process.cwd();
      build.onEnd((result) => {
        if (!result.metafile) return;
        // An input is a path relative to the working directory, or `namespace:path` for one no file holds; a
        // namespace is longer than a Windows drive letter
        const files = Object.keys(result.metafile.inputs).filter((input) => !/^[a-z][a-z-]+:/i.test(input))
          .map((input) => path.resolve(workingDir, input));
        record(bundledPackages(files, options.fromDir, ['esbuild', ...(options.named ?? [])]));
      });
    },
  };
}
