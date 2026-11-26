import type { AnyState } from '@apackdev/state';
import type { PackFeatureSystem } from './pack-registration.ts';
import { SYSTEM_EVENT_TYPES } from './define-system.ts';
import { isState } from '../state-guard.ts';

export { isState };

/**
 * A feature's system as its pack registers it: the `@apackdev/state` `State` the feature's `system.ts`
 * default-exports, accepting its declared incoming events and the shared SDK lifecycle protocol.
 */
export function packSystem(entry: AnyState, options: { incoming: readonly string[] }): PackFeatureSystem {
  return {
    machine: entry,
    receives: [...new Set([...options.incoming, ...SYSTEM_EVENT_TYPES])],
  };
}
