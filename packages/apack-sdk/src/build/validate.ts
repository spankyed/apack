import { findSourceModule, SCRIPT_MODULE_EXTENSIONS, TYPE_MODULE_EXTENSIONS } from './source-module.ts';
import { _packModuleTargets, _moduleTargetSource } from './module-targets.ts';
import { resolveTypeModule } from './type-module.ts';
import * as fs from 'node:fs';
import { ManifestSchema } from '../framework/declaration-schema.ts';
import { packFeatures, type PackManifest } from './manifest.ts';
import { diagnosticPath, packValidation, type PackDiagnostic, type PackValidation } from './diagnostics.ts';
import { _namingRefusedValue } from '../framework/refused-value.ts';

export function parseManifest(raw: unknown): PackValidation {
  const result = ManifestSchema.safeParse(raw, { error: _namingRefusedValue });
  if (result.success) return packValidation();
  const packId = raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : undefined;

  const diagnostics: PackDiagnostic[] = result.error.issues.map(issue => {
    const fieldPath = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'root';
    return {
      code: `manifest.${issue.code}`, severity: 'error', packId, path: diagnosticPath(issue.path),
      message: `apack.json ${fieldPath}: ${issue.message}`,
    };
  });
  return packValidation(diagnostics);
}

export function validateManifest(manifestPath: string): PackValidation {
  if (!fs.existsSync(manifestPath)) {
    return packValidation([{ code: 'manifest.missing', severity: 'error', path: [], message: 'Missing apack.json manifest' }]);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return packValidation([{ code: 'manifest.json', severity: 'error', path: [], message: 'apack.json is not valid JSON' }]);
  }

  return parseManifest(raw);
}

/** Check declared module files independently of dependencies, plus local designation ownership. */
export function validatePackSources(packRoot: string, manifest: Partial<PackManifest>): PackValidation {
  const diagnostics: PackDiagnostic[] = [];
  for (const entry of _packModuleTargets(manifest)) {
    const { path, target, kind, label } = entry;
    const entity = path.at(-2) === 'entities';
    const group = path[0] === 'extensions' && path[1] === 'settings';
    const feature = path[0] === 'features';
    const code = entity ? 'entity' : group ? 'settings' : feature ? 'feature' : 'module';
    try {
      if (kind === 'types') {
        resolveTypeModule(packRoot, target, label);
        continue;
      }
      const source = _moduleTargetSource(entry);
      const extensions = kind === 'type' ? TYPE_MODULE_EXTENSIONS : kind === 'component' ? [...SCRIPT_MODULE_EXTENSIONS, '.vue'] : SCRIPT_MODULE_EXTENSIONS;
      if (!findSourceModule(packRoot, source, extensions, label)) {
        diagnostics.push({ code: `${code}.${entity ? 'missing-shape-module' : group ? 'missing-form' : 'missing-file'}`,
          severity: 'error', packId: manifest.id, path, source,
          message: entity ? `${label}: no module found at ${source}` : `${label} file "${source}" not found` });
      }
    } catch (error) {
      const suffix = kind === 'types' ? 'type-module' : entity ? 'invalid-shape-target' : group ? 'invalid-form' : 'invalid-target';
      diagnostics.push({ code: `${code}.${suffix}`, severity: 'error', packId: manifest.id,
        path, source: target, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const designatedBy = new Map<string, string>();
  for (const feature of packFeatures(manifest)) {
    if (feature.designation === undefined) continue;
    const held = designatedBy.get(feature.designation);
    if (held !== undefined) {
      diagnostics.push({ code: 'feature.designation-conflict', severity: 'error', packId: manifest.id,
        path: ['features', feature.id, 'designation'],
        message: `Feature "${feature.id}": designation "${feature.designation}" is already claimed by feature "${held}"` });
    } else designatedBy.set(feature.designation, feature.id);
  }
  return packValidation(diagnostics);
}
