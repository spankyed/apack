import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { createPathsMatcher, parseTsconfig } from 'get-tsconfig';
import { transformSync, type Loader } from 'esbuild';
import type { CompilationInputs } from './compilation-inputs.ts';
import { esbuildTsconfig } from './compiler-configuration.ts';
import { splitCompilerModulePath } from './compiler-module-path.ts';
import { relativeCompilerPath, withoutCompilerFileReads } from '@apackdev/host/build/compiler-inputs';

/** tsx's CommonJS API has no per-registration config. Transform only this build's owned modules. */
export function registerCompilerCommonJS(compilation: CompilationInputs, directory: string, tsconfig?: string): () => void {
  const require = createRequire(import.meta.url);
  const extensions = require.extensions;
  const module = require('node:module') as { _resolveFilename(request: string, parent: NodeJS.Module | undefined, ...args: unknown[]): string };
  const nativeResolve = module._resolveFilename;
  const aliases = tsconfig ? createPathsMatcher({ path: tsconfig, config: parseTsconfig(tsconfig) }) : null;
  const owns = (file: string | undefined) => {
    if (!file || !path.isAbsolute(file)) return false;
    const relative = relativeCompilerPath(directory, splitCompilerModulePath(file)[0]);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  let inputs: CompilationInputs | undefined = compilation;
  const loaders: Record<string, Loader> = { '.js': 'js', '.cjs': 'js', '.ts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx' };
  using restore = new DisposableStack();
  let enabled = true;
  // Native lookup must retain owned filenames; source-path projection belongs to compiler code.
  const resolve: typeof nativeResolve = function(this: typeof module, request, parent, ...args) {
    const run = () => {
      const filename = parent?.filename;
      if (inputs && aliases && filename && owns(filename) && !filename.includes(`${path.sep}node_modules${path.sep}`)) {
        const [specifier, query] = splitCompilerModulePath(request);
        const targets = isBuiltin(specifier) ? [] : aliases(specifier);
        if (targets.length) inputs.prepareNative(specifier, path.dirname(inputs.sourcePath(splitCompilerModulePath(filename)[0])));
        for (const target of targets) {
          try { return nativeResolve.call(this, target + query, parent, ...args); }
          catch (error) {
            if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          }
        }
      }
      return nativeResolve.call(this, request, parent, ...args);
    };
    return enabled && (owns(request) || owns(parent?.filename)) ? withoutCompilerFileReads(run) : run();
  };
  module._resolveFilename = resolve;
  restore.defer(() => { if (module._resolveFilename === resolve) module._resolveFilename = nativeResolve; });
  for (const extension of Object.keys(loaders)) {
    const previous = extensions[extension];
    const fallback = previous ?? extensions['.js']!;
    const load: NodeJS.RequireExtensions[string] = (module, filename) => {
      const file = splitCompilerModulePath(filename)[0];
      const relative = relativeCompilerPath(directory, file);
      const compilation = inputs;
      if (!compilation || !enabled || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return fallback(module, filename);
      const source = compilation.sourcePath(file);
      const code = withoutCompilerFileReads(() => {
        const bytes = compilation.readFile(source);
        if (!bytes) throw new Error(`Missing captured compiler module: ${source}`);
        const configuration = compilation.configuration ?? compilation.declarationConfiguration;
        const result = transformSync(bytes.toString('utf8'), { loader: loaders[path.extname(file)] ?? 'js', format: 'cjs', platform: 'node',
          sourcefile: source, sourcemap: 'inline',
          ...(configuration && { tsconfigRaw: esbuildTsconfig(configuration, compilation.readTree().path) }) });
        return result.code;
      });
      // Keep the module's owned identity; this argument supplies source globals and script origins.
      (module as NodeJS.Module & { _compile(code: string, filename: string): void })._compile(code, source);
    };
    extensions[extension] = load;
    restore.defer(() => {
      if (extensions[extension] !== load) return;
      if (previous) extensions[extension] = previous;
      else delete extensions[extension];
    });
  }
  const owned = restore.move();
  return () => { enabled = false; inputs = undefined; owned.dispose(); };
}
