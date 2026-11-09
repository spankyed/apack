import { compilerEnvironmentIdentity } from './compiler-environment.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { InlineConfig, Plugin as VitePlugin } from 'vite';
import { getSharedFeDeps, unresolvedSubpathPackages, getSdkFeModules, getUiFeModules, sharedFeModules, sharedInstancePackage } from '@apackdev/host/build/shared-deps';
import type { RecordReads } from './build-reads';
import type { RecordBuildOutput } from './build-outputs.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { BuildWatchInputs } from './build-watch-inputs.ts';
import { globWatchPlugin } from './glob-watch.ts';
import type { CompilationInputs } from './compilation-inputs.ts';
import { relativeCompilerPath, withCompilerFileReads } from '@apackdev/host/build/compiler-inputs';
import { findPackageDirectory } from '@apackdev/host/build/package-inputs';
import { DEV_SERVER_HOST } from '@apackdev/host/packs/dev-server';
import { parseNodeOptions, withoutSourceCondition } from '@apackdev/host/build/source-resolution';

/**
 * The package names the pack declares opaque to the bundler (`build.opaqueDeps`). Unreadable is an error
 * for the reason `bundlesUi` makes it one: reading it as "none" would silently spend the build walking
 * what the pack asked it not to.
 */
function opaqueDeps(packDir: string): string[] {
  const manifestPath = path.join(packDir, 'apack.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const declared = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).build?.opaqueDeps;
    return Array.isArray(declared) ? (declared as string[]) : [];
  } catch (err) {
    throw new Error(`Couldn't read ${manifestPath}, so the FE build can't tell which dependencies this pack declares opaque (build.opaqueDeps): ${errorMessage(err)}`);
  }
}

/**
 * Includes a declared dependency whole rather than tree-shaking it.
 *
 * **Rollup's include pass is what this is about, not the output.** Walking a prebuilt bundle costs most
 * of the frontend phase and removes almost nothing from it: measured on the pack the app ships,
 * 2026-10-08, declaring its one such dependency opaque took `apack pack build` from 23.3s to 20.6s, median
 * of 3 interleaved runs, for 38 KB on an 8.5 MB output. Taking that dependency out of the graph
 * altogether is 18.5s, which is the ceiling this cannot reach — the module still has to be parsed and
 * emitted, because it is what the pack loads at runtime.
 *
 * `moduleSideEffects: 'no-treeshake'` is rollup's own primitive for it, so the module is retained
 * exactly as published. Nothing else changes: every other module is shaken as before, which is what
 * keeps the guarantees that rest on it — `fe-bundler-host-registry.integration.spec.ts`' EARS facade
 * among them.
 */
function opaqueVendorPlugin(deps: readonly string[]): VitePlugin {
  const declares = (source: string) => deps.some((dep) => source === dep || source.startsWith(`${dep}/`));
  return {
    name: 'apack-opaque-deps',
    // Before Vite's own resolver, which would otherwise have answered already
    enforce: 'pre',
    async resolveId(source: string, importer: string | undefined) {
      if (!declares(source)) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved ? { id: resolved.id, moduleSideEffects: 'no-treeshake' } : null;
    },
  };
}

/**
 * Whether the pack's apack.json opts into bundling its own copy of @apackdev/ui (`build.bundleUi`).
 * No manifest is fine — `bundleUi` is opt-in, and only a pack directory has one. A manifest that is
 * there but unreadable is not: it may be the one that opts in, and reading it as "no" would quietly
 * proxy @apackdev/ui to the host and skip its Tailwind classes.
 */
function bundlesUi(packDir: string): boolean {
  const manifestPath = path.join(packDir, 'apack.json');
  if (!fs.existsSync(manifestPath)) return false;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).build?.bundleUi === true;
  } catch (err) {
    throw new Error(`Couldn't read ${manifestPath}, so the FE build can't tell whether this pack bundles @apackdev/ui (build.bundleUi): ${errorMessage(err)}`);
  }
}

/**
 * Tailwind content globs for the @apackdev/ui a pack bundles: its build, which is what a pack resolves.
 * Only reached for a pack that set `build.bundleUi`, so anything that leaves Tailwind nothing to read is a
 * build failure — its components are nothing but Tailwind classes, and empty globs would bundle every
 * one of them unstyled, with no error. An unresolvable package and a package whose build is missing are
 * the same fault to the pack author: what they get is an unstyled app.
 */
