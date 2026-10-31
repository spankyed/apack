import type { SqliteDatabase } from './database.ts';
import { singleTypeFieldRows } from './field-query.ts';

interface ScalarInput {
  sql: string; parameters: unknown[]; order: string; field: string; types: readonly string[];
}

function scalarCells(db: SqliteDatabase, input: ScalarInput): string | undefined {
  if (input.types.length !== 1) return;
  const cells = singleTypeFieldRows(db, input.sql, input.types[0]!, input.field);
  if (!cells) return;
  // Unchecked writes and corruption must still reach the authoritative decoder. Dates/objects are
  // unique query keys rather than equal scalar cells; those queries use the batched fallback too.
  const invalid = `p._cell_entity IS NULL OR p._cell_invalid<>0
    OR (p._cell_kind IS NOT NULL AND p._cell_kind NOT IN ('null','bool','num','zero','text'))
    OR (p._cell_kind='null' AND p._cell_value IS NOT NULL)
    OR (p._cell_kind='text' AND typeof(p._cell_value)<>'text')
    OR (p._cell_kind IN ('bool','num','zero') AND
      (typeof(p._cell_value) NOT IN ('integer','real') OR p._cell_value>1.7976931348623157e308 OR p._cell_value< -1.7976931348623157e308))
    OR (p._cell_kind='bool' AND p._cell_value NOT IN (0,1))
    OR (p._cell_kind='zero' AND p._cell_value<>0)`;
  if (db.get(`SELECT 1 FROM (${cells}) p WHERE ${invalid} LIMIT 1`, input.parameters)) return;
  // REAL casts preserve the driver's rounded JS-number keys, including large integer ties and -0.
  return `SELECT p.id,p._cell_kind original_kind,p._cell_value original_value,ROW_NUMBER() OVER (ORDER BY ${input.order}) encounter,
    CASE WHEN p._cell_kind IS NULL OR p._cell_kind='null' THEN 'null'
      WHEN p._cell_kind='zero' THEN 'num' ELSE p._cell_kind END kind,
    CASE WHEN p._cell_kind IS NULL OR p._cell_kind='null' THEN NULL
      WHEN p._cell_kind IN ('num','zero') THEN CAST(p._cell_value AS REAL) ELSE p._cell_value END value
    FROM (${cells}) p`;
}

export function distinctScalarIds(db: SqliteDatabase, input: ScalarInput): string[] | undefined {
  const cells = scalarCells(db, input);
  if (!cells) return;
  // SQLite's one built-in min aggregate selects bare columns from that row. encounter is unique,
  // so the representative is unambiguous: https://sqlite.org/lang_select.html#bareagg
  return db.all(`WITH cells AS MATERIALIZED (${cells}) SELECT id,min(encounter) first
    FROM cells GROUP BY kind,value COLLATE BINARY ORDER BY first`, input.parameters)
    .map(row => String(row.id));
}

export function groupScalarValues(db: SqliteDatabase, input: ScalarInput, counts: boolean): Array<[unknown, string[] | number]> | undefined {
  const cells = scalarCells(db, input);
  if (!cells) return;
  // The sole min aggregate also retains the original first cell representation, including signed zero.
  return db.all(`WITH cells AS MATERIALIZED (${cells})
    SELECT original_kind,original_value,${counts ? 'count(*)' : 'json_group_array(id ORDER BY encounter)'} members,min(encounter) first
    FROM cells GROUP BY kind,value COLLATE BINARY ORDER BY first`, input.parameters)
    .map(row => [row.original_kind === null || row.original_kind === 'null' ? null
      : row.original_kind === 'zero' ? -0
      : row.original_kind === 'bool' ? Boolean(row.original_value) : row.original_value,
      counts ? Number(row.members) : JSON.parse(String(row.members)) as string[]]);
}
