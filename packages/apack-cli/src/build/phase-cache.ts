/**
 * Content-keyed reuse of facade types and DSL definitions.
 *
 * Keys cover authored pack files, generated entries, the phase's additional inputs and tools.
 * Diagnostic build-read records do not define this scope: additions must invalidate reuse even when
 * no previous build read them. Reused output is copied into the staged tree before publication, so
 * reuse produces the same output as running the phase. Neither cached phase reads `--release`, so a
 * release build reuses development output; a phase whose output depends on it must add it to its key.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { packInputsHash } from '@apackdev/host/build/pack-inputs';
import { dependencyClosure, packageIdentity, UnresolvedDependencyError, type ClosurePackage } from '@apackdev/host/build/package-identity';
import type { CompilationInputs } from './compilation-inputs.ts';
import { dependencyInputsHash } from './dependency-inputs.ts';
import type { ResolvedDepFiles } from '../commands/fetch-deps.ts';
import { verifyPack, type PackIntegrity } from '@apackdev/host/packs';
import type { RecordBuildOutput } from './build-outputs.ts';
import { readPackBuildInputs, assertPackBuildInputsCurrent, type PackBuildInputs } from '@apackdev/host/build/pack-build-inputs';

/** Private source-build metadata, sealed and replaced with its output; staging omits root cache files. */
const CACHE_FILE = 'phase-cache.json';

export interface PhaseStamp {
  /** What the phase read: its inputs and the implementation that produces it */
  readonly hash: string;
  /**
   * What it wrote, relative to `dist`. The output set follows the pack's declarations, so membership
   * belongs to the recorded phase rather than a fixed inventory.
   */
  readonly files: readonly string[];
}

export type PhaseStamps = Readonly<Record<string, PhaseStamp>>;

export function readPhaseCache(root: string): { stamps: PhaseStamps; inputs?: PackBuildInputs; integrity?: PackIntegrity } {
  try {
    const dir = path.join(root, 'dist');
    const receipt = verifyPack(dir);
    const inputs = readPackBuildInputs(dir, receipt);
    assertPackBuildInputsCurrent(root, inputs);
    const bytes = fs.readFileSync(path.join(dir, CACHE_FILE));
    if (createHash('sha256').update(bytes).digest('hex') !== receipt.files[CACHE_FILE]) return { stamps: {} };
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { stamps: {} };
    return { stamps: parsed as PhaseStamps, inputs, integrity: receipt };
  } catch {
    // Missing, damaged or stale input/output records require a cold rebuild.
    return { stamps: {} };
  }
}

/** Write only to staging; its seal and directory replacement own publication. */
export function writeStamps(outputDir: string, stamps: PhaseStamps, recordOutput?: RecordBuildOutput): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, CACHE_FILE);
  const bytes = `${JSON.stringify(stamps, null, 2)}\n`;
  fs.writeFileSync(file, bytes);
  recordOutput?.(file, bytes);
}

/**
 * Why a phase's recorded output cannot be taken forward, or `null` when it can.
 *
 * Two questions rather than one, which is the shape of `generate-entries`' `staleReason` and
 * `unitStaleReason` (`@apackdev/host/build/packages-built`): recording only the hash let a deleted output
 * read as current, there and here.
 *
 * **The order is the opposite of those two, deliberately.** They ask about missing output first because a
 * missing file was the silent-success bug they were written for. Here either answer rebuilds, so the order
 * decides only the message — and "inputs changed" is the expected one, worth saying plainly, while output
 * that has gone missing under an unchanged hash is the surprise worth naming on its own.
 */
export function reuseProblem(stamp: PhaseStamp | undefined, distDir: string, hash: string): string | null {
  if (!stamp) return 'no record of the last build';
  if (stamp.hash !== hash) return 'inputs changed';
  const missing = stamp.files.filter((file) => !fs.existsSync(path.join(distDir, file)));
  if (missing.length > 0) return `missing ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}`;
  return stamp.files.length > 0 ? null : 'recorded no output';
}

