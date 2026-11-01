import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { createSchemaValidator } from '../../src/sqlite/schema-validation.ts';

type Data = Record<string, any>;
const schema: EngineSchema = {
  types: { Row: { required: [], shortCode: 'ROW', fields: {
    title: { type: 'string', optional: true }, count: { type: 'number', optional: true },
    labels: { type: 'list', of: { type: 'string' }, optional: true },
    state: { type: 'enum', values: ['ready', 'done'], optional: true },
    target: { type: 'ref', to: ['Row'], optional: true },
  }, indexes: ['count'], search: { fields: { title: 1 } } } },
  relations: { related: {} }, roles: ['visible'],
};
const raw = () => structuredClone(toElmdbSchema(schema)) as Data;
const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => { for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); } });
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-schema-validation-'));
  const db = new SqliteDatabase({ path, schema: raw(), syncs: false });
  held.push({ db, path });
  return { db, e: createEarsEngine({ database: db }) };
}
const malformed: Array<[string, (next: Data) => void]> = [
  ['language', n => { n.$schema = 'wrong'; }],
  ['unknown root option', n => { n.typo = true; }],
  ['array type map', n => { n.types = []; }],
  ['null type', n => { n.types.Row = null; }],
  ['unknown type option', n => { n.types.Row.typo = true; }],
  ['invalid field name', n => { n.types.Row.fields.BAD = { type: 'any' }; }],
  ['reserved field', n => { n.types.Row.fields.createdAt = { type: 'number' }; }],
  ['invalid field kind', n => { n.types.Row.fields.title.type = 'mystery'; }],
  ['unknown field option', n => { n.types.Row.fields.title.optinal = true; }],
  ['nonboolean optional', n => { n.types.Row.fields.title.optional = 'yes'; }],
  ['empty enum', n => { n.types.Row.fields.state.values = []; }],
  ['repeated enum', n => { n.types.Row.fields.state.values = ['ready', 'ready']; }],
  ['empty reference', n => { n.types.Row.fields.target.to = []; }],
  ['undeclared reference', n => { n.types.Row.fields.target.to = ['Missing']; }],
  ['nested undeclared reference', n => { n.types.Row.fields.labels.of = { type: 'ref', to: ['Missing'] }; }],
  ['list with no element rule', n => { delete n.types.Row.fields.labels.of; }],
  ['nested nullable flag', n => { n.types.Row.fields.labels.of.nullable = true; }],
  ['invalid role name', n => { n.roles.Bad = {}; }],
  ['null role', n => { n.roles.visible = null; }],
  ['invalid relation name', n => { n.relations.BAD = { cardinality: 'many-to-many' }; }],
  ['obsolete relation unique', n => { n.relations.related.unique = true; }],
  ['duplicate relation key', n => { n.relations.related.key = ['handle', 'handle']; }],
  ['invalid relation key name', n => { n.relations.related.key = ['Bad']; }],
  ['non-map relation key', n => { n.relations.related.key = ['handle']; n.relations.related.info = { type: 'string' }; }],
  ['nonboolean relation flag', n => { n.relations.related.acyclic = 'yes'; }],
  ['undeclared endpoint', n => { n.relations.related.endpoints = [{ source: 'Missing', target: 'Row' }]; }],
  ['invalid prefix', n => { n.types.Row.shortCode.prefix = 'lower'; }],
  ['duplicate prefix', n => { n.types.Other = { additionalFields: 'allow', shortCode: { prefix: 'ROW' } }; }],
  ['unknown index kind', n => { n.types.Row.indexes.count.kind = 'bogus'; }],
  ['engine index name', n => { n.types.Row.indexes.role = { kind: 'value', fields: ['count'] }; }],
  ['undeclared indexed field', n => { n.types.Row.indexes.count.fields = ['missing']; }],
  ['unindexable value field', n => { n.types.Row.fields.count = { type: 'object' }; }],
  ['zero text weight', n => { n.types.Row.indexes.search.fields.title.weight = 0; }],
  ['nontext text source', n => { n.types.Row.indexes.search.fields = { count: { weight: 1 } }; }],
  ['vector with no dimensions', n => { n.types.Row.indexes.embedding = { kind: 'vector', from: ['title'], dims: 0, model: 'fixture' }; }],
  ['blank model', n => { n.types.Row.indexes.embedding = { kind: 'vector', from: ['title'], dims: 3, model: ' ' }; }],
];
const unsupported: Array<[string, (next: Data) => void]> = [
  ['extra-field refusal', n => { n.types.Row.additionalFields = 'refuse'; }],
  ['relation cardinality', n => { n.relations.related.cardinality = 'one-to-one'; }],
  ['relation endpoints', n => { n.relations.related.endpoints = [{ source: 'Row', target: 'Row' }]; }],
  ['typed relation info', n => { n.relations.related.info = { type: 'string' }; }],
  ['exact text analyzer', n => { n.types.Row.indexes.search.analyzer = 'exact'; }],
  ['non-English stemming', n => { n.types.Row.indexes.search.stem = 'fr'; }],
  ['non-cosine vector', n => { n.types.Row.indexes.embedding = { kind: 'vector', from: ['title'], dims: 3, model: 'fixture', metric: 'l2' }; }],
];

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite structural schema admission', () => {
  it.each([...malformed.map(([name, change]) => ({ name, change, code: 'SCHEMA_INVALID' })),
    ...unsupported.map(([name, change]) => ({ name, change, code: 'UNSUPPORTED' }))])('refuses $name before changing data, layouts, indexes or revision', ({ change, code }) => {
    const { db, e } = open();
    const id = e.create('Row', { title: 'before', count: 1 }).id();
    const before = { schema: db.schema, sequence: db.sequence, objects: db.all('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name'), builds: db.indexBuilds.statuses() };
    const next = raw(); next.types.Added = { fields: { fresh: { type: 'string' } }, additionalFields: 'allow' }; change(next);
    expect(() => db.setSchema(next)).toThrow(expect.objectContaining({ code }));
    expect(db.schema).toEqual(before.schema); expect(db.sequence).toBe(before.sequence);
    expect(db.all('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name')).toEqual(before.objects);
    expect(db.indexBuilds.statuses()).toEqual(before.builds); expect(db.sql.inTransaction).toBe(false);
    expect(e.getAttr(id, 'title')).toBe('before'); expect(e.query('Row').search('before').ids()).toEqual([id]);
    e.write(id).set('title', 'after'); expect(e.getAttr(id, 'title')).toBe('after');
  });

  it('checks malformed declarations against the pinned native parser', async () => {
    const { openDatabase } = await import('../../src/lmdb/index.ts');
    const path = mkdtempSync(join(tmpdir(), 'ears-schema-native-oracle-'));
    const db = openDatabase({ path, schema, syncs: false });
    try {
      const before = db.schema;
      for (const [name, change] of malformed) {
        const next = raw(); change(next);
        expect(() => db.setSchema(next), name).toThrow(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
        expect(db.schema).toEqual(before);
      }
    } finally { db.close(); rmSync(path, { recursive: true, force: true }); }
  });

  it('accepts nested supported values and preserves declaration inputs', () => {
    const validate = createSchemaValidator(), input = raw();
    for (const type of ['string', 'number', 'integer', 'boolean', 'bytes', 'object', 'any']) input.types.Row.fields[type] = { type, optional: true };
    input.types.Row.fields.nested = { type: 'list', of: { type: 'list', of: { type: 'ref', to: ['Row'] } }, optional: true, nullable: true };
    const before = structuredClone(input); expect(() => validate(input)).not.toThrow(); expect(input).toEqual(before);
  });

  it.each([undefined, Number.NaN, new Date(), new Uint8Array([1])])('refuses non-JSON declaration metadata: %s', value => {
    const input = raw(); input.types.Row.declaredBy = value;
    expect(() => createSchemaValidator()(input)).toThrow(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
  });

  it('refuses cyclic declarations with a schema error', () => {
    const input = raw(); input.types.Row.fields.labels.of = input.types.Row.fields.labels;
    expect(() => createSchemaValidator()(input)).toThrow(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
  });

  it.each([false, true])('refuses malformed persisted declarations before loading indexes, readOnly=%s', readOnly => {
    const { db } = open(), input = raw(); input.types.Row.fields.title.type = 'unknown';
    db.run('UPDATE meta SET value=? WHERE key=?', [db.pack(input), 'schema']); db.close();
    expect(() => new SqliteDatabase({ path: db.path, readOnly, syncs: false })).toThrow(
      expect.objectContaining({ code: 'CORRUPT', cause: expect.objectContaining({ code: 'SCHEMA_INVALID' }) }));
  });

  it('uses the admitted locale for ICU text ordering', () => {
    const { db } = open(), input = raw(); input.collation = 'sv'; db.setSchema(input);
    const e = createEarsEngine({ database: db });
    for (const [i, title] of ['ä', 'z', 'a'].entries()) e.create('Row', { id: `Row-${i}`, title });
    expect(e.query('Row').orderBy('title').ids()).toEqual(['Row-2', 'Row-1', 'Row-0']);
  });
});
