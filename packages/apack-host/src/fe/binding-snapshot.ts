import { captureStepBinding } from '../packs/step-bindings.ts';
import { _settingsJsonProblems } from '@apackdev/sdk/framework';
import type { frontendBindingProblem } from './declaration-binding.ts';
import type { PackFERegistration } from '@apackdev/sdk/fe';
import { isPlainObject } from '@apackdev/sdk/utils/pure';

/** Own binding membership before validation; retain executable component/extension/callback objects. */
export function captureFrontendBindings(registration: PackFERegistration, declarations: Parameters<typeof frontendBindingProblem>[0]): PackFERegistration {
  const captured = { ...registration };
  for (const field of ['settingsForms', 'appExtensions'] as const) {
    if (isPlainObject(captured[field])) captured[field] = Object.freeze({ ...captured[field] });
  }
  if (Array.isArray(captured.artifacts)) captured.artifacts = captured.artifacts.map(captureFacet);
  if (Array.isArray(captured.blocks)) captured.blocks = captured.blocks.map(captureFacet);
  if (Array.isArray(captured.steps)) captured.steps = captured.steps.map(captureStepBinding);
  if (isPlainObject(captured.textEditor)) captured.textEditor = Object.fromEntries(Object.entries(captured.textEditor).map(([id, surface]) => {
    if (!isPlainObject(surface)) return [id, surface];
    const value = { ...surface };
    if (isPlainObject(value.extensions)) value.extensions = Object.freeze({ ...value.extensions });
    if (isPlainObject(value.readOnly)) value.readOnly = Object.freeze({ ...value.readOnly });
    if (isPlainObject(value.popups)) value.popups = Object.freeze({ ...value.popups });
    return [id, Object.freeze(value)];
  }));
  if (!isPlainObject(captured.features)) return captured;
  captured.features = Object.fromEntries(Object.entries(captured.features).map(([id, feature]) => {
    if (!isPlainObject(feature)) return [id, feature];
    const copy = { ...feature };
    if (isPlainObject(copy.surface)) {
      const surface = { ...copy.surface };
      const canvas = declarations.features?.[id]?.surface?.canvas;
      if (canvas && typeof canvas === 'object' && 'routes' in canvas && isPlainObject(surface.canvas)) {
        surface.canvas = Object.freeze({ ...surface.canvas });
      }
      if (isPlainObject(surface.options)) surface.options = Object.freeze({ ...surface.options });
      if (Array.isArray(surface.hotkeys)) surface.hotkeys = Object.freeze(surface.hotkeys.map(hotkey =>
        isPlainObject(hotkey) ? Object.freeze({ ...hotkey }) : hotkey));
      if (isPlainObject(surface.fallbackPanel)) surface.fallbackPanel = Object.freeze({ ...surface.fallbackPanel,
        ...(isPlainObject(surface.fallbackPanel.toggle) && { toggle: Object.freeze({ ...surface.fallbackPanel.toggle }) }) });
      copy.surface = Object.freeze(surface);
    }
    if (isPlainObject(copy.references)) {
      const references = { ...copy.references };
      if (isPlainObject(references.types)) references.types = Object.fromEntries(Object.entries(references.types).map(([name, type]) => {
        if (!isPlainObject(type)) return [name, type];
        const value = { ...type };
        if (Array.isArray(value.svgElements)) {
          if (_settingsJsonProblems(value.svgElements).length) throw new Error('Reference SVG elements must contain JSON data properties');
          value.svgElements = structuredClone(value.svgElements);
        }
        return [name, value];
      }));
      if (isPlainObject(references.categories)) references.categories = Object.fromEntries(Object.entries(references.categories)
        .map(([name, category]) => [name, isPlainObject(category) ? { ...category } : category]));
      copy.references = references;
    }
    return [id, copy];
  }));
  return captured;
}

function captureFacet<T extends { fe?: unknown }>(value: T): T {
  if (!isPlainObject(value)) return value;
  const copy = { ...value };
  return Object.freeze({ ...copy, ...(isPlainObject(copy.fe) && { fe: Object.freeze({ ...copy.fe }) }) });
}
