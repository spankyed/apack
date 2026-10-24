// The conversions: a format 1 environment keeps one record of each fact afterwards (format 2), a format 2 one keeps
// one row per attribute (format 3), a format 3 one one record per entity (format 4), and none loses anything else
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { open } from 'lmdb';
import { OUT_OF_LINE_BYTES } from '../../src/index.ts';
import { convertToCurrentFormat, convertToFormat2, convertToFormat3, convertToFormat4, LMDB_FORMAT_VERSION, openRecordStore, REMOVE_ATTRIBUTE, rewriteAttributes } from '../../src/lmdb/index.ts';

const SEP = '\x1F';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** A format 1 environment as the stored data showed them: every doubled fact present once */
function format1(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-format-1-'));
  dirs.push(dir);
  const root = open({ path: dir, maxDbs: 8, compression: true });
  const entities = root.openDB({ name: 'entities', encoding: 'json' });
  const attrs = root.openDB({ name: 'attrs', encoding: 'json' });
  const relations = root.openDB({ name: 'relations', encoding: 'json' });
  const attr = (kind: string, id: string, value: unknown, i = 0) => attrs.putSync(`${kind}${SEP}${id}${SEP}${i}`, { t: typeof value, v: value });
  // An entity with its row (flush-time createdAt) and its attributes, one of them the stored entityType
  entities.putSync('Note-1', { type: 'Note', createdAt: 2 });
  attr('createdAt', 'Note-1', 1);
  attr('title', 'Note-1', 'kept');
  attr('entityType', 'Note-1', 'Note');
  // A relation: its row, its entity row and its details as an attribute
  relations.putSync('Relation-1', { kind: 'refs', src: 'Note-1', tgt: 'Flow-1', info: null, createdAt: 3 });
  entities.putSync('Relation-1', { type: 'Relation', createdAt: 3 });
  attr('relationDetails', 'Relation-1', { sourceEntity: 'Note-1', targetEntity: 'Flow-1', relationType: 'refs' });
  // A row written for a relation's end that lives in another partition, and an entity with attributes and no row
  entities.putSync('Flow-1', { type: 'Flow', createdAt: 3 });
  attr('createdAt', 'Note-2', 4);
  root.close();
  return dir;
}

function read(dir: string) {
  const root = open({ path: dir, maxDbs: 8, compression: true, readOnly: true });
  try {
    // A database a conversion dropped reads as empty
    const rows = (name: string, encoding?: 'json') => {
      const db = root.openDB({ name, ...(encoding && { encoding }) });
      return db ? Object.fromEntries([...db.getRange()].map(({ key, value }) => [String(key), value])) : {};
    };
    return {
      records: rows('rows'),
      values: rows('values'),
      relationRows: rows('relationRows'),
      entities: rows('entities', 'json'),
      attrs: rows('attrs', 'json') as Record<string, { t: string; v: unknown }>,
      attrKeys: Object.keys(rows('attrs', 'json')).sort(),
      relations: Object.keys(rows('relations', 'json')),
      format: root.openDB({ name: 'meta', encoding: 'json' }).get('format'),
    };
  } finally {
    root.close();
  }
}

it('removes the second record of each fact, keeps the first, and records format 2', () => {
  const dir = format1();
  expect(convertToFormat2(dir)).toEqual({
    entityTypeAttrs: 1, relationDetailAttrs: 1, relationRows: 1, orphanRows: 1, rewrittenRows: 1, addedRows: 1,
  });
  expect(read(dir)).toMatchObject({
    entities: { 'Note-1': { type: 'Note' }, 'Note-2': { type: 'Note' } },
    attrKeys: [`createdAt${SEP}Note-1${SEP}0`, `createdAt${SEP}Note-2${SEP}0`, `title${SEP}Note-1${SEP}0`],
    relations: ['Relation-1'],
    format: 2,
  });
});