/** Every file under `dir`, at any depth, with this extension */
function filesWith(dir: string, ext: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? filesWith(path.join(dir, entry.name), ext)
    : entry.name.endsWith(ext) ? [path.join(dir, entry.name)] : []));
}

/**
 * The files Tailwind scans for @apackdev/ui's class names are compiler inputs like any other a build reads,
 * and a build captures a dependency file when it is first read. Reading them through the compilation before
 * Vite runs is what puts them in the build's read tree, where Tailwind's scan resolves; unread, the scan
 * finds nothing and the bundle ships the components unstyled.
 */
function uiTailwindContent(packDir: string, compilation?: CompilationInputs): string[] {
  let uiDir: string;
  try {
    uiDir = path.dirname(fs.realpathSync(createRequire(path.join(packDir, 'package.json')).resolve('@apackdev/ui/package.json')));
  } catch (err) {
    throw new Error(
      `This pack sets build.bundleUi, but @apackdev/ui can't be resolved from ${packDir}, so Tailwind would generate none of its components' classes: ${errorMessage(err)}`,
    );
  }
  const built = path.join(uiDir, 'dist');
  const content = path.join(built, '**/*.js');
  // Tailwind reads class names out of the built modules and silently generates nothing when it finds no
  // file to read — so check for what the glob actually matches, not merely that the directory is non-empty
  const modules = fs.existsSync(built) ? filesWith(built, '.js') : [];
  if (modules.length === 0) {
    throw new Error(
      `This pack sets build.bundleUi, but @apackdev/ui has no built modules at ${content}, so Tailwind would generate none of its components' classes. Build the packages first: npm run packages:ensure`,
    );
  }
  for (const file of modules) compilation?.readFile(file);
  return [content];
}

/** A pack's @apackdev/ui, which is what depends on tiptap and may hold its own nested copy */
function uiPackageDir(packDir: string): string | undefined {
  return findPackageDirectory(packDir, '@apackdev/ui')?.directory;
}

/**
 * The directories whose installs own the shared packages, in the order they are tried: the pack, then its
 * `@apackdev/ui` — which is what actually depends on tiptap and may hold its own nested copy.
 *
 * **Every consumer of the shared list resolves from the same two.** They are what makes the tiptap and
 * ProseMirror subpaths resolvable at all for a pack that does not depend on tiptap directly, so a consumer
 * passing only the pack dir gets a *shorter* list and no error — and two consumers with different lists is
 * one externalising a specifier the other does not know about.
 */
function sharedResolveDirs(packDir: string): string[] {
  return [packDir, uiPackageDir(packDir)].filter((dir): dir is string => dir !== undefined);
}

/** Every specifier this pack leaves for the host to resolve, which is the shared list minus its opt-out */
function packSharedSpecifiers(packDir: string): string[] {
  return Object.keys(sharedFeModules(...sharedResolveDirs(packDir))).filter(
    (specifier) => !(bundlesUi(packDir) && /^@apackdev\/ui(\/|$)/.test(specifier)),
  );
}

