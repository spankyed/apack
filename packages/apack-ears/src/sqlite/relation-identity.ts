import { createHash } from 'node:crypto';

const relationKeyField = (info: unknown, name: string): unknown =>
  info !== null && typeof info === 'object' && Object.hasOwn(info, name)
    ? (info as Record<string, unknown>)[name] ?? null : null;

/** A relation key reads own info fields; missing fields and explicit null have the same identity. */
export function sameRelationKey(fields: readonly string[], left: unknown, right: unknown): boolean {
  return fields.every(name => sameStoredValue(relationKeyField(left, name), relationKeyField(right, name)));
}

/** Candidate bucket only: callers must still use sameRelationKey before reporting identity.
 * Decoded persisted arrays are dense. NaN/invalid dates cannot equal another decoded key and need no bucket.
 */
export function relationKeyFingerprint(fields: readonly string[], info: unknown): string | undefined {
  const hash = createHash('sha256');
  const part = (tag: string, bytes: Uint8Array) => { hash.update(`${tag}${bytes.byteLength}:`); hash.update(bytes); };
  const text = (tag: string, value: string) => part(tag, Buffer.from(value, 'utf16le'));
  const value = (item: unknown): boolean => {
    if (item === null) { text('null', ''); return true; }
    if (item === undefined) { text('undefined', ''); return true; }
    if (typeof item === 'string') { text('string', item); return true; }
    if (typeof item === 'boolean') { text('boolean', String(item)); return true; }
    if (typeof item === 'number') {
      if (Number.isNaN(item)) return false;
      text('number', String(item === 0 ? 0 : item)); return true;
    }
    if (typeof item === 'bigint') { text('bigint', String(item)); return true; }
    if (item instanceof Uint8Array) { part('bytes', item); return true; }
    if (item instanceof Date) {
      if (Number.isNaN(item.getTime())) return false;
      text('date', String(item.getTime())); return true;
    }
    if (Array.isArray(item)) {
      text('array', String(item.length));
      for (const entry of item) if (!value(entry)) return false;
      return true;
    }
    if (item && typeof item === 'object') {
      const map = item as Record<string, unknown>, names = Object.keys(map).filter(name => map[name] !== undefined).sort();
      text('object', String(names.length));
      for (const name of names) { text('key', name); if (!value(map[name])) return false; }
      return true;
    }
    throw Object.assign(new Error('Unsupported persisted relation key value'), { code: 'CORRUPT' });
  };
  text('fields', String(fields.length));
  for (const field of fields) if (!value(relationKeyField(info, field))) return undefined;
  return hash.digest('hex');
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
