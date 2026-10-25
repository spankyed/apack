import { _stepBackendParts } from '../framework/step-backend-declaration.ts';
import { _packEntities } from '../framework/data-declaration.ts';
import { _surfaceTargets } from '../framework/surface-declaration.ts';
import { _referenceTargets } from '../framework/reference-declaration.ts';
import { _stepFrontendTargets } from '../framework/step-frontend-declaration.ts';
import { packFeatures, type PackManifest } from './manifest.ts';
import { _parseModulePath, _parseModuleReference } from '../framework/module-reference.ts';
import { MIGRATION_LINES } from '../framework/declaration-schema.ts';

interface ModuleTarget {
  path: string[];
  target: string;
  kind: 'script' | 'component' | 'type' | 'types';
  reference: 'named' | 'default' | 'module';
  label: string;
  conventionalExport?: string;
}

/** Authored module targets, derived from declarations; no source discovery or executable imports. */
export function _packModuleTargets(manifest: Partial<PackManifest>): ModuleTarget[] {
  const targets: ModuleTarget[] = [];
  const add = (path: string[], target: string | undefined, kind: ModuleTarget['kind'] = 'script', reference: ModuleTarget['reference'] = 'named', label = path.join('.'), conventionalExport = reference === 'module' && kind !== 'types' ? 'default' : undefined) => {
    if (target !== undefined) targets.push({ path, target, kind, reference, label, conventionalExport });
  };
  for (const feature of packFeatures(manifest)) {
    const prefix = ['features', feature.id];
    const field = (name: string, target: string | undefined, kind: ModuleTarget['kind'] = 'script', reference: ModuleTarget['reference'] = 'named') =>
      add([...prefix, ...name.split('.')], target, kind, reference, `Feature "${feature.id}": ${name}`);
    field('settings.form', feature.settings?.form, 'component', 'module');
    for (const [name, target] of feature.references ? _referenceTargets(feature.references) : []) {
      const icon = name.endsWith('.icon');
      field(`references.${name}`, target, icon ? 'component' : 'script', icon ? 'default' : 'named');
    }
    field('system.entry', feature.system?.entry, 'script', 'module');
    field('system.contract', feature.system?.contract, 'type');
    field('surface.contract', feature.surface?.contract, 'type');
    for (const [name, target] of Object.entries(feature.services ?? {})) field(`services.${name}`, target);
    for (const [name, target] of Object.entries(feature.repositories ?? {})) field(`repositories.${name}`, target);
    field('views', feature.views);
    for (const [name, target] of feature.surface ? _surfaceTargets(feature.surface) : []) {
      field(`surface.${name}`, target, name === 'state' || name === 'fallbackPanel.isShown' ? 'script' : 'component', name === 'fallbackPanel.isShown' ? 'named' : 'default');
    }
    field('types', feature.types, 'types', 'module');
  }
  for (const [name, definition] of Object.entries(manifest.extensions?.settings ?? {})) {
    add(['extensions', 'settings', name, 'form'], definition.form, 'component', 'module', `Settings group "${name}": form`);
  }
  for (const { name, owner, shape } of _packEntities(manifest)) {
    if (shape !== null) add([...owner.split('.'), 'entities', name], shape, 'type', 'named', `Entity shape "${name}"`);
  }
  for (const [name, target] of Object.entries(manifest.extensions?.services ?? {})) add(['extensions', 'services', name], target);
  for (const [name, entry] of Object.entries(manifest.extensions?.steps ?? {})) {
    const prefix = ['extensions', 'steps', name];
    for (const [facet, parts] of Object.entries(_stepBackendParts(entry))) {
      for (const [name, target] of Object.entries(parts.callbacks)) add([...prefix, facet, name], target);
    }
    add([...prefix, 'runtime', 'handler'], entry.runtime?.handler);
    add([...prefix, 'types'], entry.types, 'types', 'module', `Step "${name}": types`);
    if (entry.dsl?.helpers !== undefined) targets.push({ path: [...prefix, 'dsl', 'helpers'], target: entry.dsl.helpers,
      kind: 'script', reference: 'module', label: `Step "${name}": dsl.helpers` });
    for (const [field, target, kind] of entry.fe ? _stepFrontendTargets(entry.fe) : []) {
      add([...prefix, 'fe', ...field.split('.')], target, kind, kind === 'component' ? 'default' : 'named');
    }
  }
  for (const [name, entry] of Object.entries(manifest.extensions?.blocks ?? {})) {
    add(['extensions', 'blocks', name, 'be'], entry.be);
    add(['extensions', 'blocks', name, 'fe'], entry.fe, 'component', 'module');
  }
  for (const [name, entry] of Object.entries(manifest.extensions?.artifacts ?? {})) add(['extensions', 'artifacts', name, 'fe'], entry.fe, 'component', 'module');
  for (const [name, entry] of Object.entries(manifest.extensions?.dsl ?? {})) add(['extensions', 'dsl', name, 'entry'], entry.entry, 'types', 'module');
  for (const [id, contribution] of Object.entries(manifest.extensions?.textEditor ?? {})) {
    const prefix = ['extensions', 'textEditor', id];
    for (const [name, target] of Object.entries(contribution.extensions ?? {})) add([...prefix, 'extensions', name], target);
    for (const [name, target] of Object.entries(contribution.popups ?? {})) add([...prefix, 'popups', name], target, 'component', 'module');
    add([...prefix, 'isSuggestionActive'], contribution.isSuggestionActive);
  }
  for (const [name, target] of Object.entries(manifest.extensions?.appExtensions ?? {})) add(['extensions', 'appExtensions', name], target, 'component', 'module');
  for (const [name, target] of Object.entries(manifest.lifecycle ?? {})) add(['lifecycle', name], target);
  for (const line of MIGRATION_LINES) {
    for (const [version, entry] of Object.entries(manifest.migrations?.[line] ?? {})) add(['migrations', line, version, 'up'], entry.up);
  }
  for (const [name, target] of Object.entries(manifest.content?.writers ?? {})) add(['content', 'writers', name], target);
  for (const [name, entry] of Object.entries(manifest.content?.formats ?? {})) add(['content', 'formats', name, 'compiler'], entry.compiler, 'script', 'module');
  for (const [name, entry] of Object.entries(manifest.content?.sources ?? {})) {
    if (typeof entry !== 'string') add(['content', 'sources', name, 'applier'], entry.applier, 'script', 'module', `content.sources.${name}.applier`, 'apply');
  }
  return targets;
}

/** Resolve syntax according to the declaration's purpose, before looking for its file. */
export function _moduleTargetSource(entry: ModuleTarget): string {
  return entry.reference === 'module' ? _parseModulePath(entry.target, entry.label)
    : _parseModuleReference(entry.target, entry.label, entry.reference === 'default' ? 'default' : undefined).source;
}