export function packExternalsPlugin(packDir: string): VitePlugin {
  const resolveFrom = sharedResolveDirs(packDir);
  const feDeps = getSharedFeDeps(...resolveFrom);
  // A bundleUi pack imports ProseMirror and tiptap's Vue menus through the shared subpaths. If they
  // resolve to nothing the pack inlines its own copy and the app ends up with two ProseMirror
  // instances, which fails at runtime in ways that do not point here — so fail now, naming them.
  if (bundlesUi(packDir)) {
    const unresolved = unresolvedSubpathPackages(...resolveFrom);
    if (unresolved.length > 0) {
      throw new Error(
        `This pack sets build.bundleUi, but ${unresolved.join(' and ')} cannot be resolved from ${packDir}, so the pack would bundle its own ProseMirror instead of sharing the app's. Install ${unresolved.length > 1 ? 'them' : 'it'} in the pack.`,
      );
    }
  }
  const sdkModules = getSdkFeModules();
  // @apackdev/ui comes from the host like the SDK modules, unless the pack bundles all of it
  const uiModules = bundlesUi(packDir) ? {} : getUiFeModules(packDir);

  // SDK modules resolve through Vite (this.resolve), so the build's conditions apply: a pack
  // linked to a checkout's workspace SDK gets its source, an installed SDK its dist.
  const packImporter = path.join(packDir, 'package.json');
  type ResolveContext = { resolve: (source: string, importer?: string, options?: { skipSelf?: boolean }) => Promise<{ id: string; external?: boolean | string } | null> };
  async function resolveSdkFile(ctx: ResolveContext, specifier: string): Promise<string | undefined> {
    const resolved = await ctx.resolve(specifier, packImporter, { skipSelf: true });
    const file = resolved && !resolved.external ? resolved.id.split('?')[0] : undefined;
    return file && fs.existsSync(file) ? fs.realpathSync(file) : undefined;
  }

  // The SDK's host bindings (bindHost, bindFeHost). A shared SDK module is left external and so is the
  // host's own copy, which has an app bound; an inlined copy has nothing bound, so any inlined module
  // reaching the app throws "No host is bound".
  async function resolveHostBindingPaths(ctx: ResolveContext): Promise<string[]> {
    const runtimeIndex = await resolveSdkFile(ctx, '@apackdev/sdk/runtime');
    if (!runtimeIndex) return [];
    // Workspace source, or the published package's compiled modules
    return ['host-runtime', 'fe-host'].flatMap((name) => {
      const file = ['ts', 'js'].map(ext => path.join(path.dirname(runtimeIndex), `${name}.${ext}`)).find(f => fs.existsSync(f));
      return file ? [fs.realpathSync(file)] : [];
    });
  }

  // SDK modules the host shares, by file. A bundled SDK module can import one of these barrels
  // by relative path (e.g. '../designations/index.js'); that import must get the host proxy too,
  // not an inlined copy.
  let sharedModuleFiles: Promise<{ sdkRoot: string; bySpecifier: Map<string, string> } | null> | undefined;
  function getSharedModuleFiles(ctx: ResolveContext) {
    sharedModuleFiles ??= (async () => {
      const manifest = await resolveSdkFile(ctx, '@apackdev/sdk/package.json');
      if (!manifest) return null;
      const bySpecifier = new Map<string, string>();
      for (const specifier of Object.keys(sdkModules)) {
        const file = await resolveSdkFile(ctx, specifier);
        if (file) bySpecifier.set(file, specifier);
      }
      return { sdkRoot: path.dirname(manifest), bySpecifier };
    })();
    return sharedModuleFiles;
  }

  return {
    name: 'pack-externals',
    enforce: 'pre',

    async generateBundle(_options, bundle) {
      // Only code that survives tree-shaking matters (e.g. generated files re-export BE modules)
      const hostId = (await resolveHostBindingPaths(this)).find((file) => Object.values(bundle).some(
        (out) => out.type === 'chunk' && (out.modules[file]?.renderedLength ?? 0) > 0,
      ));
      if (!hostId) return;
      const sdkRoot = path.dirname(path.dirname(hostId));

      // Walk importers back to the first pack-owned module to name the offending import
      const chain = [hostId];
      const seen = new Set(chain);
      let current = hostId;
      while (current.startsWith(sdkRoot)) {
        const next = this.getModuleInfo(current)?.importers.find(i => !seen.has(i));
        if (!next) break;
        chain.push(next);
        seen.add(next);
        current = next;
      }
      const packRoot = fs.realpathSync(packDir);
      const rel = (id: string) => id.startsWith(sdkRoot)
        ? `@apackdev/sdk/${path.relative(sdkRoot, id)}`
        : path.relative(packRoot, id);

      this.error(
        'Pack FE code inlines an @apackdev/sdk module that reaches the app through its host binding, ' +
        'which would fail at runtime with "No host is bound".\n' +
        `  Import chain: ${chain.reverse().map(rel).join(' → ')}\n` +
        `  Only these SDK modules are shared with the host in the renderer: ${Object.keys(sdkModules).join(', ')}.\n` +
        '  Import from one of those instead, or add the module to SDK_FE_MODULES in @apackdev/host/build/shared-deps.',
      );
    },

    async resolveId(source, importer, options) {
      // A bundled SDK module can reach a shared barrel by relative path ('../designations/index.js'). That
      // import is the shared module under another name, so it leaves the bundle under the name the host
      // publishes rather than being inlined beside it.
      const shared = source.startsWith('.') && importer ? await getSharedModuleFiles(this) : null;
      if (shared) {
        const importerPath = importer!.split('?')[0];
        const insideSdk = fs.existsSync(importerPath) && fs.realpathSync(importerPath).startsWith(shared.sdkRoot + path.sep);
        if (insideSdk) {
          const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
          const file = resolved && !resolved.external ? resolved.id.split('?')[0] : undefined;
          const specifier = file && fs.existsSync(file) ? shared.bySpecifier.get(fs.realpathSync(file)) : undefined;
          if (specifier) return { id: specifier, external: true };
        }
      }
      // **Left for the host to resolve.** The bundle keeps the bare specifier and the document's import map
      // names the host's module (`hostSharedModulesPlugin`, the renderer's Vite config). Leaving it alone is
      // the whole mechanism: the pack gets live bindings, and an import of a name this apack does not
      // have fails when the module links, naming the export, rather than arriving as `undefined`.
      if (feDeps[source] || sdkModules[source] || uiModules[source]) {
        return { id: source, external: true };
      }
      // A pack without @apackdev/ui installed gets an empty proxy list, which is right until it imports
      // one: the import would be bundled instead of taken from the host, and every component in it
      // would fail at load with no sign of why. A pack that means to carry its own sets build.bundleUi.
      if (!bundlesUi(packDir) && /^@apackdev\/ui(\/|$)/.test(source)) {
        throw new Error(
          `This pack imports ${source}, but @apackdev/ui can't be resolved from ${packDir}, so there is nothing to take from the host. Install @apackdev/ui in the pack, or set build.bundleUi to carry your own copy.`,
        );
      }
      // Reached only by what the host does *not* share: `@apackdev/ears`, which a pack frontend inlines
      // because the renderer keeps no EARS data, and an `@apackdev/sdk` subpath outside SDK_FE_MODULES. From
      // the pack rather than the importing module, so those land on the pack's own copies.
      if (sharedInstancePackage(source)) {
        return this.resolve(source, packImporter, { ...options, skipSelf: true });
      }
    },
  };
}

