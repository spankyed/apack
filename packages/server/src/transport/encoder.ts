// Safe JSON encoding for `@apackdev/link` frames and `app-events.log`, handling `BigInt` and circular structures.
//
// Plain `JSON.stringify` throws `TypeError` on `BigInt` values and cyclic object graphs. On the fast path
// (every ordinary message and streamed event), one `JSON.stringify(value, bigintsAsStrings)` handles all plain
// values and BigInts without extra allocations. Only when that throws does `withoutCycles` walk the structure
// to cut genuine reference loops to `"[circular]"` (preserving shared non-cyclic sibling references).
import type { Codec, Message as LinkMessage } from '@apackdev/link';
import { createLogger } from '@apackdev/sdk/logger';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('app-events');
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** What a BigInt becomes: its decimal digits, as a string. Lossy in type, exact in value. */
const bigintsAsStrings = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);

/** What replaces the second and later sighting of the same object, so a cycle terminates. */
const CIRCULAR = '[circular]';

/**
 * A copy with cycles cut and BigInts stringified, for the case the fast path threw.
 *
 * Keyed on a `WeakSet` of the objects on the current path rather than every object seen, so a value that
 * legitimately appears twice side by side is kept both times and only a genuine loop is cut.
 */
function withoutCycles(value: unknown, path: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) return CIRCULAR;
  path.add(value);
  try {
    const described = value as { toJSON?: (key?: string) => unknown };
    if (typeof described.toJSON === 'function') return withoutCycles(described.toJSON(''), path);
    if (Array.isArray(value)) return value.map((entry) => withoutCycles(entry, path));
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = withoutCycles(entry, path);
    return copy;
  } finally {
    path.delete(value);
  }
}

/** The message id, when the value carries one — what ties a report back to its request. */
const frameId = (data: unknown): { id?: unknown } => {
  const id = (data as { id?: unknown })?.id;
  return id === undefined ? {} : { id };
};

/**
 * `data` as JSON, with BigInts as digits and loops cut, and **never throwing**.
 *
 * `describeFailure` builds what is written when even the second pass fails (e.g. a throwing getter or
 * throwing `toJSON`), so `app-events.log` and performance byte-size measurements never throw.
 */
export function encodeJsonSafely(data: unknown, describeFailure: (reason: string) => unknown): string {
  try {
    return JSON.stringify(data, bigintsAsStrings);
  } catch (refused) {
    const which = frameId(data);
    try {
      const cut = JSON.stringify(withoutCycles(data, new WeakSet()));
      logger.warn('An outgoing message needed cycles cut to be sent', { ...which, reason: errorMessage(refused) });
      return cut;
    } catch (fatal) {
      logger.error('A message could not be serialised; wrote a placeholder instead', { ...which, reason: errorMessage(fatal) });
      return JSON.stringify(describeFailure(errorMessage(fatal))) ?? '""';
    }
  }
}

/**
 * `@apackdev/link` JSON codec that safely encodes `BigInt` values as decimal strings and cuts circular
 * object references instead of rejecting ordinary frames. If a value still cannot be encoded (e.g. a
 * throwing getter or top-level `undefined`), it throws `TypeError` so `@apackdev/link` refuses only that
 * single frame (settling asks/views as failed) while keeping the link alive.
 */
export const safeJsonCodec: Codec = {
  encode: (value: unknown): LinkMessage => {
    try {
      const text = JSON.stringify(value, bigintsAsStrings);
      if (text === undefined) throw new TypeError('Not a value JSON can hold');
      return text;
    } catch (refused) {
      if (value === undefined) throw new TypeError('Not a value JSON can hold');
      const which = frameId(value);
      try {
        const cut = JSON.stringify(withoutCycles(value, new WeakSet()));
        if (cut === undefined) throw new TypeError('Not a value JSON can hold');
        logger.warn('An outgoing link frame needed cycles cut to be sent', { ...which, reason: errorMessage(refused) });
        return cut;
      } catch (fatal) {
        logger.error('A link frame could not be serialised', { ...which, reason: errorMessage(fatal) });
        throw new TypeError(`Link frame could not be serialised: ${errorMessage(fatal)}`);
      }
    }
  },
  list: (parts) => `[${parts.join(',')}]`,
  record: (fields) => `{${fields.map(([name, value]) => `${JSON.stringify(name)}:${value as string}`).join(',')}}`,
  decode: (message) => JSON.parse(typeof message === 'string' ? message : utf8Decoder.decode(message)) as unknown,
};
