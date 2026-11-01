import type { DeclarationData } from '@apackdev/sdk/framework';
import type { PackManifest } from '@apackdev/sdk/build';
import type { SurfaceDeclaration, SettingsDefinition, ReferenceDeclarations, StepFrontendDeclaration } from '@apackdev/sdk/framework';
import type { PackFERegistration, PackFEFeature, SurfaceDefinition, TextEditorExtensions } from '@apackdev/sdk/fe';
import { isPlainObject, hasOwn } from '@apackdev/sdk/utils/pure';
import { namedBindings, sameKeys } from '../packs/binding-shape.ts';
import { isEqual } from '../features/settings/document.ts';

const REGISTRATION_KEYS = {
  id: true, declarationRevision: true, bindSettings: true, features: true, settingsForms: true,
  steps: true, artifacts: true, blocks: true, appExtensions: true, textEditor: true,
} satisfies Record<keyof PackFERegistration, true>;

const FEATURE_KEYS = { surface: true, settingsForm: true, designation: true, default: true, references: true } satisfies Record<keyof PackFEFeature, true>;
const SURFACE_KEYS = { label: true, state: true, icon: true, canvas: true, panel: true, chat: true,
  isPinned: true, hotkeys: true, options: true, fallbackPanel: true } satisfies Record<keyof SurfaceDefinition, true>;
const TIPTAP_KEYS = { readOnly: true, extensions: true, popups: true, isSuggestionActive: true } satisfies Record<keyof TextEditorExtensions, true>;
const optionalKeys = (actual: unknown, keys: string[]) => sameKeys(actual === undefined ? {} : actual, keys);
const isComponent = (value: unknown) => typeof value === 'function' || isPlainObject(value);

/** Compare a bound surface to its data without executing its views or predicates. */
function surfaceBindingProblem(declaration: SurfaceDeclaration, surface: unknown): string | undefined {
  const problem = (field = '') => `surface${field ? '.' + field : ''}`;
  if (!isPlainObject(surface) || typeof surface.label !== 'string' || !surface.label.trim()
    || !isPlainObject(surface.state) || typeof surface.state.transition !== 'function'
    || typeof surface.state.getInitialSnapshot !== 'function') return problem();
  for (const key of Object.keys(surface)) if (!hasOwn(SURFACE_KEYS, key)) return problem(key);
  for (const field of ['label', 'isPinned'] as const) if (surface[field] !== declaration[field]) return problem(field);
  for (const field of ['icon', 'panel', 'chat'] as const) {
    if ((surface[field] !== undefined) !== (declaration[field] !== undefined)
      || (declaration[field] !== undefined && !isComponent(surface[field]))) return problem(field);
  }
  if ((surface.canvas !== undefined) !== (declaration.canvas !== undefined)) return problem('canvas');
  if (declaration.canvas !== undefined) {
    const canvas = declaration.canvas;
    if (typeof canvas === 'object' && 'routes' in canvas) {
      if (!sameKeys(surface.canvas, Object.keys(canvas.routes)) || Object.values(surface.canvas as Record<string, unknown>).some(value => !isComponent(value))) return problem('canvas.routes');
    } else if (!isComponent(surface.canvas)) return problem('canvas');
  }
  if (declaration.hotkeys === undefined ? surface.hotkeys !== undefined : !Array.isArray(surface.hotkeys)
    || surface.hotkeys.length !== declaration.hotkeys.length || declaration.hotkeys.some((hotkey, index) => {
      const actual = (surface.hotkeys as unknown[])[index];
      return !sameKeys(actual, Object.keys(hotkey)) || (actual as Record<string, unknown>).action !== hotkey.action
        || (actual as Record<string, unknown>).global !== hotkey.global;
    })) return problem('hotkeys');
  if (declaration.options === undefined ? surface.options !== undefined : !sameKeys(surface.options, Object.keys(declaration.options))
    || (surface.options as Record<string, unknown>).headerClass !== declaration.options.headerClass) return problem('options');
  const fallback = surface.fallbackPanel;
  if (declaration.fallbackPanel === undefined ? fallback !== undefined : !isPlainObject(fallback)
    || !sameKeys(fallback, ['label', 'toggle', 'isShown']) || fallback.label !== declaration.fallbackPanel.label
    || !sameKeys(fallback.toggle, ['type']) || (fallback.toggle as Record<string, unknown>).type !== declaration.fallbackPanel.toggle.type
    || typeof fallback.isShown !== 'function') return problem('fallbackPanel');
}

