// Node 24+ / ES2026 `Error.isError` typed directly so source consumers without `ESNext.Error` in `lib` still typecheck.
const isError = (value: unknown): value is Error =>
  (Error as ErrorConstructor & { isError(v: unknown): v is Error }).isError(value);

function isSuppressedError(value: unknown): value is Error & { error: unknown; suppressed: unknown } {
  return isError(value) && value.name === 'SuppressedError' && 'error' in value && 'suppressed' in value;
}

function collectSuppressedChain(value: unknown, out: unknown[], visited: Set<unknown>): void {
  if (!isSuppressedError(value)) {
    out.push(value);
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);
  // `suppressed` always happened before `error`; in-order traversal flattens both nested `using`
  // blocks and multi-disposer `DisposableStack` trees into chronological order.
  collectSuppressedChain(value.suppressed, out, visited);
  collectSuppressedChain(value.error, out, visited);
}

/**
 * A thrown value's message: an Error's own, anything else as text.
 * Unwraps `SuppressedError` trees (from `using` / `DisposableStack`) into chronological order so
 * the primary failure is preserved ahead of any disposal failures instead of returning V8's generic text.
 */
export function errorMessage(error: unknown): string {
  if (isSuppressedError(error)) {
    const chain: unknown[] = [];
    collectSuppressedChain(error, chain, new Set());
    if (chain.length === 0) return error.message;
    const [primary, ...cleanup] = chain.map((item) => (isError(item) ? item.message : String(item)));
    return cleanup.length > 0 ? `${primary} (cleanup also failed: ${cleanup.join('; ')})` : primary!;
  }
  return isError(error) ? error.message : String(error);
}

/** Whether `object` has `key` itself, not by inheritance: a key such as `__proto__` read as data */
export function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** A non-null object that isn't an array */
export const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val);

/**
 * `over` on `base`: plain objects merge key by key, an undefined value keeps the base's, anything else replaces it.
 * Only own keys are read and the result is built from entries, so a key such as `__proto__` stays data: it can't
 * reach an inherited object, or set the result's prototype.
 */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(over)) return over as T;
  const merged = Object.entries(over).map(([key, value]) => [key, deepMerge(ownValue(base, key), value)]);
  return Object.fromEntries([...Object.entries(base), ...merged]) as T;
}

/** `object[key]` when `object` has `key` itself, never an inherited value */
function ownValue(object: Record<string, unknown>, key: string): unknown {
  return hasOwn(object, key) ? object[key] : undefined;
}

export type MaybeArr<T> = T | readonly T[];
export function asArr<T>(v: MaybeArr<T>): readonly T[] {
  return (Array.isArray(v) ? v : [v]) as readonly T[];
}

export const entries = <T extends Record<string, unknown>>(obj: T) =>
  Object.entries(obj) as Array<[keyof T, T[keyof T]]>

export function toDisplayName(str: string): string {
  return str.replace(/-/g, ' ');
}

export function extractValueByPath(source: unknown, path: string): unknown {
  if (!path || path === '$') return source;
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const segments = cleanPath.split('.');

  let current = source;
  for (const segment of segments) {
    if (current == null) return undefined;
    const record = current as Record<string, unknown>;

    const selector = segment.match(/^(\w+)\[(\w+)=([^\]]+)\]$/);
    if (selector) {
      const [, arrayName, field, value] = selector;
      const arr = record[arrayName];
      if (!Array.isArray(arr)) return undefined;
      current = arr.find((item: Record<string, unknown> | null | undefined) => item?.[field] === value);
    } else {
      current = record[segment];
    }
  }
  return current;
}

export const BinaryOperator = {
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  GREATER_THAN: 'greater_than',
  LESS_THAN: 'less_than',
  GREATER_THAN_OR_EQUALS: 'greater_than_or_equals',
  LESS_THAN_OR_EQUALS: 'less_than_or_equals',
  CONTAINS: 'contains',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',
  MATCHES: 'matches',
  IS_EMPTY: 'is_empty',
  IS_NULL: 'is_null',
} as const;

export type BinaryOperator = (typeof BinaryOperator)[keyof typeof BinaryOperator];
