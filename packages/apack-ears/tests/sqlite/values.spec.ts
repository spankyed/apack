import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from '../../bench/sqlite/database.ts';
import { SqliteValues } from '../../src/sqlite/values.ts';

const held: Array<{ database: SqliteDatabase; path: string }> = [];
afterAll(() => { for (const { database, path } of held) { database.close(); rmSync(path, { recursive: true, force: true }); } });
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'ears-sqlite-values-'));
  const db = new SqliteDatabase({ path, syncs: false });
  held.push({ database: db, path });
  const codec = { encode: (value: unknown) => db.pack(value), decode: (bytes: Uint8Array) => db.unpack(bytes) as unknown };
  const values = new SqliteValues(db, codec, 64);
  values.initialize();
  return { db, values, codec };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite authoritative attribute layout', () => {
  it('round-trips native and overflow kinds, distinguishing missing, null, false, zero and signed zero', () => {
    const { values } = setup();
    const input = Object.fromEntries(Object.entries({ nil: null, flag: false, zero: 0, negative: -0,
      text: 'hello', large: 'large '.repeat(100), at: new Date(1234), bytes: new Uint8Array([0, 255]),
      array: [null, false, 0, new Date(99)], object: JSON.parse('{"__proto__":{"safe":true},"nested":[0,false]}') }));
    const layout = values.declare('Note', [...Object.keys(input), 'absent']);
    values.set(layout, 'Note-a', input);
    const [row] = values.read(layout, ['Note-a']);
    expect(row).toEqual({ id: 'Note-a', entityType: 'Note', ...input });
    expect(Object.is(row!.negative, -0)).toBe(true);
    expect(Object.hasOwn(row!, 'absent')).toBe(false);
    expect(Object.hasOwn(row!.object as object, '__proto__')).toBe(true);
    expect(values.read(layout, ['Note-missing'])).toEqual([undefined]);
    const repeated = values.read(layout, ['Note-a', 'Note-a']);
    expect(repeated[0]!.array).not.toBe(repeated[1]!.array);
    expect(repeated[0]!.bytes).not.toBe(repeated[1]!.bytes);
  });

  it('allocates physical names without case-folding logical type or field names', () => {
    const { values } = setup();
    const lower = values.declare('Note', ['fooBar', 'foobar', '__proto__']);
    const upper = values.declare('NOTE', ['fooBar']);
    expect(lower.table).not.toBe(upper.table);
    values.set(lower, 'Note-a', Object.fromEntries([['fooBar', 1], ['foobar', 2], ['__proto__', 'own']]));
    values.set(upper, 'NOTE-a', { fooBar: 3 });
    expect(values.read(lower, ['Note-a'])[0]).toEqual(Object.fromEntries([
      ['id', 'Note-a'], ['entityType', 'Note'], ['fooBar', 1], ['foobar', 2], ['__proto__', 'own']]));
    expect(values.read(upper, ['NOTE-a'])[0]!.fooBar).toBe(3);
  });

  it('admits a declared field over flexible data without rewriting or validating incumbent values', () => {
    const { db, values } = setup();
    const before = values.declare('Note', []);
    values.set(before, 'Note-a', { newField: { invalidUnderLaterRule: true } });
    const after = values.declare('Note', ['newField']);
    expect(values.read(after, ['Note-a'])[0]!.newField).toEqual({ invalidUnderLaterRule: true });
    values.set(after, 'Note-a', { newField: 4 });
    expect(db.all('SELECT * FROM value_overflow')).toEqual([]);
    expect(values.read(after, ['Note-a'])[0]!.newField).toBe(4);
    values.set(after, 'Note-a', {}, ['newField']);
    expect(Object.hasOwn(values.read(after, ['Note-a'])[0]!, 'newField')).toBe(false);
  });

  it('projects a page in two SQL calls and patches a scalar without reading or encoding its large neighbors', () => {
    const { db, values, codec } = setup();
    const layout = values.declare('Message', ['rank', 'body', 'data']);
    for (let i = 0; i < 50; i++) values.set(layout, `Message-${i}`,
      { rank: i, body: 'body'.repeat(4096), data: { nested: [i] }, flexible: 'extra' });
    let reads = 0, encodes = 0, decodes = 0;
    const all = db.all.bind(db), get = db.get.bind(db), encode = codec.encode, decode = codec.decode;
    db.all = (...args) => { reads++; return all(...args); };
    db.get = (...args) => { reads++; return get(...args); };
    codec.encode = value => { encodes++; return encode(value); };
    codec.decode = bytes => { decodes++; return decode(bytes); };
    values.set(layout, 'Message-0', { rank: 99 });
    expect(reads).toBe(0);
    expect(encodes).toBe(0);
    const page = values.read(layout, Array.from({ length: 50 }, (_, i) => `Message-${i}`), ['rank']);
    expect(reads).toBe(2);
    expect(decodes).toBe(0);
    expect(page[0]).toEqual({ id: 'Message-0', entityType: 'Message', rank: 99 });
    expect(values.read(layout, ['Message-0'])[0]!.body).toBe('body'.repeat(4096));
  });

  it('keeps attribute changes and newly declared slots inside the caller transaction', () => {
    const { db, values } = setup();
    const layout = values.declare('Note', ['rank']);
    values.set(layout, 'Note-a', { rank: 1 });
    db.sql.exec('BEGIN');
    values.set(layout, 'Note-a', { rank: 2, body: 'temporary' });
    values.declare('Note', ['admitted']);
    db.sql.exec('ROLLBACK');
    const reopened = values.declare('Note', ['rank']);
    expect(reopened.fields.has('admitted')).toBe(false);
    expect(values.read(reopened, ['Note-a'])[0]).toEqual({ id: 'Note-a', entityType: 'Note', rank: 1 });
  });

  it('reopens existing layouts read-only and diagnoses missing or duplicate authoritative values', () => {
    const { db, values } = setup();
    const layout = values.declare('Note', ['body', 'rank']);
    values.set(layout, 'Note-a', { body: 'large'.repeat(100), rank: 1 });
    const ro = new SqliteDatabase({ path: db.path, readOnly: true });
    try {
      const reopened = new SqliteValues(ro, { encode: v => ro.pack(v), decode: v => ro.unpack(v) as unknown });
      expect(reopened.read(reopened.layout('Note')!, ['Note-a'])[0]!.rank).toBe(1);
    } finally { ro.close(); }
    db.run('INSERT INTO value_overflow VALUES (?,?,?,?)', ['Note-a', 'rank', 'num', 2]);
    expect(() => values.read(layout, ['Note-a'])).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    db.run('DELETE FROM value_overflow WHERE entity_id=?', ['Note-a']);
    expect(() => values.read(layout, ['Note-a'])).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
  });


  it('stores wide declarations beyond the native column budget without losing fields', () => {
    const { values } = setup();
    const fields = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`field${i}`, i]));
    const layout = values.declare('Wide', Object.keys(fields));
    expect(layout.fields.size).toBe(128);
    values.set(layout, 'Wide-a', fields);
    expect(values.read(layout, ['Wide-a'])[0]).toEqual({ id: 'Wide-a', entityType: 'Wide', ...fields });
  });

  it('rejects invalid values and ambiguous patches before changing stored data', () => {
    const { values } = setup();
    const layout = values.declare('Note', ['rank']);
    values.set(layout, 'Note-a', { rank: 1 });
    expect(() => values.set(layout, 'Note-a', { rank: Infinity })).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
    expect(() => values.set(layout, 'Note-a', { rank: 2 }, ['rank'])).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
    expect(values.read(layout, ['Note-a'])[0]!.rank).toBe(1);
  });

});
