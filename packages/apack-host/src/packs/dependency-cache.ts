import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { parseDependencySnapshot, type PackDependencySnapshot } from '@apackdev/sdk/build';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { replaceDir } from '../replace-dir.ts';
import { holdExclusiveLock } from '../exclusive-lock.ts';
import { PACK_LAYOUT, verifyPack, packBuildRevision, type PackIntegrity } from './layout.ts';
import { settingsDeclarationDiagnostics } from '../features/settings/compile.ts';

const localOrigin = z.object({
  kind: z.enum(['workspace', 'file', 'host', 'installed-app']),
  directory: z.string().refine(path.isAbsolute, 'Dependency source directory must be absolute'),
  selection: z.string().min(1),
}).strict();
const originSchema = z.union([localOrigin, z.object({
  kind: z.literal('github'), repository: z.string().min(1), tag: z.string().min(1),
  archive: z.string().min(1), checksum: z.string().min(1),
}).strict()]);
const resolutionSchema = z.object({
  spec: z.string().min(1), id: z.string().min(1), version: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['build', 'type-data']), origin: originSchema,
}).strict();

export type DependencyOrigin = z.infer<typeof originSchema>;
export type DependencyResolution = z.infer<typeof resolutionSchema>;
export interface CachedDependencyBuild {
  directory: string;
  snapshot: PackDependencySnapshot;
  resolution: DependencyResolution;
}

/** Validate current dependency data and any producer receipt; never import executable modules. */
export function readDependencyBuild(directory: string): Omit<CachedDependencyBuild, 'resolution'> & {
  revision: string; kind: DependencyResolution['kind'];
} {
  const { snapshot, bytes } = readSnapshot(directory);
  const integrity = readVerifiedBuildIntegrity(directory, snapshot, bytes);
  const revision = integrity ? packBuildRevision(integrity) : snapshotRevision(bytes);
  return { directory, snapshot, revision, kind: integrity ? 'build' : 'type-data' };
}

function cacheDirectory(root: string, id: string): string {
  if (!PACK_ID_PATTERN.test(id)) throw new Error(`Invalid dependency pack ID: ${id}`);
  return path.join(root, '.apack', 'deps', id);
}

function readSnapshot(directory: string): { snapshot: PackDependencySnapshot; bytes: Buffer } {
  const bytes = fs.readFileSync(path.join(directory, PACK_LAYOUT.snapshot));
  const result = parseDependencySnapshot(JSON.parse(bytes.toString('utf8')));
  if (!result.snapshot) throw new Error(`${directory}: ${result.diagnostics.map(issue => issue.message).join('; ')}`);
  const settingsDiagnostics = settingsDeclarationDiagnostics(result.snapshot.manifest, {
    codePrefix: 'snapshot', source: 'snapshot.json', label: 'snapshot.json', pathPrefix: ['manifest'],
  });
  if (settingsDiagnostics.length) throw new Error(`${directory}: ${settingsDiagnostics.map(issue => issue.message).join('; ')}`);
  return { snapshot: result.snapshot, bytes };
}

function snapshotRevision(bytes: Buffer): string {
  return crypto.hash('sha256', bytes, 'hex');
}

/** An absent receipt permits type inspection only; a present receipt must match captured declarations. */
function readVerifiedBuildIntegrity(directory: string, snapshot: PackDependencySnapshot, bytes: Buffer): PackIntegrity | undefined {
  if (!fs.lstatSync(path.join(directory, PACK_LAYOUT.integrity), { throwIfNoEntry: false })) return undefined;
  const integrity = verifyPack(directory);
  if (integrity.id !== snapshot.manifest.id || integrity.version !== snapshot.manifest.version
    || snapshotRevision(bytes) !== integrity.files[PACK_LAYOUT.snapshot]
    || !isDeepStrictEqual(JSON.parse(fs.readFileSync(path.join(directory, PACK_LAYOUT.manifest), 'utf8')), snapshot.manifest)) {
    throw new Error(`Dependency build ${integrity.id}@${integrity.version} declares captured snapshot ${snapshot.manifest.id}@${snapshot.manifest.version}; declarations differ from its verified build`);
  }
  return integrity;
}

