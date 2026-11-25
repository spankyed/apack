import { _packDeclarationProblem, _settingsJsonProblems, type NativePackDeclaration, type DeclarationData } from '@apackdev/sdk/framework';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { isPlainObject } from '@apackdev/sdk/utils/pure';
import type { LoadedPackEntry } from '../packs/layout-types.ts';
import type { frontendBindingProblem } from './declaration-binding.ts';

/**
 * Lightweight frontend boundary check for static native declarations (authoritative full Zod schema
 * validation runs on the backend via `_nativePackDeclarationProblem`). Keeps Zod out of the renderer
 * bundle while refusing impure objects and bad pack identities before cloning, matching the `loaded` path.
 */
export function nativeFrontendDeclarationProblem(declaration: unknown): string | undefined {
  const problems = _settingsJsonProblems(declaration);
  if (problems.length) return problems.map(problem => `${problem.path.join('.')}: declarations must contain finite, acyclic JSON data properties`).join('; ');
  if (!isPlainObject(declaration)) return 'Expected a plain object';
  if (typeof declaration.id !== 'string' || !PACK_ID_PATTERN.test(declaration.id)) return 'id: Must be a valid pack id';
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