/**
 * **Keeps an external specifier bare in what a dev server sends.**
 *
 * `vite:import-analysis` rewrites the imports of every module it serves, and an import the resolvers left
 * external it rewrites to `/@id/<specifier>` — its own convention for "ask this server for it". Here that is
 * the wrong answer twice over: the browser resolves it against the module's own `pack://` URL, so the
 * request comes back to *this* server, which left the specifier external and has nothing to serve for it. The
 * pack's frontend then fails to load, where leaving the name alone resolves it through the document's import
 * map to the host's module. A build has no such rewrite and emits the bare name already, so this is what
 * makes `apack pack dev` agree with `apack pack build`.
 *
 * **It has to be a middleware, not a `transform`.** Vite appends `importAnalysisPlugin` after the user's
 * `post` plugins, so no hook runs after the rewrite; the only place left is the response. That is also the
 * path that matters — the `pack://` handler proxies an HTTP request here
 * (`packages/main/src/modules/pack-protocol/PackProtocol.ts`), so what the browser links against is this
 * body, not a `transformRequest` result.
 *
 * `normalizeResolvedIdToUrl` is the code it undoes: an id that is not already `.`- or `/`-prefixed and is
 * not an `isExternalUrl` is wrapped, and a bare specifier can be neither.
 */
function keepExternalsBarePlugin(packDir: string): VitePlugin {
  // **Padded to the same length**, which is why the replacement is not simply the specifier. `send` appends
  // an inline sourcemap computed against the body this then edits, so a shorter line would leave every
  // mapping after the edit on it claiming a column 5 to the right of where it now is. Whitespace before a
  // module specifier is legal wherever one appears, so the padding costs nothing and the map stays exact.
  //
  // Longest first, so `@apackdev/ui/design/button` is unwrapped before a prefix of it could be.
  const wrapped = packSharedSpecifiers(packDir)
    .map((specifier) => [`"/@id/${specifier}"`, `${' '.repeat('/@id/'.length)}"${specifier}"`] as const)
    .sort((a, b) => b[0].length - a[0].length);

  return {
    name: 'pack-externals-stay-bare',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const end = res.end.bind(res);
        // Patched per request rather than once, because `res` is a new object each time
        res.end = function patched(this: unknown, chunk?: unknown, ...rest: unknown[]) {
          const type = String(res.getHeader('Content-Type') ?? '');
          if (typeof chunk === 'string' && type.includes('javascript')) {
            let body = chunk;
            for (const [from, to] of wrapped) body = body.split(from).join(to);
            if (body !== chunk) {
              // Length-preserving by construction (see `wrapped`), so nothing already sent about the size
              // of this body has gone stale. Asserted rather than assumed: a replacement that stopped
              // preserving it would otherwise truncate the module against a Content-Length set upstream.
              if (body.length !== chunk.length) throw new Error(`pack-externals-stay-bare changed a response's length (${chunk.length} to ${body.length}); the sourcemap Vite appended no longer lines up`);
              return (end as (c: unknown, ...r: unknown[]) => unknown)(body, ...rest);
            }
          }
          return (end as (c: unknown, ...r: unknown[]) => unknown)(chunk, ...rest);
        } as typeof res.end;
        next();
      });
    },
  };
}

