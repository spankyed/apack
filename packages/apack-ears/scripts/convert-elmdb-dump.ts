// Explicit developer conversion on a copy. Never imported by application startup or public entries.
import { closeSync, fstatSync, mkdirSync, openSync, readSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Unpackr } from 'msgpackr';
import type { Load } from '../src/storage.ts';
import { SqliteDatabase } from '../src/sqlite/database.ts';
import { auditSqliteDatabase } from '../src/sqlite/audit.ts';
import { createSchemaValidator } from '../src/sqlite/schema-validation.ts';

const invalid = (why: string): never => { throw Object.assign(new Error(`Invalid elmdb dump: ${why}`), { code: 'DUMP_INVALID' }); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** Native dumps contain string-keyed maps, not msgpackr records. Refuse integers JS cannot preserve. */
function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) return invalid('integer exceeds JavaScript precision');
    return Number(value);
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, held]) => {
    if (typeof key !== 'string') return invalid('map key is not a string');
    return [key, normalize(held)];
  }));
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value) || value instanceof Date || value instanceof Uint8Array) return value;
  return invalid('unsupported MessagePack value');
}
function load(value: unknown): Load {
  if (!object(value)) return invalid('load is not a map');
  const strings = (...keys: string[]) => keys.every(key => typeof value[key] === 'string');
  let keys: string[];
  switch (value.load) {
    case 'entity':
      keys = ['load', 'id', 'fields', 'trashed'];
      if (!strings('id') || !object(value.fields) || (value.trashed !== undefined && typeof value.trashed !== 'boolean')) return invalid('entity');
      break;
    case 'relation':
      keys = ['load', 'id', 'kind', 'source', 'target', 'info'];
      if (!strings('id', 'kind', 'source', 'target')) return invalid('relation');
      // Rust Option::None is encoded as nil; the EARS port represents absent info with undefined.
      if (value.info === null) delete value.info;
      break;
    case 'sequence':
      keys = ['load', 'name', 'next'];
      if (!strings('name') || !integer(value.next)) return invalid('sequence');
      break;
    case 'embedding':
      keys = ['load', 'id', 'index', 'chunk', 'model', 'hash', 'vector'];
      if (!strings('id', 'index', 'model', 'hash') || !integer(value.chunk) || value.chunk > 0xffffffff ||
          !Array.isArray(value.vector) || !value.vector.length || value.vector.some(n => typeof n !== 'number' || !Number.isFinite(n))) return invalid('embedding');
      break;
    default: return invalid('unsupported load kind');
  }
  if (Object.keys(value).some(key => !keys.includes(key))) return invalid('unknown load fields');
  return value as unknown as Load;
}

/** Owns only a newly reserved container; success returns its closed, independently reopened/audited store. */
export async function convertElmdbDump(file: string, directory: string) {
  const fd = openSync(file, 'r');
  let reserved = false, database: SqliteDatabase | undefined;
  let result: { path: string; loads: number; sequence: number; audit: Awaited<ReturnType<typeof auditSqliteDatabase>> } | undefined;
  const failures: unknown[] = [];
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) return invalid('input must be a regular file');
    let offset = 0;
    const bytes = (size: number): Buffer => {
      if (size > 1024 ** 3 || size > stat.size - offset) return invalid('truncated or oversized frame');
      const buffer = Buffer.allocUnsafe(size);
      let held = 0;
      while (held < size) {
        const n = readSync(fd, buffer, held, size - held, offset + held);
        if (!n) return invalid('input changed or was truncated');
        held += n;
      }
      offset += size; return buffer;
    };
    const length = () => bytes(4).readUInt32LE();
    if (bytes(8).toString() !== 'ELMDBDMP' || length() !== 1) return invalid('unsupported header/version');
    const schemaBytes = bytes(length());
    let schema: unknown;
    if (schemaBytes.length) {
      try { schema = JSON.parse(schemaBytes.toString('utf8')); } catch { return invalid('schema JSON'); }
      createSchemaValidator()(schema);
    }
    mkdirSync(directory, { mode: 0o700 }); reserved = true;
    const path = join(resolve(directory), 'store');
    database = new SqliteDatabase({ path, ...(schema ? { schema: schema as object } : {}) });
    const unpacker = new Unpackr({ useRecords: false, mapsAsObjects: false });
    let count = 0, batch: Load[] = [], batchBytes = 0;
    const flush = () => { if (batch.length) database!.bulkLoad(batch); batch = []; batchBytes = 0; };
    for (;;) {
      const size = length();
      if (size === 0xffffffff) break;
      const encoded = bytes(size);
      let decoded: unknown;
      try { decoded = unpacker.unpack(encoded); } catch { return invalid('load MessagePack'); }
      batch.push(load(normalize(decoded))); batchBytes += size; count++;
      if (batch.length >= 1000 || batchBytes >= 8 * 1024 ** 2) flush();
    }
    if (bytes(8).readBigUInt64LE() !== BigInt(count) || offset !== stat.size) return invalid('load count or trailing bytes');
    flush();
    database.rebuildIndexes(); await database.indexesReady(); database.close(); database = undefined;
    database = new SqliteDatabase({ path }); await database.indexesReady();
    const audit = await auditSqliteDatabase(database);
    if (!audit.ok) return invalid(`converted store fails audit: ${audit.issues.join('; ')}`);
    result = { path, loads: count, sequence: database.sequence, audit };
  } catch (error) { failures.push(error); }
  try { database?.close(); } catch (error) { failures.push(error); }
  try { closeSync(fd); } catch (error) { failures.push(error); }
  if (failures.length && reserved) try { rmSync(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Conversion and cleanup failed', { cause: failures[0] });
  return result!;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Usage: tsx packages/apack-ears/scripts/convert-elmdb-dump.ts <dump-file> <new-private-directory>');
  console.log(JSON.stringify(await convertElmdbDump(input, output), null, 2));
}
