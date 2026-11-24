import { _entityDestinationsProblem, _packDeclarationProblem, _parseEventContracts, _settingsJsonProblems,
  type NativePackDeclaration, type DeclarationData } from '@apackdev/sdk/framework';
import { FEATURE_ID_PATTERN, PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { errorMessage, isPlainObject } from '@apackdev/sdk/utils/pure';
import type { LoadedPackEntry } from '../packs/layout-types.ts';
import type { frontendBindingProblem } from './declaration-binding.ts';

function recordOfObjectsProblem(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return `${path}: Expected an object`;
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) return `${path}.${key}: Expected an object`;
  }
}

function surfaceShapeProblem(surface: unknown, path: string): string | undefined {
  if (surface === undefined) return undefined;
  if (!isPlainObject(surface)) return `${path}: Expected an object`;
  if (surface.canvas !== undefined && typeof surface.canvas !== 'string') {
    if (!isPlainObject(surface.canvas)) return `${path}.canvas: Expected a component target or routes object`;
    if ('routes' in surface.canvas && !isPlainObject(surface.canvas.routes)) return `${path}.canvas.routes: Expected an object`;
  }
  if (surface.hotkeys !== undefined && (!Array.isArray(surface.hotkeys) || surface.hotkeys.some(h => !isPlainObject(h)))) {
    return `${path}.hotkeys: Expected an array of hotkey objects`;
  }
  if (surface.options !== undefined && !isPlainObject(surface.options)) return `${path}.options: Expected an object`;
  if (surface.fallbackPanel !== undefined) {
    if (!isPlainObject(surface.fallbackPanel) || !isPlainObject(surface.fallbackPanel.toggle)) {
      return `${path}.fallbackPanel: Expected an object with toggle`;
    }
  }
}

/**
 * Lightweight frontend boundary check for static native declarations (authoritative schema validation
 * runs on the host backend via `_nativePackDeclarationProblem`). Keeps Zod out of the renderer bundle
 * while refusing impure objects, bad identities, or malformed declaration containers before cloning.
 */
export function nativeFrontendDeclarationProblem(declaration: unknown): string | undefined {
  const problems = _settingsJsonProblems(declaration);
  if (problems.length) return problems.map(problem => `${problem.path.join('.')}: declarations must contain finite, acyclic JSON data properties`).join('; ');
  if (!isPlainObject(declaration)) return 'Expected a plain object';
  if (typeof declaration.id !== 'string' || !PACK_ID_PATTERN.test(declaration.id)) return 'id: Must be a valid pack id';
  if (declaration.features !== undefined) {
    if (!isPlainObject(declaration.features)) return 'features: Expected an object';
    let firstDefault: string | undefined;
    for (const [id, feature] of Object.entries(declaration.features)) {
      if (!FEATURE_ID_PATTERN.test(id)) return `features.${id}: Invalid feature id`;
      if (!isPlainObject(feature)) return `features.${id}: Expected an object`;
      const surfaceProblem = surfaceShapeProblem(feature.surface, `features.${id}.surface`);
      if (surfaceProblem) return surfaceProblem;
      if (isPlainObject(feature.surface) && feature.surface.default === true) {
        if (firstDefault !== undefined) {
          return `features.${id}.surface.default: Two features claim the default surface: "${firstDefault}" and "${id}". Only one may.`;
        }
        firstDefault = id;
      }
      if (feature.settings !== undefined && !isPlainObject(feature.settings)) return `features.${id}.settings: Expected an object`;
      if (feature.references !== undefined) {
        if (!isPlainObject(feature.references) || !isPlainObject(feature.references.types) || !isPlainObject(feature.references.categories)) {
          return `features.${id}.references: Expected an object with types and categories`;
        }
      }
    }
  }
  for (const field of ['settings', 'steps', 'artifacts', 'blocks', 'dsl', 'textEditor'] as const) {
    const problem = recordOfObjectsProblem(declaration[field], field);
    if (problem) return problem;
  }
  if (isPlainObject(declaration.steps)) {
    for (const [stepId, step] of Object.entries(declaration.steps)) {
      if (!isPlainObject((step as Record<string, unknown>).node)) return `steps.${stepId}.node: Expected an object`;
    }
  }
  if (isPlainObject(declaration.textEditor)) {
    for (const [groupId, group] of Object.entries(declaration.textEditor)) {
      const entry = group as Record<string, unknown>;
      if (entry.extensions !== undefined && !isPlainObject(entry.extensions)) return `textEditor.${groupId}.extensions: Expected an object`;
      if (entry.popups !== undefined && !isPlainObject(entry.popups)) return `textEditor.${groupId}.popups: Expected an object`;
    }
  }
  if (declaration.appExtensions !== undefined) {
    if (!isPlainObject(declaration.appExtensions)) return 'appExtensions: Expected an object';
    for (const [name, target] of Object.entries(declaration.appExtensions)) {
      if (typeof target !== 'string') return `appExtensions.${name}: Expected a string`;
    }
  }
  const features = declaration.features as Record<string, { surface?: unknown; system?: unknown }> | undefined;
  if (declaration.entityDestinations !== undefined) {
    if (!isPlainObject(declaration.entityDestinations)) return 'entityDestinations: Expected an object';
    for (const [entity, feature] of Object.entries(declaration.entityDestinations)) {
      if (!entity || typeof feature !== 'string' || !feature) return `entityDestinations.${entity}: Expected nonempty entity and feature names`;
    }
    const destinationProblem = _entityDestinationsProblem(declaration.entityDestinations as Record<string, string>, features);
    if (destinationProblem) return `entityDestinations: ${destinationProblem}`;
  }
  if (declaration.eventContracts !== undefined) {
    try { _parseEventContracts(declaration.eventContracts, features, true); }
    catch (error) { return `eventContracts: ${errorMessage(error)}`; }
  }
}