/**
 * The dev server `apack pack dev` serves a pack's frontend from.
 *
 * Here rather than inline in the command, so a spec can drive the same server the command does. It is one
 * declaration with two readers for a reason: the first spec to stand a dev server up wrote its own config, left
 * out `optimizeDeps.exclude`, and spent its evidence on a dep optimizer the real server never reaches.
 *
 * `optimizeDeps.exclude` is what keeps the host-shared packages out of the pre-bundle: this server leaves
 * them external for the document's import map, so the pack never loads one from here — pre-bundling them
 * would spend the work and, if anything did reach the pre-bundle, hand the pack a second copy. No
 * `resolve.conditions`, deliberately — a pack resolves the `@apackdev` packages the way its own author's
 * install does, which is `dist` for an installed SDK and source for one linked to a checkout.
 */
export async function packDevServerConfig(root: string, feEntry: string): Promise<InlineConfig> {
  const vue = (await import('@vitejs/plugin-vue')).default;
  const entryRelative = '/' + path.relative(root, feEntry);
  return {
    root,
    configFile: false,
    plugins: [
      packExternalsPlugin(root),
      keepExternalsBarePlugin(root),
      vue(),
      {
        name: 'pack-entry-redirect',
        configureServer(srv) {
          srv.middlewares.use((req, _res, next) => {
            if (req.url === '/runtime/fe.js' || req.url === '/dist/fe.js' || req.url === '/@id/fe') {
              req.url = entryRelative;
            }
            next();
          });
        },
      },
    ],
    server: {
      host: DEV_SERVER_HOST, port: 5199, strictPort: false, cors: true, hmr: { protocol: 'ws', host: DEV_SERVER_HOST },
      // Scanning private build candidates can prevent their publication on Windows.
      watch: { ignored: file => relativeCompilerPath(root, file).split(path.sep)[0] === '.apack' },
    },
    logLevel: 'info',
    optimizeDeps: { exclude: packSharedSpecifiers(root) },
  };
}

/** Startup configuration only: ordinary source edits stay in Vite's live module graph. */
export function readPackDevServerInputs(root: string): string {
  const manifest = fs.readFileSync(path.join(root, 'apack.json'), 'utf8');
  const metadata = [path.join(root, 'package.json')];
  const packages = new Set(Object.keys(getSdkFeModules()).flatMap(specifier => sharedInstancePackage(specifier) ?? []));
  packages.add('@apackdev/ui');
  for (const name of packages) {
    const directory = findPackageDirectory(root, name)?.directory;
    if (directory) metadata.push(path.join(directory, 'package.json'));
  }
  const directories = sharedResolveDirs(root);
  return JSON.stringify([manifest, findFEEntry(root), directories, sharedFeModules(...directories), compilerEnvironmentIdentity(),
    parseNodeOptions(withoutSourceCondition(process.env.NODE_OPTIONS)),
    metadata.map(file => [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null])]);
}

export interface BundleFEOptions {
  packDir: string;
  outputDir: string;
  entryPoint: string;
  /** Use the build's captured file and namespace reads. */
  compilation?: CompilationInputs;
  /** Minified, no source maps (release bundles). */
  release?: boolean;
  /** Where this bundle reports the files it read, for the build's record of its inputs */
  recordReads?: RecordReads;
  /** Expected emitted/copied bytes, retained by the build until sealing. */
  recordOutput?: RecordBuildOutput;
  /** Live subscriptions for the worker's parent, independent of optional diagnostic recording. */
  onInputs?: (inputs: BuildWatchInputs) => void | Promise<void>;
}

/** Current compiler watch files include stylesheet and asset dependencies as well as modules.
 * Diagnostics and live worker subscriptions consume the same observations before publication.
 */
