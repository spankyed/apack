/// <reference types="node" />
import { open, type Database, type RootDatabase } from 'lmdb';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { _idClock, _indexEntries, type IndexValue, type RecordIndexes, type RecordStore, type StoredRecord } from '../records.ts';
import { checkStamp } from './stamp.ts';

/**
 * How this version encodes a record store's records and index entries, stamped in its `meta` database under `format`
 * as an EARS environment stamps `LMDB_FORMAT_VERSION`. Beside it, `kind` says the files are a record store
 * (`RECORD_STORE_KIND`), which is what tells the two apart: each refuses the other's files.
 */
export const RECORD_STORE_FORMAT_VERSION = 1;
export const RECORD_STORE_KIND = 'records';

/** Sorts after every id, so a range over one index value ends after its last entry */
const ID_CEILING = '\uffff';

export interface RecordStoreOptions<R extends { id: string } = StoredRecord> {
  /** The environment's directory */
  path: string;
  /** The indexes `findBy` looks records up by (`RecordIndexes`) */
  indexes: RecordIndexes<R>;
  readOnly?: boolean;
}

/** An index entry's key: the index, the value filed under it and the record's id, so one value's entries sort by id */
type IndexKey = [string, IndexValue, string];

type Dbs = { root: RootDatabase; records: Database<StoredRecord, string>; index: Database<1, IndexKey> };

/**
 * Opens (creating it, unless read-only) the record store at `path`, whole records by id in their own LMDB environment
 * with an index per declared name; refuses files of another kind or format. Each write is one transaction (so a read
 * sees it at once) without a sync per write: a crash of the machine, not of the process, can lose the last writes,
 * which suits what a record store is for — a log that can afford them, such as run history.
 */
export function openRecordStore<R extends { id: string } = StoredRecord>({ path: dir, indexes, readOnly = false }: RecordStoreOptions<R>): RecordStore<R> {
  let dbs: Dbs | null = null;
  const newId = _idClock();

  function openDbs(at = dir, asReadOnly = readOnly): Dbs {
    if (asReadOnly && !fs.existsSync(path.join(at, 'data.mdb'))) throw new Error(`No record store at ${at}`);
    if (!asReadOnly) fs.mkdirSync(path.dirname(at), { recursive: true });
    const root = open({ path: at, maxDbs: 4, noSync: true, readOnly: asReadOnly });
    try {
      checkStamp(root, at, asReadOnly, { kind: RECORD_STORE_KIND, format: RECORD_STORE_FORMAT_VERSION, noun: 'record store' });
      return {
        root,
        records: root.openDB({ name: 'records', encoding: 'json' }),
        index: root.openDB({ name: 'index', encoding: 'json' }) as unknown as Database<1, IndexKey>,
      };
    } catch (error) {
      root.close();
      throw error;
    }
  }

  function current(): Dbs {
    if (!dbs) throw new Error(`The record store at ${dir} is closed`);
    return dbs;
  }

  /**
   * The open environment to write to, or nothing once the store is closed, when the write is dropped: a record store
   * is a log, and a write made as the app shuts down has nowhere to go
   */
  function writable(): Dbs | null {
    if (readOnly) throw new Error(`The record store at ${dir} is open read-only`);
    return dbs;
  }

  /** Removes every record and index entry; keys are read first, since a range is a live cursor */
  const empty = ({ records, index }: Dbs) => {
    // eslint-disable-next-line no-useless-spread -- a range is a live cursor, read whole before it is removed from
    for (const key of [...records.getKeys()]) records.remove(key);
    // eslint-disable-next-line no-useless-spread -- a range is a live cursor, read whole before it is removed from
    for (const key of [...index.getKeys()]) index.remove(key);
  };

  const entries = (record: StoredRecord): IndexKey[] =>
    _indexEntries(indexes, record as R).map(([name, value]) => [name, value, record.id]);

  function close(): void {
    if (!dbs) return;
    dbs.root.close();
    dbs = null;
  }

  dbs = openDbs();

  return {
    path: dir,
    readOnly,
    // While closed, a read finds nothing
    get: (id) => dbs?.records.get(id) as R | undefined,
    put(record) {
      const open = writable();
      if (!open) return;
      const { root, records, index } = open;
      root.transactionSync(() => {
        const previous = records.get(record.id);
        if (previous) for (const key of entries(previous)) index.removeSync(key);
        records.putSync(record.id, record);
        for (const key of entries(record)) index.putSync(key, 1);
      });
    },
    delete(id) {
      const open = writable();
      if (!open) return;
      const { root, records, index } = open;
      root.transactionSync(() => {
        const previous = records.get(id);
        if (!previous) return;
        for (const key of entries(previous)) index.removeSync(key);
        records.removeSync(id);
      });
    },
    findBy(name, value, { reverse = false, limit, cursor } = {}) {
      if (!dbs) return [];
      const { records, index } = dbs;
      // A reverse range starts at its high bound; a cursor bounds the end the walk starts from
      const low: IndexKey = [name, value, !reverse && cursor !== undefined ? cursor : ''];
      const high: IndexKey = [name, value, reverse && cursor !== undefined ? cursor : ID_CEILING];
      const range = index.getKeys(reverse ? { start: high, end: low, reverse: true } : { start: low, end: high });
      const found: R[] = [];
      // `for…of` closes the range's read transaction however the loop ends
      for (const key of range) {
        const id = key[2];
        if (id === cursor) continue;
        const record = records.get(id) as R | undefined;
        if (limit !== undefined && found.length >= limit) break;
        if (record) found.push(record);
      }
      return found;
    },
    newId,
    close,
    reset() {
      const open = writable();
      if (!open) return;
      open.root.transactionSync(() => { empty(open); });
    },
    replaceWith(source) {
      const open = writable() ?? current();
      const from = openDbs(source, true);
      try {
        open.root.transactionSync(() => {
          empty(open);
          for (const { key, value } of from.records.getRange()) open.records.put(key, value);
          for (const { key, value } of from.index.getRange()) open.index.put(key, value);
        });
      } finally {
        from.root.close();
      }
    },
    async copyTo(targetDir) {
      fs.mkdirSync(targetDir, { recursive: true });
      await current().root.backup(targetDir, false);
    },
  };
}