it('refuses an environment that records another format than the step converts, changing nothing', () => {
  const dir = format1();
  convertToFormat2(dir);
  const before = read(dir);
  expect(() => convertToFormat2(dir)).toThrow('records storage format 2; this step converts format 1');
  expect(read(dir)).toEqual(before);
  convertToFormat3(dir);
  expect(() => convertToFormat3(dir)).toThrow('records storage format 3; this step converts format 2');
  convertToFormat4(dir);
  expect(() => convertToFormat4(dir)).toThrow('records storage format 4; this step converts format 3');
});

/** A format 2 environment: one attribute row per list index */
function format2(rows: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-format-2-'));
  dirs.push(dir);
  const root = open({ path: dir, maxDbs: 8, compression: true });
  root.openDB({ name: 'meta', encoding: 'json' }).putSync('format', 2);
  root.openDB({ name: 'entities', encoding: 'json' }).putSync('Note-1', { type: 'Note' });
  root.openDB({ name: 'relations', encoding: 'json' });
  const attrs = root.openDB({ name: 'attrs', encoding: 'json' });
  for (const [key, value] of Object.entries(rows)) {
    attrs.putSync(key.replaceAll('|', SEP), { t: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, v: value });
  }
  root.close();
  return dir;
}

it('joins each attribute\'s rows into one, a single row its value and several rows or a role one list, and moves the trash into the engine', () => {
  const dir = format2({
    'title|Note-1|0': 'kept',
    'tags|Note-1|0': ['a', 'b'],
    'tag|Note-1|1': 'second', 'tag|Note-1|0': 'first',
    'role|Note-1|0': 'current',
    'gap|Note-1|1': 'after a hole',
    'meta|Note-1|0': { k: 1 },
    'deleted|Note-2|0': true, 'deletedAt|Note-2|0': 7,
    'deleted|Note-3|0': true, 'updatedAt|Note-3|0': 4,
    'deleted|Note-4|0': false, 'deletedAt|Note-4|0': null,
  });
  expect(convertToFormat3(dir)).toEqual({ singleValues: 4, joinedLists: 3, trashed: 2 });
  const { attrs, format } = read(dir);
  expect(format).toBe(3);
  expect(Object.fromEntries(Object.entries(attrs).map(([key, { v }]) => [key.replace(SEP, '|'), v]))).toEqual({
    'title|Note-1': 'kept',
    'tags|Note-1': ['a', 'b'],
    'tag|Note-1': ['first', 'second'],
    'role|Note-1': ['current'],
    'gap|Note-1': [null, 'after a hole'],
    'meta|Note-1': { k: 1 },
    'trashedAt|Note-2': 7,
    'trashedAt|Note-3': 4,
    'updatedAt|Note-3': 4,
  });
});

it('converts to the current format a step at a time, and leaves a current one alone', () => {
  const dir = format1();
  expect(convertToCurrentFormat(dir).map(({ to }) => to)).toEqual([2, 3, 4]);
  expect(read(dir)).toEqual({
    records: {
      'Note-1': { type: 'Note', fields: [['createdAt', 1], ['title', 'kept']], outOfLine: [] },
      'Note-2': { type: 'Note', fields: [['createdAt', 4]], outOfLine: [] },
    },
    values: {},
    relationRows: { 'Relation-1': { kind: 'refs', source: 'Note-1', target: 'Flow-1', info: null, createdAt: 3 } },
    entities: {}, attrs: {}, attrKeys: [], relations: [],
    format: LMDB_FORMAT_VERSION,
  });
  expect(convertToCurrentFormat(dir)).toEqual([]);
});

/** A format 3 environment: an entity row holding its type, and one attribute row per attribute */
function format3(entities: Record<string, string>, attrs: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-format-3-'));
  dirs.push(dir);
  const root = open({ path: dir, maxDbs: 8, compression: true });
  root.openDB({ name: 'meta', encoding: 'json' }).putSync('format', 3);
  for (const [id, type] of Object.entries(entities)) root.openDB({ name: 'entities', encoding: 'json' }).putSync(id, { type });
  root.openDB({ name: 'relations', encoding: 'json' });
  const rows = root.openDB({ name: 'attrs', encoding: 'json' });
  for (const [key, value] of Object.entries(attrs)) {
    rows.putSync(key.replace('|', SEP), value instanceof Date ? { t: 'date', v: value.toISOString() } : { t: Array.isArray(value) ? 'array' : typeof value, v: value });
  }
  root.close();
  return dir;
}

