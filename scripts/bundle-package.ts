// Builds a publishable copy of a workspace package that ships as a bundle (@apackdev/cli,
// @apackdev/testing) into <package>/dist/package. The shared-instance packages (SHARED_INSTANCE_PACKAGES)
// and the private @apackdev/host are inlined from source, so the published package can use host-only
// modules. The app-only SQLite entry stays external to preserve package-relative native/vector/WASM
// assets. Other packages stay external and become dependencies at the version the workspace uses.
//
//   tsx scripts/bundle-package.ts packages/apack-cli
import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { packageName } from '@apackdev/host/build/specifiers';
import { recordBundleReads, runPackageBuild } from '@apackdev/host/build/packages-built';
import { replaceDir } from '@apackdev/host/replace-dir';
import { manifestPaths, publishedSpec, type Manifest } from '@apackdev/host/build/published-manifest';
import { SHARED_INSTANCE_PACKAGES } from '@apackdev/host/build/shared-deps';
import ts from 'typescript';
import { BareImports } from './lib/published-imports.ts';
import { build, type BuildOptions, type Plugin } from 'esbuild';

interface BundleConfig {
  /** Entry name (output dist/<name>.js) → source file, relative to the package */
  entries: Record<string, string>;
  /** Native require preloads run before ESM/compiler activation. */
  commonjsEntries?: Record<string, string>;
  /**
   * Entries bundled with the shared-instance packages external instead of inlined: they run inside a
   * pack's process and must share the pack's installed instances (the SDK's registries, the EARS
   * engine), not carry their own copies: the published package declares them as peer dependencies.
   */
  sharedExternalEntries?: Record<string, string>;
  /** Extra files copied verbatim into the published package */
  copy?: string[];
  /** Emit dist/<entry>.d.ts for each entry */
  declarations?: boolean;
  /** Fields replacing the workspace ones in the published package.json */
  manifest: Record<string, unknown>;
}

const CONFIGS: Record<string, BundleConfig> = {
  '@apackdev/cli': {
    entries: { cli: 'src/index.ts', 'build-worker': 'src/build/build-worker.ts', 'frontend-worker': 'src/build/frontend-worker.ts' },
    commonjsEntries: { 'compiler-startup': 'src/build/compiler-startup.ts' },
    copy: ['bin/apack.mjs', 'bin/compiler-windows.ps1', 'bin/compiler-helper-job.ps1', 'bin/compiler-pe-context.ps1', 'bin/compiler-pe-process.ps1', 'bin/compiler-source-hooks.mjs', 'bin/compiler-startup-coordinator.mjs', 'bin/compiler-startup-loader.mjs', 'bin/compiler-import.cjs', 'templates'],
    manifest: { bin: { apack: 'bin/apack.mjs' } },
  },
  '@apackdev/testing': {
    // vitest-exit-with-parent, vitest-worker and vitest-teardown are loaded by path from dist/vitest.js's isolatedDataDir()
    entries: { index: 'src/index.ts', playwright: 'src/playwright.ts', vitest: 'src/vitest.ts', 'vitest-worker': 'src/vitest-worker.ts', 'vitest-exit-with-parent': 'src/vitest-exit-with-parent.ts', 'vitest-teardown': 'src/vitest-teardown.ts' },
    sharedExternalEntries: { harness: 'src/harness.ts' },
    declarations: true,
    manifest: { exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './playwright': { types: './dist/playwright.d.ts', default: './dist/playwright.js' },
      './vitest': { types: './dist/vitest.d.ts', default: './dist/vitest.js' },
      './harness': { types: './dist/harness.d.ts', default: './dist/harness.js' },
    } },
  },
};

/** Every path the published manifest points at, as [what names it, where it points] */
function publishedPaths(config: BundleConfig, pkgDir: string): [string, string][] {
  // The same walk the staged packages' manifests get (`@apackdev/host/build/published-manifest`), so a generated
  // manifest and a derived one are held to one answer about what a manifest names
  const paths: [string, string][] = [...manifestPaths(config.manifest as Manifest)];
  for (const file of config.copy ?? []) {
    // A directory entry becomes its files, because `existsSync` is true of an empty directory and shipping an
    // empty `templates/` is exactly the failure this assertion is for: the CLI would scaffold nothing, and only
    // `test-packaged-authoring.sh` runs the published layout.
    const from = path.join(pkgDir, file);
    if (fs.existsSync(from) && fs.statSync(from).isDirectory()) {
      for (const inside of filesUnder(from)) paths.push(['a copied file', path.join(file, inside)]);
    } else paths.push(['a copied file', file]);
  }
  return paths;
}

