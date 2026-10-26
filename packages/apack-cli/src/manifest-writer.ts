import * as fs from 'node:fs';
import * as path from 'node:path';
import { FeatureEntrySchema, ManifestSchema, type PackManifest } from '@apackdev/sdk/build';

const shape = ManifestSchema.out.shape;
const rootFields = Object.keys(shape);
const featureFields = Object.keys(FeatureEntrySchema.shape);
const extensionFields = Object.keys(shape.extensions.unwrap().shape);

function ordered<T extends object>(value: T, fields: readonly string[]): T {
  const entries = new Map(Object.entries(value));
  const known = fields.flatMap(key => entries.has(key) ? [[key, entries.get(key)]] : []);
  return Object.fromEntries([...known, ...[...entries].filter(([key]) => !fields.includes(key))]) as T;
}

/** Order structural fields only; declaration members and arrays retain their authored order. */
export function formatManifest(manifest: PackManifest): string {
  const value = { ...manifest };
  if (manifest.features) value.features = Object.fromEntries(Object.entries(manifest.features)
    .map(([id, feature]) => [id, ordered(feature, featureFields)]));
  if (manifest.extensions) value.extensions = ordered(manifest.extensions, extensionFields);
  return JSON.stringify(ordered(value, rootFields), null, 2) + '\n';
}

export function writeManifest(root: string, manifest: PackManifest): void {
  fs.writeFileSync(path.join(root, 'apack.json'), formatManifest(manifest));
}
