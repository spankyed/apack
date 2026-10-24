// Converts one environment written in an older storage format to the current one, in place, a step per format.
// Nothing in the app calls this: an older data dir is refused at open (`checkFormat`), and the conversion is an
// explicit, one-off operation on a copy (`scripts/ears-convert.ts`).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { open, type Database, type RootDatabase } from 'lmdb';
import { entityTypeOf } from '../attribute-storage.ts';
import type { EARS } from '../entities.ts';
import { valueKey } from './adapter.ts';
import { LMDB_FORMAT_VERSION, type EntityRecord, type RelationRecord } from './envs.ts';
import { isLarge, sizeOf } from '../values.ts';

const SEP = '\x1F';

/** An attribute as formats 1 to 3 stored it: JSON, its type beside it so a Date comes back one */
type AttrRecord = { t: string; v: any };

const decodeAttr = (rec?: AttrRecord | null): unknown =>
  !rec ? null : rec.t === 'date' && typeof rec.v === 'string' ? new Date(rec.v) : rec.v;

/** What the conversion to format 2 removed and rewrote, per kind of row */
export interface FormatConversion {
  /** Attribute rows of `entityType`: the id says it */
  entityTypeAttrs: number;
  /** Attribute rows of `relationDetails`: the relations table holds each relation */
  relationDetailAttrs: number;
  /** Entity rows of relations: a relation is its row in the relations table */
  relationRows: number;
  /** Entity rows no attribute names: written for a relation's ends, or left by a relation that was removed */
  orphanRows: number;
  /** Entity rows rewritten to hold only their type, which is the id's */
  rewrittenRows: number;
  /** Entities with attributes and no row, given one */
  addedRows: number;
}

/**
 * Converts the format 1 environment at `basePath` to format 2, in one transaction, and records format 2.
 * Refuses an environment that records any format, since only one written before formats were recorded is
 * format 1.
 */
export function convertToFormat2(basePath: string): FormatConversion {
  return withEnv(basePath, 1, ({ root, meta }) => {
    const entities = root.openDB({ name: 'entities', encoding: 'json' }) as Database<Record<string, unknown>>;
    const attrs = root.openDB({ name: 'attrs', encoding: 'json' }) as Database<unknown>;

    const result: FormatConversion = { entityTypeAttrs: 0, relationDetailAttrs: 0, relationRows: 0, orphanRows: 0, rewrittenRows: 0, addedRows: 0 };
    root.transactionSync(() => {
      const withAttrs = new Set<string>();
      // Materialised, since the body removes keys from the range it walks
      for (const key of [...attrs.getKeys()] as string[]) {
        const kind = key.slice(0, key.indexOf(SEP));
        const id = key.slice(kind.length + 1, key.indexOf(SEP, kind.length + 1));
        if (kind === 'entityType') { attrs.remove(key); result.entityTypeAttrs++; }
        else if (kind === 'relationDetails') { attrs.remove(key); result.relationDetailAttrs++; }
        else withAttrs.add(id);
      }
      for (const { key, value } of [...entities.getRange()] as Array<{ key: string; value: Record<string, unknown> }>) {
        if (value?.type === 'Relation') { entities.remove(key); result.relationRows++; continue; }
        if (!withAttrs.has(key)) { entities.remove(key); result.orphanRows++; continue; }
        entities.put(key, { type: entityTypeOf(key as EARS.EntityId) });
        result.rewrittenRows++;
        withAttrs.delete(key);
      }
      for (const id of withAttrs) {
        entities.put(id, { type: entityTypeOf(id as EARS.EntityId) });
        result.addedRows++;
      }
      meta.put('format', 2);
    });
    return result;
  });
}

/** What the conversion to format 3 rewrote */
export interface Format3Conversion {
  /** Attributes stored as one row, rewritten under the key without an index */
  singleValues: number;
  /** Attributes stored as several rows (a role list, a list built by `add`), each joined into one array value */
  joinedLists: number;
  /** Entities marked `deleted: true`, put in the trash: `trashedAt`, from their `deletedAt` */
  trashed: number;
}

