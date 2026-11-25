import { boundFeHost } from '../runtime/fe-host.ts';
import type { StepEntry } from '../framework/declaration-types.ts';
import type { DeclarationData } from '../framework/catalog-view.ts';
import type { StepDefinition } from '../steps/types.ts';

/** Accepted frontend binding with its owning declaration and backend identities. */
export interface StepFrontendBinding {
  readonly packId: string;
  readonly declaration: DeclarationData<StepEntry>;
  /** Accepted backend declaration revision; absent for native composition. */
  readonly declarationRevision?: string;
  /** Accepted backend runtime identity; absent for native composition. */
  readonly registrationId?: string;
  /** Accepted backend build identity, including when frontend delivery uses a development server. */
  readonly buildRevision?: string;
  readonly binding: StepDefinition;
}

/** Active frontend bindings with their accepted owner and revision; declarations live in the catalog. */
export function getStepFrontendBindings(): ReadonlyMap<string, StepFrontendBinding> {
  return boundFeHost().packs.stepBindings();
}
