import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { findPackageDirectory } from './package-inputs.ts';
import { SOURCE_CONDITION } from './source-resolution.ts';

/**
 * Packages a process must load once: pack runtimes, dependency runtimes, the app and tests share one
 * instance of each (the SDK's registries, the EARS engine's data). Every bundler external list, the
 * host pack loader's bridge, the pack test harness's bridge and bundle-package derive from this list.
 * The frontend shares only the SDK modules below (SDK_FE_MODULES): it keeps no EARS data, so a pack
 * frontend inlines what it imports from @apackdev/ears (constants and pure helpers). What a pack's
 * frontend may leave to the host is `sharedFeModules` below, which is those plus the shared deps and
 * @apackdev/ui's exports.
 */
export const SHARED_INSTANCE_PACKAGES = ['@apackdev/sdk', '@apackdev/ears'] as const;

/** The shared-instance package a specifier belongs to (`@apackdev/sdk/repositories` → `@apackdev/sdk`), if any */
export function sharedInstancePackage(specifier: string): string | undefined {
  return SHARED_INSTANCE_PACKAGES.find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

/** esbuild externals for the shared-instance packages and all their subpaths */
export function sharedInstanceExternals(): string[] {
  return SHARED_INSTANCE_PACKAGES.flatMap((pkg) => [pkg, `${pkg}/*`]);
}

/**
 * Shared-instance exports only the app's composition root loads, with the reason. Pack code never
 * requires them, so neither the pack loader's bridge nor the test harness's provides them.
 */
export const APP_ONLY_EXPORTS: Readonly<Record<string, string>> = {
  '@apackdev/ears/sqlite': "the app's SQLite databases; native storage bindings are not provided to packs",
  '@apackdev/ears/lmdb': "the app's elmdb databases; it loads elmdb, which only the app installs",
};

/**
 * The specifiers of a shared-instance package that backend code can require, read from its exports
 * map: every code export except the frontend's (`./fe`, `./fe/*`), metadata (`.json`), wildcards,
 * `APP_ONLY_EXPORTS` and exports only the monorepo resolves (an `@apackdev/source` target without a published one).
 */
export function sharedInstanceSpecifiers(pkg: string, exportsMap: Record<string, unknown>): string[] {
  const specifier = (key: string) => (key === '.' ? pkg : `${pkg}/${key.slice(2)}`);
  return Object.entries(exportsMap)
    .filter(([key, target]) =>
      !key.includes('*')
      && !Object.hasOwn(APP_ONLY_EXPORTS, specifier(key))
      && !key.endsWith('.json')
      && key !== './fe' && !key.startsWith('./fe/')
      && !(typeof target === 'object' && target !== null && Object.keys(target).every((condition) => condition === SOURCE_CONDITION)))
    .map(([key]) => specifier(key));
}

/**
 * The exports map of a shared-instance package as `fromFile` (a path or file URL) resolves it. A pack
 * that doesn't depend on one directly gets the copy its @apackdev/sdk resolves.
 */
export function sharedInstanceExports(pkg: string, fromFile: string): Record<string, unknown> {
  const require = createRequire(fromFile);
  let manifest: string;
  try {
    manifest = require.resolve(`${pkg}/package.json`);
  } catch (err) {
    if (pkg === SHARED_INSTANCE_PACKAGES[0]) throw err;
    const sdkManifest = fs.realpathSync(require.resolve(`${SHARED_INSTANCE_PACKAGES[0]}/package.json`));
    manifest = createRequire(sdkManifest).resolve(`${pkg}/package.json`);
  }
  return (JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { exports: Record<string, unknown> }).exports;
}

/**
 * Packages the host resolves for a pack, because neither the bundle nor the installed pack can carry them.
 *
 * Two shapes, both discovered the same way — the failure names the file it could not find:
 * - a **native binding**. `node-pty` requires `build/Release/pty.node`; `chokidar` optionally requires
 *   `fsevents`, whose binary is the same story. A `.node` is compiled machine code, so esbuild has no loader
 *   for one and the only answer is to resolve it at run time.
 * - a **shipped executable**. `@vscode/ripgrep` computes `rgPath` from its own `__dirname`, which inside a
 *   bundle is the bundle's directory and not the package's.
 *
 * So a pack bundle leaves them external (`@apackdev/cli`'s `be-bundler.ts`) and the bridge resolves them from
 * the loader (`withModuleBridge`'s `hostPackages`, `packs/runtime/bridge.ts`). Resolving from the loader is
 * the half that has to be here: `stagePack` copies a pack's `dist/{runtime,build,types}` and nothing else, so
 * an installed pack has no `node_modules` for an external specifier to come from, wherever it was installed
 * from. `packages/api` declares the two this app ships, and `electron-builder.mjs` packages both its
 * `node_modules` and the hoisted root one, which is what makes them resolvable beside the API bundle.
 *
 * A pack needing one this app does not have falls through to its own resolution and fails there, naming it —
 * a question about that pack rather than about this list. `fsevents` is the counter-example: chokidar
 * requires it in a try/catch and falls back to polling, so a pack runs without it either way.
 */
export const HOST_RESOLVED_BINARIES = ['node-pty', 'fsevents', '@vscode/ripgrep'] as const;

export interface SharedDep {
  globalKey?: string;
  /**
   * The module the host actually loads for this specifier, where that is a different module.
   *
   * `@tiptap/pm/<x>` is `export * from 'prosemirror-<x>'`, so the two specifiers name one module and both
   * have to reach it. Loaded separately they are two copies of ProseMirror — bundled twice in a pack, or
   * pre-bundled into two files by a dev server — which is the duplicate instance this list exists to
   * prevent, and the reason the canonical is the prosemirror package rather than the re-export.
   */
  canonical?: string;
  target: 'fe' | 'be' | 'both';
}

export const SHARED_DEPS: Record<string, SharedDep> = {
  'vue':                  { globalKey: 'vue',              target: 'fe' },
  'xstate':               { globalKey: 'xstate',           target: 'both' },
  '@xstate/vue':          { globalKey: 'xstateVue',        target: 'fe' },
  'zod':                  {                                target: 'be' },

  '@tiptap/core':         { globalKey: 'tiptapCore',       target: 'fe' },
  '@tiptap/vue-3':        { globalKey: 'tiptapVue3',       target: 'fe' },
  '@tiptap/starter-kit':  { globalKey: 'tiptapStarterKit', target: 'fe' },
  'reka-ui':              { globalKey: 'rekaUi',           target: 'fe' },
  'lucide-vue-next':      { globalKey: 'lucideVueNext',    target: 'fe' },
  '@vue-flow/core':       { globalKey: 'vueFlowCore',      target: 'fe' },
};

/**
 * Packages the host shares with every subpath they export, keyed by specifier. A pack that bundles
 * @apackdev/ui (build.bundleUi) imports ProseMirror and tiptap's Vue menus through these; sharing them
 * keeps one ProseMirror in the app, the host's.
 */
const SHARED_SUBPATH_PACKAGES = ['@tiptap/pm', '@tiptap/vue-3'];

/**
 * Exported code subpaths of a package installed near `fromDir` (`@tiptap/pm/state`, …).
 *
 * `fromDir` is the directory that owns the dependency — the pack being built, or the renderer — never
 * this module's own location. Resolving from here worked only because the CLI happened to sit in a
 * checkout whose node_modules had tiptap; under a global install, `npx` or pnpm it found nothing,
 * returned no subpaths, and a `build.bundleUi` pack quietly inlined its own ProseMirror — the duplicate
 * instance this list exists to prevent.
 */
function exportedSubpaths(name: string, fromDirs: readonly string[]): string[] {
  const manifestPath = fromDirs.flatMap((fromDir) => {
    const require = createRequire(path.join(fromDir, 'package.json'));
    return (require.resolve.paths(name) ?? []).map((dir) => path.join(dir, name, 'package.json'));
  }).find((file) => fs.existsSync(file));
  if (!manifestPath) return [];
  const exports: Record<string, unknown> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).exports ?? {};
  return Object.keys(exports)
    .filter((key) => key.startsWith('./') && !key.endsWith('.json') && !key.includes('*'))
    .map((key) => `${name}${key.slice(1)}`);
}

