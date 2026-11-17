/**
 * The pack's own working directory, and what a build keeps there rather than in `dist/`.
 *
 * In host because the two sides cannot reach each other: `apack pack build` writes the record
 * (`@apackdev/cli`) and the repo's chain checks read it (`scripts/lib/build-reads.ts`), while a package may
 * not import the repo's `scripts/` and `scripts/` cannot import the CLI, which publishes no exports map.
 * Two literals agreeing by convention is a rename away from a reader that finds nothing and blames the
 * build for not having run.
 *
 * Deliberately not part of `PACK_LAYOUT` (`packs/layout.ts`): staging copies what that names into the
 * published pack, and nothing here is published — `apack pack clean` removes it, no fingerprint walks it
 * (dot-prefixed entries being skipped), and `electron-builder.mjs` excludes it from the installed app.
 */

/** The pack-relative working directory: dependency cache, staging, release output, build records */
export const PACK_WORK_DIR = '.apack';

/**
 * Where `apack pack build` builds a pack before it copies the result to `dist/`. A bundle's source map is written
 * there, so its relative `sources` are relative to this directory, not to the copy in `dist/` that ships.
 */
export const PACK_BUILD_STAGING_DIR = `${PACK_WORK_DIR}/build`;

/** What each bundling phase of `apack pack build` read, pack-relative. Written by the build, read by the chain. */
export const PACK_READS_FILE = `${PACK_WORK_DIR}/reads.json`;
