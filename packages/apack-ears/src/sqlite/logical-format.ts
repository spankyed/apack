// Logical recovery records preserve opaque stored payloads; callers stage imports until the footer verifies.
import { createHash } from 'node:crypto';
import { Packr, Unpackr } from 'msgpackr';

export type LogicalFieldKind = 'null' | 'bool' | 'num' | 'zero' | 'text' | 'date' | 'bytes' | 'array' | 'object';
export type LogicalRecord =
  | { kind: 'meta'; key: string; value: Uint8Array }
  | { kind: 'entity'; id: string; type: string; seq: number; trashed: boolean; shortCode: string | null }
  | { kind: 'value'; id: string; field: string; storageKind: LogicalFieldKind; value: null | number | string | Uint8Array }
  | { kind: 'relation'; id: string; relationKind: string; source: string; target: string; seq: number; info: Uint8Array | null }
  | { kind: 'embedding'; id: string; index: string; chunk: number; hash: string; model: string; dimensions: number; bytes: Uint8Array };
export interface LogicalHeader { kind: 'header'; sequence: number }
interface LogicalFooter { kind: 'footer'; count: number; sha256: string }
export interface LogicalStreamOptions { maxFrameBytes?: number }
const magic = Buffer.from('APACK-EARS-SQLITE-LOGICAL-1\n');
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: 'DUMP_INVALID' }); };
const integer = (value: unknown, minimum = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
function limit(options: LogicalStreamOptions): number {
  const bytes = options.maxFrameBytes ?? 1024 ** 3;
  if (!integer(bytes, 1) || bytes > 0xffffffff) return fail('Invalid logical archive frame limit');
  return bytes;
}
function record(value: unknown): LogicalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Invalid logical record');
  const row = value as Record<string, unknown>;
  let fields: string[] = [], valid = false;
  const strings = (...names: string[]) => names.every(name => typeof row[name] === 'string');
  switch (row.kind) {
    case 'meta': fields = ['kind', 'key', 'value']; valid = strings('key') && row.value instanceof Uint8Array; break;
    case 'entity':
      fields = ['kind', 'id', 'type', 'seq', 'trashed', 'shortCode'];
      valid = strings('id', 'type') && integer(row.seq, 1) && typeof row.trashed === 'boolean' && (row.shortCode === null || strings('shortCode')); break;
    case 'value': {
      fields = ['kind', 'id', 'field', 'storageKind', 'value'];
      const held = row.value;
      const cell = row.storageKind === 'null' ? held === null : row.storageKind === 'bool' ? held === 0 || held === 1 :
        row.storageKind === 'zero' ? held === 0 : row.storageKind === 'num' ? typeof held === 'number' && Number.isFinite(held) :
        row.storageKind === 'date' ? typeof held === 'number' && Number.isFinite(new Date(held).getTime()) :
        row.storageKind === 'text' ? typeof held === 'string' : ['bytes', 'array', 'object'].includes(String(row.storageKind)) && held instanceof Uint8Array;
      valid = strings('id', 'field') && cell; break;
    }
    case 'relation':
      fields = ['kind', 'id', 'relationKind', 'source', 'target', 'seq', 'info'];
      valid = strings('id', 'relationKind', 'source', 'target') && integer(row.seq, 1) && (row.info === null || row.info instanceof Uint8Array); break;
    case 'embedding':
      fields = ['kind', 'id', 'index', 'chunk', 'hash', 'model', 'dimensions', 'bytes'];
      valid = strings('id', 'index', 'hash', 'model') && integer(row.chunk) && integer(row.dimensions, 1) &&
        row.bytes instanceof Uint8Array && row.bytes.byteLength === Number(row.dimensions) * 4; break;
  }
  if (!valid || Object.keys(row).length !== fields.length || fields.some(name => !Object.hasOwn(row, name))) return fail('Invalid logical record fields');
  return row as LogicalRecord;
}
function frame(packer: Packr, value: unknown, maximum: number): Buffer {
  const payload = packer.pack(value);
  if (payload.byteLength < 1 || payload.byteLength > maximum) return fail('Logical archive frame exceeds its limit');
  const bytes = Buffer.allocUnsafe(4 + payload.byteLength); bytes.writeUInt32BE(payload.byteLength); bytes.set(payload, 4);
  return bytes;
}
export async function* encodeLogicalSnapshot(sequence: number, records: Iterable<LogicalRecord> | AsyncIterable<LogicalRecord>,
  options: LogicalStreamOptions = {}): AsyncGenerator<Uint8Array> {
  if (!integer(sequence)) return fail('Invalid snapshot commit identity');
  const maximum = limit(options), packer = new Packr({ useRecords: false }), hash = createHash('sha256');
  hash.update(magic); yield Buffer.from(magic);
  const header = frame(packer, { kind: 'header', sequence } satisfies LogicalHeader, maximum);
  hash.update(header); yield header;
  let count = 0;
  for await (const value of records) {
    const bytes = frame(packer, record(value), maximum); hash.update(bytes); count++; yield bytes;
  }
  yield frame(packer, { kind: 'footer', count, sha256: hash.digest('hex') } satisfies LogicalFooter, maximum);
}

