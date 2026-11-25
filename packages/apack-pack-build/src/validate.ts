import { findSourceModule, SCRIPT_MODULE_EXTENSIONS, TYPE_MODULE_EXTENSIONS } from './source-module.ts';
import { _packModuleTargets, _moduleTargetSource } from './module-targets.ts';
import { resolveTypeModule } from './type-module.ts';
import * as fs from 'node:fs';
import {
  packFeatures, packValidation, parseManifest,
  type PackDiagnostic, type PackManifest, type PackValidation,
} from '@apackdev/pack-format';

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
  // A worker is bundled on its own and imported by nothing, so it is checked here rather than among the targets
  // codegen reads exports from, whose program would otherwise take in everything a worker imports
  for (const [name, target] of Object.entries(manifest.build?.workers ?? {})) {
    const label = `Worker "${name}"`;
    try {
      if (!findSourceModule(packRoot, target, SCRIPT_MODULE_EXTENSIONS, label)) {
        diagnostics.push({ code: 'module.missing-file', severity: 'error', packId: manifest.id, path: ['build', 'workers', name], source: target,
          message: `${label} file "${target}" not found` });
      }
    } catch (error) {
      diagnostics.push({ code: 'module.invalid-target', severity: 'error', packId: manifest.id, path: ['build', 'workers', name], source: target,
        message: error instanceof Error ? error.message : String(error) });
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