/** Every file under `dir`, relative to it: what a copied directory entry stands for */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(path.join(dir, entry.name)).map((inside) => path.join(entry.name, inside))
      : [entry.name]);
}

/**
 * Every file the published package points at is there. Declarations are the fragile half: tsc puts them
 * under the common source directory of the whole program, so one entry importing a file from outside the
 * package moves all of them, and the exports map would point at nothing. npm packs that without a word
 * and a dependent then sees an untyped module, so the build fails here instead. `bin` and the copied
 * files are checked with them: the CLI publishes no exports map, and its bin is how the layout is read.
 */
function assertPublishedPathsExist(config: BundleConfig, pkgDir: string, outDir: string, name: string): void {
  const missing = publishedPaths(config, pkgDir)
    .filter(([, target]) => !fs.existsSync(path.join(outDir, target)))
    .map(([names, target]) => `  ${name} ${names}: ${target}`);
  if (missing.length > 0) {
    throw new Error(`The published package names files this build did not write:\n${missing.join('\n')}\n`
      + 'A declaration emitted somewhere else means an entry reached outside the package: import it through a package specifier instead.');
  }
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const pkgDir = path.resolve(process.argv[2] ?? '');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
const config = CONFIGS[pkg.name];
if (!config) throw new Error(`No bundle config for ${pkg.name}`);

const outDir = path.join(pkgDir, 'dist', 'package');
/** Built here and renamed over `dist/package` at the end; `scripts/build-package.ts` says why */
const stagedDir = path.join(pkgDir, '.temp', 'build');
const workspaceManifestFile = (name: string) => createRequire(path.join(repoRoot, 'package.json')).resolve(`${name}/package.json`);
const workspaceManifest = (name: string) => JSON.parse(fs.readFileSync(workspaceManifestFile(name), 'utf-8'));
const sharedPkgs = SHARED_INSTANCE_PACKAGES.map(workspaceManifest);
const hostPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'apack-host', 'package.json'), 'utf-8'));
const SHARED = new Set<string>(SHARED_INSTANCE_PACKAGES);
const INLINED = new Set([...SHARED, '@apackdev/host']);

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const externalizeAllButInlined: Plugin = {
  name: 'externalize-all-but-inlined',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      // SQLite's native extension and regex assets resolve relative to its own package.
      if (args.path === '@apackdev/ears/sqlite') return { path: args.path, external: true };
      if (args.kind === 'entry-point' || INLINED.has(packageName(args.path))) return undefined;
      return { path: args.path, external: true };
    });
  },
};

function versionOf(name: string): string {
  // The package's own ranges win; inlined shared-instance and host code brings their ranges. A `file:` range, relative to
  // the manifest declaring it, is published as the version it links
  const sources: Array<[Record<string, string> | undefined, string]> = [
    [pkg.dependencies, pkgDir], [pkg.peerDependencies, pkgDir],
    ...SHARED_INSTANCE_PACKAGES.flatMap((shared, i) => [[sharedPkgs[i].dependencies, path.dirname(workspaceManifestFile(shared))], [sharedPkgs[i].peerDependencies, path.dirname(workspaceManifestFile(shared))]] as Array<[Record<string, string> | undefined, string]>),
    [hostPkg.dependencies, path.join(repoRoot, 'packages', 'apack-host')],
  ];
  for (const [source, dir] of sources) {
    if (source?.[name]) return publishedSpec(source[name], dir);
  }
  throw new Error(`${pkg.name} bundle imports ${name}, which neither ${pkg.name}, the shared-instance packages nor @apackdev/host declares`);
}

const externalizeAllButHost: Plugin = {
  name: 'externalize-all-but-host',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point' || packageName(args.path) === '@apackdev/host') return undefined;
      return { path: args.path, external: true };
    });
  },
};

const sharedOptions = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  metafile: true,
  logLevel: 'warning',
  conditions: ['@apackdev/source', 'module'],
  banner: { js: "import { createRequire as __apackCreateRequire } from 'node:module'; const require = __apackCreateRequire(import.meta.url);" },
} satisfies BuildOptions;

