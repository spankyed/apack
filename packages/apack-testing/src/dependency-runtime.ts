// Loads a dependency's backend runtime (runtime/index.cjs) into the test process on the pack's own
// shared-instance packages, xstate and zod, the way the app loads it on its own (@apackdev/host/packs/runtime, bridge.ts).
import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
  APP_ONLY_EXPORTS, SHARED_INSTANCE_PACKAGES, getSharedBeDeps, sharedInstanceExports, sharedInstanceSpecifiers,
} from '@apackdev/host/build/shared-deps';
import { withModuleBridge } from '@apackdev/host/packs';
import type { PackRegistration } from '@apackdev/sdk/framework';

/** Subpaths of shared-instance packages never loaded by a dependency's backend runtime (pull Vue, test helpers, or TypeScript) */
const NON_BACKEND_SHARED_SUBPATHS = new Set([
  '@apackdev/state/vue',
  '@apackdev/state/testing',
  '@apackdev/state/graph',
]);

/** The shared-instance exports a backend runtime can require, as the pack resolves them */
function sharedSpecifiers(packDir: string): string[] {
  const fromFile = path.join(packDir, 'package.json');
  return SHARED_INSTANCE_PACKAGES
    .flatMap((pkg) => sharedInstanceSpecifiers(pkg, sharedInstanceExports(pkg, fromFile)))
    .filter((specifier) => !NON_BACKEND_SHARED_SUBPATHS.has(specifier));
}

function unavailable(specifier: string, reason: string): unknown {
  const fail = () => {
    throw new Error(`${specifier} couldn't be loaded in this pack's tests (${reason}); a dependency's runtime used it`);
  };
  return new Proxy(function unavailableModule() {}, { get: (_target, property) => (property === '__esModule' ? false : fail()), apply: fail, construct: fail });
}

/** The modules dependency runtimes share with the test process, imported from the pack */
async function sharedModules(packDir: string): Promise<Record<string, unknown>> {
  const modules: Record<string, unknown> = {};
  for (const specifier of new Set([...sharedSpecifiers(packDir), ...getSharedBeDeps()])) {
    try {
      modules[specifier] = await import(/* @vite-ignore */ specifier);
    } catch (err) {
      // An optional peer the pack doesn't install: fine until a runtime uses it
      modules[specifier] = unavailable(specifier, err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  }
  return modules;
}

let shared: Promise<Record<string, unknown>> | undefined;

export interface DependencyRuntime {
  registration: PackRegistration;
}

/**
 * Requires a dependency's runtime with the pack's shared modules bridged and packages the pack doesn't
 * install stubbed, points it at its compiled content, and returns its registration.
 */
export async function loadDependencyRuntime(packDir: string, depId: string, runtimeEntry: string, contentDir: string | undefined): Promise<DependencyRuntime> {
  shared ??= sharedModules(packDir);
  const modules = await shared;
  const require = createRequire(runtimeEntry);
  const mod = withModuleBridge({ modules, stubMissing: true, resolveFrom: runtimeEntry, appOnly: APP_ONLY_EXPORTS }, () => require(runtimeEntry)) as {
    registration?: PackRegistration;
    setCompiledDir?(dir: string): void;
  };
  if (!mod.registration) throw new Error(`Dependency "${depId}": ${runtimeEntry} exports no registration`);
  if (contentDir) mod.setCompiledDir?.(contentDir);
  return { registration: mod.registration };
}
