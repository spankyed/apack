import { createOperationTransport, operationTransport, type OperationTransport } from '../observation.ts';
import { createWriteLease, withoutWriteAuthority } from '../write-lease.ts';
// MessagePack belongs to the native boundary, not the engine's JavaScript call path.
import { Packr, Unpackr } from 'msgpackr';
import { createNativeIndexReadiness, type NativeIndexSource } from './index-readiness.ts';
import { DATABASE_FORMAT } from './format.ts';
import { setField } from '../ids.ts';
import type { Answer, Changes, EarsDatabase, EarsUnit, WriteResult } from '../database.ts';

// A field holding `undefined` is absent, as it is once stored (msgpackr's `skipValues`, which its declarations omit);
// Dates are msgpack timestamps, which elmdb keeps
const packr = new Packr({ useRecords: false, skipValues: [undefined] } as ConstructorParameters<typeof Packr>[0]);
const unpackr = new Unpackr({ useRecords: false, mapsAsObjects: true, int64AsType: 'number' });
// The exact decode, for an answer whose maps may hold a `__proto__` key, which a decode straight to objects renames
const exact = new Unpackr({ useRecords: false, mapsAsObjects: false, int64AsType: 'number' });

const sent = (transport: OperationTransport, value: unknown): Uint8Array => transport.request(packr.pack(value));
const received = (transport: OperationTransport, bytes: Uint8Array): Uint8Array => transport.response(bytes);

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
export interface BinaryDatabase extends NativeIndexSource, Omit<EarsDatabase, 'readSync' | 'write' | 'begin' | 'bulkLoad' | 'format' | 'indexesReady' | 'onIndexesChanged' | 'withExclusiveWrites' | 'withoutWriteAuthority'> {
  readSync(request: Uint8Array): Uint8Array;
  write(request: Uint8Array, durable?: boolean | null): Uint8Array;
  begin(): BinaryUnit;
  bulkLoad(loads: Uint8Array): void;
}

function adaptUnit(transport: OperationTransport, unit: BinaryUnit, assertWritable: () => void, ended: () => void): EarsUnit {
  const mutate = <T>(operation: () => T): T => { assertWritable(); try { return operation(); } finally { if (!unit.isOpen) ended(); } };
  return {
    get isOpen() { return unit.isOpen; },
    read: (request) => unpackAnswers(received(transport, unit.read(sent(transport, request)))),
    write: (request) => mutate(() => unpackr.unpack(received(transport, unit.write(sent(transport, request)))) as WriteResult),
    savepoint: () => mutate(() => unit.savepoint()),
    rollbackTo: (depth) => mutate(() => unit.rollbackTo(depth)),
    release: (depth) => mutate(() => unit.release(depth)),
    commit: (durable) => mutate(() => unpackr.unpack(received(transport, unit.commit(durable))) as Changes),
    abort: () => mutate(() => unit.abort()),
  };
}

export function adaptDatabase(database: BinaryDatabase): EarsDatabase {
  const lease = createWriteLease(), units = new Set<EarsUnit>(), transport = createOperationTransport();
  const mutate = <T>(operation: () => T): T => { lease.assertWritable(); return operation(); };
  const readiness = createNativeIndexReadiness(database, () => [...units].some(unit => unit.isOpen));
  const replace = (operation: () => void) => mutate(() => {
    try { operation(); readiness.invalidate(); }
    catch (error) {
      if ((error as { code?: string }).code === 'NOT_DURABLE') readiness.invalidate();
      throw error;
    }
  });
  const adapter: EarsDatabase = {
    format: DATABASE_FORMAT,
    get path() { return database.path; },
    get readOnly() { return database.readOnly; },
    get isOpen() { return database.isOpen; },
    get schema() { return database.schema; },
    get sequence() { return database.sequence; },
    readSync: (request) => unpackAnswers(received(transport, database.readSync(sent(transport, request)))),
    write: (request, durable) => mutate(() => unpackr.unpack(received(transport, database.write(sent(transport, request), durable))) as WriteResult),
    begin: () => mutate(() => {
      const native = database.begin();
      const unit = adaptUnit(transport, native, lease.assertWritable, () => { units.delete(unit); });
      units.add(unit); return unit;
    }),
    setSchema: (schema) => mutate(() => {
      try { return database.setSchema(schema); }
      finally { readiness.changed(); }
    }),
    reset: () => replace(() => database.reset()),
    backup: (target) => database.backup(target),
    replaceWith: (source) => replace(() => database.replaceWith(source)),
    stats: () => database.stats(),
    bulkLoad: (loads) => mutate(() => database.bulkLoad(sent(transport, loads))),
    untrack: (token) => database.untrack(token),
    trackStats: () => database.trackStats(),
    durable: () => database.durable(),
    indexesReady: (types) => readiness.wait(types),
    withExclusiveWrites: (operation) => {
      if (!database.isOpen) return Promise.reject(Object.assign(new Error('The database is closed'), { code: 'CLOSED' }));
      if ([...units].some(unit => unit.isOpen)) return Promise.reject(Object.assign(new Error('Commit or abort the open unit before maintenance'), { code: 'UNIT_OPEN' }));
      return lease.run(operation);
    },
    withoutWriteAuthority,
    close: () => mutate(() => {
      try { database.close(); }
      finally { if (!database.isOpen) readiness.invalidate('CLOSED'); }
    }),
  };
  return Object.defineProperty(adapter, operationTransport, { value: transport });
}
