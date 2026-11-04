// Fixer 3 of the package-freshness doors (the doors are listed in packages/apack-testing/CLAUDE.md):
// A pack compiles and runs against the @apackdev packages' published dist. When those packages come from
// an apack checkout (a linked pack, the in-repo fixtures), that dist is built on demand and can be
// behind the checkout's source — so a command that loads it asks the checkout to bring it up to date.
// Installed packages have nothing to build: their dist is what npm delivered.
import { createRequire } from 'node:module';
import { spawnSync, type StdioOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CHECKOUT_MARKER, buildUnitsIn, type BuildUnit } from '@apackdev/host/build/packages-built';

/**
 * The packages a pack can resolve whose dist a checkout builds on demand. Every one is asked, because a
 * pack need not link them all: with @apackdev/sdk installed from the registry and @apackdev/ui linked to a
 * checkout, asking only the SDK would find no checkout and leave that linked dist stale and silent.
 */
const CHECKOUT_PACKAGES = ['@apackdev/sdk', '@apackdev/ears', '@apackdev/ui', '@apackdev/testing', '@apackdev/cli'];

/** The checkout a package resolves into from `packDir`, or undefined for an installed copy */
function checkoutOf(packDir: string, pkg: string): string | undefined {
  let dir: string;
  try {
    dir = path.dirname(fs.realpathSync.native(createRequire(path.join(packDir, 'package.json')).resolve(`${pkg}/package.json`)));
  } catch {
    return undefined; // Not installed here, or it exports no package.json: nothing to build either way
  }
  for (let root = path.dirname(path.dirname(dir)); root !== path.dirname(root); root = path.dirname(root)) {
    if (fs.existsSync(path.join(root, CHECKOUT_MARKER))) return root;
  }
  return undefined;
}

/** The apack checkout a pack's @apackdev packages come from, or undefined when they are all installed */
export function checkoutFor(packDir: string): string | undefined {
  for (const pkg of CHECKOUT_PACKAGES) {
    const checkout = checkoutOf(packDir, pkg);
    if (checkout) return checkout;
  }
  return undefined;
}

/** The package build units of every checkout these directories' packages come from; none when all are installed. */
export function checkoutBuildUnits(directories: readonly string[]): BuildUnit[] {
  const checkouts = new Set(directories.map(checkoutFor).filter(checkout => checkout !== undefined));
  return [...checkouts].flatMap(checkout => Object.values(buildUnitsIn(checkout)));
}

/**
 * Builds the checkout's packages when its sources moved since the last build, so what this command
 * loads is what the checkout says. A no-op for a pack whose packages are installed, and a directory
 * walk (under a second) when nothing is stale.
 */
/**
 * @param stdio where the build's own output goes. `inherit` for a command whose stdout is prose; a caller
 * whose stdout is *data* passes `['ignore', 2, 2]` to send it to stderr instead — `npm run dev:drive -- --eval`
 * prints one JSON envelope and npm's two banner lines in front of it would corrupt what a program parses.
 */
export function ensureCheckoutPackages(packDir: string, stdio: StdioOptions = 'inherit'): void {
  const checkout = checkoutFor(packDir);
  if (!checkout) return;
  // npm is a shell script on Windows, which spawn cannot launch without one
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', ['run', 'packages:ensure'], {
    cwd: checkout, stdio, shell: windows,
    // The selected pack compiler's binary need not match checkout tools' own esbuild versions.
    env: { ...process.env, ESBUILD_BINARY_PATH: undefined },
  });
  if (result.status === 0) return;
  // A spawn that never ran has no status and a reason of its own; a build that failed printed its own
  const why = result.error ? `: ${result.error.message}` : '';
  throw new Error(`The apack checkout at ${checkout} could not build its packages, so this pack would load a stale copy of them${why}`);
}
