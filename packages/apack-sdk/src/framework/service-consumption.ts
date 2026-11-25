import { HOST_PACK_ID, PACK_ID_PATTERN } from '../ids/refs.ts';

/** @internal The always-available SDK facilities; target settings policy still applies. */
export const _BASELINE_HOST_SERVICE_NAMES = ['logger', 'emitter', 'repository', 'settings'] as const;
/** @internal One inventory for schema assistance, selection and host-name collision checks (verified against `keyof HostServices` in `services/index.ts`). */
export const _HOST_SERVICE_NAMES = [..._BASELINE_HOST_SERVICE_NAMES,
  'onboarding', 'appData', 'runHistory', 'inference', 'secrets', 'filesystem', 'terminal',
] as const;

/** @internal Service keys use the existing JavaScript identifier grammar. */
export const _SERVICE_NAME_PATTERN = /^[A-Za-z_$][\w$]*$/;
const packPattern = PACK_ID_PATTERN.source.slice(1, -1);
const servicePattern = _SERVICE_NAME_PATTERN.source.slice(1, -1);
const serviceRefPattern = new RegExp(`^(${packPattern})/(${servicePattern})$`);

/** Service APIs requested in addition to the SDK baseline and a pack's own services. */
export interface PackConsumption {
  /** Qualified provider/service refs; baseline and own services are implicit. */
  readonly services: readonly string[];
}

/** @internal Native and authored readers supply their pack-level service map explicitly. */
export interface _PackServiceDeclarations {
  readonly id: string;
  readonly version?: string;
  readonly services?: Readonly<Record<string, string>>;
  readonly features?: Readonly<Record<string, { readonly services?: Readonly<Record<string, string>> }>>;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly consumes?: PackConsumption;
}

/** @internal The direct owner and source target of one provided service. */
export interface _PackServiceDeclaration {
  readonly packId: string;
  readonly name: string;
  readonly ref: string;
  readonly target: string;
  readonly featureId?: string;
}

/** @internal Flatten only declared service ownership; never load the target or infer transitive exports. */
export function _packServiceDeclarations(pack: _PackServiceDeclarations): readonly _PackServiceDeclaration[] {
  const entries: _PackServiceDeclaration[] = [];
  const owners = new Map<string, string>();
  const add = (services: Readonly<Record<string, string>> = {}, featureId?: string) => {
    const owner = featureId === undefined ? 'pack' : `feature "${featureId}"`;
    for (const [name, target] of Object.entries(services)) {
      const previous = owners.get(name);
      if (previous !== undefined) throw new Error(`Service "${name}" in pack "${pack.id}" is declared by both ${previous} and ${owner}`);
      owners.set(name, owner);
      entries.push({ packId: pack.id, name, ref: `${pack.id}/${name}`, target, ...(featureId !== undefined && { featureId }) });
    }
  };
  for (const [id, feature] of Object.entries(pack.features ?? {})) add(feature.services, id);
  add(pack.services);
  return entries;
}

/** @internal Parse service identity, independently of module references and feature naming rules. */
export function _parseServiceReference(ref: string): { packId: string; name: string } {
  const match = serviceRefPattern.exec(ref);
  if (!match) throw new Error(`Service "${ref}" must be "<provider-pack>/<service>"`);
  return { packId: match[1], name: match[2] };
}

/** @internal Check dependency membership without needing provider declarations or executable modules. */
export function _serviceProviderProblem(pack: Pick<_PackServiceDeclarations, 'id' | 'dependencies'>, ref: string): string | undefined {
  const { packId } = _parseServiceReference(ref);
  if (packId !== HOST_PACK_ID && packId !== pack.id && !Object.hasOwn(pack.dependencies ?? {}, packId)) {
    return `Pack "${pack.id}" consumes "${ref}", but provider "${packId}" is not a direct dependency`;
  }
}
