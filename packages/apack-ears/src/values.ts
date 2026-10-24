// What makes a value large: one rule, which the engine keeps out of memory by and the LMDB store places a value by,
// so a value loaded at boot is where a write would have put it

/**
 * How large a value must be, serialized, to be kept out of memory once committed: a few large values (a transcript,
 * an artifact's content) are most of a database's bytes, and none of them is ever matched by the value index
 */
export const OUT_OF_LINE_BYTES = 2048;

/** A value's size serialized, as the store holds it; a primitive other than a string counts as small */
export const sizeOf = (value: unknown): number =>
  typeof value === 'string' ? value.length : value !== null && typeof value === 'object' ? (JSON.stringify(value)?.length ?? 0) : 8;

/** Whether a value is kept out of memory once committed */
export const isLarge = (value: unknown): boolean =>
  (typeof value === 'string' || (value !== null && typeof value === 'object')) && sizeOf(value) > OUT_OF_LINE_BYTES;