/** The shared subpath packages that resolve to nothing from `fromDir`, so none of their subpaths is shared */
export function unresolvedSubpathPackages(...fromDirs: string[]): string[] {
  return SHARED_SUBPATH_PACKAGES.filter((name) => exportedSubpaths(name, fromDirs).length === 0);
}

/**
 * @param fromDirs the directories whose installs own the shared packages, tried in order: the pack
 * being built and its `@apackdev/ui` (which is what actually depends on tiptap, and may hold its own
 * nested copy), or the renderer.
 */
export function getSharedFeDeps(...fromDirs: string[]): Record<string, SharedDep & { globalKey: string }> {
  const deps = Object.fromEntries(
    Object.entries(SHARED_DEPS).filter(([, d]) => d.target !== 'be' && d.globalKey),
  ) as Record<string, SharedDep & { globalKey: string }>;
  for (const specifier of SHARED_SUBPATH_PACKAGES.flatMap((name) => exportedSubpaths(name, fromDirs))) {
    // Libraries importing ProseMirror directly (prosemirror-markdown → prosemirror-model) get the same
    // module as the pack that imports it through tiptap, which is what `canonical` says above
    const pmModule = specifier.match(/^@tiptap\/pm\/(.+)$/)?.[1];
    const canonical = pmModule === undefined ? undefined : `prosemirror-${pmModule}`;
    deps[specifier] ??= { globalKey: specifier, target: 'fe', ...(canonical !== undefined && { canonical }) };
    if (canonical !== undefined) deps[canonical] ??= { globalKey: specifier, canonical, target: 'fe' };
  }
  return deps;
}