/**
 * The declarations a consumer can reach: every `types` target the exports map names, and every declaration
 * those import by relative path, transitively. What lies outside is shipped weight rather than published
 * surface — a different problem from this one, and conflating them makes this check report a file nothing
 * can import.
 */
function reachableDeclarations(outDir: string, manifest: Manifest): string[] {
  const exports = (manifest.exports ?? {}) as Record<string, { types?: string }>;
  const queue = Object.values(exports)
    .map((target) => target?.types)
    .filter((types): types is string => typeof types === 'string')
    .map((types) => path.join(outDir, types));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const info = ts.preProcessFile(fs.readFileSync(file, 'utf-8'), true, true);
    for (const { fileName } of info.importedFiles) {
      if (!fileName.startsWith('.')) continue;
      queue.push(path.resolve(path.dirname(file), fileName.replace(/\.js$/, '.d.ts')));
    }
  }
  return [...seen];
}

async function main(): Promise<void> {
  fs.rmSync(stagedDir, { recursive: true, force: true });
  fs.mkdirSync(stagedDir, { recursive: true });
  // The swap renames onto `dist/package`, so its parent has to be there to rename into
  fs.mkdirSync(path.dirname(outDir), { recursive: true });

  const sharedExternal = config.sharedExternalEntries && await build({
    ...sharedOptions,
    entryPoints: Object.fromEntries(Object.entries(config.sharedExternalEntries).map(([name, src]) => [name, path.join(pkgDir, src)])),
    outdir: path.join(stagedDir, 'dist'),
    plugins: [externalizeAllButHost],
  });

  const result = await build({
    entryPoints: Object.fromEntries(Object.entries(config.entries).map(([name, src]) => [name, path.join(pkgDir, src)])),
    outdir: path.join(stagedDir, 'dist'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    metafile: true,
    logLevel: 'warning',
    // Inlined workspace packages bundle from source (see their package.json exports)
    conditions: ['@apackdev/source', 'module'],
    // Bundled CommonJS dependencies may call require(); give ESM chunks one
    banner: { js: "import { createRequire as __apackCreateRequire } from 'node:module'; const require = __apackCreateRequire(import.meta.url);" },
    plugins: [externalizeAllButInlined],
  });

  const commonjs = config.commonjsEntries && await build({
    entryPoints: Object.fromEntries(Object.entries(config.commonjsEntries).map(([name, src]) => [name, path.join(pkgDir, src)])),
    outdir: path.join(stagedDir, 'dist'), outExtension: { '.js': '.cjs' },
    bundle: true, format: 'cjs', platform: 'node', target: 'node22', metafile: true,
    conditions: ['@apackdev/source'], plugins: [externalizeAllButInlined],
  });

  // What the bundle read, for `dep-files.integration.spec.ts` to hold this unit's declaration to. An
  // observation and never a key: see `bundleReadsFile`.
  //
  // **Repo-relative, which the metafile's paths are not**: esbuild reports them relative to its working
  // directory, so an inlined workspace package arrives as `../apack-ears/src/x.ts` — which is why the first
  // version of this recorded zero of the files it exists to record. A dependency under a real `node_modules`
  // is left out: those are covered by `package-lock.json`, which every unit declares.
  const repoRelative = (input: string): string => path.relative(repoRoot, path.resolve(pkgDir, input));
  recordBundleReads(pkg.name, [...new Set([
    ...Object.keys(result.metafile.inputs), ...Object.keys(sharedExternal?.metafile?.inputs ?? {}), ...Object.keys(commonjs?.metafile?.inputs ?? {}),
  ])].map(repoRelative).filter((file) => !file.startsWith('..') && !file.includes('node_modules/')));

  const imported = new Set<string>();
  for (const output of [...Object.values(result.metafile.outputs), ...Object.values(sharedExternal?.metafile?.outputs ?? {}), ...Object.values(commonjs?.metafile?.outputs ?? {})]) {
    for (const imp of output.imports) {
      if (imp.external && !builtins.has(imp.path)) imported.add(packageName(imp.path));
    }
  }

  // Declared dependencies stay (some are only loaded by other dependencies, e.g. vue for
  // @vitejs/plugin-vue); packages the inlined SDK code imports are added
  const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));
  const dependencies: Record<string, string> = { ...pkg.dependencies };
  for (const name of imported) {
    if (!peers.has(name) && !SHARED.has(name)) dependencies[name] ??= versionOf(name);
  }
  const peerDependencies: Record<string, string> = { ...pkg.peerDependencies };
  for (const shared of sharedPkgs) {
    if (config.sharedExternalEntries && imported.has(shared.name)) {
      // Those entries run on the pack's installed instances: a peer, so the package never brings its own copy
      delete dependencies[shared.name];
      peerDependencies[shared.name] = `^${shared.version}`;
    } else if (dependencies[shared.name]) {
      // Packs build against the version released with this package
      dependencies[shared.name] = shared.version;
    }
  }
  // The private host package is inlined, never installed
  delete dependencies['@apackdev/host'];

  for (const file of config.copy ?? []) {
    const from = path.join(pkgDir, file);
    const dest = path.join(stagedDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // A directory as well as a file, since the CLI ships its scaffold templates as a tree. `copyFileSync`
    // throws EISDIR on one, which is how this was found rather than shipped empty.
    if (fs.statSync(from).isDirectory()) fs.cpSync(from, dest, { recursive: true });
    else fs.copyFileSync(from, dest);
  }

  if (config.declarations) {
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    const entryFiles = [...Object.values(config.entries), ...Object.values(config.sharedExternalEntries ?? {})].map((src) => path.join(pkgDir, src));
    execFileSync(process.execPath, [
      tsc, ...entryFiles, '--declaration', '--emitDeclarationOnly', '--outDir', path.join(stagedDir, 'dist'),
      '--module', 'esnext', '--moduleResolution', 'bundler', '--customConditions', '@apackdev/source', '--allowImportingTsExtensions', '--target', 'es2022',
      '--strict', '--esModuleInterop', '--skipLibCheck', '--types', 'node',
    ], { stdio: 'inherit' });
  }

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/spankyed/apack.git', directory: `packages/${path.basename(pkgDir)}` },
    type: 'module',
    engines: pkg.engines,
    ...config.manifest,
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    peerDependencies: Object.keys(peerDependencies).length > 0 ? peerDependencies : undefined,
    peerDependenciesMeta: pkg.peerDependenciesMeta,
    publishConfig: { access: 'public', provenance: true },
  };
  fs.writeFileSync(path.join(stagedDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  assertPublishedPathsExist(config, pkgDir, stagedDir, pkg.name);

  // The declarations must name only packages a consumer installs. `tsc --emitDeclarationOnly` copies a bare
  // specifier through untouched where esbuild would have inlined the same import — so a type taken from
  // `@apackdev/host`, which is inlined and deliberately absent from `dependencies` above, resolves at runtime
  // and is `any` to anyone type-checking. `build-package.ts` and `build-ui-package.ts` have asserted this
  // since they were written; this build emitted declarations without it, which is how one reached
  // @apackdev/testing's harness and was found by reading the built file rather than by any check.
  if (config.declarations) {
    // Reachable from the exports map, not every file tsc emitted. `build-package.ts` walks the whole tree
    // because for @apackdev/ears and /sdk every dist module is an export; a bundled package has three entries
    // and tsc writes a declaration per module it compiled, so walking everything reports a module a consumer
    // cannot name — `checkout-freshness.d.ts` takes a host type in an options bag only this package's own
    // spec passes, and no entry's declaration mentions it.
    const bareImports = new BareImports(stagedDir);
    for (const file of reachableDeclarations(stagedDir, manifest as Manifest)) {
      bareImports.fromDeclaration(fs.readFileSync(file, 'utf-8'), file);
    }
    bareImports.assertDeclared(manifest as Parameters<BareImports['assertDeclared']>[0],
      path.join(path.relative(repoRoot, pkgDir), 'package.json'));
  }
  // Every check above has passed against the staged tree, so this is the moment it becomes the built one
  replaceDir(stagedDir, outDir);
  console.log(`Built ${pkg.name}@${pkg.version} into ${path.relative(process.cwd(), outDir)}`);
}

// The build's own success stamp: written only if main() returns, and cleared before it touches dist/package
await runPackageBuild(pkg.name, main);
