import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, hash as cryptoHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PackManifest } from '@apackdev/sdk/build';
import { _depTypesFile, _depTypesVersion, generatePackFiles } from '@apackdev/sdk/build';
import { holdExclusiveLock } from '@apackdev/host/exclusive-lock';
import { compileSettingsDefinition } from '@apackdev/host/packs';
import { findPackRoot, readValidManifest } from '../utils';
import { resolveDeps, type ResolvedDeps } from './generate';
import { packInputsHash } from '@apackdev/host/build/pack-inputs';
import { captureCompilationInputs, type CompilationInputs } from '../build/compilation-inputs.ts';
import { assertDependencyInputsCurrent, dependencyInputsHash } from '../build/dependency-inputs.ts';

const STAMP_FILE = '.apack/generate-entries.json';
function computeInputsHash(root: string, manifest: PackManifest, dependencies: ResolvedDeps, compilation: CompilationInputs): string {
  if (!isDeepStrictEqual(Object.keys(manifest.dependencies ?? {}).sort(), [...dependencies.files.keys()].sort())) {
    throw new Error('Resolved dependencies differ from apack.json; retry generation');
  }
  assertDependencyInputsCurrent(dependencies.files);
  const hash = createHash('sha256');
  hash.update(packInputsHash(root, { modulesOnly: true }));
  // The parsed declarations used below are part of the identity, even if disk changes between reads.
  hash.update(JSON.stringify(manifest));
  hash.update(compilation.hash);
  hash.update(dependencyInputsHash(dependencies.files));
  return hash.digest('hex');
}

/**
 * Warns about each dependency whose facade types (src/__generated__/deps/<id>.d.ts) were generated
 * from a version other than the one the pack builds and runs with.
 */
export function warnStaleDepTypes(root: string, runtimeVersions: Map<string, string>): void {
  for (const [depId, runtimeVersion] of runtimeVersions) {
    const file = path.join(root, _depTypesFile(depId));
    if (!fs.existsSync(file)) continue;
    const typesVersion = _depTypesVersion(fs.readFileSync(file, 'utf-8'), depId);
    if (typesVersion === runtimeVersion) continue;
    console.warn(`\nWarning: ${_depTypesFile(depId)} has the types of ${depId}@${typesVersion ?? 'an unknown version'}, but the pack builds with ${depId}@${runtimeVersion}. Code checked against these types may not match the dependency at runtime: run "apack pack generate-entries --force" (or build without --skip-generate).`);
  }
}

/** Inputs and exact output bytes from a successful generation. */
interface InputsStamp { hash: string; files: Record<string, string> }
const digest = (content: string | Buffer): string => cryptoHash('sha256', content, 'hex');

function readStamp(hashPath: string): InputsStamp | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(hashPath, 'utf-8')) as InputsStamp;
    if (typeof parsed?.hash !== 'string' || !parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) return null;
    return Object.keys(parsed.files).length > 0 && Object.entries(parsed.files).every(([file, hash]) =>
      file.startsWith('src/__generated__/') && !file.split('/').some(part => part === '..')
      && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) ? parsed : null;
  } catch {
    return null;
  }
}

/** The recorded output set follows the manifest, including dependency facades. */
function staleReason(hashPath: string, root: string, currentHash: string): string | null {
  const stamp = readStamp(hashPath);
  if (!stamp) return 'no record of the last run';
  for (const [file, hash] of Object.entries(stamp.files)) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) return `missing ${file}`;
    if (!fs.statSync(target).isFile() || digest(fs.readFileSync(target)) !== hash) return `modified ${file}`;
  }
  return stamp.hash === currentHash ? null : 'inputs changed';
}

/** Skipping generation requires the same evidence that permits normal generation to reuse its files. */
export function assertGeneratedCurrent(root: string, manifest: PackManifest, dependencies: ResolvedDeps, compilation?: CompilationInputs): void {
  if (compilation) compilation.assertCurrent();
  assertGeneratedStampCurrent(root, manifest, dependencies, compilation ?? captureCompilationInputs(root));
}

/**
 * The generated files and the stamp of the inputs they were generated from, without re-checking the compilation's
 * captured inputs: for a caller that runs `compilation.assertCurrent()` itself before publishing.
 */
export function assertGeneratedStampCurrent(root: string, manifest: PackManifest, dependencies: ResolvedDeps, compilation: CompilationInputs): void {
  const problem = staleReason(path.join(root, STAMP_FILE), root, computeInputsHash(root, manifest, dependencies, compilation));
  if (problem) throw new Error(`Generated pack files are stale: ${problem}. Run "apack pack generate-entries" or build without --skip-generate.`);
}

