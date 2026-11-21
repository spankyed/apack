import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatNodeOptions, parseNodeOptions } from './node-options.js';
export { formatNodeOptions, parseNodeOptions } from './node-options.js';

/**
 * The packages whose exports name `src/` under the condition, and so resolve two ways in a checkout.
 *
 * Exported because the pack rule asks the mirror-image question of a pack's own compiler
 * (`apack-cli/src/build/pack-resolution.ts`, which wants `dist` where this wants source), and two lists of the
 * same packages could disagree about which.
 */
export const SOURCE_PACKAGES = ['@apackdev/sdk', '@apackdev/ui'] as const;

/**
 * The export condition under which the packages above resolve their TypeScript source.
 *
 * Here because this module is what the condition is *about*, beside `SOURCE_PACKAGES` for the same reason: the
 * packages and the condition are one fact, and two modules holding half of it each is how the list of packages
 * came to exist twice in two orders. Seven copies of this string existed before it moved here.
 *
 * `@apackdev/ui`'s `scripts/exports.ts` keeps a copy and must: `@apackdev/ui` does not depend on `@apackdev/host`, and
 * `check:specifiers` holds a package's own `scripts/` to that package's source and its declared dependencies.
 * That one is the exception rather than an oversight.
 */
export const SOURCE_CONDITION = '@apackdev/source';

/**
 * NODE_OPTIONS without the source condition, for the processes the CLI starts to run pack code: the
 * Playwright runner, the content-runtime check and the app the fixture launches, each of which resolves the
 * @apackdev packages' dist as a pack does. Nothing here adds the condition — a host process that needs it
 * gets it from `scripts/with-source.mjs`, which runs before any TypeScript loader and keeps its own copy.
 */
export function withoutSourceCondition(nodeOptions: string | undefined): string {
  const args = parseNodeOptions(nodeOptions);
  const kept: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    if ((option === '--conditions' || option === '-C') && args[index + 1] === SOURCE_CONDITION) { index++; continue; }
    if (option === `--conditions=${SOURCE_CONDITION}` || option === `-C=${SOURCE_CONDITION}`) continue;
    kept.push(option);
  }
  return formatNodeOptions(kept);
}

/** Resolves a specifier the way the checked process does, to a file path */
export type ResolveFile = (specifier: string) => string;

function tryResolve(resolve: ResolveFile, specifier: string): string | undefined {
  try {
    return fs.realpathSync(resolve(specifier));
  } catch {
    return undefined;
  }
}

/**
 * Throws when a checkout's workspace @apackdev/sdk or @apackdev/ui doesn't resolve to its source.
 * Without the @apackdev/source condition a process would run the checkout's dist, which is stale
 * or missing. Installed packages (they ship no src) and packages that don't resolve pass.
 *
 * @param resolve resolves like the process being checked (its conditions and loader hooks)
 * @param processName names the process in the error
 */
export function assertSourceResolution(resolve: ResolveFile, processName: string): void {
  for (const name of SOURCE_PACKAGES) {
    const manifestPath = tryResolve(resolve, `${name}/package.json`);
    if (!manifestPath) continue;
    const dir = path.dirname(manifestPath);
    const srcDir = path.join(dir, 'src');
    if (!fs.existsSync(srcDir)) continue;

    const exports: Record<string, unknown> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).exports ?? {};
    const subpath = Object.keys(exports).find((key) => {
      const target = exports[key];
      return typeof target === 'object' && target !== null && '@apackdev/source' in target;
    });
    if (!subpath) continue;
    const specifier = `${name}${subpath.slice(1)}`;
    const resolved = tryResolve(resolve, specifier);
    if (resolved?.startsWith(srcDir + path.sep)) continue;

    const target = resolved ? path.relative(dir, resolved) : 'its unbuilt dist';
    throw new Error(
      `${processName} resolves ${specifier} to ${target} instead of the checkout's source (${path.relative(process.cwd(), srcDir) || srcDir}). ` +
      'Run it with the @apackdev/source condition: `node scripts/with-source.mjs <command>` or `node --conditions=@apackdev/source`.',
    );
  }
}