/** Bindings supply components and callable layouts; all editor metadata must match the declaration. */
function stepFrontendProblem(declaration: StepFrontendDeclaration, actual: unknown): string | undefined {
  if (!sameKeys(actual, Object.keys(declaration))) return 'fe';
  const facet = actual as Record<string, unknown>;
  for (const field of ['colorKey', 'handlePrefix'] as const) if (facet[field] !== declaration[field]) return `fe.${field}`;
  if (!sameKeys(facet.nodeConfig, Object.keys(declaration.nodeConfig))) return 'fe.nodeConfig';
  const config = facet.nodeConfig as Record<string, unknown>;
  if (!isComponent(config.icon)) return 'fe.nodeConfig.icon';
  for (const [key, value] of Object.entries(declaration.nodeConfig)) {
    if (key !== 'icon' && !isEqual(config[key], value)) return `fe.nodeConfig.${key}`;
  }
  if (declaration.components !== undefined) {
    if (!sameKeys(facet.components, Object.keys(declaration.components))
      || Object.values(facet.components as Record<string, unknown>).some(value => !isComponent(value))) return 'fe.components';
  }
  if (declaration.layout !== undefined) {
    if (!sameKeys(facet.layout, Object.keys(declaration.layout))) return 'fe.layout';
    const layout = facet.layout as Record<string, unknown>;
    for (const [key, value] of Object.entries(declaration.layout)) {
      if (typeof value === 'string' ? typeof layout[key] !== 'function' : layout[key] !== value) return `fe.layout.${key}`;
    }
  }
}

/** Validate the complete reference facet without calling providers or components. */
function referenceBindingProblem(declaration: ReferenceDeclarations, actual: unknown): string | undefined {
  if (!sameKeys(actual, ['types', 'categories'])) return 'references';
  const bindings = actual as Record<string, unknown>;
  if (!sameKeys(bindings.types, Object.keys(declaration.types))) return 'references.types';
  if (!sameKeys(bindings.categories, Object.keys(declaration.categories))) return 'references.categories';
  for (const [id, expected] of Object.entries(declaration.types)) {
    const value = (bindings.types as Record<string, unknown>)[id];
    const path = `references.types.${id}`;
    if (!sameKeys(value, ['category', 'icon', 'svgElements'])) return path;
    const type = value as Record<string, unknown>;
    if (type.category !== expected.category
      || !isComponent(type.icon)) return path;
    if (!Array.isArray(type.svgElements) || type.svgElements.length !== expected.svgElements.length) return `${path}.svgElements`;
    for (const [index, [tag, attrs]] of expected.svgElements.entries()) {
      const element = type.svgElements[index];
      if (!Array.isArray(element) || element.length !== 2 || element[0] !== tag
        || !sameKeys(element[1], Object.keys(attrs)) || Object.entries(attrs).some(([key, value]) => element[1][key] !== value)) return `${path}.svgElements`;
    }
  }
  for (const [id, expected] of Object.entries(declaration.categories)) {
    const value = (bindings.categories as Record<string, unknown>)[id];
    if (!sameKeys(value, ['label', 'icon', 'useItems'])) return `references.categories.${id}`;
    const category = value as Record<string, unknown>;
    if (category.label !== expected.label || !isComponent(category.icon)
      || typeof category.useItems !== 'function') return `references.categories.${id}`;
  }
}

