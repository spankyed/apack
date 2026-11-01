/** A relation key reads own info fields; missing fields and explicit null have the same identity. */
export function sameRelationKey(fields: readonly string[], left: unknown, right: unknown): boolean {
  const field = (info: unknown, name: string): unknown =>
    info !== null && typeof info === 'object' && Object.hasOwn(info, name)
      ? (info as Record<string, unknown>)[name] ?? null : null;
  return fields.every(name => sameStoredValue(field(left, name), field(right, name)));
}

export function sameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array)
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);
  if (a instanceof Date || b instanceof Date)
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameStoredValue(v, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined);
  const other = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined);
  return keys.length === other.length && keys.every(k => Object.hasOwn(b, k) &&
    sameStoredValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function checkRelationKeyInfo(fields: readonly string[], info: unknown): void {
  if (fields.length && info !== undefined &&
      (info === null || typeof info !== 'object' || Array.isArray(info) || info instanceof Date || info instanceof Uint8Array))
    throw Object.assign(new Error('A keyed relation holds its info in a map'), { code: 'FIELD_TYPE' });
}
