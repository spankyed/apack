/**
 * The LMDB store behind an app's EARS engine. It needs the `lmdb` package, an optional peer the app
 * installs; `@apackdev/ears` itself never loads it. Packs and pack tests don't use this entry.
 *
 * @packageDocumentation
 */

export { openLmdbStore, SYNC_IDLE_MS, SYNC_INTERVAL_MS, type LmdbStore, type LmdbStoreOptions, type LmdbStoreStats } from './store.ts';
export { LMDB_FORMAT_VERSION, openEnvAt, closeEnv, type EntityRecord, type LmdbDbs, type RelationRecord } from './envs.ts';
export { makeLmdbAdapter } from './adapter.ts';
export { hydrate } from './hydrate.ts';
export { convertToCurrentFormat, convertToFormat2, convertToFormat3, convertToFormat4, REMOVE_ATTRIBUTE, rewriteAttributes, type AttributeRewrite, type FormatConversion, type Format3Conversion, type Format4Conversion, type FormatSteps } from './convert.ts';
export { openRecordStore, RECORD_STORE_FORMAT_VERSION, RECORD_STORE_KIND, type RecordStoreOptions } from './record-store.ts';
export { LmdbReader, type EntityMeta, type FindByAttrOpts } from './reader.ts';