/**
 * Converts the format 2 environment at `basePath` to format 3, in one transaction, and records format 3: each
 * attribute's rows (`kind␟id␟index`) become one row (`kind␟id`). One row at index 0 is the value; several rows, or
 * a role, are one array by index, a hole read as null. The trash moves into the engine: an entity marked
 * `deleted: true` gets `trashedAt` (its `deletedAt`, else its `updatedAt`, else 0), and both marks go.
 */
export function convertToFormat3(basePath: string): Format3Conversion {
  return withEnv(basePath, 2, ({ root, meta }) => {
    const attrs = root.openDB({ name: 'attrs', encoding: 'json' }) as Database<AttrRecord>;
    const result: Format3Conversion = { singleValues: 0, joinedLists: 0, trashed: 0 };
    root.transactionSync(() => {
      const grouped = new Map<string, Array<[number, unknown]>>();
      // Materialised, since the body removes keys from the range it walks
      for (const { key, value } of [...attrs.getRange()] as Array<{ key: string; value: AttrRecord }>) {
        const last = key.lastIndexOf(SEP);
        const attribute = key.slice(0, last);
        let rows = grouped.get(attribute);
        if (!rows) grouped.set(attribute, rows = []);
        rows.push([Number(key.slice(last + 1)), decodeAttr(value)]);
        attrs.remove(key);
      }
      const valueOf = (kind: string, id: string) => grouped.get(`${kind}${SEP}${id}`)?.find(([index]) => index === 0)?.[1];
      for (const [attribute, rows] of grouped) {
        const kind = attribute.slice(0, attribute.indexOf(SEP));
        if (kind === 'deleted' || kind === 'deletedAt') {
          const id = attribute.slice(kind.length + 1);
          if (kind === 'deleted' && valueOf('deleted', id) === true) {
            const at = [valueOf('deletedAt', id), valueOf('updatedAt', id)].find((v) => typeof v === 'number') ?? 0;
            attrs.put(`trashedAt${SEP}${id}`, encode(at));
            result.trashed++;
          }
          continue;
        }
        let value: unknown;
        if (rows.length === 1 && rows[0][0] === 0 && kind !== 'role') {
          value = rows[0][1];
          result.singleValues++;
        } else {
          const list: unknown[] = [];
          for (const [index, element] of rows) list[index] = element;
          value = Array.from(list, (element) => element ?? null);
          result.joinedLists++;
        }
        attrs.put(attribute, encode(value));
      }
      meta.put('format', 3);
    });
    return result;
  });
}

/** What the conversion to format 4 wrote */
export interface Format4Conversion {
  /** Entity records written, one per entity */
  entities: number;
  /** Attributes in them */
  attributes: number;
  /** Of those, the large ones, kept in `values` */
  outOfLine: number;
  /** Ids holding attributes and no entity row, kept as records of no type */
  untyped: number;
  /** Relations rewritten as `RelationRecord`s */
  relations: number;
}

/**
 * Converts the format 3 environment at `basePath` to format 4, in one transaction, and records format 4: each
 * entity's row and attribute rows become one record (`EntityRecord`), each large value is put in `values`, and each
 * relation is rewritten as a `RelationRecord`; the databases format 3 wrote are dropped.
 */
