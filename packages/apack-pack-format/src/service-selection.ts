import { HOST_PACK_ID } from '@apackdev/sdk/ids';
import {
  _BASELINE_HOST_SERVICE_NAMES, _HOST_SERVICE_NAMES, _packServiceDeclarations, _parseServiceReference,
  _serviceProviderProblem, type _PackServiceDeclarations,
} from '@apackdev/sdk/framework';
import { satisfies } from 'semver';
import { parsePackDependency } from './dependency-source.ts';

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
