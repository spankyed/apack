import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_ONLY_EXPORTS, HOST_RESOLVED_BINARIES, SHARED_DEPS, sharedInstanceExternals } from '@apackdev/host/build/shared-deps';
import { CONTENT_COMPILERS_FILE, STEPS_BUILD_MODULE } from '@apackdev/sdk/build';
import { checkContentRuntimeLoads } from './content-runtime-check';
import type { RecordReads } from './build-reads';
import type { RecordBuildOutput } from './build-outputs.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { esbuildTsconfig, readPackCompilerConfiguration } from './compiler-configuration.ts';
import type { CompilerReadTree } from './compiler-read-tree.ts';
import { compilerModuleReferences } from './compiler-module-references.ts';
import type { CompilationInputs } from './compilation-inputs.ts';

export interface BundleRuntimeOptions {
  /** A build reuses its captured config; standalone bundler calls resolve their own. */
  compilation?: CompilationInputs;
  /** Minify for release bundles; dev builds keep readable output with source maps. */
  release?: boolean;
  /**
   * Where this bundle reports the files it read, for the build's record of its inputs. Absent when
   * nothing is recording, which is what keeps `metafile` off in that case.
   */
  recordReads?: RecordReads;
  recordOutput?: RecordBuildOutput;
}

/**
 * The host-provided packages every pack bundle leaves external; the host loader resolves its own singletons.
 *
 * Exported for `tests/build/pack-externals.spec.ts`, which holds these against what the loader actually
 * provides: an external specifier the loader does not resolve is a pack that loads in this checkout, where
 * node_modules sits above it, and fails once installed, where nothing does.
 */
export const HOST_EXTERNALS = [...Object.keys(SHARED_DEPS), ...sharedInstanceExternals()];

type EsbuildOptions = import('esbuild').BuildOptions;

/**
 * The esbuild setup every pack bundle shares: the pack's tsconfig, the host-import guard and
 * frontend-asset stub, and node/esm defaults. esbuild resolves the pack's own `#` imports itself, since
 * each names the file that is there.
 * `overrides` supplies the entry, output and per-bundle options.
 */
