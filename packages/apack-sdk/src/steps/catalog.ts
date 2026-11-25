import { _boundBackendHost } from '../runtime/backend-port.ts';
import { declarationJson } from '../framework/declaration-data.ts';
import { selectCatalogDeclaration, selectCatalogDeclarations } from '../framework/catalog-selection.ts';
import type { DeclarationData, StepCatalogEntry } from '../framework/catalog-view.ts';
import type { StepEntry } from '../framework/declaration-types.ts';
import type { PackServiceAccess } from '../services/pack-service-access.ts';
import type { StepDefinition } from './types.ts';

/** Accepted backend implementation, with its owned declaration and actual runtime generation. */
export interface StepBackendBinding {
  readonly packId: string;
  readonly declaration: DeclarationData<StepEntry>;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly registrationId: string;
  readonly binding: StepDefinition;
  /** The accepted step owner's selection and identity, independent of the flow runner. */
  readonly servicesForAction: PackServiceAccess['servicesForAction'];
}

/** Selected backend declarations; reads never consult or activate executable providers. */
export function getStepDeclarations(): readonly StepCatalogEntry[] {
  return selectCatalogDeclarations(_boundBackendHost().packs.stepDeclarations());
}

export function getStepDeclaration(type: string): StepCatalogEntry | undefined {
  return selectCatalogDeclaration(type, _boundBackendHost().packs.stepDeclarations());
}

/** Eligibility for new work; active runtime lookups retain their separate retirement lifetime. */
export function getStepBinding(type: string): StepBackendBinding | undefined {
  // Chosen among the owners that may run: a disabled pack declaring the same type must not hide the enabled one
  const owner = selectCatalogDeclaration(type, _boundBackendHost().packs.stepDeclarations()
    .filter(entry => entry.origin === 'source' ? entry.enabled !== false : entry.enabled === true));
  if (!owner) return undefined;
  const accepted = _boundBackendHost().packs.stepBindings().get(type);
  if (!accepted || !accepted.registrationId || accepted.packId !== owner.packId || accepted.binding.type !== type
    || declarationJson(owner.declaration) !== declarationJson(accepted.declaration)
    || owner.buildRevision !== accepted.buildRevision) return undefined;
  if (owner.origin === 'native') return accepted.declarationRevision === undefined ? accepted : undefined;
  return owner.declarationRevision && owner.declarationRevision === accepted.declarationRevision ? accepted : undefined;
}
