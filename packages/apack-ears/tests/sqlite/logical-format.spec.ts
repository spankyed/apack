import { describe, expect, it } from 'vitest';
import { encodeLogicalSnapshot, decodeLogicalSnapshot, type LogicalRecord } from '../../src/sqlite/logical-format.ts';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []; for await (const value of source) values.push(value); return values;
}
async function encoded(records: LogicalRecord[] = fixture()): Promise<Buffer> {
  return Buffer.concat((await collect(encodeLogicalSnapshot(7, records))).map(value => Buffer.from(value)));
}
async function* chunks(bytes: Uint8Array, width = bytes.byteLength): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(0);
  for (let offset = 0; offset < bytes.byteLength; offset += width) yield bytes.subarray(offset, offset + width);
}
function fixture(): LogicalRecord[] {
  return [
    { kind: 'meta', key: '__proto__', value: Buffer.from([0x81, 0xa1, 0x78, 0]) },
    { kind: 'entity', id: 'Row-one', type: 'Row', seq: 1, trashed: true, shortCode: null },
    { kind: 'value', id: 'Row-one', field: '__proto__', storageKind: 'zero', value: -0 },
    { kind: 'value', id: 'Row-one', field: 'bytes', storageKind: 'bytes', value: Buffer.from([0, 255, 0xc1]) },
    { kind: 'value', id: 'Row-one', field: 'object', storageKind: 'object', value: Buffer.from([0x81, 0xa1, 0x78, 0]) },
    { kind: 'value', id: 'Row-one', field: 'date', storageKind: 'date', value: 1700000000000 },
    { kind: 'relation', id: 'Relation-one', relationKind: 'edge', source: 'Row-one', target: 'Row-two', seq: 2, info: Buffer.from([0xc0]) },
    { kind: 'embedding', id: 'Row-one', index: 'embedding', chunk: 0, hash: 'content', model: 'model', dimensions: 2, bytes: Buffer.from([0, 0, 128, 63, 0, 0, 0, 0]) },
  ];
}

describe('logical archive framing', () => {
  it.each([1, 3, 17, 4096])('round trips raw typed records with %i-byte fragmentation', async width => {
    const records = fixture(), bytes = await encoded(records);
    const result = await collect(decodeLogicalSnapshot(chunks(bytes, width)));
    expect(result[0]).toEqual({ kind: 'header', sequence: 7 });
    // The zero kind is authoritative; MessagePack may encode its numerical payload as positive zero.
    records[2] = { ...records[2]!, value: 0 } as LogicalRecord;
    expect(result.slice(1)).toEqual(records);
    expect(Object.getPrototypeOf(result[3])).toBe(Object.prototype);
  });
  it('round trips an empty snapshot with a verified footer', async () => {
    expect(await collect(decodeLogicalSnapshot(chunks(await encoded([]))))).toEqual([{ kind: 'header', sequence: 7 }]);
  });
  it.each(['truncated', 'altered', 'trailing', 'zero-length'] as const)('refuses %s input', async fault => {
    const bytes = await encoded();
    const changed = fault === 'truncated' ? bytes.subarray(0, -2) : fault === 'trailing' ? Buffer.concat([bytes, Buffer.from([0])]) : Buffer.from(bytes);
    if (fault === 'altered') {
      const at = changed.indexOf('Row-one'); expect(at).toBeGreaterThan(0); changed[at + 4] = 'x'.charCodeAt(0);
    }
    if (fault === 'zero-length') changed.writeUInt32BE(0, changed.indexOf('\n') + 1);
    await expect(collect(decodeLogicalSnapshot(chunks(changed, 3)))).rejects.toMatchObject({ code: 'DUMP_INVALID' });
  });
  it('rejects excessive declared lengths before reading their payload', async () => {
    const bytes = await encoded(); bytes.writeUInt32BE(0xffffffff, bytes.indexOf('\n') + 1);
    await expect(collect(decodeLogicalSnapshot(chunks(bytes), { maxFrameBytes: 1024 }))).rejects.toMatchObject({ code: 'DUMP_INVALID' });
  });
  it('applies the configured output limit and refuses invalid record fields', async () => {
    await expect(collect(encodeLogicalSnapshot(1, [{ kind: 'meta', key: 'large', value: Buffer.alloc(2048) }], { maxFrameBytes: 1024 })))
      .rejects.toMatchObject({ code: 'DUMP_INVALID' });
    await expect(encoded([{ kind: 'entity', id: 'Row-one', type: 'Row', seq: -1, trashed: false, shortCode: null }]))
      .rejects.toMatchObject({ code: 'DUMP_INVALID' });
  });
  it('closes the input iterator when a consumer stops before footer verification', async () => {
    const bytes = await encoded(); let closed = false;
    async function* source() { try { yield* chunks(bytes, 3); } finally { closed = true; } }
    for await (const value of decodeLogicalSnapshot(source())) if (value.kind === 'entity') break;
    expect(closed).toBe(true);
  });
  it('retains malformed-input and iterator-cleanup errors together', async () => {
    const cleanup = new Error('input close failed'); let sent = false;
    const input: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
      next: async () => sent ? { done: true, value: undefined } : (sent = true, { done: false, value: Buffer.from('bad') }),
      return: async () => { throw cleanup; },
    }) };
    let failure: unknown; try { await collect(decodeLogicalSnapshot(input)); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toMatchObject({ code: 'DUMP_INVALID' });
    expect((failure as AggregateError).errors[1]).toBe(cleanup);
  });
});
