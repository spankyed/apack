import { hasOwn } from '@apackdev/sdk/utils/pure';
import type { PackManifest, PackFeatureEntry, StepEntry, MigrationLine, PackMigrationDeclaration } from '@apackdev/pack-format';

export { readManifest } from '../../utils';

export function addFeature(manifest: PackManifest, id: string, entry: PackFeatureEntry): void {
  if (!manifest.features) manifest.features = {};
  if (hasOwn(manifest.features, id)) throw new Error(`Feature "${id}" already exists in manifest`);
  manifest.features[id] = entry;
}

/** The `extensions` section, created on the first contribution a scaffold adds to the pack */
function extensions(manifest: PackManifest): NonNullable<PackManifest['extensions']> {
  manifest.extensions ??= {};
  return manifest.extensions;
}

/** Adds a flow step: `entry` names where each of its facets lives */
export function addStep(manifest: PackManifest, type: string, entry: StepEntry): void {
  const ext = extensions(manifest);
  ext.steps ??= {};
  if (hasOwn(ext.steps, type)) throw new Error(`Step "${type}" already exists in manifest`);
  ext.steps[type] = entry;
}

/** Adds an artifact type: `icon` is a lucide-vue-next export name, `component` the path to its viewer */
export function addArtifact(
  manifest: PackManifest,
  type: string,
  entry: { icon: string; component: string },
): void {
  const ext = extensions(manifest);
  ext.artifacts ??= {};
  if (hasOwn(ext.artifacts, type)) throw new Error(`Artifact "${type}" already exists in manifest`);
  ext.artifacts[type] = { icon: entry.icon, fe: entry.component };
}

/** Adds a message block: `component` is the path to the `.vue` file that draws it */
export function addBlock(
  manifest: PackManifest,
  type: string,
  entry: { kind?: 'input'; component: string },
): void {
  const ext = extensions(manifest);
  ext.blocks ??= {};
  if (hasOwn(ext.blocks, type)) throw new Error(`Block "${type}" already exists in manifest`);
  ext.blocks[type] = { ...(entry.kind ? { kind: entry.kind } : {}), fe: entry.component };
}

/** The manifest owns the version line, target, description and executable reference. */
export function addMigration(manifest: PackManifest, line: MigrationLine, version: string, declaration: PackMigrationDeclaration): void {
  const migrations = manifest.migrations ?? (manifest.migrations = {});
  const onLine = migrations[line] ?? (migrations[line] = {});
  if (hasOwn(onLine, version)) throw new Error(`Migration "${version}" already exists in manifest under "${line}"`);
  onLine[version] = declaration;
}

/**
 * Adds a content source, which is how a scaffold declares content it just wrote: a path alone for a key the
 * SDK compiles, or a path and a `format` of this pack's own or a dependency's (`<dependency>:<name>`); the
 * schema checks that it resolves.
 */
export function addContentSource(manifest: PackManifest, key: string, entry: string | { path: string; format: string }): void {
  const content = manifest.content ?? (manifest.content = {});
  const sources = content.sources ?? (content.sources = {});
  if (hasOwn(sources, key)) throw new Error(`Content source "${key}" already exists in manifest`);
  sources[key] = entry;
}

/** Adds a pack-level service: `target` is "path#exportName" of the service object */
export function addPackService(manifest: PackManifest, key: string, target: string): void {
  const ext = extensions(manifest);
  ext.services ??= {};
  if (hasOwn(ext.services, key)) {
    throw new Error(`Pack service "${key}" already exists in manifest`);
  }
  ext.services[key] = target;
}

/** Adds a feature service: `target` is "path#exportName" of the service object */
export function addFeatureService(manifest: PackManifest, featureId: string, key: string, target: string): void {
  const feature = manifest.features && hasOwn(manifest.features, featureId) ? manifest.features[featureId] : undefined;
  if (!feature) throw new Error(`Feature "${featureId}" not found in manifest`);
  if (!feature.services) feature.services = {};
  if (hasOwn(feature.services, key)) {
    throw new Error(`Service "${key}" already exists on feature "${featureId}"`);
  }
  feature.services[key] = target;
}
