import { SYSTEM_EVENT_TYPES, type PackEventContracts } from '@apackdev/sdk/framework';
import { SURFACE_EVENT_TYPES } from '@apackdev/sdk/events';
import { isPlainObject } from '@apackdev/sdk/utils/pure';

/** Match endpoint membership without constructing actors or executing handlers. */
export function eventBindingProblem(contracts: Readonly<PackEventContracts> | undefined, actual: unknown,
  partial = false): string | undefined {
  if (!isPlainObject(actual)) return 'features';
  for (const id of new Set([...Object.keys(contracts ?? {}), ...Object.keys(actual)])) {
    const feature = actual[id];
    if (feature !== undefined && !isPlainObject(feature)) return `features.${id}`;
    for (const kind of ['system', 'surface'] as const) {
      const declared = contracts?.[id]?.[kind];
      const binding = feature?.[kind];
      const path = `features.${id}.${kind}`;
      if (binding === undefined && partial) continue;
      if ((declared !== undefined) !== (binding !== undefined)) return path;
      if (!declared) continue;
      if (!isPlainObject(binding) || !Array.isArray(binding.receives)
        || binding.receives.some(name => typeof name !== 'string' || !name)) return `${path}.receives`;
      const protocol = kind === 'system' ? SYSTEM_EVENT_TYPES : SURFACE_EVENT_TYPES;
      const expected = new Set([...('incoming' in declared ? declared.incoming : declared.receives), ...protocol]);
      const received = new Set([...binding.receives, ...protocol]);
      if (expected.size !== received.size || !expected.isSubsetOf(received)) return `${path}.receives`;
    }
  }
}