/** Check declared identities before registering components, resolving factories or granting settings access. */
export function frontendBindingProblem(manifest: DeclarationData<Pick<PackManifest, 'id' | 'extensions'>> & {
  features?: Record<string, { surface?: SurfaceDeclaration; designation?: string; settings?: SettingsDefinition; references?: ReferenceDeclarations }>;
}, registration: unknown): string | undefined {
  const problem = (path: string) => `Pack "${manifest.id}" frontend ${path} does not match its accepted declarations`;
  if (!isPlainObject(registration)) return problem('registration');
  if (Object.keys(registration).some(key => !hasOwn(REGISTRATION_KEYS, key))) return problem('registration fields');
  if (registration.bindSettings !== undefined && typeof registration.bindSettings !== 'function') return problem('bindSettings');
  const declared = Object.fromEntries(Object.entries(manifest.features ?? {}).filter(([, feature]) =>
    feature.surface || feature.designation || feature.settings?.form || feature.references));
  const features = registration.features === undefined ? {} : registration.features;
  if (!sameKeys(features, Object.keys(declared))) return problem('features');
  for (const [id, feature] of Object.entries(features as Record<string, unknown>)) {
    const expected = declared[id];
    if (!isPlainObject(feature) || Object.keys(feature).some(key => !hasOwn(FEATURE_KEYS, key))) return problem(`features.${id}`);
    if ((feature.references !== undefined) !== !!expected.references) return problem(`features.${id}.references`);
    if (expected.references) {
      const mismatch = referenceBindingProblem(expected.references, feature.references);
      if (mismatch) return problem(`features.${id}.${mismatch}`);
    }
    if (feature.designation !== expected.designation) return problem(`features.${id}.designation`);
    if (feature.default !== (expected.surface?.default ? true : undefined)) return problem(`features.${id}.default`);
    if ((feature.surface !== undefined) !== !!expected.surface) return problem(`features.${id}.surface`);
    if (expected.surface) {
      const mismatch = surfaceBindingProblem(expected.surface, feature.surface);
      if (mismatch) return problem(`features.${id}.${mismatch}`);
    }
    if ((feature.settingsForm !== undefined) !== !!expected.settings?.form || (expected.settings?.form && !isComponent(feature.settingsForm))) return problem(`features.${id}.settingsForm`);
  }
  const groups = Object.entries(manifest.extensions?.settings ?? {}).filter(([, definition]) => definition.form).map(([id]) => id);
  if (!optionalKeys(registration.settingsForms, groups)) return problem('settingsForms');
  if (registration.settingsForms !== undefined && Object.values(registration.settingsForms as Record<string, unknown>).some(form => !isComponent(form))) return problem('settingsForms');
  const extensions = manifest.extensions;
  const stepDeclarations = Object.entries(extensions?.steps ?? {});
  const steps = namedBindings(registration.steps, 'type', stepDeclarations.map(([type]) => type));
  if (!steps) return problem('steps');
  for (const [type, entry] of stepDeclarations) {
    const step = steps.get(type)!;
    if ((step.kind ?? 'step') !== (entry.kind ?? 'step')) return problem(`steps.${type}.kind`);
    if (!isEqual(step.node, entry.node)) return problem(`steps.${type}.node`);
    if ((step.fe !== undefined) !== !!entry.fe || (entry.fe && !isPlainObject(step.fe))) return problem(`steps.${type}.fe`);
    if (entry.fe) {
      const mismatch = stepFrontendProblem(entry.fe, step.fe);
      if (mismatch) return problem(`steps.${type}.${mismatch}`);
    }
    for (const facet of ['build', 'runtime', 'trigger']) if (step[facet] !== undefined) return problem(`steps.${type}.${facet}`);
  }
  const artifacts = namedBindings(registration.artifacts, 'type', Object.keys(extensions?.artifacts ?? {}));
  if (!artifacts) return problem('artifacts');
  for (const [type, entry] of Object.entries(extensions?.artifacts ?? {})) {
    const facet = artifacts.get(type)!.fe;
    if (!isPlainObject(facet) || !isComponent(facet.icon) || (facet.component !== undefined) !== !!entry.fe || (entry.fe && !isComponent(facet.component))) return problem(`artifacts.${type}.fe`);
  }
  const blocks = namedBindings(registration.blocks, 'type', Object.keys(extensions?.blocks ?? {}));
  if (!blocks) return problem('blocks');
  for (const [type, entry] of Object.entries(extensions?.blocks ?? {})) {
    const block = blocks.get(type)!;
    if ((block.kind ?? 'display') !== (entry.kind ?? 'display')) return problem(`blocks.${type}.kind`);
    if ((block.fe !== undefined) !== !!entry.fe || (entry.fe && (!isPlainObject(block.fe) || !isComponent(block.fe.component)))) return problem(`blocks.${type}.fe`);
    if (block.be !== undefined) return problem(`blocks.${type}.be`);
  }
  if (!optionalKeys(registration.appExtensions, Object.keys(extensions?.appExtensions ?? {}))) return problem('appExtensions');
  if (registration.appExtensions !== undefined && Object.values(registration.appExtensions as Record<string, unknown>).some(component => !isComponent(component))) return problem('appExtensions');
  const declaredEditors = extensions?.textEditor ?? {};
  if (!optionalKeys(registration.textEditor, Object.keys(declaredEditors))) return problem('textEditor');
  for (const [id, declaration] of Object.entries(declaredEditors)) {
    const contribution = (registration.textEditor as Record<string, unknown>)[id];
    const at = `textEditor.${id}`;
    if (!isPlainObject(contribution) || Object.keys(contribution).some(key => !hasOwn(TIPTAP_KEYS, key))) return problem(at);
    if (declaration.readOnly === false) {
      if (contribution.readOnly !== false) return problem(`${at}.readOnly`);
    } else if (declaration.readOnly !== undefined) {
      const adapter = contribution.readOnly;
      if (!isPlainObject(adapter) || Object.keys(adapter).some(key => !['transformMarkdown', 'decorate'].includes(key))
        || Object.values(adapter).some(value => value !== undefined && typeof value !== 'function')) return problem(`${at}.readOnly`);
    } else if (contribution.readOnly !== undefined) return problem(`${at}.readOnly`);
    if (!optionalKeys(contribution.extensions, Object.keys(declaration.extensions ?? {}))) return problem(`${at}.extensions`);
    for (const [name, binding] of Object.entries((contribution.extensions ?? {}) as Record<string, unknown>)) {
      if (!binding || typeof binding !== 'object' || !('name' in binding) || binding.name !== name
        || !('type' in binding) || typeof binding.type !== 'string' || !['node', 'mark', 'extension'].includes(binding.type)
        || !('config' in binding) || !isPlainObject(binding.config)
        || !('configure' in binding) || typeof binding.configure !== 'function') return problem(`${at}.extensions.${name}`);
    }
    if (!optionalKeys(contribution.popups, Object.keys(declaration.popups ?? {}))
      || Object.values((contribution.popups ?? {}) as Record<string, unknown>).some(component => !isComponent(component))) return problem(`${at}.popups`);
    if ((contribution.isSuggestionActive !== undefined) !== !!declaration.isSuggestionActive
      || (declaration.isSuggestionActive && typeof contribution.isSuggestionActive !== 'function')) return problem(`${at}.isSuggestionActive`);
  }
}
