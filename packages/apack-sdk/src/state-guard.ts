import type { AnyState } from '@apackdev/state';

/**
 * Whether `value` is a `@apackdev/state` `State`.
 *
 * `@apackdev/state` produces `{ def, resolve? }` where `def` is a non-null state definition object.
 */
export function isState(value: unknown): value is AnyState {
  if (typeof value !== 'object' || value === null || !('def' in value)) return false;
  const def = (value as { def: unknown }).def;
  return typeof def === 'object' && def !== null;
}
