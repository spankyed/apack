import type { SqliteDatabase } from './database.ts';

/** SQL ordering is equivalent only for these scalar cells; ICU text and deep values use the JS comparator. */
export function orderNumericIds(db: SqliteDatabase, input: {
  sql: string; parameters: unknown[]; order: string; field: string; descending?: boolean; limit?: number;
}): string[] | undefined {
  if (input.field === 'id' || input.field === 'entityType' || input.field.includes('\0')) return undefined;
  const types = [...new Set(db.all(`SELECT DISTINCT e.type FROM (${input.sql}) p
    JOIN entities e ON e.id=p.id`, input.parameters).map(row => String(row.type)))].sort();
  if (!types.length) return [];
  if (types.some(type => type.includes('\0'))) return undefined;
  const source = db.fieldSource(input.field, types, true);
  let joined = `SELECT p.id,p.major,p.ord,f.id _sort_entity,f.kind _sort_kind,f.value _sort_value
    FROM (${input.sql}) p LEFT JOIN (${source}) f ON f.id=p.id`;
  if (types.length === 1) {
    const layout = db.values.layout(types[0]!);
    if (layout) {
      // A LEFT JOIN over the composite field source can materialize it and scan every value for
      // every candidate. One type has one authoritative table: probe its primary key directly.
      const slot = layout.fields.get(input.field);
      const overflow = slot === undefined ? undefined : `v.k${slot} IS NULL OR v.k${slot}='@'`;
      const kind = slot === undefined ? 'o.kind' : `CASE WHEN ${overflow} THEN o.kind ELSE v.k${slot} END`;
      const value = slot === undefined ? 'o.value' : `CASE WHEN ${overflow} THEN o.value ELSE v.v${slot} END`;
      joined = `SELECT p.id,p.major,p.ord,v.entity_id _sort_entity,${kind} _sort_kind,${value} _sort_value
        FROM (${input.sql}) p LEFT JOIN ${layout.table} v ON v.entity_id=p.id
        LEFT JOIN value_overflow o ON o.entity_id=p.id AND o.field='${input.field.replaceAll("'", "''")}'`;
    }
  }
  // Unchecked imports need their actual cell kind, not their declared rule. Invalid cells and missing primary
  // records must reach the normal decoder so this optimization cannot turn corruption into missing values.
  const invalid = `p._sort_entity IS NULL
    OR (p._sort_kind IS NOT NULL AND p._sort_kind NOT IN ('bool','num','zero','date','null'))
    OR (p._sort_kind IN ('bool','num','zero','date') AND
      (typeof(p._sort_value) NOT IN ('integer','real') OR p._sort_value>1.7976931348623157e308 OR p._sort_value< -1.7976931348623157e308))
    OR (p._sort_kind='null' AND p._sort_value IS NOT NULL)
    OR (p._sort_kind='bool' AND p._sort_value NOT IN (0,1))
    OR (p._sort_kind='zero' AND p._sort_value<>0)
    OR (p._sort_kind='date' AND (p._sort_value>8640000000000000 OR p._sort_value< -8640000000000000 OR p._sort_value<>CAST(p._sort_value AS INTEGER)))`;
  if (db.get(`SELECT 1 FROM (${joined}) p WHERE ${invalid} LIMIT 1`, input.parameters)) return undefined;
  const rank = `CASE p._sort_kind WHEN 'bool' THEN 0 WHEN 'num' THEN 1 WHEN 'zero' THEN 1 WHEN 'date' THEN 2 ELSE 5 END`;
  const direction = input.descending ? 'DESC' : 'ASC';
  // The driver returns JS numbers, including rounding large SQLite integers to doubles. Preserve those ties.
  // Only an immediately following limit is safe here: filtering or another ordering step before the limit
  // would change which prefix survives. Eligibility still checks every candidate, including outside this prefix.
  const limited = input.limit !== undefined;
  return db.all(`SELECT p.id FROM (${joined}) p ORDER BY ${rank} ${direction},
    CAST(p._sort_value AS REAL) ${direction},${input.order}${limited ? ' LIMIT ?' : ''}`,
    limited ? [...input.parameters, input.limit] : input.parameters).map(row => String(row.id));
}
