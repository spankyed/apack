import { z } from 'zod';
import { HOST_PACK_ID, PACK_ID_PATTERN } from '../ids/refs.ts';
import type { HostServices } from '../services/index.ts';
import { satisfies } from 'semver';
import { parsePackDependency } from './dependency-source.ts';

/** @internal The always-available SDK facilities; target settings policy still applies. */
export const _BASELINE_HOST_SERVICE_NAMES = ['logger', 'emitter', 'repository', 'settings'] as const;
/** @internal One inventory for schema assistance, selection and host-name collision checks. */
export const _HOST_SERVICE_NAMES = [..._BASELINE_HOST_SERVICE_NAMES,
  'onboarding', 'appData', 'runHistory', 'inference', 'secrets', 'filesystem', 'terminal',
] as const satisfies readonly (keyof HostServices)[];
const complete: Exclude<keyof HostServices, typeof _HOST_SERVICE_NAMES[number]> extends never ? true : never = true;
void complete;

/** @internal Service keys use the existing JavaScript identifier grammar. */
export const _SERVICE_NAME_PATTERN = /^[A-Za-z_$][\w$]*$/;
const packPattern = PACK_ID_PATTERN.source.slice(1, -1);
const servicePattern = _SERVICE_NAME_PATTERN.source.slice(1, -1);
const serviceRefPattern = new RegExp(`^(${packPattern})/(${servicePattern})$`);
const dependencyServiceRefPattern = new RegExp(`^(?!${HOST_PACK_ID}/)${packPattern}/${servicePattern}$`);
const hostRefs = _HOST_SERVICE_NAMES.map(name => `${HOST_PACK_ID}/${name}` as const);

/** Service APIs requested in addition to the SDK baseline and a pack's own services. */
export interface PackConsumption {
  /** Qualified provider/service refs; baseline and own services are implicit. */
  readonly services: readonly string[];
}

export const PackConsumptionSchema: z.ZodType<PackConsumption> = z.object({
  services: z.array(z.union([
    z.enum(hostRefs as [typeof hostRefs[number], ...typeof hostRefs[number][]]),
    z.string().regex(dependencyServiceRefPattern, 'Must name a service as "<provider-pack>/<service>"'),
  ])).refine(refs => new Set(refs).size === refs.length, 'Consumed service references must be unique')
    .describe('Required service refs (provider-pack/service). Use the listed host refs for host APIs. Other providers must be this pack or direct dependencies, and must directly declare the service.'),
}).strict().describe('Supported API dependencies. Logger, emitter, repository, caller-bound settings and this pack\'s own services are implicit. This is not a resource permission or security sandbox.');

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

/** @internal Resolve the same selection for codegen and accepted host bindings, from declaration data alone. */
export function _packServiceSelection(pack: _PackServiceDeclarations,
  provider: (packId: string, ref: string) => _PackServiceDeclarations | undefined,
): readonly { readonly ref: string; readonly packId: string; readonly name: string }[] {
  const own = _packServiceDeclarations(pack);
  const reserved = own.find(entry => (_HOST_SERVICE_NAMES as readonly string[]).includes(entry.name));
  if (reserved) throw new Error(`Service "${reserved.name}" in pack "${pack.id}" collides with the host's service`);
  const selected = new Map<string, { ref: string; packId: string; name: string }>();
  const exposed = new Map<string, string>();
  for (const ref of [..._BASELINE_HOST_SERVICE_NAMES.map(name => `${HOST_PACK_ID}/${name}`),
    ...own.map(entry => entry.ref), ...(pack.consumes?.services ?? [])]) {
    const membership = _serviceProviderProblem(pack, ref);
    if (membership) throw new Error(membership);
    const parsed = _parseServiceReference(ref);
    if (parsed.packId === HOST_PACK_ID) {
      if (!(_HOST_SERVICE_NAMES as readonly string[]).includes(parsed.name)) throw new Error(`Pack "${pack.id}" consumes unknown host service "${ref}"`);
    } else {
      const declaration = parsed.packId === pack.id ? pack : provider(parsed.packId, ref);
      if (!declaration || declaration.id !== parsed.packId) throw new Error(`Pack "${pack.id}" consumes "${ref}", but provider "${parsed.packId}" has no available declaration`);
      if (!(parsed.packId === pack.id ? own : _packServiceDeclarations(declaration)).some(entry => entry.name === parsed.name)) {
        throw new Error(`Pack "${pack.id}" consumes "${ref}", but provider "${parsed.packId}" does not declare service "${parsed.name}"`);
      }
      if (parsed.packId !== pack.id) {
        const spec = pack.dependencies?.[parsed.packId];
        if (typeof spec !== 'string') throw new Error(`Pack "${pack.id}" consumes "${ref}" with an invalid dependency specification`);
        const { range } = parsePackDependency(spec);
        if (range !== '*' && (!declaration.version || !satisfies(declaration.version, range, { includePrerelease: true }))) {
          throw new Error(`Pack "${pack.id}" consumes "${ref}", but provider "${parsed.packId}" version ${declaration.version ?? '(undeclared)'} does not satisfy ${range}`);
        }
      }
    }
    const previous = exposed.get(parsed.name);
    if (previous !== undefined && previous !== parsed.packId) {
      throw new Error(`Pack "${pack.id}" selects service "${parsed.name}" from both "${previous}" and "${parsed.packId}"`);
    }
    exposed.set(parsed.name, parsed.packId);
    selected.set(ref, { ref, ...parsed });
  }
  return [...selected.values()];
}
