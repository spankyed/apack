import path from 'node:path';
import { registerCompilerCommonJS } from './compiler-commonjs.ts';
import { splitCompilerModulePath } from './compiler-module-path.ts';
import { createRequire, findPackageJSON, isBuiltin, register, registerHooks, type ModuleHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CompilationInputs } from './compilation-inputs.ts';
import { withoutCompilerFileReads } from '@apackdev/host/build/compiler-inputs';
import { cliPackageDirectory } from './tool-identity.ts';
import { writeCompilerModuleConfiguration } from './compiler-module-configuration.ts';
import { assertNodeSupportsCompiler } from './node-support.ts';

let sequence = 0;

/** Native resolution uses owned paths; ESM execution retains logical source metadata. */
export function createCompilerModuleLoader(compilation: CompilationInputs) {
  // Before anything registers a hook, because an unsupported Node fails inside one and blames it.
  assertNodeSupportsCompiler();
  // Public builds use a fresh worker, so their single scope has a stable URL namespace. In-process
  // callers still need separate identities even when two captures contain identical source bytes.
  const namespace = `apack-build-${++sequence}`;
  const closed = new Int32Array(new SharedArrayBuffer(4));
  let hooks: ModuleHooks | undefined;
  let pending: ReturnType<typeof initialize> | undefined;
  let stopping: Promise<void> | undefined;
  const scoped = (value: string | undefined) => {
    if (!value?.startsWith('file:')) return false;
    return new URL(value).searchParams.get('tsx-namespace') === namespace;
  };

  async function initialize() {
    const tree = compilation.readTree();
    const root = pathToFileURL(`${tree.directory}${path.sep}`).href;
    const readURL = (value: string) => {
      const url = new URL(value);
      let file = fileURLToPath(url);
      const [physical, query] = splitCompilerModulePath(file);
      if (query && new URLSearchParams(query.slice(1)).get('namespace') === namespace) {
        // Node may encode tsx's CommonJS scope suffix into the URL pathname.
        url.search = '?' + [url.search.slice(1), query.slice(1)].filter(Boolean).join('&');
        file = physical;
      }
      const owned = pathToFileURL(tree.path(compilation.sourcePath(file)));
      owned.search = url.search;
      owned.hash = url.hash;
      return owned;
    };
    register(pathToFileURL(path.join(cliPackageDirectory(), 'bin/compiler-source-hooks.mjs')), {
      data: { directory: tree.directory, namespace, closed: closed.buffer },
    });
    const ownedHooks: Parameters<typeof registerHooks>[0] = {
      resolve(specifier, context, next) {
        if (isBuiltin(specifier) || (!context.parentURL?.startsWith(root) && !specifier.startsWith(root)
          && !scoped(context.parentURL) && !scoped(specifier))) return next(specifier, context);
        return withoutCompilerFileReads(() => {
          if (!path.isAbsolute(specifier) && /^[a-z][\w+.-]*:/i.test(specifier) && !specifier.startsWith('file:')) return next(specifier, context);
          const require = Array.from(context.conditions).includes('require');
          // tsx carries its CommonJS scope in a path suffix; it is not part of the filename.
          const commonjsScope = require && new URLSearchParams(splitCompilerModulePath(specifier)[1].slice(1)).get('namespace') === namespace;
          const url = specifier.startsWith('file:') ? new URL(specifier)
            : path.isAbsolute(specifier) && (!require || commonjsScope) ? new URL(specifier, context.parentURL) : undefined;
          const target = url ? fileURLToPath(url) : specifier;
          const source = path.isAbsolute(target) ? compilation.sourcePath(target) : target;
          const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : source;
          compilation.prepareNative(source, path.dirname(compilation.sourcePath(parent)));
          const parentURL = context.parentURL?.startsWith('file:') ? readURL(context.parentURL).href : context.parentURL;
          const request = url ? readURL(url.href).href : path.isAbsolute(target) ? tree.path(source) : specifier;
          const result = next(request, { ...context, parentURL });
          if (!result.url.startsWith('file:')) return result;
          const owned = readURL(result.url);
          const file = compilation.sourcePath(fileURLToPath(owned));
          if (file.endsWith('.node')) compilation.prepareNative(file, path.dirname(file));
          if (compilation.readFile(file) === undefined) throw new Error(`Missing captured compiler module: ${file}`);
          // Node's CommonJS cache keys ignore URL queries. Retain its per-tree filenames.
          if (require || result.format?.startsWith('commonjs')) return { ...result, url: owned.href };
          const logical = pathToFileURL(file);
          logical.search = owned.search;
          // tsx appends its namespace after a fragment; retain the caller's fragment instead.
          logical.hash = url?.hash ?? (specifier.startsWith('.') ? new URL(specifier, context.parentURL).hash : owned.hash);
          // Keep raw query spelling and terminate tsx's namespace before any fragment.
          const marker = `tsx-namespace=${namespace}`;
          const query = owned.search.slice(1).split('&').filter(field => field !== marker).join('&');
          logical.search = `?${marker}${query || logical.hash ? `&${query}` : ''}`;
          return { ...result, url: logical.href };
        });
      },
      load(url, context, next) {
        if (!url.startsWith(root) && !scoped(url)) return next(url, context);
        if (Atomics.load(closed, 0)) throw new Error('Compiler module load outlived its build');
        // Loading/transformation is tooling; evaluation resumes in the caller's captured read scope.
        return withoutCompilerFileReads(() => next(url, context));
      },
    };
    const [esm, cjs] = await withoutCompilerFileReads(() => Promise.all([import('tsx/esm/api'), import('tsx/cjs/api')]));
    const tsconfig = writeCompilerModuleConfiguration(compilation.configuration ?? compilation.declarationConfiguration, tree);
    const importCompilerSource = createRequire(import.meta.url)(path.join(cliPackageDirectory(), 'bin/compiler-import.cjs')) as (url: string) => Promise<Record<string, unknown>>;
    const commonjs = cjs.register({ namespace });
    const unregisterCommonJS = registerCompilerCommonJS(compilation, tree.directory, tsconfig);
    try {
      const modules = esm.register({ namespace, tsconfig });
      // Run before tsx's synchronous hooks, while the request still carries its capture namespace.
      try { hooks = registerHooks(ownedHooks); }
      catch (error) { await modules.unregister(); throw error; }
      return { modules, commonjs, unregisterCommonJS, importCompilerSource };
    } catch (error) { unregisterCommonJS(); commonjs.unregister(); throw error; }
  }

  return {
    async importModule(file: string): Promise<Record<string, unknown>> {
      if (Atomics.load(closed, 0)) throw new Error('Compiler module load outlived its build');
      withoutCompilerFileReads(() => compilation.prepareNative(file, path.dirname(file)));
      pending ??= withoutCompilerFileReads(initialize);
      const { importCompilerSource, commonjs } = await pending;
      if (Atomics.load(closed, 0)) throw new Error('Compiler module load outlived its build');
      const tree = compilation.readTree();
      const owned = tree.path(file);
      const extension = path.extname(file);
      const packageFile = findPackageJSON(pathToFileURL(owned));
      const metadata = packageFile && compilation.readFile(compilation.sourcePath(packageFile));
      const cjs = extension === '.cjs' || extension === '.cts'
        || (!['.mjs', '.mts'].includes(extension) && (!metadata || JSON.parse(metadata.toString('utf8')).type !== 'module'));
      if (cjs) {
        // Avoid ESM loaders rewriting CommonJS response URLs back to shared source cache keys.
        const value = commonjs.require(owned, import.meta.url) as unknown;
        const exports = value && (typeof value === 'object' || typeof value === 'function') ? value as Record<string, unknown> : {};
        return { ...exports, default: exports.__esModule ? exports.default : value };
      }
      // Enter through the checked native resolver; tsx's scoped import protocol bypasses it.
      const url = pathToFileURL(file);
      url.searchParams.set('tsx-namespace', namespace);
      return importCompilerSource(url.href);
    },
    dispose(): Promise<void> {
      stopping ??= (async () => {
        Atomics.store(closed, 0, 1);
        const loaded = await pending?.catch(() => undefined);
        hooks?.deregister();
        if (loaded) {
          try { await loaded.modules.unregister(); }
          finally { loaded.unregisterCommonJS(); loaded.commonjs.unregister(); }
        }
      })();
      return stopping;
    },
  };
}
