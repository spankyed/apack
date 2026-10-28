// MessagePack belongs to the native boundary, not the engine's JavaScript call path.
import { Packr, Unpackr } from 'msgpackr';
import { setField } from '../ids.ts';
import type { Answer, Changes, EarsDatabase, EarsUnit, WriteResult } from '../database.ts';

// A field holding `undefined` is absent, as it is once stored (msgpackr's `skipValues`, which its declarations omit);
// Dates are msgpack timestamps, which elmdb keeps
const packr = new Packr({ useRecords: false, skipValues: [undefined] } as ConstructorParameters<typeof Packr>[0]);
const unpackr = new Unpackr({ useRecords: false, mapsAsObjects: true, int64AsType: 'number' });
// The exact decode, for an answer whose maps may hold a `__proto__` key, which a decode straight to objects renames
const exact = new Unpackr({ useRecords: false, mapsAsObjects: false, int64AsType: 'number' });

const pack = (value: unknown): Uint8Array => packr.pack(value);

/** Maps decoded as `Map`s, made objects whose keys are their own properties, `__proto__` among them */
function objectsOf(value: unknown): unknown {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of value) setField(out, String(key), objectsOf(inner));
    return out;
  }
  if (Array.isArray(value)) return value.map(objectsOf);
  return value;
}

const PROTO = [...'__proto__'].map((char) => char.charCodeAt(0));

/** Whether `bytes` hold the text `__proto__` anywhere: a key of that name, or a value that merely spells it */
function spellsProto(bytes: Uint8Array): boolean {
  for (let at = bytes.indexOf(PROTO[0]!); at !== -1 && at + PROTO.length <= bytes.length; at = bytes.indexOf(PROTO[0]!, at + 1)) {
    if (PROTO.every((byte, offset) => bytes[at + offset] === byte)) return true;
  }
  return false;
}

/**
 * Every answer decoded alike, whatever its shape: exactly when its bytes could hold a `__proto__` key anywhere — a
 * row, a field's value, an edge's info, an answer inside another — and straight to objects otherwise
 */
function unpackAnswers(bytes: Uint8Array): Answer[] {
  const answers = (spellsProto(bytes) ? objectsOf(exact.unpack(bytes)) : unpackr.unpack(bytes)) as Answer[];
  for (const answer of answers) if (answer.kind === 'explained') answer.backend = 'elmdb';
  return answers;
}

interface BinaryUnit extends Omit<EarsUnit, 'read' | 'write' | 'commit'> {
  read(request: Uint8Array): Uint8Array;
  write(request: Uint8Array): Uint8Array;
  commit(durable?: boolean | null): Uint8Array;
}
export interface BinaryDatabase extends Omit<EarsDatabase, 'readSync' | 'write' | 'begin' | 'bulkLoad'> {
  readSync(request: Uint8Array): Uint8Array;
  write(request: Uint8Array, durable?: boolean | null): Uint8Array;
  begin(): BinaryUnit;
  bulkLoad(loads: Uint8Array): void;
}

function adaptUnit(unit: BinaryUnit): EarsUnit {
  return {
    get isOpen() { return unit.isOpen; },
    read: (request) => unpackAnswers(unit.read(pack(request))),
    write: (request) => unpackr.unpack(unit.write(pack(request))) as WriteResult,
    savepoint: () => unit.savepoint(),
    rollbackTo: (depth) => unit.rollbackTo(depth),
    release: (depth) => unit.release(depth),
    commit: (durable) => unpackr.unpack(unit.commit(durable)) as Changes,
    abort: () => unit.abort(),
  };
}

export function adaptDatabase(database: BinaryDatabase): EarsDatabase {
  return {
    get path() { return database.path; },
    get readOnly() { return database.readOnly; },
    get isOpen() { return database.isOpen; },
    get schema() { return database.schema; },
    get sequence() { return database.sequence; },
    readSync: (request) => unpackAnswers(database.readSync(pack(request))),
    write: (request, durable) => unpackr.unpack(database.write(pack(request), durable)) as WriteResult,
    begin: () => adaptUnit(database.begin()),
    setSchema: (schema) => database.setSchema(schema),
    reset: () => database.reset(),
    backup: (target) => database.backup(target),
    replaceWith: (source) => database.replaceWith(source),
    stats: () => database.stats(),
    bulkLoad: (loads) => database.bulkLoad(pack(loads)),
    untrack: (token) => database.untrack(token),
    trackStats: () => database.trackStats(),
    durable: () => database.durable(),
    close: () => database.close(),
  };
}