export function convertToFormat4(basePath: string): Format4Conversion {
  return withEnv(basePath, 3, ({ root, meta }) => {
    const entities = root.openDB({ name: 'entities', encoding: 'json' }) as Database<{ type?: string }, string>;
    const attrs = root.openDB({ name: 'attrs', encoding: 'json' }) as Database<AttrRecord, string>;
    const relations = root.openDB({ name: 'relations', encoding: 'json' }) as Database<{ kind: string; src: string; tgt: string; info?: unknown; createdAt?: number }, string>;
    const rows = root.openDB({ name: 'rows' }) as Database<EntityRecord, string>;
    const values = root.openDB({ name: 'values' }) as Database<unknown, string>;
    const relationRows = root.openDB({ name: 'relationRows' }) as Database<RelationRecord, string>;
    const result: Format4Conversion = { entities: 0, attributes: 0, outOfLine: 0, untyped: 0, relations: 0 };
    root.transactionSync(() => {
      const records = new Map<string, EntityRecord>();
      for (const { key, value } of entities.getRange()) {
        records.set(key, { type: value?.type ?? entityTypeOf(key as EARS.EntityId), fields: [], outOfLine: [] });
      }
      for (const { key, value } of attrs.getRange()) {
        const sep = key.indexOf(SEP);
        const kind = key.slice(0, sep);
        const id = key.slice(sep + 1);
        let record = records.get(id);
        if (!record) records.set(id, record = { type: null, fields: [], outOfLine: [] });
        const decoded = decodeAttr(value);
        if (isLarge(decoded)) {
          values.put(valueKey(kind, id), decoded);
          record.outOfLine.push([kind, sizeOf(decoded), Array.isArray(decoded) ? decoded.length : null]);
          result.outOfLine++;
        } else {
          record.fields.push([kind, decoded]);
        }
        result.attributes++;
      }
      for (const [id, record] of records) {
        rows.put(id, record);
        if (record.type === null) result.untyped++;
        else result.entities++;
      }
      for (const { key, value: r } of relations.getRange()) {
        relationRows.put(key, { kind: r.kind, source: r.src, target: r.tgt, info: r.info ?? null, createdAt: r.createdAt ?? 0 });
        result.relations++;
      }
      entities.dropSync();
      attrs.dropSync();
      relations.dropSync();
      meta.put('format', 4);
    });
    return result;
  });
}

/** Each step a conversion took, from the format the environment recorded to the current one */
export type FormatSteps = Array<
  { to: 2; result: FormatConversion } | { to: 3; result: Format3Conversion } | { to: 4; result: Format4Conversion }
>;

/** Converts the environment at `basePath` from the format it records to `LMDB_FORMAT_VERSION`, a step per format */
export function convertToCurrentFormat(basePath: string): FormatSteps {
  const steps: FormatSteps = [];
  let format = recordedFormat(basePath);
  if (format === LMDB_FORMAT_VERSION) return steps;
  if (format === 1) { steps.push({ to: 2, result: convertToFormat2(basePath) }); format = 2; }
  if (format === 2) { steps.push({ to: 3, result: convertToFormat3(basePath) }); format = 3; }
  if (format === 3) { steps.push({ to: 4, result: convertToFormat4(basePath) }); format = 4; }
  if (format !== LMDB_FORMAT_VERSION) throw new Error(`The database at ${basePath} records storage format ${JSON.stringify(format)}, which doesn't convert to ${LMDB_FORMAT_VERSION}`);
  return steps;
}

/** The format an environment records, 1 when it records none */
function recordedFormat(basePath: string): unknown {
  return withEnv(basePath, undefined, ({ meta }) => meta.get('format') ?? 1);
}

/**
 * Opens the environment, refusing another kind's or one that records a format other than `from` (when given), and
 * closes it after
 */
function withEnv<T>(basePath: string, from: number | undefined, fn: (env: { root: RootDatabase; meta: Database<unknown> }) => T): T {
  if (!fs.existsSync(path.join(basePath, 'data.mdb'))) throw new Error(`No LMDB database at ${basePath}`);
  const root = open({ path: basePath, maxDbs: 8, compression: true });
  try {
    const meta = root.openDB({ name: 'meta', encoding: 'json' }) as Database<unknown>;
    // Another kind of environment (a record store) records its own format, which no step here converts
    const kind = meta.get('kind');
    if (kind !== undefined) throw new Error(`The files at ${basePath} are a ${JSON.stringify(kind)} store, not an EARS database`);
    const recorded = meta.get('format') ?? 1;
    if (from !== undefined && recorded !== from) {
      throw new Error(`The database at ${basePath} records storage format ${JSON.stringify(recorded)}; this step converts format ${from}`);
    }
    return fn({ root, meta });
  } finally {
    root.close();
  }
}

