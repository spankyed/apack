// Loads pack runtime code (CommonJS) so its `require('@apackdev/sdk/…')` gets the loader's own module
// instances. Without it, the runtime would load a separate copy of the SDK with empty registries and
// an empty EARS store. The app bridges its bundled SDK; the pack test harness bridges the pack's.
import Module, { createRequire } from 'node:module';
import { hasOwn } from '@apackdev/sdk/utils/pure';

export interface ModuleBridgeOptions {
  /** Specifier → the module the loaded code gets for `require(specifier)` */
  modules: Readonly<Record<string, unknown>>;
  /**
   * Packages resolved from `resolveFrom` rather than from the loaded file (an installed pack has no node_modules),
   * with every subpath they export: a bundled dependency may require `zod/v4` where the pack imports `zod`
   */
  hostPackages?: readonly string[];
  /** A file (path or file URL) that host packages resolve from */
  resolveFrom?: string;
  /**
   * A package that can't be resolved loads as a module that throws when used, naming it. For tests: a
   * dependency's runtime keeps its npm packages external, and a pack's tests needn't install them all.
   */
  stubMissing?: boolean;
  /** Packages only the bridge provides: a module of one that `modules` lacks throws, rather than loading another copy */
  bridgedPackages?: readonly string[];
  /** Specifiers only the app loads, with what each is: requiring one throws */
  appOnly?: Readonly<Record<string, string>>;
}

type ModuleInternals = typeof Module & {
  _resolveFilename(request: string, parent: unknown, ...rest: unknown[]): string;
};

const BRIDGE_PREFIX = '__module_bridge__/';
const STUB_PREFIX = '__missing_module__/';

function missingModule(name: string): unknown {
  const fail = (use: string) => {
    throw new Error(`"${name}" isn't installed (${use}). It's a package a dependency's runtime uses; install it, or mock the service that uses it.`);
  };
  return new Proxy(function missing() {}, {
    get: (_target, property) => (property === '__esModule' ? false : fail(`read ${String(property)}`)),
    apply: () => fail('called'),
    construct: () => fail('constructed'),
  });
}

const cacheEntry = (id: string, exports: unknown) =>
  ({ id, filename: id, loaded: true, exports, children: [], paths: [] }) as unknown as NodeJS.Module;

/** Puts each bridged module in the require cache, under the bridge key and under the host's own path for it */
function primeRequireCache(cache: NodeJS.Dict<NodeJS.Module>, modules: Readonly<Record<string, unknown>>, hostRequire: NodeRequire): void {
  for (const [specifier, exports] of Object.entries(modules)) {
    const key = `${BRIDGE_PREFIX}${specifier}`;
    if (cache[key]) continue;
    const entry = cacheEntry(key, exports);
    cache[key] = entry;
    // A lazy initializer resolves the host's path for itself; point that at the bridged module too, so it
    // gets this instance rather than loading a second copy from the same file
    try {
      const realPath = hostRequire.resolve(specifier);
      if (!cache[realPath]) cache[realPath] = entry;
    } catch { /* the bridge key is enough */ }
  }
}

/** Resolves a host-provided package, and any subpath of one, from `hostRequire`; `null` for anything else */
function hostPackageResolver(hostPackages: readonly string[], hostRequire: NodeRequire): (request: string) => string | null {
  const resolved = new Map<string, string | null>();
  const resolving = new Set<string>();
  return (request: string) => {
    if (!hostPackages.some((name) => request === name || request.startsWith(`${name}/`))) return null;
    // createRequire.resolve consults our hook too. Let that recursive call reach Node's
    // original resolver, with createRequire's host parent, instead of resolving again.
    if (resolving.has(request)) return null;
    if (!resolved.has(request)) {
      resolving.add(request);
      try {
        resolved.set(request, hostRequire.resolve(request));
      } catch {
        // Not installed for the host either: the pack's own resolution decides what happens
        resolved.set(request, null);
      } finally {
        resolving.delete(request);
      }
    }
    return resolved.get(request) ?? null;
  };
}

let hostModulesKept = false;

