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
import { fileURLToPath } from 'node:url';
import { PACK_BUILD_STAGING_DIR } from './pack-workdir.ts';

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

/**
 * The `@apackdev` packages published from other repositories (apack-git's, and apack-terminal's two), which the root's
 * `overrides` take from each repository's release. They share the scope and are third-party here, as elmdb's are
 */
export const OTHER_REPOSITORY_PACKAGES: ReadonlySet<string> = new Set(['@apackdev/git', '@apackdev/terminal', '@apackdev/terminal-view']);

/** The platform packages `@apackdev/terminal` installs its broker from, one per target (`@apackdev/terminal-darwin-arm64`) */
const BROKER_PLATFORM_PACKAGE = /^@apackdev\/terminal-(darwin|linux|win32)-/;

/** First-party: a workspace of this repository, or the repository's root package */
export const isFirstParty = (name: string): boolean => name === 'apack' || name.startsWith('@app/')
  || (name.startsWith('@apackdev/') && !OTHER_REPOSITORY_PACKAGES.has(name) && !BROKER_PLATFORM_PACKAGE.test(name));

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

/** The packages a module path runs through `node_modules` to, outermost first */
const namedThrough = (module: string): string[] => [...module.matchAll(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g)].map(([, name]) => name.replace('\\', '/'));

/**
 * The package a module path runs through `node_modules` to, by its names alone, for a path that is no file: found from
 * `fromDir` one `node_modules` at a time, as Node finds a nested install. It throws for a name that isn't installed,
 * so a nested package that is gone is never taken for the one it was nested in
 */
function installedThrough(names: readonly string[], fromDir: string): BundledPackage {
  let found = installedPackage(names[0], fromDir);
  for (const name of names.slice(1)) found = installedPackage(name, found.dir);
  return found;
}

/** A path to a script with no space in it, which a `// ` line naming no file is still taken for a module by */
const SCRIPT_PATH = /^\S+\.[cm]?[jt]sx?$/;

/**
 * Every third-party package a built pack's bundles inlined, read from the bundles themselves: a bundle with a source
 * map names its modules in the map's `sources`, relative to the map; one without, as esbuild writes a pack's build
 * helpers, names each module in a `// <path>` comment, relative to the pack, whatever the module is: a script, a
 * package's JSON, a path with spaces. A bundle with neither cannot say what it inlined, and is a problem rather than an
 * empty list.
 *
 * **A module is its package's by where its file is** (`packageOf`): a pack can inline another workspace's or a
 * dependency's copy of a package the pack itself would resolve at another version. Only a module that is no file is told
 * by the names in its path, and one whose names don't resolve is a problem.
 *
 * A pack's CSS says nothing of where it came from, so a package a pack takes only CSS from is not found here.
 */
export function readPackBundledPackages(packDir: string): { packages: BundledPackage[]; problems: string[] } {
  const dist = path.join(packDir, 'dist');
  const noBundle = `${dist} holds no bundle: build the pack before packaging`;
  if (!fs.existsSync(dist)) return { packages: [], problems: [noBundle] };
  const bundles = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) => /\.(c|m)?js$/.test(file));
  const ids: string[] = [];
  const named = new Map<string, BundledPackage>();
  const problems: string[] = [];
  const isFile = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  const credit = (module: string, resolved: string, unknown: string) => {
    if (isFile(resolved)) { ids.push(resolved); return; }
    const names = namedThrough(module);
    if (!names.length) { problems.push(unknown); return; }
    try {
      const installed = installedThrough(names, packDir);
      named.set(installed.dir, installed);
    } catch (error) { problems.push(`${unknown}: ${(error as Error).message}`); }
  };
  for (const bundle of bundles) {
    const file = path.join(dist, bundle);
    const name = path.relative(packDir, file);
    if (fs.existsSync(`${file}.map`)) {
      const { sources = [] } = JSON.parse(fs.readFileSync(`${file}.map`, 'utf8')) as { sources?: string[] };
      // A pack is built in a staging directory and copied, so a source's relative path is the staging directory's
      const staged = path.join(packDir, PACK_BUILD_STAGING_DIR, path.dirname(bundle));
      for (const entry of sources) {
        // A source no relative path reaches, such as one on another drive than the map on Windows, is a `file:` URL
        const source = entry.startsWith('file:') ? fileURLToPath(entry) : entry;
        // A bundler's own virtual module, which `packageOf` knows by its id, unless it is a package's file under a query
        if (source.startsWith('\0') && !namedThrough(source).length) { ids.push(source); continue; }
        const module = (source.startsWith('\0') ? source.slice(1) : source).split('?')[0];
        credit(module, path.resolve(staged, module), `${name}.map names ${source}, which is not where its build left it, so its package is unknown`);
      }
      continue;
    }
    // esbuild keeps no comment of the source's but a legal one, so a `// ` line is a module's, or text inside a string:
    // one naming a file is a module, and one naming none is taken for a module only when it looks like a script's path
    const modules = [...fs.readFileSync(file, 'utf8').matchAll(/^\/\/ (.+)$/gm)].map(([, module]) => module)
      .filter((module) => isFile(path.resolve(packDir, module)) || SCRIPT_PATH.test(module));
    for (const module of modules) credit(module, path.resolve(packDir, module), `${name} names ${module}, which is not there, so its package is unknown`);
    if (!modules.length) problems.push(`${name} has no source map and names no module, so what it inlined is unknown`);
  }
  if (!bundles.length) problems.push(noBundle);
  // What the bundlers inject with no module of a package: esbuild's and Vite's helpers, plugin-vue's, and the pack's
  // CSS, which Tailwind writes (the pack builder runs every pack's CSS through it)
  const css = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' }).some((file) => file.endsWith('.css'));
  const injected = ['esbuild', 'vite', '@vitejs/plugin-vue', ...(css ? ['tailwindcss'] : [])];
  let fromModules: BundledPackage[] = [];
  try {
    // Two esbuilds write a pack's bundles: the one the pack builder calls for the build helpers, and the one Vite
    // depends on, which transforms and minifies the frontend and is another install when Vite asks for a newer one
    fromModules = [...bundledPackages(ids, packDir, injected), installedPackage('esbuild', installedPackage('vite', packDir).dir)];
  } catch (error) { problems.push((error as Error).message); }
  const found = new Map([...fromModules, ...named.values()].map((pkg) => [pkg.dir, pkg]));
  // The pack's own sources belong to this pack regardless of its npm name. An installed
  // dependency that happens to use that same name still belongs to its own directory.
  const authoredDir = fs.realpathSync(packDir);
  const packages = [...found.values()].filter((pkg) => pkg.dir !== authoredDir && !isFirstParty(pkg.name));
  return { packages, problems };
}