async function bundlePackSource<T extends EsbuildOptions>(
  packDir: string,
  options: BundleRuntimeOptions,
  overrides: T,
): Promise<import('esbuild').BuildResult<T>> {
  const esbuild = await import('esbuild');
  const configuration = options.compilation ? options.compilation.configuration : readPackCompilerConfiguration(packDir);
  const compilation = options.compilation;
  const tree = compilation?.readTree();
  const workingDir = tree?.path(packDir) ?? process.cwd();
  let stdin = overrides.stdin;
  if (stdin && tree && compilation) {
    const resolveDir = stdin.resolveDir ?? packDir;
    const contents = typeof stdin.contents === 'string' ? stdin.contents : Buffer.from(stdin.contents ?? []).toString('utf8');
    stdin = { ...stdin, contents: compilerModuleReferences(
      tree.path(path.resolve(resolveDir, stdin.sourcefile ?? 'stdin.ts')), contents, tree.path,
      specifier => compilation.prepareNative(specifier, resolveDir)) };
  }
  if (options.compilation) {
    const entries = overrides.entryPoints;
    const files = Array.isArray(entries) ? entries.map(entry => typeof entry === 'string' ? entry : entry.in) : Object.values(entries ?? {});
    for (const file of files) options.compilation.prepareNative(file, packDir);
    if (stdin) options.compilation.prepareNativeSource(
      path.resolve(stdin.resolveDir ?? packDir, stdin.sourcefile ?? 'stdin.ts'),
      Buffer.from(stdin.contents ?? ''));
  }
  const plugins: import('esbuild').Plugin[] = [rejectHostImportsPlugin(), stubFrontendAssetsPlugin()];
  if (options.compilation) plugins.push(capturedSourcesPlugin(options.compilation, workingDir));

  const merged: EsbuildOptions = {
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: [...HOST_EXTERNALS, ...HOST_RESOLVED_BINARIES],
    tsconfigRaw: configuration && esbuildTsconfig(configuration, tree?.path),
    plugins,
    minify: options.release ?? false,
    logLevel: 'silent',
    // `metafile.inputs` is this bundle's dep file, and the one place the five esbuild bundles share: a
    // caller asking for the record never has to remember the flag, and one that is not pays nothing
    ...(options.recordReads && { metafile: true }),
    ...overrides,
    ...(tree && {
      absWorkingDir: workingDir,
      outfile: overrides.outfile && path.resolve(overrides.outfile),
      outdir: overrides.outdir && path.resolve(overrides.outdir),
      entryPoints: Array.isArray(overrides.entryPoints)
        ? overrides.entryPoints.map(entry => typeof entry === 'string' ? tree.path(entry) : { ...entry, in: tree.path(entry.in) })
        : overrides.entryPoints && Object.fromEntries(Object.entries(overrides.entryPoints).map(([name, file]) => [name, tree.path(file)])),
      stdin: stdin && { ...stdin, resolveDir: tree.path(stdin.resolveDir ?? packDir) },
    }),
    ...((tree || options.recordOutput) && { write: false }),
  };
  let result: import('esbuild').BuildResult;
  try { result = await esbuild.build(merged); }
  catch (error) { throw new Error(tree?.diagnostic(errorMessage(error)) ?? errorMessage(error), { cause: error }); }
  if ((tree || options.recordOutput) && overrides.write !== false) {
    if (!result.outputFiles?.length) throw new Error('Native bundle returned no output files');
    for (const file of result.outputFiles) {
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      const bytes = tree && file.path.endsWith('.map') ? sourceMapOrigins(file.text, file.path, tree) : file.contents;
      fs.writeFileSync(file.path, bytes);
      options.recordOutput?.(file.path, bytes);
    }
  }
  if (options.recordReads && result.metafile) {
    options.recordReads({ bundler: 'esbuild', version: esbuild.version, files: Object.keys(result.metafile.inputs).map(file => tree ? path.resolve(workingDir, file) : file) });
  }
  // esbuild keys `outputFiles`/`metafile` off the literal options it was called with; merging hides
  // the caller's `write: false` / `metafile: true` from it, so restate them on the result.
  return result as unknown as import('esbuild').BuildResult<T>;
}

/** Populate owned lookup inputs before native resolution; module bodies use the same captured bytes. */
function capturedSourcesPlugin(compilation: CompilationInputs, workingDir: string): import('esbuild').Plugin {
  const loaders: Record<string, import('esbuild').Loader> = {
    '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx',
    '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.json': 'json', '.txt': 'text', '.css': 'css', '': 'js',
  };
  return { name: 'apack-captured-sources', setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.namespace && args.namespace !== 'file') return;
      const source = path.isAbsolute(args.path) ? compilation.sourcePath(args.path) : args.path;
      compilation.prepareNative(source, compilation.sourcePath(args.resolveDir || workingDir));
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: 'file' }, args => {
      const loader = loaders[path.extname(args.path)];
      if (!loader) return;
      const contents = compilation.readFile(compilation.sourcePath(args.path));
      if (contents === undefined) throw new Error(`Missing captured compiler input: ${args.path}`);
      let projected: string | Buffer = contents;
      if (['js', 'jsx', 'ts', 'tsx'].includes(loader)) {
        compilation.prepareNativeSource(args.path, contents);
        projected = compilerModuleReferences(args.path, contents.toString('utf8'), compilation.readTree().path,
          specifier => compilation.prepareNative(specifier, compilation.sourcePath(path.dirname(args.path))));
      }
      return { contents: projected, loader, resolveDir: path.dirname(args.path) };
    });
  } };
}

/** Only source-map metadata is projected; authored source text and its embedded values stay intact. */
function sourceMapOrigins(text: string, file: string, tree: CompilerReadTree): string {
  const map = JSON.parse(text);
  map.sources = map.sources.map((source: string) => {
    if (/^[a-z][\w+.-]*:/i.test(source) && !path.isAbsolute(source)) return source;
    const readPath = path.resolve(path.dirname(file), map.sourceRoot ?? '', source);
    const original = tree.sourcePath(readPath);
    return original === readPath ? source : path.relative(path.dirname(file), original).split(path.sep).join('/');
  });
  return JSON.stringify(map);
}