function checkBuild(directory: string, resolution: Pick<DependencyResolution, 'id' | 'version' | 'revision' | 'kind'>): PackDependencySnapshot {
  if (!fs.lstatSync(directory).isDirectory()) throw new Error(`Dependency "${resolution.id}" build must be a directory`);
  const { snapshot, bytes } = readSnapshot(directory);
  if (snapshot.manifest.id !== resolution.id || snapshot.manifest.version !== resolution.version) {
    throw new Error(`Dependency "${resolution.id}" snapshot identity differs from its resolution record`);
  }
  let revision: string;
  if (resolution.kind === 'build') {
    const integrity = readVerifiedBuildIntegrity(directory, snapshot, bytes);
    if (!integrity) throw new Error(`Dependency "${resolution.id}" has no complete build receipt`);
    revision = packBuildRevision(integrity);
  } else {
    if (!fs.lstatSync(path.join(directory, PACK_LAYOUT.typesDir)).isDirectory()
      || !fs.lstatSync(path.join(directory, PACK_LAYOUT.snapshot)).isFile()) {
      throw new Error(`Dependency "${resolution.id}" type-data cache must contain regular files`);
    }
    revision = snapshotRevision(bytes);
    const entries = fs.readdirSync(directory);
    if (entries.length !== 1 || entries[0] !== PACK_LAYOUT.typesDir
      || fs.readdirSync(path.join(directory, PACK_LAYOUT.typesDir)).join() !== 'snapshot.json') {
      throw new Error(`Dependency "${resolution.id}" type-data cache contains unexpected files`);
    }
  }
  if (revision !== resolution.revision) throw new Error(`Dependency "${resolution.id}" content identity differs from its resolution record`);
  return snapshot;
}

/** Capture one resolution and verify its immutable build without loading executable modules. */
export function readCachedDependency(root: string, id: string): CachedDependencyBuild | null {
  const directory = cacheDirectory(root, id);
  const record = path.join(directory, 'resolution.json');
  let bytes: string;
  try { bytes = fs.readFileSync(record, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const resolution = resolutionSchema.parse(JSON.parse(bytes));
  if (resolution.id !== id) throw new Error(`Dependency "${id}" resolution declares "${resolution.id}"`);
  const build = path.join(directory, 'builds', resolution.revision);
  return { directory: build, snapshot: checkBuild(build, resolution), resolution };
}

/** Copy producer bytes unchanged; publish the resolution only after the complete copy verifies. */
export function cacheDependency(root: string, id: string, source: string,
  spec: string, origin: DependencyOrigin): CachedDependencyBuild {
  const { snapshot, bytes } = readSnapshot(source);
  if (snapshot.manifest.id !== id) throw new Error(`Dependency "${id}" resolved to pack "${snapshot.manifest.id}"`);
  const integrity = readVerifiedBuildIntegrity(source, snapshot, bytes);
  const resolution = resolutionSchema.parse({ spec, id, version: snapshot.manifest.version, origin,
    kind: integrity ? 'build' : 'type-data',
    revision: integrity ? packBuildRevision(integrity) : snapshotRevision(bytes),
  });
  const directory = cacheDirectory(root, id);
  const builds = path.join(directory, 'builds');
  fs.mkdirSync(builds, { recursive: true });
  using cleanup = new DisposableStack();
  const staged = fs.mkdtempSync(path.join(builds, '.incoming-'));
  cleanup.defer(() => fs.rmSync(staged, { recursive: true, force: true }));
  const temporaryRecord = path.join(directory, `.resolution-${crypto.randomBytes(8).toString('hex')}.json`);
  cleanup.defer(() => fs.rmSync(temporaryRecord, { force: true }));
  if (integrity) fs.cpSync(source, staged, { recursive: true, dereference: false });
  else {
    fs.mkdirSync(path.join(staged, PACK_LAYOUT.typesDir));
    fs.writeFileSync(path.join(staged, PACK_LAYOUT.snapshot), bytes);
  }
  checkBuild(staged, resolution);
  using _lock = holdExclusiveLock({ file: path.join(directory, 'publish.lock'),
    what: `Publishing dependency ${id}`, refuse: holder => new Error(`Dependency ${id} cache is held by ${holder}; retry resolution`) });
  const destination = path.join(builds, resolution.revision);
  if (fs.existsSync(destination)) {
    try { checkBuild(destination, resolution); }
    catch { replaceDir(staged, destination); }
  } else fs.renameSync(staged, destination);
  fs.writeFileSync(temporaryRecord, JSON.stringify(resolution, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temporaryRecord, path.join(directory, 'resolution.json'));
  return { directory: destination, snapshot, resolution };
}
