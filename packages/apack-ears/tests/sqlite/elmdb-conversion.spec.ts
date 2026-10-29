import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Packr } from 'msgpackr';
import { convertElmdbDump } from '../../scripts/convert-elmdb-dump.ts';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { openDatabase } from '../../src/sqlite/index.ts';
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const schema = toElmdbSchema({ types: { Row: { required: [], shortCode: 'ROW', embed: { from: ['text'], model: 'conversion', dims: 3 } } }, relations: { custom: {} }, roles: [] });
function dump(loads: unknown[], schemaValue: unknown = schema) {
  const length = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const frame = (b: Uint8Array) => Buffer.concat([length(b.length), b]);
  const count = Buffer.alloc(8); count.writeBigUInt64LE(BigInt(loads.length));
  const packer = new Packr({ useRecords: false });
  return Buffer.concat([Buffer.from('ELMDBDMP'), length(1), frame(Buffer.from(schemaValue ? JSON.stringify(schemaValue) : '')),
    ...loads.map(value => frame(packer.pack(value))), length(0xffffffff), count]);
}
function fixture(data: Buffer) {
  const root = mkdtempSync(join(tmpdir(), 'ears-convert-')); roots.push(root);
  const input = join(root, 'source.dump'), output = join(root, 'converted'); writeFileSync(input, data);
  return { input, output, data };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('explicit elmdb dump conversion', () => {
  it('reopens an audited store, retains typed values, trash/order/relations/counters and leaves input unchanged', async () => {
    const at = new Date('2024-01-02T03:04:05.000Z');
    const f = fixture(dump([
      { load: 'entity', id: 'Row-second', fields: { text: 'retained', at, bytes: Buffer.from([0, 255]), nested: { zero: -0 }, shortCode: 'ROW-9', __proto__: null }, trashed: false },
      { load: 'entity', id: 'Row-first', fields: { text: 'trashed', trashedAt: 42 }, trashed: true },
      { load: 'relation', id: 'Relation-edge', kind: 'custom', source: 'Row-second', target: 'Row-first', info: { at } },
      { load: 'sequence', name: 'shortCode:Row', next: 20 },
      { load: 'sequence', name: 'seq', next: 90 },
    ]));
    const result = await convertElmdbDump(f.input, f.output);
    expect(result).toMatchObject({ path: join(f.output, 'store'), loads: 5, audit: { ok: true, checkedEntities: 2, checkedRelations: 1 } });
    expect(readFileSync(f.input)).toEqual(f.data);
    const database = openDatabase({ path: result.path });
    try {
      const e = createEarsEngine({ database });
      expect(e.query.withTrashed('Row').ids()).toEqual(['Row-second', 'Row-first']);
      expect(e.query('Row').ids()).toEqual(['Row-second']);
      expect(e.getAttr('Row-second', 'at')).toEqual(at);
      expect(e.getAttr('Row-second', 'bytes')).toEqual(new Uint8Array([0, 255]));
      expect(Object.is((e.getAttr('Row-second', 'nested') as { zero: number }).zero, -0)).toBe(true);
      expect(e.getRelation('Relation-edge')?.info).toEqual({ at });
      const next = e.create('Row', { text: 'next' }).id();
      expect(e.getAttr(next, 'shortCode')).toMatch(/20$/);
    } finally { database.close(); }
  });
  it('refuses an incumbent destination without removing its contents', async () => {
    const f = fixture(dump([])); writeFileSync(f.output, 'incumbent');
    await expect(convertElmdbDump(f.input, f.output)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(f.output, 'utf8')).toBe('incumbent');
  });
  it.each(['truncated', 'trailing', 'count'] as const)('removes owned staging on late %s failure', async kind => {
    const valid = dump(Array.from({ length: 1001 }, (_, i) => ({ load: 'entity', id: `Row-${i}`, fields: { text: 'retained' }, trashed: false })));
    const broken = kind === 'truncated' ? valid.subarray(0, valid.length - 1) : kind === 'trailing' ? Buffer.concat([valid, Buffer.from([0])]) : Buffer.from(valid);
    if (kind === 'count') broken.writeBigUInt64LE(2n, broken.length - 8);
    const f = fixture(broken);
    await expect(convertElmdbDump(f.input, f.output)).rejects.toMatchObject({ code: 'DUMP_INVALID' });
    expect(existsSync(f.output)).toBe(false); expect(readFileSync(f.input)).toEqual(broken);
  });
  it('refuses precision loss and malformed loads rather than silently changing primary data', async () => {
    for (const item of [{ load: 'sequence', name: 'seq', next: 9007199254740993n }, { load: 'unset', id: 'Row-one', field: 'text' }, { load: 'entity', id: 42, fields: {} }]) {
      const f = fixture(dump([item]));
      await expect(convertElmdbDump(f.input, f.output)).rejects.toMatchObject({ code: 'DUMP_INVALID' });
      expect(existsSync(f.output)).toBe(false);
    }
  });
});