/**
 * Every specifier a pack's frontend may leave to the host, each naming the module the host loads for it.
 *
 * **One declaration with two readers**, which is what keeps them from disagreeing: the renderer serves each
 * distinct module (the values) and publishes the whole map to the document, and the pack bundler leaves
 * each key external. A specifier the host does not serve is one a pack's bundle cannot link against.
 *
 * `fromDirs` are the directories whose installs own these packages, as `getSharedFeDeps` takes them; the
 * first also decides which `@apackdev/ui` is read, since that is the one whose exports a pack compiles
 * against.
 */
export function sharedFeModules(...fromDirs: string[]): Readonly<Record<string, string>> {
  const modules: Record<string, string> = {};
  for (const [specifier, dep] of Object.entries(getSharedFeDeps(...fromDirs))) {
    modules[specifier] = dep.canonical ?? specifier;
  }
  for (const specifier of Object.keys(getSdkFeModules())) modules[specifier] = specifier;
  for (const specifier of Object.keys(getUiFeModules(fromDirs[0] ?? '.'))) modules[specifier] = specifier;
  return modules;
}

export interface SdkFeModule {
  globalKey: string;
}

export const SDK_FE_MODULES: Record<string, SdkFeModule> = {
  '@apackdev/sdk/fe':           { globalKey: 'sdkFe' },
  '@apackdev/sdk/fe/references': { globalKey: 'sdkFeReferences' },
  '@apackdev/sdk/runtime':      { globalKey: 'sdkRuntime' },
  '@apackdev/sdk/steps':        { globalKey: 'sdkSteps' },
  '@apackdev/sdk/artifacts':    { globalKey: 'sdkArtifacts' },
  '@apackdev/sdk/blocks':       { globalKey: 'sdkBlocks' },
  '@apackdev/sdk/designations': { globalKey: 'sdkDesignations' },
  '@apackdev/sdk/commands':     { globalKey: 'sdkCommands' },
  '@apackdev/sdk/events':       { globalKey: 'sdkEvents' },
  '@apackdev/sdk/helpers':      { globalKey: 'sdkHelpers' },
};

export function getSdkFeModules(): Record<string, SdkFeModule> {
  return SDK_FE_MODULES;
}

/**
 * Every @apackdev/ui export, shared with pack FE code like the SDK modules: the host serves each and names
 * it in the document's import map under its specifier. Read from the exports map of the @apackdev/ui that
 * `fromDir` resolves (the host's own, or a pack's).
 */
export function getUiFeModules(fromDir: string): Record<string, SdkFeModule> {
  const directory = findPackageDirectory(fromDir, '@apackdev/ui')?.directory;
  if (!directory) return {};
  const manifestPath = path.join(directory, 'package.json');
  const { exports } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { exports: Record<string, unknown> };
  return Object.fromEntries(
    Object.keys(exports)
      .filter((key) => key !== './package.json')
      .map((key) => {
        const specifier = `@apackdev/ui${key.slice(1)}`;
        return [specifier, { globalKey: specifier }];
      }),
  );
}

/**
 * The packages the host provides to pack backends. Their subpaths come with them: a pack bundle leaves the whole
 * package external (esbuild), so a dependency it bundles may require `zod/v4` where the pack imports `zod`, and the
 * bridge resolves any subpath of these from the host (`withModuleBridge`'s `hostPackages`).
 */
export function getSharedBeDeps(): string[] {
  return Object.keys(SHARED_DEPS).filter((name) => SHARED_DEPS[name].target !== 'fe');
}

export function findSdkVersion(startDir: string): string | undefined {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === '@apackdev/sdk') return pkg.version;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return undefined;
}