function sourceExists(file: string, compilation?: CompilationInputs): boolean {
  return compilation ? compilation.readFile(file) !== undefined : fs.existsSync(file);
}

function bundleError(err: unknown): { success: false; error: string } {
  return { success: false, error: errorMessage(err) };
}

/**
 * Bundle the pack's generated backend entry (src/__generated__/pack-entry.ts) into
 * dist/runtime/index.cjs. It exports `registration` (systems, services, steps,
 * artifacts, blocks, EARS, boot hooks, migrations) and `setCompiledDir`. Host-provided and
 * shared-instance packages stay external: the host loader resolves them to its own singletons,
 * whichever pack the bundle is for.
 */
export async function bundlePackRuntime(
  packDir: string,
  outputDir: string,
  options: BundleRuntimeOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const entryPath = path.join(packDir, 'src', '__generated__', 'pack-entry.ts');
  if (!sourceExists(entryPath, options.compilation)) {
    return { success: false, error: 'No src/__generated__/pack-entry.ts. Run "apack pack generate-entries" first.' };
  }

  const runtimeDir = path.join(outputDir, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  try {
    await bundlePackSource(packDir, options, {
      entryPoints: [entryPath],
      format: 'cjs',
      outfile: path.join(runtimeDir, 'index.cjs'),
      sourcemap: options.release ? false : true,
    });
    return { success: true };
  } catch (err) {
    return bundleError(err);
  }
}

/**
 * Bundle the pack's build-time step definitions (the module codegen writes from its `steps` entries) into
 * dist/build/steps.build.mjs. Dependent packs' `apack pack build` imports it to validate
 * and compile flows with this pack's real step code. Shared-instance and host-shared
 * packages stay external and resolve from the importing pack's node_modules.
 */
export async function bundlePackStepBuild(
  packDir: string,
  outputDir: string,
  options: BundleRuntimeOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const entryPath = path.resolve(packDir, STEPS_BUILD_MODULE);
  if (!sourceExists(entryPath, options.compilation)) {
    return { success: false, error: `No ${STEPS_BUILD_MODULE}. Run "apack pack generate-entries" first.` };
  }
  try {
    await bundlePackSource(packDir, options, {
      entryPoints: [entryPath],
      outfile: path.join(outputDir, 'build', 'steps.build.mjs'),
    });
    return { success: true };
  } catch (err) {
    return bundleError(err);
  }
}

/**
 * Bundle the compiler modules named in the pack's content.formats into dist/build/content-compilers.mjs,
 * one export per format name. Dependent packs' `apack pack build` compiles this pack's formats with it,
 * since the pack's sources aren't installed. Shared-instance and host-shared packages stay external.
 */
export async function bundlePackContentCompilers(
  packDir: string,
  outputDir: string,
  compilers: Record<string, string>,
  options: BundleRuntimeOptions = {},
): Promise<{ success: boolean; error?: string }> {
  for (const [name, modulePath] of Object.entries(compilers)) {
    if (!sourceExists(path.resolve(packDir, modulePath), options.compilation)) {
      return { success: false, error: `content format "${name}": compiler module not found: ${modulePath}` };
    }
  }
  const contents = Object.entries(compilers)
    .map(([name, modulePath]) => `export { default as ${JSON.stringify(name)} } from ${JSON.stringify(path.resolve(packDir, modulePath))};`)
    .join('\n');

  try {
    await bundlePackSource(packDir, options, {
      stdin: { contents, resolveDir: packDir, sourcefile: 'content-compilers.ts', loader: 'ts' },
      outfile: path.join(outputDir, 'build', CONTENT_COMPILERS_FILE),
    });
    return { success: true };
  } catch (err) {
    return bundleError(err);
  }
}

/**
 * Bundle the pack's generated flow helpers (src/__generated__/flow-helpers.ts) into one ES module,
 * returned with the names it exports rather than written: the pack's snapshot carries it, and
 * dependents' generated flow helpers re-export it. Shared-instance and host-shared packages stay external.
 */
export async function bundlePackFlowHelpersModule(
  packDir: string,
  options: BundleRuntimeOptions = {},
): Promise<{ success: true; module: string; exports: string[] } | { success: false; error: string }> {
  const entryPath = path.join(packDir, 'src', '__generated__', 'flow-helpers.ts');
  if (!sourceExists(entryPath, options.compilation)) {
    return { success: false, error: 'No src/__generated__/flow-helpers.ts. Run "apack pack generate-entries" first.' };
  }
  try {
    const result = await bundlePackSource(packDir, options, {
      entryPoints: [entryPath],
      outfile: path.join(packDir, 'flow-helpers.mjs'),
      write: false,
      metafile: true,
    });
    const [output] = Object.values(result.metafile.outputs);
    return { success: true, module: result.outputFiles[0].text, exports: [...output.exports].sort() };
  } catch (err) {
    return bundleError(err);
  }
}

/** The pack's content runtime bundle in its build dir: what dependents' unit tests register */
export const CONTENT_RUNTIME_FILE = 'content-runtime.mjs';

/**
 * Bundle the pack's content runtime (src/__generated__/content-runtime.ts: entity types, repositories,
 * content writers) into dist/build/content-runtime.mjs. Only the shared-instance packages (@apackdev/sdk and
 * @apackdev/ears) stay external, so a dependent's unit tests can load it with just their own installed
 * and share their instances. The
 * build then loads it that way, so a bundle that can't load fails here.
 */
export async function bundlePackContentRuntime(
  packDir: string,
  outputDir: string,
  options: BundleRuntimeOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const entryPath = path.join(packDir, 'src', '__generated__', 'content-runtime.ts');
  if (!sourceExists(entryPath, options.compilation)) {
    return { success: false, error: 'No src/__generated__/content-runtime.ts. Run "apack pack generate-entries" first.' };
  }
  const outfile = path.join(outputDir, 'build', CONTENT_RUNTIME_FILE);
  try {
    await bundlePackSource(packDir, options, {
      entryPoints: [entryPath],
      outfile,
      external: sharedInstanceExternals(),
      // Bundled CommonJS dependencies may call require(); give the ESM bundle one
      banner: { js: "import { createRequire as __apackCreateRequire } from 'node:module'; const require = __apackCreateRequire(import.meta.url);" },
    });
  } catch (err) {
    return bundleError(err);
  }
  return checkContentRuntimeLoads(packDir, outfile);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Fails the bundle when pack code imports @apackdev/host, the app's private package, or an export only the
 * app loads (`APP_ONLY_EXPORTS`, the elmdb databases): installed apack doesn't provide them to packs, so
 * they would only fail later, at load. Packs use @apackdev/sdk.
 */
export function rejectHostImportsPlugin(): import('esbuild').Plugin {
  const appOnly = new RegExp(`^(?:${Object.keys(APP_ONLY_EXPORTS).map(escapeRegExp).join('|')})$`);
  return {
    name: 'reject-host-imports',
    setup(build) {
      const importedFrom = (importer: string) => path.relative(process.cwd(), importer) || importer;
      build.onResolve({ filter: /^@apackdev\/host(?:\/|$)/ }, (args) => ({
        errors: [{ text: `${args.path} is the app's private host package; packs import @apackdev/sdk instead (imported from ${importedFrom(args.importer)})` }],
      }));
      build.onResolve({ filter: appOnly }, (args) => ({
        errors: [{ text: `${args.path} is only for the app (${APP_ONLY_EXPORTS[args.path]}); packs can't import it (imported from ${importedFrom(args.importer)})` }],
      }));
    },
  };
}

/**
 * Step and surface definitions reference Vue components and styles for the renderer.
 * The backend runtime never renders them, so they become empty modules.
 */
function stubFrontendAssetsPlugin(): import('esbuild').Plugin {
  return {
    name: 'stub-frontend-assets',
    setup(build) {
      build.onResolve({ filter: /\.(vue|css)$/ }, args => ({ path: args.path, namespace: 'frontend-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'frontend-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
    },
  };
}

