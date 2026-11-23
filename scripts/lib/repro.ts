// What `npm run check:repro` compares, and how. The orchestration — running the builds — is
// `scripts/repro.ts`; everything here is pure enough for a spec to drive without building anything, which is
// the only way the comparison gets a firing case at all (two full builds is not a unit test).
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILD_UNITS, REPO_ROOT, type BuildUnit } from '@apackdev/host/build/packages-built';
import { APP_OUTPUTS, PACK_OUTPUTS } from './chain-steps.ts';
import { repoRelative } from './import-populations.ts';

/** One path whose bytes did not survive a second build of the same input */
export interface Difference {
  readonly path: string;
  readonly kind: 'changed' | 'appeared' | 'disappeared';
}

/**
 * Every tree a build writes, taken from the declarations that already say so rather than listed again here:
 * the five `BUILD_UNITS` (each `dist` and its publish tree), `PACK_OUTPUTS` (the staged distribution) and `APP_OUTPUTS` (the four app trees). A list of someone else's outputs is a guess, and
 * this one would go stale the first time a package is added.
 *
 * The families are one argument rather than one each, so a fourth is an entry here and no new parameter. Both
 * arguments are injectable because that is the only honest way to watch the emptiness guard fire: a spec hands
 * in an empty map and an empty list and asserts it throws, rather than trusting a branch nothing takes.
 */
const COMPARED_FAMILIES: readonly (readonly string[])[] = [PACK_OUTPUTS, APP_OUTPUTS];

export function reproPaths(
  units: Record<string, BuildUnit> = BUILD_UNITS,
  families: readonly (readonly string[])[] = COMPARED_FAMILIES,
  root = REPO_ROOT,
): string[] {
  const fromUnits = Object.values(units).flatMap((unit) => unit.outputs.map((out) => repoRelative(root, out)));
  const all = [...new Set([...fromUnits, ...families.flat()])].sort();
  if (all.length === 0) {
    throw new Error('check:repro derived no output paths from BUILD_UNITS, PACK_OUTPUTS or APP_OUTPUTS, so it '
      + 'would compare nothing and pass. Something moved one of those declarations.');
  }
  return all;
}

/**
 * Every file under those paths, by sha256. A missing path contributes nothing rather than throwing: a build
 * that has not run yet is the caller's problem to report, and the *second* snapshot missing what the first had
 * is a `disappeared` difference, which is the more useful way to say it.
 */
export function snapshot(paths: readonly string[], root = REPO_ROOT): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (absolute: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return; // not there, or not a directory — a single file is handled by the caller below
    }
    for (const entry of entries) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) hashes.set(repoRelative(root, child), crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex'));
    }
  };
  for (const relative of paths) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;
    if (fs.statSync(absolute).isDirectory()) walk(absolute);
    else hashes.set(relative, crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'));
  }
  return hashes;
}

/**
 * Outputs measured as irreproducible, with the cause, so a difference at one of them is reported rather than
 * failing the run. Everything else failing is the point of the check.
 *
 * **Empty, and it took holding three entries to get there.** Before the pack moved out, the first run recorded
 * `pack-types.d.ts`, `action-defs.d.ts` and `snapshot.json`, all of them `tsc` printing a union's members in
 * the order it created the member types — an order that changes between builds, so the same sources emitted
 * different bytes. That was fixed rather than accepted: `sortLiteralUnions`
 * (`@apackdev/cli`'s `build/declaration-text.ts`) now sorts them at the one point that writes a declaration bundle, and six consecutive builds produce one
 * hash where `action-defs.d.ts` alone had taken five in six.
 *
 * So a new entry here is a claim that something cannot be fixed, and it needs the measurement to say so.
 * Note the one asymmetry if one is ever added: a stale entry is *reported*, not failed, because this class of
 * nondeterminism is a race and a run where one happens to agree is not evidence it is gone.
 */
export const KNOWN_IRREPRODUCIBLE: Readonly<Record<string, string>> = {};

/** The differences that fail a run, and the ones a recorded cause explains */
export function partition(differences: readonly Difference[]): { failing: Difference[]; known: Difference[] } {
  return {
    failing: differences.filter((d) => !(d.path in KNOWN_IRREPRODUCIBLE)),
    known: differences.filter((d) => d.path in KNOWN_IRREPRODUCIBLE),
  };
}

/** What the second build did to the first's output, sorted so a report reads the same way twice */
export function compare(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): Difference[] {
  const differences: Difference[] = [];
  for (const [file, hash] of before) {
    if (!after.has(file)) differences.push({ path: file, kind: 'disappeared' });
    else if (after.get(file) !== hash) differences.push({ path: file, kind: 'changed' });
  }
  for (const file of after.keys()) {
    if (!before.has(file)) differences.push({ path: file, kind: 'appeared' });
  }
  return differences.sort((a, b) => a.path.localeCompare(b.path));
}