export async function generateEntries(
  _args: string[],
  packRoot?: string,
  dependencies?: ResolvedDeps,
  compilation?: CompilationInputs,
) {
  if (_args.some(arg => arg !== '--force')) throw new Error('Usage: apack pack generate-entries [--force]');
  const root = packRoot ?? findPackRoot(process.cwd());
  const outDir = path.join(root, 'src/__generated__');
  const hashPath = path.join(root, STAMP_FILE);
  const force = _args.includes('--force');
  // Code generated from a manifest the installer would reject would describe a pack that can't install
  const manifest = readValidManifest(root);

  dependencies ??= await resolveDeps(root, manifest.dependencies);
  compilation ??= captureCompilationInputs(root);
  const currentHash = computeInputsHash(root, manifest, dependencies, compilation);

  const stale = force ? 'forced' : staleReason(hashPath, root, currentHash);
  if (stale === null) {
    console.log('generate-entries: inputs unchanged, skipping (use --force to regenerate)');
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  // One writer per pack. Two runs over one pack interleave their writes into `src/__generated__/`, and the loser
  // is invisible: every file is written, the last writer wins each one, and the result reads as a stale build
  // nobody can reproduce. It happened here — concurrent runs left the type barrel describing a fix that was
  // already compiled. The build takes this through this function too, and never around it: `holdExclusiveLock` has no re-entrancy, so a nested take would refuse itself, naming this pid.
  using _lock = holdExclusiveLock({
    file: path.join(outDir, GENERATE_LOCK),
    what: 'apack pack generate-entries',
    refuse: (holder) => new Error(
      `Another run is generating ${path.relative(process.cwd(), outDir) || 'src/__generated__'}: ${holder}. `
      + `Wait for it to finish. If none is running, delete ${path.join(outDir, GENERATE_LOCK)} and try again.`,
    ),
  });
  await writeGenerated(root, outDir, hashPath, currentHash, manifest, dependencies, compilation);
}

/** The lock file, inside the directory it guards, so it travels with the output it protects */
const GENERATE_LOCK = '.generating.lock';

async function writeGenerated(
  root: string,
  outDir: string,
  hashPath: string,
  currentHash: string,
  manifest: PackManifest,
  dependencies: ResolvedDeps,
  compilation: CompilationInputs,
) {
  const files = await generatePackFiles(manifest, {
    packRoot: root,
    depTypes: dependencies.depTypes,
    depSnapshots: dependencies.depSnapshots,
    validateSettings: compileSettingsDefinition,
  });
  compilation.assertCurrent();
  if (computeInputsHash(root, manifest, dependencies, compilation) !== currentHash) {
    throw new Error('Pack generation inputs changed; retry before publishing generated files');
  }

  // Dependencies' facade types are rewritten from their snapshots each time
  fs.rmSync(path.join(outDir, 'deps'), { recursive: true, force: true });
  for (const [filePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, filePath)), { recursive: true });
    fs.writeFileSync(path.join(root, filePath), content);
  }
  // Generated files this codegen no longer emits (renamed or removed outputs) would keep
  // compiling into the pack with stale content; hand-written files are never touched
  const produced = new Set(Object.keys(files).map(f => path.resolve(root, f)));
  for (const name of fs.readdirSync(outDir)) {
    if (name === GENERATE_LOCK) continue;
    const file = path.join(outDir, name);
    if (produced.has(file) || !fs.statSync(file).isFile()) continue;
    const head = fs.readFileSync(file, 'utf-8').slice(0, 120);
    if (/^\/\/ (@generated from apack\.json|Auto-generated by `apack pack generate-entries`)/.test(head)) fs.rmSync(file);
  }

  // Compiler-specific cache metadata is not a generated module consumed by subsequent builds.
  fs.mkdirSync(path.dirname(hashPath), { recursive: true });
  fs.writeFileSync(hashPath, JSON.stringify({ hash: currentHash, files: Object.fromEntries(Object.keys(files).sort().map(file => [file, digest(files[file])])) }, null, 2) + '\n');

  console.log('Generated:');
  for (const filePath of Object.keys(files)) {
    console.log(`  ${filePath}`);
  }
}

/**
 * Regenerates the entries after `apack pack add` wrote new files. Reading a system's events takes the pack's `@apackdev/sdk`,
 * which a pack scaffolded moments ago may not have installed yet: then the scaffold stands, and the pack's `prepare`
 * script regenerates the entries when `npm install` runs.
 */
export async function regenerateAfterScaffold(root: string): Promise<boolean> {
  try {
    await generateEntries([], root);
    return true;
  } catch (err) {
    // A pack scaffolded before `npm install` can't resolve what its contracts name, and nothing here can tell
    // that from a mistake in the pack: both reach the reader as a type that didn't resolve. So say what happened
    // and let `npm install`, which regenerates, be the next step either way.
    console.log(`\n  src/__generated__/ not regenerated: ${(err as Error).message}. Run: npm install (it regenerates them)`);
    return false;
  }
}
