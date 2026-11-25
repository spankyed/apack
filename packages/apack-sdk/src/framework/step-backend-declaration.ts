import type { DeclarationData } from './catalog-view.ts';
import type { StepEntry } from './declaration-types.ts';

type BackendDeclaration = DeclarationData<Pick<StepEntry, 'build' | 'trigger'>>;

function buildParts(declaration: NonNullable<BackendDeclaration['build']>) {
  const { relation, ...callbacks } = declaration;
  return { data: { ...(relation !== undefined && { relation }) }, callbacks };
}

function triggerParts(declaration: NonNullable<BackendDeclaration['trigger']>) {
  const { trackField, persistent, queryFields, ...callbacks } = declaration;
  return { data: { trackField, ...(persistent !== undefined && { persistent }),
    ...(queryFields !== undefined && { queryFields }) }, callbacks };
}

/** @internal Separate declared data from callable slots without importing implementations. */
export function _stepBackendParts(entry: DeclarationData<Pick<StepEntry, 'build' | 'trigger'>>) {
  return {
    ...(entry.build && { build: buildParts(entry.build) }),
    ...(entry.trigger && { trigger: triggerParts(entry.trigger) }),
  };
}