it('gathers each entity into one record, a large value into `values`, and keeps an attribute of no entity under no type', () => {
  const long = 'x'.repeat(OUT_OF_LINE_BYTES + 1);
  const list = Array.from({ length: OUT_OF_LINE_BYTES }, () => 1);
  const at = new Date('2026-01-02T03:04:05.000Z');
  const dir = format3({ 'Note-1': 'Note' }, {
    'title|Note-1': 'short', 'body|Note-1': long, 'list|Note-1': list, 'seenAt|Note-1': at,
    'title|Note-9': 'no entity row',
  });
  expect(convertToFormat4(dir)).toEqual({ entities: 1, attributes: 5, outOfLine: 2, untyped: 1, relations: 0 });
  const { records, values } = read(dir);
  expect(records).toEqual({
    'Note-1': {
      type: 'Note',
      fields: [['seenAt', at], ['title', 'short']],
      outOfLine: [['body', long.length, null], ['list', JSON.stringify(list).length, list.length]],
    },
    'Note-9': { type: null, fields: [['title', 'no entity row']], outOfLine: [] },
  });
  expect(values).toEqual({ [`body${SEP}Note-1`]: long, [`list${SEP}Note-1`]: list });
});

it('refuses a record store, whose format is its own, and leaves it as it was', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ears-records-')), 'records');
  dirs.push(path.dirname(dir));
  const records = openRecordStore({ path: dir, indexes: {} });
  records.put({ id: 'R-1' });
  records.close();
  expect(() => convertToCurrentFormat(dir)).toThrow('are a "records" store, not an EARS database');
  const reopened = openRecordStore({ path: dir, indexes: {} });
  expect(reopened.get('R-1')).toEqual({ id: 'R-1' });
  reopened.close();
});

it('rewrites, removes and leaves each attribute as its rewrite answers, and removes the named entities whole', () => {
  const dir = format1();
  convertToCurrentFormat(dir);
  const seen: string[] = [];
  const result = rewriteAttributes(dir, (kind, id, value) => {
    seen.push(`${kind} ${id}`);
    if (kind === 'title') return `${value as string}, renamed`;
    if (kind === 'createdAt' && id === 'Note-2') return REMOVE_ATTRIBUTE;
    return undefined;
  }, { removeEntities: ['Note-1'] });
  // Note-1's own rows go with it and are never offered to the rewrite
  expect(seen).toEqual([`createdAt Note-2`]);
  expect(result).toEqual({ rewritten: 0, removed: 3, removedEntities: 1 });
  expect(read(dir).records).toEqual({ 'Note-2': { type: 'Note', fields: [], outOfLine: [] } });

  const other = format1();
  convertToCurrentFormat(other);
  expect(rewriteAttributes(other, (kind, _id, value) => (kind === 'title' ? `${value as string}, renamed` : undefined))).toEqual({ rewritten: 1, removed: 0, removedEntities: 0 });
  expect(read(other).records['Note-1']).toEqual({ type: 'Note', fields: [['createdAt', 1], ['title', 'kept, renamed']], outOfLine: [] });

  // A value the rewrite makes large moves out of line, and one it makes small back into the record
  const long = 'y'.repeat(OUT_OF_LINE_BYTES + 1);
  rewriteAttributes(other, (kind) => (kind === 'title' ? long : undefined));
  expect(read(other).records['Note-1']).toEqual({ type: 'Note', fields: [['createdAt', 1]], outOfLine: [['title', long.length, null]] });
  expect(read(other).values).toEqual({ [`title${SEP}Note-1`]: long });
  rewriteAttributes(other, (kind) => (kind === 'title' ? 'short again' : undefined));
  expect(read(other).records['Note-1']).toEqual({ type: 'Note', fields: [['createdAt', 1], ['title', 'short again']], outOfLine: [] });
  expect(read(other).values).toEqual({});
});