/** What `rewriteAttributes` changed */
export interface AttributeRewrite {
  /** Attribute rows given a new value */
  rewritten: number;
  /** Attribute rows removed: with their entity, or by the rewrite answering `REMOVE_ATTRIBUTE` */
  removed: number;
  /** Entity rows removed (`removeEntities`) */
  removedEntities: number;
}

/** What a `rewriteAttributes` rewrite answers to remove the attribute row it was given */
export const REMOVE_ATTRIBUTE: unique symbol = Symbol('REMOVE_ATTRIBUTE');

/**
 * Rewrites the attribute rows of a copy of a database in this version's format, in place and in one transaction: a
 * data change made explicitly, on a copy, as a format conversion is — never at boot. `rewrite` is given each
 * attribute's kind, entity id and value, as a read gives it back, and answers its new value, undefined to leave
 * it, or `REMOVE_ATTRIBUTE` to remove it; `removeEntities` names entities to remove, their rows and every attribute of theirs.
 * Refuses a database in another format.
 */
export function rewriteAttributes(
  basePath: string,
  rewrite: (kind: string, id: string, value: unknown) => unknown,
  { removeEntities = [] }: { removeEntities?: readonly string[] } = {},
): AttributeRewrite {
  return withEnv(basePath, LMDB_FORMAT_VERSION, ({ root }) => {
    const rows = root.openDB({ name: 'rows' }) as Database<EntityRecord, string>;
    const values = root.openDB({ name: 'values' }) as Database<unknown, string>;
    const removing = new Set(removeEntities);
    const result: AttributeRewrite = { rewritten: 0, removed: 0, removedEntities: 0 };
    root.transactionSync(() => {
      // Materialised, since the body writes and removes keys of the range it walks
      // eslint-disable-next-line no-useless-spread -- a range is a live cursor, read whole before it is written to
      for (const { key: id, value: record } of [...rows.getRange()]) {
        if (removing.has(id)) {
          for (const [kind] of record.outOfLine) values.remove(valueKey(kind, id));
          rows.remove(id);
          result.removed += record.fields.length + record.outOfLine.length;
          if (record.type !== null) result.removedEntities++;
          continue;
        }
        const next: EntityRecord = { type: record.type, fields: [], outOfLine: [] };
        let changed = false;
        const keep = (kind: string, value: unknown) => {
          if (isLarge(value)) {
            values.put(valueKey(kind, id), value);
            next.outOfLine.push([kind, sizeOf(value), Array.isArray(value) ? value.length : null]);
          } else {
            next.fields.push([kind, value]);
          }
        };
        const visit = (kind: string, value: unknown, kept: () => void) => {
          const answer = rewrite(kind, id, value);
          if (answer === undefined) { kept(); return; }
          changed = true;
          values.remove(valueKey(kind, id));
          if (answer === REMOVE_ATTRIBUTE) { result.removed++; return; }
          keep(kind, answer);
          result.rewritten++;
        };
        for (const field of record.fields) visit(field[0], field[1], () => next.fields.push(field));
        for (const held of record.outOfLine) visit(held[0], values.get(valueKey(held[0], id)), () => next.outOfLine.push(held));
        if (changed) rows.put(id, next);
      }
    });
    return result;
  });
}

/** An attribute record, as formats 1 to 3 wrote one */
function encode(value: unknown): AttrRecord {
  if (value instanceof Date) return { t: 'date', v: value.toISOString() };
  const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value;
  return { t, v: value };
}
