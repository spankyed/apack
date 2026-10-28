import type { SqliteDatabase } from './database.ts';

/** Physical objects that must exist before a derived search group can be read. */
export interface SqliteSearchStructure {
  types: readonly string[];
  objects: ReadonlyArray<readonly [kind: 'table' | 'index' | 'trigger', name: string]>;
  /** Reset a partially present derived group before reconstructing it from primary values. */
  reset?: string;
}

export function missingSearchStructures(db: SqliteDatabase, groups: readonly SqliteSearchStructure[]): SqliteSearchStructure[] {
  const present = new Set(db.all('SELECT type,name FROM sqlite_schema').map(row => JSON.stringify([row.type, row.name])));
  return groups.filter(group => group.objects.some(object => !present.has(JSON.stringify(object))));
}
