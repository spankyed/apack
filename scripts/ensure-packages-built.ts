#!/usr/bin/env node
/**
 * Builds the publishable packages when their build output no longer matches the sources it was built
 * from, and is the repo's entry to that rule for everything that is not a package:
 *
 *   tsx scripts/ensure-packages-built.ts        (npm run packages:ensure, @apackdev/cli's pretest)
 *
 * The rule itself lives in `@apackdev/host/build/packages-built`, which everything that needs it imports
 * by that name: a relative import of this file would put the repo root into `@apackdev/testing`'s
 * declaration emit and move every declaration its bundle publishes.

 */
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PackagesBuildFailed, PackagesWentStale, ensurePackagesBuilt } from '@apackdev/host/build/packages-built';

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    ensurePackagesBuilt();
  } catch (err) {
    // The packages moved under a run that had already built them: report it as itself, not as a stack
    if (err instanceof PackagesWentStale) {
      fs.writeSync(2, `${err.message}\n`);
      process.exitCode = 1;
      // The build printed its own error; exit with its status rather than a stack trace over it
    } else if (err instanceof PackagesBuildFailed) {
      fs.writeSync(2, `${err.message} — the packages are not built.\n`);
      process.exitCode = err.status;
    } else {
      throw err;
    }
  }
}
