// How a tRPC message is put on the wire, and why `JSON.stringify` alone is not enough.
//
// **The failure this exists for.** The ws adapter's default encoder is `JSON.stringify(data)`, and it is called
// from the async loop that drains a subscription, not from the `emit.next` that fed it. So a value it cannot
// serialise does not fail the one send: it throws inside the adapter, the subscription dies, the renderer's
// client reports `onFailed`, and the shell goes to `BACKEND_ERROR` — the fatal error page. One event carrying
// one bad value ends that window's entire event stream, and every later request times out while `/eval` and
// `/state` keep answering, so it reads as a database fault rather than a serialisation one.
//
// What `JSON.stringify` does with the awkward cases:
//
// | value | `JSON.stringify` |
// |---|---|
// | `BigInt`, anywhere — including a field of a class instance | **throws** `TypeError` |
// | a circular structure | **throws** `TypeError` |
// | a function, a symbol, `undefined` | silently omitted |
// | a `Map`, a `Set`, a class instance with no BigInt | `{}`, or its own enumerable fields |
//
// A BigInt has an obvious answer, its decimal string, and a replacer reaches every one however deep. A cycle
// has none — `JSON.stringify` throws on one whatever the replacer says — so it takes a second pass that cuts
// the loop. And since that pass reads properties itself, it can fail too, which is why there is a third tier:
// **this function must never throw**, because a throw from it reaches that drain loop.
//
// **Fast path first, because this runs per streamed token**: the ordinary case costs one `JSON.stringify`, the
// replacer being the same single pass, and the walk happens only after a throw.
//
// The replacer is therefore an optimisation rather than the mechanism: `withoutCycles` stringifies BigInts too,
// so deleting it changes no output byte and merely routes every BigInt message through a throw and a full walk.
// The only case that can tell the two apart is the one asserting a BigInt is sent *without* a warning.
import { createLogger } from '@apackdev/sdk/logger';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('app-events');

/** What a BigInt becomes: its decimal digits, as a string. Lossy in type, exact in value. */
const bigintsAsStrings = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);

/** What replaces the second and later sighting of the same object, so a cycle terminates */
const CIRCULAR = '[circular]';

/** What a frame carries when even the second pass could not describe the value */
const UNSERIALISABLE = '[unserialisable]';

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
    // `JSON.stringify` asks a value to describe itself before reading its fields, so this has to as well.
    // Walking a Date's own enumerable properties finds none and yields `{}`, where the fast path sends an ISO
    // string — the two paths have to agree. A `toJSON` returning the value itself terminates on the path check.
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

/**
 * `data` as JSON, with BigInts as digits and loops cut, and **never throwing**.
 *
 * `describeFailure` builds what is written when even the second pass fails, and it belongs to the caller
 * because the shape does: a socket needs a frame its client can read, and a log line needs to still be a log
 * line. Sharing one placeholder put a JSON-RPC frame into `app-events.log`, which is a file something else
 * parses.
 */
export function encodeJsonSafely(data: unknown, describeFailure: (reason: string) => unknown): string {
  try {
    return JSON.stringify(data, bigintsAsStrings);
  } catch (refused) {
    // Nothing is allocated above this line: the fast path runs per streamed token.
    const which = frameId(data);
    try {
      // No replacer: `withoutCycles` has already stringified every BigInt, so passing one changes no byte.
      // Reported only once this succeeded, so the message describes what was sent rather than what was tried.
      const cut = JSON.stringify(withoutCycles(data, new WeakSet()));
      logger.warn('An outgoing message needed cycles cut to be sent', { ...which, reason: errorMessage(refused) });
      return cut;
    } catch (fatal) {
      // The second pass reads properties too, so a throwing getter, a throwing `toJSON` or a structure deeper
      // than the stack arrives here. It must still return something: a throw from this function reaches the loop
      // draining the subscription, which is the one failure the module exists to prevent.
      logger.error('A message could not be serialised; wrote a placeholder instead', { ...which, reason: errorMessage(fatal) });
      return JSON.stringify(describeFailure(errorMessage(fatal))) ?? '""';
    }
  }
}

/** The message id, when the value carries one — what ties a report or a placeholder back to its request */
const frameId = (data: unknown): { id?: unknown } => {
  const id = (data as { id?: unknown })?.id;
  return id === undefined ? {} : { id };
};

/**
 * The encoder `applyWSSHandler` is given (`experimental_encoder`), in place of its default `JSON.stringify`.
 *
 * It never throws. A message that cannot be serialised exactly is serialised approximately and reported, which
 * is the trade this makes on purpose: a window that shows one `[circular]` where it wanted an object is working,
 * and a window whose event stream is dead is not. The last resort is a **frame**, carrying the request's id so
 * the client can settle the call it belongs to rather than waiting on it.
 */
export const jsonSafeEncoder = {
  encode: (data: unknown): string => encodeJsonSafely(
    data,
    () => ({ ...frameId(data), jsonrpc: '2.0', result: { type: 'data', data: UNSERIALISABLE } }),
  ),
  decode: (data: unknown): unknown => {
    if (typeof data !== 'string') throw new Error('The API speaks JSON text frames; this one carried binary data');
    return JSON.parse(data);
  },
};
