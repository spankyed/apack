import type { AnyState } from '@apackdev/state';
import type { AnyStateMachine } from 'xstate';
import type { PackFeatureSystem } from './pack-registration.ts';
import { SYSTEM_EVENT_TYPES } from './define-system.ts';
import { isState } from '../state-guard.ts';

export { isState };

export interface SystemEntry {
  /**
   * The spec `defineSystem` returned, so a system module's default export is one thing. Nothing reads the events
   * from it: codegen reads them from the feature's contract (`features[].system.contract`), which is why the entry
   * no longer needs `satisfies` to keep them — there is no inference left to widen.
   */
  spec: { types: unknown; typeOf: unknown };
  machine: AnyStateMachine;
}

/**
 * A feature's system as its pack registers it: the entry the feature's `system.ts` default-exports (an XState
 * `SystemEntry` or a `@apackdev/state` `State`), accepting its declared incoming events and the shared SDK lifecycle
 * protocol.
 */
export function packSystem(entry: SystemEntry | AnyState, options: { incoming: readonly string[] }): PackFeatureSystem {
  return {
    machine: isState(entry) ? entry : entry.machine,
    receives: [...new Set([...options.incoming, ...SYSTEM_EVENT_TYPES])],
  };
}
