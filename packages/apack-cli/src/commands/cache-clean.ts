import * as fs from 'node:fs';
import * as path from 'node:path';
import { cliDirs, type CliDirs } from '../app/pack-host';
import { dirBytes, size } from '../app/profiles';
import { betaDownloadLeftovers, cachedBetaBuilds } from '../app/beta-app';
import { compilerStoreEntries, compilerStoreRoot, removeCompilerStoreEntry } from '../build/compiler-installation';

/**
 * The downloaded Beta builds, which nothing has ever reclaimed — each one an unpacked app of a few hundred
 * megabytes, and they accumulate one per release tested against.
 *
 * **The newest is kept by default, because resolution prefers a cached build.** `cachedBetaApp`
 * (`pack-host.ts`) answers from the cache whenever a downloaded build satisfies the pack's range, so
 * emptying it on a plain `clean` would turn every later run into a download. `--all` is for when that is
 * what you want — moving to a newer Beta is deleting the one you have.
 *
 * Staging directories go whatever the flag says: a download that was killed leaves one, nothing reads it
 * again, and `cachedBetaBuilds` already refuses to see it.
 *
 * `dirs` is a parameter rather than a `cliDirs()` this reads for itself, and the difference is the test:
 * this deletes from a cache a person owns, so the policy — which build survives — is checked against a
 * temporary one rather than trusted. `clean` passes nothing.
 */
export function cleanApps(all: boolean, dirs: CliDirs = cliDirs()): void {
  const builds = cachedBetaBuilds(dirs.cache);
  const leftovers = betaDownloadLeftovers(dirs.cache);
  if (builds.length === 0 && leftovers.length === 0) {
    console.log('  no downloaded app builds');
    return;
  }

  let removed = 0;
  let reclaimed = 0;
  // `cachedBetaBuilds` is newest first, which is the one this keeps — the same build resolution would pick
  builds.forEach(({ tag, dir }, index) => {
    const go = all || index > 0;
    const bytes = dirBytes(dir);
    console.log(`  ${go ? 'removing' : '  keeping'}  ${tag.padEnd(24)} ${size(bytes).padStart(6)}${go ? '' : '  newest'}`);
    if (!go) return;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    removed++;
    reclaimed += bytes;
  });
  for (const dir of leftovers) {
    reclaimed += dirBytes(dir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    removed++;
    console.log(`  removing  ${path.basename(dir).padEnd(24)}         an interrupted download`);
  }

  console.log(removed === 0
    ? '\n  nothing to remove'
    : `\n  removed ${removed} build${removed === 1 ? '' : 's'}, reclaiming ${size(reclaimed)}`);
  if (!all && builds.length > 0 && removed < builds.length) console.log('  --all removes the newest too');
}

/**
 * The captured compiler installations, one per compiler and runtime version a build has run — each a copy of the
 * runtime. All go: the next build captures what it needs again. One being captured or used by a live process is
 * left alone, and one Windows still holds open is reported rather than failing the clean.
 */
export async function cleanCompilers(store: string = compilerStoreRoot()): Promise<void> {
  const entries = compilerStoreEntries(store);
  if (entries.length === 0) {
    console.log('  no captured compiler installations');
    return;
  }
  let reclaimed = 0;
  for (const entry of entries) {
    const name = path.basename(entry);
    const bytes = dirBytes(entry);
    try {
      if (!await removeCompilerStoreEntry(entry)) {
        console.log(`    keeping  ${name.padEnd(24)}         being captured or used`);
        continue;
      }
      reclaimed += bytes;
      console.log(`  removing  ${name.padEnd(24)} ${size(bytes).padStart(6)}`);
    } catch (error) {
      console.log(`    keeping  ${name.padEnd(24)}         in use (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
    }
  }
  console.log(`\n  reclaimed ${size(reclaimed)} of captured compilers`);
}

export async function cacheClean(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: apack cache clean [--all]\n\nRemove downloaded beta builds, keeping the newest unless --all is passed, and captured compiler installations, which builds capture again as needed. App installations and user data are kept.');
    return;
  }
  if (args.some(arg => arg !== '--all')) throw new Error('Usage: apack cache clean [--all]');
  cleanApps(args.includes('--all'));
  await cleanCompilers();
}