/** Linear byte consumption: a fragmented frame allocates its destination once, not once per incoming chunk. */
class Bytes {
  private held: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private readonly input: AsyncIterator<Uint8Array>;
  constructor(input: AsyncIterator<Uint8Array>) { this.input = input; }
  async read(size: number, eof = false): Promise<Buffer | undefined> {
    let output: Buffer | undefined, copied = 0;
    while (copied < size) {
      if (this.offset === this.held.byteLength) {
        const next = await this.input.next();
        if (next.done) {
          if (!copied && eof) return undefined;
          return fail('Truncated logical archive');
        }
        if (!(next.value instanceof Uint8Array)) return fail('Logical archive input must contain bytes');
        this.held = next.value; this.offset = 0;
        if (!this.held.byteLength) continue;
      }
      const available = Math.min(size - copied, this.held.byteLength - this.offset);
      if (!copied && available === size) {
        const bytes = Buffer.from(this.held.buffer, this.held.byteOffset + this.offset, size); this.offset += size; return bytes;
      }
      output ??= Buffer.allocUnsafe(size);
      output.set(this.held.subarray(this.offset, this.offset + available), copied); this.offset += available; copied += available;
    }
    return output!;
  }
}

async function closeInput(input: AsyncIterator<Uint8Array>, failed: boolean, primary: unknown): Promise<void> {
  try { await input.return?.(); }
  catch (cleanup) { throw new AggregateError(failed ? [primary, cleanup] : [cleanup], 'Logical archive input cleanup failed', { cause: failed ? primary : cleanup }); }
}

/** Footer verification happens only on exhaustion. Importers must keep every yielded record in staging. */
export async function* decodeLogicalSnapshot(chunks: AsyncIterable<Uint8Array>, options: LogicalStreamOptions = {}): AsyncGenerator<LogicalHeader | LogicalRecord> {
  const maximum = limit(options), input = chunks[Symbol.asyncIterator](), bytes = new Bytes(input), hash = createHash('sha256');
  const unpacker = new Unpackr({ useRecords: false, mapsAsObjects: false });
  let count = 0, first = true, failed = false;
  let failure: unknown;
  try {
    const prefix = (await bytes.read(magic.length))!;
    if (!prefix.equals(magic)) return fail('Unknown logical archive format');
    hash.update(prefix);
    for (;;) {
      const length = (await bytes.read(4))!, size = length.readUInt32BE();
      if (size < 1 || size > maximum) return fail('Logical archive frame exceeds its limit');
      const payload = (await bytes.read(size))!;
      let decoded: unknown;
      try { decoded = unpacker.unpack(payload); } catch { return fail('Invalid logical archive MessagePack'); }
      if (!(decoded instanceof Map)) return fail('Logical archive envelope must be a map');
      const value = Object.fromEntries(decoded) as Record<string, unknown>;
      if (first) {
        if (value.kind !== 'header' || !integer(value.sequence) || Object.keys(value).length !== 2) return fail('Invalid logical archive header');
        first = false; hash.update(length); hash.update(payload); yield value as unknown as LogicalHeader;
      } else if (value.kind === 'footer') {
        if (Object.keys(value).length !== 3 || value.count !== count || value.sha256 !== hash.digest('hex')) return fail('Logical archive count/checksum mismatch');
        if (await bytes.read(1, true)) return fail('Trailing bytes after logical archive footer');
        return;
      } else {
        const item = record(value); hash.update(length); hash.update(payload); count++; yield item;
      }
    }
  } catch (error) { failed = true; failure = error; throw error; }
  finally { await closeInput(input, failed, failure); }
}
