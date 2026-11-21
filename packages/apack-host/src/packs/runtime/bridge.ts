import { APP_ONLY_EXPORTS, HOST_RESOLVED_BINARIES, SHARED_DEPS, SHARED_INSTANCE_PACKAGES } from '../../build/shared-deps.ts';
import { keepHostModulesResolvable, withModuleBridge } from '../module-bridge.ts';
import { SHARED_INSTANCE_MODULES } from './sdk-modules.ts';

// The SDK bridge: pack runtime code shares the loader's shared-instance packages (@apackdev/sdk,
// @elmdb/ears); it never requires @apackdev/host (check:specifiers and apack pack build reject it).
// The API bundle inlines them (tsup bundles them). Any CJS code loaded at runtime (external packs,
// built-in dev entry) that does require('@elmdb/ears') would otherwise get a SEPARATE module
// instance, with no bound app and no installed engine.
// sdk-modules.ts imports every export statically, so they resolve to the BUNDLED instances, the
// ones with hydrated data; withHostResolution injects them into the require cache so dynamically
// loaded pack code shares them.
const SDK_BRIDGE: Record<string, unknown> = SHARED_INSTANCE_MODULES;

/**
 * The shared-instance package specifiers bridged to host singletons.
 *
 * Exported for the drift guard in tests/packs/runtime/sdk-bridge-drift.spec.ts. A pack
 * importing a shared-instance subpath that is missing here fails loudly, and
 * says what to do: `withModuleBridge` throws "isn't provided by this
 * apack: rebuild the pack with the current @apackdev/cli" for any specifier
 * under a bridged package it has no entry for.
 *
 * **It throws rather than falling through**, which is the whole of what this list buys. Real Node
 * resolution of a missing subpath dies on the SDK's extensionless relative imports — an error about a
 * file, naming nothing a pack author can act on. The loader records a load problem and the other packs
 * load, so a pack built against an SDK entry this app no longer has is a pack reported missing with the
 * reason attached, rather than one that fails obscurely.
 */
export function getBridgedSdkSpecifiers(): readonly string[] {
  return Object.keys(SDK_BRIDGE);
}

/**
 * The packages the loader resolves from itself for a pack, rather than bridging a module of.
 *
 * Exported for the guard in `@apackdev/cli`'s `tests/build/pack-externals.spec.ts`, the one place that sees
 * both this and the externals a pack bundle is built with.
 */
export function getHostProvidedPackages(): readonly string[] {
  return HOST_PROVIDED_PACKAGES;
}

/**
 * Every specifier a pack's backend bundle leaves external, resolved from here.
 *
 * `hostPackages` is a resolution rather than a bridged module, so the question it answers is only "may a
 * backend require this", and for anything the host provides the answer is yes. An installed pack has no
 * `node_modules`: the host resolves external imports from its own dependencies. The CLI's
 * `tests/build/pack-externals.spec.ts` checks these against the pack bundler's external dependencies.
 *
 * This is not `getSharedBeDeps()` widened: that list is the modules a backend shares an *instance* of, which
 * `@apackdev/testing`'s dependency runtime imports eagerly, and a frontend package belongs in neither.
 */
const HOST_PROVIDED_PACKAGES = [...Object.keys(SHARED_DEPS), ...HOST_RESOLVED_BINARIES];

/**
 * Runs `fn` (a require of pack runtime code) with the shared-instance packages bridged to the loader's
 * instances and host-provided packages resolved from the loader (the API bundle, in the app).
 *
 * The resolution outlives the call, because a pack's require does too: `keepHostModulesResolvable` says
 * why. What is scoped to `fn` is the refusals, which are diagnostics about the pack being loaded.
 */
export function withHostResolution<T>(fn: () => T): T {
  keepHostModulesResolvable({ modules: SDK_BRIDGE, hostPackages: HOST_PROVIDED_PACKAGES, resolveFrom: import.meta.url });
  return withModuleBridge({
    modules: SDK_BRIDGE,
    hostPackages: HOST_PROVIDED_PACKAGES,
    resolveFrom: import.meta.url,
    // A runtime built against a shared-instance module this app no longer has fails, saying to rebuild it
    bridgedPackages: SHARED_INSTANCE_PACKAGES,
    appOnly: APP_ONLY_EXPORTS,
  }, fn);
}