function inputReportPlugin(options: BundleFEOptions, directories: Set<string>, version: string, observedFiles: Set<string>): VitePlugin {
  return {
    name: 'report-build-inputs',
    async buildEnd(error) {
      for (const file of this.getWatchFiles()) observedFiles.add(file);
      const files = [...observedFiles];
      options.recordReads?.({ bundler: 'vite', version, files });
      if (options.onInputs) await options.onInputs({ files: [...new Set(files.filter(file => !file.includes('\0'))
        .map(file => path.resolve(options.packDir, fs.existsSync(file) ? file : file.replace(/[?#].*$/, ''))))],
        directories: [...directories], successful: !error });
    },
  };
}

export function findFEEntry(packDir: string): string | null {
  const srcEntry = path.join(packDir, 'src', 'pack-entry-fe.ts');
  if (fs.existsSync(srcEntry)) return srcEntry;

  const srcEntryJs = path.join(packDir, 'src', 'pack-entry-fe.js');
  if (fs.existsSync(srcEntryJs)) return srcEntryJs;

  const generatedEntry = path.join(packDir, 'src', '__generated__', 'pack-entry-fe.ts');
  if (fs.existsSync(generatedEntry)) return generatedEntry;

  return null;
}

/**
 * PostCSS plugins for the pack's CSS: Tailwind over the pack's own config if it has one, otherwise
 * over a generated one covering `src/`. A pack that bundles @apackdev/ui also generates the classes
 * its components use.
 *
 * Nothing here fails quietly. The bundle it produces either has the pack's styles or it doesn't, and
 * an unstyled bundle with no message is the worst outcome — it looks like a successful build and the
 * cause is invisible at runtime. So:
 *
 * - **Hard failure** when the pack demonstrably relies on Tailwind: it ships a `tailwind.config`, or
 *   it sets `build.bundleUi` (every @apackdev/ui component is Tailwind classes, so without Tailwind that
 *   bundle is *guaranteed* unstyled). A broken or unexpected config is always a hard failure — the
 *   pack wrote it, and reverting to the generated default would silently drop its theme.
 * - **Warning** when the pack gives no such signal and Tailwind can't load: it may use no Tailwind
 *   classes at all, and a toolchain problem shouldn't stop it building. The reason is still printed,
 *   together with what the bundle is missing.
 */
/**
 * @apackdev/ui's Tailwind preset, resolved from the pack, or none when its copy is too old to ship one.
 *
 * A pack building against an older @apackdev/ui has no `./tailwind-preset` export. That is not worth
 * failing the build over — it is the behaviour every such pack already had — so it degrades to the
 * warning below and the pack can still ship.
 */
async function uiTailwindPresets(packDir: string): Promise<unknown[]> {
  const require = createRequire(path.join(packDir, 'package.json'));
  let resolved: string;
  try {
    resolved = require.resolve('@apackdev/ui/tailwind-preset');
  } catch {
    console.warn("! FE bundle: this @apackdev/ui has no tailwind-preset export, so @apackdev/ui's own theme (primary-*) gets no CSS. Upgrade @apackdev/ui, or define those colours in this pack's tailwind config.");
    return [];
  }
  const mod = await import(pathToFileURL(resolved).href) as { uiTailwindPreset?: unknown; default?: unknown };
  const preset = mod.uiTailwindPreset ?? mod.default;
  return preset ? [preset] : [];
}

async function tailwindPostcssPlugins(packDir: string, compilation?: CompilationInputs): Promise<any[]> {
  const packTwConfig = [path.join(packDir, 'tailwind.config.ts'), path.join(packDir, 'tailwind.config.js')]
    .find((f) => fs.existsSync(f));
  const bundleUi = bundlesUi(packDir);
  // Why a failure to load Tailwind can't be shrugged off for this pack, if it can't
  const needsTailwind = packTwConfig
    ? `This pack has ${path.basename(packTwConfig)}`
    : bundleUi
      ? 'This pack sets build.bundleUi, so it bundles @apackdev/ui, whose components are Tailwind classes'
      : undefined;

  let tailwindcss: (config: unknown) => unknown;
  let autoprefixer: () => unknown;
  try {
    tailwindcss = (await import('tailwindcss')).default as unknown as (config: unknown) => unknown;
    autoprefixer = (await import('autoprefixer')).default as unknown as () => unknown;
  } catch (err) {
    const reason = `Tailwind CSS couldn't be loaded: ${errorMessage(err)}`;
    if (needsTailwind) {
      throw new Error(`${reason}\n  ${needsTailwind}, so the bundle would have no styles at all. Install tailwindcss and autoprefixer.`);
    }
    console.warn(`! FE bundle: ${reason}\n  The bundle is built without Tailwind, so any Tailwind classes in this pack's templates get no styles.`);
    return [];
  }

  const uiContent = bundleUi ? uiTailwindContent(packDir, compilation) : [];
  // Scanning @apackdev/ui's files finds the class names; the theme behind them (primary-*) is defined
  // only in a Tailwind config, so without its preset those classes match nothing and Tailwind emits
  // no CSS for them — the component renders with its accent silently missing.
  const uiPresets = bundleUi ? await uiTailwindPresets(packDir) : [];
  let twConfig: unknown = {
    content: [path.join(packDir, 'src/**/*.{vue,js,ts,jsx,tsx}'), ...uiContent],
    ...(uiPresets.length > 0 && { presets: uiPresets }),
  };
  if (packTwConfig) {
    // Tailwind loads a config path itself; only a pack that also needs @apackdev/ui's globs merged in
    // has to be loaded here
    twConfig = packTwConfig;
    if (uiContent.length > 0) {
      const loadConfig = (await import('tailwindcss/loadConfig.js')).default;
      let config: { content?: unknown };
      try {
        config = loadConfig(packTwConfig) as { content?: unknown };
      } catch (err) {
        throw new Error(`${path.basename(packTwConfig)} couldn't be loaded, and build.bundleUi needs @apackdev/ui's files added to its \`content\`: ${errorMessage(err)}`);
      }
      const content = Array.isArray(config.content) ? { files: config.content } : config.content as { files?: unknown } | undefined;
      if (!content || !Array.isArray(content.files)) {
        throw new Error(
          `${path.basename(packTwConfig)} must set \`content\` to an array of globs or to { files: [...] }, so that build.bundleUi can add @apackdev/ui's files to it; got ${JSON.stringify(config.content)}`,
        );
      }
      // The pack's own presets stay first, so it can still override the theme it inherits
      const presets = Array.isArray((config as { presets?: unknown[] }).presets) ? (config as { presets: unknown[] }).presets : [];
      twConfig = {
        ...config,
        content: { ...content, files: [...content.files, ...uiContent] },
        ...(uiPresets.length > 0 && { presets: [...uiPresets, ...presets] }),
      };
    }
  }
  return [tailwindcss(twConfig), autoprefixer()];
}

export async function bundlePackFE(options: BundleFEOptions): Promise<{ success: boolean; error?: string }> {
  const bundle = () => bundleFrontend(options);
  return options.compilation
    ? withCompilerFileReads({ compilation: options.compilation, outputDirectory: options.outputDir }, bundle)
    : bundle();
}

async function bundleFrontend(options: BundleFEOptions): Promise<{ success: boolean; error?: string }> {
  const { packDir, outputDir, entryPoint, release = false, recordReads, compilation } = options;

  const vite = await import('vite');
  const vue = (await import('@vitejs/plugin-vue')).default;

  let postcssPlugins: any[];
  try {
    postcssPlugins = await tailwindPostcssPlugins(packDir, compilation);
  } catch (err) {
    return { success: false, error: errorMessage(err) };
  }

  // Inject @tailwind utilities so Tailwind generates classes found in templates. Vite's module ids
  // are real paths (a pack under a symlinked dir, like macOS's /var, has others)
  const entryFile = fs.realpathSync(path.resolve(packDir, entryPoint));
  const directories = new Set<string>();
  // Workers compile in separate Rollup builds. The final report must retain their inputs too.
  const observedFiles = new Set<string>();
  const inputPlugins = () => [
    ...((recordReads || options.onInputs) ? [inputReportPlugin(options, directories, vite.version, observedFiles)] : []),
    ...(options.onInputs ? [globWatchPlugin(packDir, directories)] : []),
  ];
  if (options.onInputs) postcssPlugins.push({
    postcssPlugin: 'apack-watch-inputs',
    OnceExit(_root: unknown, { result }: { result: { opts: { from?: string }; messages: Record<string, unknown>[] } }) {
      for (const message of result.messages) {
        if (message.type === 'dir-dependency' && typeof message.dir === 'string') {
          directories.add(path.resolve(path.dirname(result.opts.from ?? entryFile), message.dir));
        }
      }
    },
  });
  const tailwindInjectPlugin: VitePlugin = {
    name: 'tailwind-inject',
    resolveId(id) { if (id === 'virtual:tailwind-utils.css') return '\0virtual:tailwind-utils.css'; },
    load(id) { if (id === '\0virtual:tailwind-utils.css') return '@tailwind utilities;'; },
    transform(code, id) {
      if (id === entryFile || id === entryPoint || id === path.resolve(packDir, entryPoint)) {
        return `import 'virtual:tailwind-utils.css';\n${code}`;
      }
    },
  };

  try {
    const opaque = opaqueDeps(packDir);
    const publicDir = compilation?.readTree().path(path.join(packDir, 'public'));
    const built = await vite.build({
      root: packDir,
      publicDir,
      configFile: false,
      plugins: [
        {
          // The app's private host package isn't provided to packs; they import @apackdev/sdk
          name: 'reject-host-imports',
          enforce: 'pre',
          resolveId(id: string, importer?: string) {
            if (/^@apackdev\/host(?:\/|$)/.test(id)) {
              this.error(`${id} is the app's private host package; packs import @apackdev/sdk instead${importer ? ` (imported from ${importer})` : ''}`);
            }
            return null;
          },
        },
        tailwindInjectPlugin,
        packExternalsPlugin(packDir),
        ...(opaque.length > 0 ? [opaqueVendorPlugin(opaque)] : []),
        vue(),
        ...inputPlugins(),
        ...(compilation || options.recordOutput ? [{
          name: 'captured-public-files',
          generateBundle() {
            // Vite has copied public files before generation; owned inputs are read-only.
            const publicFiles = publicDir ?? path.join(packDir, 'public');
            const capturePublic = (directory: string) => {
              if (!fs.existsSync(directory)) return;
              for (const name of fs.readdirSync(directory)) {
                const file = path.join(directory, name);
                if (fs.statSync(file).isDirectory()) capturePublic(file);
                else {
                  const target = path.join(outputDir, path.relative(publicFiles, file));
                  options.recordOutput?.(target, fs.readFileSync(file));
                  if (compilation) {
                    const stat = compilation.readMetadata('stat', compilation.sourcePath(file), []) as fs.Stats;
                    fs.chmodSync(target, stat.mode);
                  }
                }
              }
            };
            capturePublic(publicFiles);
          },
        }] : []),
      ],
      worker: { plugins: inputPlugins },
      css: {
        postcss: { plugins: postcssPlugins },
      },
      resolve: {
        // No alias map: a pack names its own modules with `#` subpath imports, which Vite resolves from the
        // pack's own `package.json` — measured, extensionless included, and from inside another package's
        // build graph. A pack's `compilerOptions.paths` is TypeScript's business and no longer this build's.
        conditions: [...vite.defaultClientConditions],
      },
      build: {
        lib: {
          entry: entryPoint,
          formats: ['es'],
          fileName: 'fe',
        },
        outDir: outputDir,
        emptyOutDir: false,
        sourcemap: !release,
        minify: release,
        target: 'es2022',
        cssCodeSplit: false,
        rollupOptions: {
          /**
           * **Not `false`, however tempting the saving.** This walk is the phase's whole cost — 6.1s of its
           * 12.8s of CPU, against 0.3s compiling every SFC — so turning it off for the non-release build
           * measures -19% (2026-10-08; the profile and the A/B are in `docs/archive/references/pipeline-lessons.md`).
           *
           * What fails is `fe-bundler-host-registry.integration.spec.ts`, and the reason reaches every pack:
           * a pack's `#generated/ears` pairs the EARS constants with a `#__PURE__`-annotated `defineEars()` call, so
           * without the shake a frontend importing only a constant carries that call into the renderer and
           * runs it. Off is a divergence in what *executes* between a dev build and a release, and the dev
           * build is the one that spec and the E2E suite cover.
           */
          treeshake: { propertyReadSideEffects: false },
        },
      },
      logLevel: 'warn',
    });
    for (const output of Array.isArray(built) ? built : [built]) {
      if (!('output' in output)) throw new Error('Frontend build did not return its written output');
      for (const file of output.output) options.recordOutput?.(path.join(outputDir, file.fileName),
        file.type === 'chunk' ? file.code : file.source);
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: compilation?.diagnostic(errorMessage(err)) ?? errorMessage(err),
    };
  }
}