/** Every file under `dir`, relative to it, sorted — the listing a phase's output set is read from */
export function filesUnder(dir: string, base = dir, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

/** Copies a phase's recorded output from `dist` into the staged tree, at the same relative paths */
export function takeForward(distDir: string, stagedDir: string, files: readonly string[], options: { hashes: PackIntegrity['files']; recordOutput?: RecordBuildOutput }): void {
  for (const file of files) {
    const from = path.join(distDir, file);
    const expected = options.hashes[file.split(path.sep).join('/')];
    if (!expected) throw new Error(`Reusable output is not in the verified receipt: ${file}`);
    const bytes = fs.readFileSync(from);
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Reusable output changed: ${file}`);
    const to = path.join(stagedDir, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
    fs.chmodSync(to, fs.statSync(from).mode);
    options.recordOutput?.(to, bytes);
  }
}

/**
 * What a pack's DSL definitions compile against beyond its own sources: `@apackdev/sdk` and `@apackdev/ui` as the
 * pack resolves them, and every package each brings (`dependencyClosure`), as one hash of their identities
 * (`packageIdentity`: name, version and the files each ships). That is workspace source in a checkout and
 * `node_modules` in an installed pack, and a linked package (`npm run deps:local`'s EARS) is read the same way as an
 * installed one, since its version says nothing.
 *
 * **A package it cannot find is a refusal, not an omission.** Leaving one out of the scope would mean a change to it
 * did not invalidate anything, and the build would take a bundle forward that was compiled against the one before.
 * `packagesBuiltOrRefuse` is the same shape: where the evidence is missing, say so rather than answer from what is
 * left. `missing` names each declaration that doesn't resolve and who declared it.
 */
export function apackScope(packDir: string): { readonly hash: string } | { readonly missing: readonly string[] } {
  const packages = new Map<string, ClosurePackage>();
  const missing: string[] = [];
  for (const name of ['@apackdev/sdk', '@apackdev/ui']) {
    try {
      for (const pkg of dependencyClosure(name, packDir)) packages.set(pkg.directory, pkg);
    } catch (err) {
      if (!(err instanceof UnresolvedDependencyError)) throw err;
      missing.push(...err.unresolved);
    }
  }
  if (missing.length > 0) return { missing };
  // Sorted by what each package is, not where it is: two installs of the same packages are one scope
  const identities = [...packages.keys()].map((directory) => {
    const { name, version, hash } = packageIdentity(directory);
    return `${name}@${version}:${hash}`;
  }).sort();
  return { hash: createHash('sha256').update(identities.join('\n')).digest('hex') };
}

/** The facade types a dependent compiles against: the pack's own sources, and what it compiles them with */
export function typesInputsHash(root: string, dependencies: ReadonlyMap<string, ResolvedDepFiles>, compilation: CompilationInputs): string {
  return phaseInputsHash(root, { bundler: 'types-bundler.ts', dependencies, compilation });
}

/** The DSL defs: the manifest's `dsl` entries, the sources they name, and the packages their types come from (`apackScope`) */
export function dslInputsHash(root: string, apackScopeHash: string, dependencies: ReadonlyMap<string, ResolvedDepFiles>, compilation: CompilationInputs): string {
  return phaseInputsHash(root, { bundler: 'dsl-defs.ts', scope: apackScopeHash, dependencies, compilation });
}

/**
 * One hash for every gated phase: the pack's own sources and build inputs, whatever else the phase reaches,
 * and the implementation that produces it.
 */
function phaseInputsHash(root: string, o: {
  readonly bundler: string;
  readonly scope?: string;
  readonly dependencies: ReadonlyMap<string, ResolvedDepFiles>;
  readonly compilation: CompilationInputs;
}): string {
  const hash = createHash('sha256');
  hash.update(o.bundler);
  hash.update(o.compilation.hash);
  hash.update(packInputsHash(root, { generated: true }));
  if (o.scope !== undefined) hash.update(o.scope);
  hash.update(dependencyInputsHash(o.dependencies));
  return hash.digest('hex');
}
