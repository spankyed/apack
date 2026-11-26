import type { AnyState } from '@apackdev/state';

/**
 * Whether `value` is a `@apackdev/state` `State` (as opposed to an XState `AnyStateMachine` or a `SystemEntry`).
 *
 * `@apackdev/state` produces `{ def, resolve? }` where `def` is a non-null state definition object, whereas an XState
 * machine carries `config` and a `SystemEntry` carries `machine`.
 */
export function isState(value: unknown): value is AnyState {
  if (typeof value !== 'object' || value === null || !('def' in value)) return false;
  if ('machine' in value || 'config' in value) return false;
  const def = (value as { def: unknown }).def;
  return typeof def === 'object' && def !== null;
}