/** Supplied by host composition or the accepted backend entry, never inferred from frontend delivery. */
export type FrontendAdmission =
  | { kind: 'native'; declaration: NativePackDeclaration }
  | { kind: 'loaded'; pack: LoadedPackEntry };

type FrontendDeclarations = Parameters<typeof frontendBindingProblem>[0];

export interface AcceptedFrontendAdmission {
  declarations: FrontendDeclarations;
  /** Native claims have no build stamp; bind their accepted data to this frontend instance. */
  entityDestinations?: DeclarationData<Record<string, string>>;
  declarationRevision?: string;
  registrationId?: string;
  buildRevision?: string;
}

/** Capture declaration authority before reading or granting resources to a module's registration. */
export function captureFrontendAdmission(admission: FrontendAdmission): AcceptedFrontendAdmission {
  if (!admission || typeof admission !== 'object') throw new Error('Frontend registration requires accepted native or loaded declarations');
  if (admission.kind === 'native') {
    const problem = nativeFrontendDeclarationProblem(admission.declaration);
    if (problem) throw new Error(`Invalid native declarations: ${problem}`);
    const { id, features, settings, steps, artifacts, blocks, dsl, textEditor, appExtensions } = admission.declaration;
    return { entityDestinations: ownData(admission.declaration.entityDestinations ?? {}),
      declarations: ownData({ id, features, extensions: { settings, steps, artifacts, blocks, dsl, textEditor, appExtensions } }) };
  }
  if (admission.kind !== 'loaded') throw new Error('Frontend registration requires accepted native or loaded declarations');
  const pack = admission.pack;
  if (!pack) throw new Error('Frontend registration requires an accepted backend entry');
  const { id, manifest, declarationRevision, registrationId, buildRevision } = pack;
  if (manifest && _settingsJsonProblems(manifest).length) throw new Error(`Pack "${id}" declarations must contain JSON data properties`);
  if (!manifest || manifest.id !== id || typeof declarationRevision !== 'string' || !declarationRevision.trim()
    || typeof registrationId !== 'string' || !registrationId.trim()) {
    throw new Error(`Pack "${id}" frontend has no matching accepted declarations`);
  }
  if (buildRevision !== undefined && !/^[a-f0-9]{64}$/.test(buildRevision)) throw new Error(`Pack "${id}" frontend has no accepted build identity`);
  return { declarations: ownData(manifest), declarationRevision, registrationId,
    ...(buildRevision !== undefined && { buildRevision }) };
}

export function frontendIdentityProblem(admission: AcceptedFrontendAdmission, registration: unknown): string | undefined {
  const { id } = admission.declarations;
  if (admission.declarationRevision !== undefined) return _packDeclarationProblem({ id, declarationRevision: admission.declarationRevision }, registration);
  if (!registration || typeof registration !== 'object' || !('id' in registration) || registration.id !== id) {
    return `Pack "${id}" frontend registration belongs to another pack`;
  }
  if ('declarationRevision' in registration && registration.declarationRevision !== undefined) {
    return `Pack "${id}" native frontend cannot claim an installed declaration revision`;
  }
}

function ownData<T>(data: T): DeclarationData<T> {
  const copy = structuredClone(data);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  };
  freeze(copy);
  return copy as DeclarationData<T>;
}
