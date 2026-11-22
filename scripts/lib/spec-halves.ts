/**
 * Which half a spec runs in, and which vitest config that half is.
 *
 * A spec's half is a decision, declared by its filename: `.native.spec.ts`, `.integration.spec.ts` or neither. It picks the config
 * that runs the file, and `sizeOf` (`test-timeouts.ts`) derives a timeout budget from it, so this is
 * load-bearing well beyond any one command — `chain-steps.ts`' `INTEGRATION_SUITES` and `NATIVE_SUITES` are
 * the suites with that half's config (`hasHalf`), which is the whole chain's view of which suites have one.
 *
 * **Declared, never derived from a measured cost**, because the quantity is not one number: a spec read 2.8s
 * in the fast pool and 0.64s in the integration pool, so each half's reading would demand a move the other
 * took back.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const INTEGRATION_SUFFIX = '.integration.spec.ts';

/**
 * Specs that execute a native compiler runtime or hold live filesystem watchers. They need a disposable runner
 * (the CLI's runner guard), and their cost is process and native work rather than input capture, so they are
 * their own half: selectable on their own, and runnable in parallel with the rest of integration.
 */
export const NATIVE_SUFFIX = '.native.spec.ts';

/**
 * The two halves, as one declaration: the list is the definition and the type is derived from it.
 *
 * Written twice, a consumer that iterates the halves and a consumer that switches on them disagree the day a
 * third is added — the failure the root `CLAUDE.md` records for `PackRuleKey`, `APP_ENVS` and `ALL_COLORS`.
 * `CONFIG_BY_HALF` below is keyed by the type, so a half with no config is a compile error rather than a
 * lookup that returns undefined.
 */
export const HALVES = ['fast', 'integration', 'native'] as const;
export type Half = (typeof HALVES)[number];

export const halfOfPath = (file: string): Half =>
  (file.endsWith(NATIVE_SUFFIX) ? 'native' : file.endsWith(INTEGRATION_SUFFIX) ? 'integration' : 'fast');

/**
 * Which config runs each half, as one declaration rather than two lists that can disagree.
 *
 * `configsFor` derives its order from this, and a spec's path derives its config from it the other way
 * round, which is what lets a command act on the half a named spec lives in rather than the whole suite.
 */
export const CONFIG_BY_HALF: Readonly<Record<Half, string>> = {
  fast: 'vitest.config.ts',
  integration: 'vitest.integration.config.ts',
  native: 'vitest.native.config.ts',
};

/**
 * The vitest configs a package runs its specs under, read from the package rather than assumed.
 *
 * `@apackdev/cli` has three; `@app/internal-repo-checks` and `@app/internal-publish-checks` have two; the other nine have one.
 */
export function configsFor(packageDir: string): string[] {
  return Object.values(CONFIG_BY_HALF).filter((file) => fs.existsSync(path.join(packageDir, file)));
}

/**
 * Whether a package has a second half at all.
 *
 * A package with one config has nowhere to move a spec to. Which halves it has is `hasHalf`.
 */
export const hasSplit = (packageDir: string): boolean => configsFor(packageDir).length > 1;

/** Whether a package runs a given half, which is whether its config for that half exists */
export const hasHalf = (packageDir: string, half: Half): boolean => fs.existsSync(path.join(packageDir, CONFIG_BY_HALF[half]));

/**
 * Every spec a package owns, relative to the package.
 *
 * Both `tests/` and `src/`. No config includes `src/**`, so a colocated spec would never run; walking it
 * here keeps such a spec visible rather than silently skipped. `spec-dry.ts` is the consumer: it is how a
 * whole-suite run lists the specs it would execute.
 *
 * Ignoring what a package builds keeps the walk to sources: `dist` holds compiled copies, and `etc` holds
 * recorded files rather than specs.
 */
// `templates` holds the CLI's scaffold: `templates/pack/tests/*.spec.ts` is a spec a pack author will run,
// not one of this package's, and vitest's own `include` already leaves it out
// Exported so the cases over it iterate this set rather than a second copy of the names: a member added
// here without a case would otherwise be a directory nothing has watched the walk skip
export const IGNORED = new Set(['node_modules', 'dist', 'etc', 'coverage', 'templates']);
export function specFiles(packageDir: string): string[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) return [];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(spec|test)\.ts$/.test(entry.name) ? [path.relative(packageDir, full)] : [];
    });
  return walk(packageDir).sort();
}