/**
 * Keeps the host's modules resolvable from pack code for the rest of the process.
 *
 * **Pack code requires a bridged module long after the load that produced it.** esbuild defers a module's
 * body into an `__init` the bundle calls on first use, so default-setup's `extensions/steps/action/runtime.ts`
 * runs its `require('@apackdev/sdk/logger')` when an action step first runs — any time, under any stack. A
 * scoped patch is gone by then, and priming the cache cannot cover it: Node resolves before it looks in the
 * cache, and an installed pack has no `node_modules` for a bare specifier to resolve through. In a checkout
 * the workspace one sits above the pack and answers, which is why this is invisible until a pack is
 * installed — and then every action step fails with `Cannot find module '@apackdev/sdk/logger'`.
 *
 * **Resolution only, and it never throws.** `withModuleBridge`'s refusals are load-time diagnostics — they
 * tell a pack author to rebuild, at the moment the pack's runtime is being required — so they stay scoped to
 * that load. Keeping them installed would make them answer for host code too, and `appOnly` would then
 * refuse the app its own `@elmdb/ears/database`.
 *
 * Safe to leave installed because the only CJS `require` of a bridged specifier in this process is a pack's:
 * host code is ESM, which never consults `Module._resolveFilename`, and the API bundle inlines these packages
 * rather than requiring them. Idempotent, since every pack load asks for the same host.
 */
export function keepHostModulesResolvable(options: Pick<ModuleBridgeOptions, 'modules' | 'hostPackages' | 'resolveFrom'>): void {
  if (hostModulesKept) return;
  hostModulesKept = true;
  const moduleInternals = Module as ModuleInternals;
  const originalResolve = moduleInternals._resolveFilename;
  const hostRequire = createRequire(options.resolveFrom ?? import.meta.url);
  const resolveFromHost = hostPackageResolver(options.hostPackages ?? [], hostRequire);
  primeRequireCache(hostRequire.cache, options.modules, hostRequire);

  moduleInternals._resolveFilename = function resolve(this: unknown, request: string, parent: unknown, ...rest: unknown[]) {
    if (request in options.modules) return `${BRIDGE_PREFIX}${request}`;
    return resolveFromHost(request) ?? originalResolve.call(this, request, parent, ...rest);
  };
}

function isBareSpecifier(request: string): boolean {
  return !request.startsWith('.') && !request.startsWith('/') && !request.startsWith('node:') && !Module.builtinModules.includes(request);
}

/**
 * Runs `fn` (typically a `require` of runtime code) with bridged resolution. The bridged modules stay
 * in the require cache, so requires the code makes later, lazily, get them too.
 */
export function withModuleBridge<T>(options: ModuleBridgeOptions, fn: () => T): T {
  const moduleInternals = Module as ModuleInternals;
  const originalResolve = moduleInternals._resolveFilename;
  const hostRequire = createRequire(options.resolveFrom ?? import.meta.url);
  const cache = hostRequire.cache;

  // A host package's own subpaths come from the host too (`zod` and `zod/v4`, whatever a bundled dependency asks
  // for), so nothing has to list them: an installed pack has no node_modules, and a second copy of a package the
  // host provides is exactly what the bridge exists to prevent
  const resolveFromHost = hostPackageResolver(options.hostPackages ?? [], hostRequire);

  primeRequireCache(cache, options.modules, hostRequire);

  moduleInternals._resolveFilename = function resolve(this: unknown, request: string, parent: unknown, ...rest: unknown[]) {
    if (request in options.modules) return `${BRIDGE_PREFIX}${request}`;
    if (options.appOnly && hasOwn(options.appOnly, request)) {
      throw new Error(`${request} is only for the app (${options.appOnly[request]}); pack code can't import it`);
    }
    if (options.bridgedPackages?.some(pkg => request === pkg || request.startsWith(`${pkg}/`))) {
      throw new Error(`${request} isn't provided by this apack: rebuild the pack with the current @apackdev/cli`);
    }
    const host = resolveFromHost(request);
    if (host) return host;
    try {
      return originalResolve.call(this, request, parent, ...rest);
    } catch (err) {
      if (!options.stubMissing || !isBareSpecifier(request)) throw err;
      const key = `${STUB_PREFIX}${request}`;
      cache[key] ??= cacheEntry(key, missingModule(request));
      return key;
    }
  };

  try {
    return fn();
  } finally {
    moduleInternals._resolveFilename = originalResolve;
  }
}
