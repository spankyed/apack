import type { SqliteDatabase } from './database.ts';

/** Inline cells and overflow pointers are mutually exclusive authoritative representations. */
export function fieldCellInvalid(slot: number | undefined): string {
  return slot === undefined ? '0' : `CASE WHEN (v.k${slot}='@' AND o.entity_id IS NULL)
    OR (v.k${slot} IS NOT NULL AND v.k${slot}<>'@' AND o.entity_id IS NOT NULL) THEN 1 ELSE 0 END`;
}

/** Input is already restricted to this type, on the caller's read snapshot. */
export function singleTypeFieldRows(db: SqliteDatabase, sql: string, type: string, field: string): string | undefined {
  if (field === 'id' || field === 'entityType' || field.includes('\0') || type.includes('\0')) return;
  const layout = db.values.layout(type);
  if (!layout) return;
  const slot = layout.fields.get(field);
  const overflow = slot === undefined ? undefined : `v.k${slot} IS NULL OR v.k${slot}='@'`;
  const kind = slot === undefined ? 'o.kind' : `CASE WHEN ${overflow} THEN o.kind ELSE v.k${slot} END`;
  const value = slot === undefined ? 'o.value' : `CASE WHEN ${overflow} THEN o.value ELSE v.v${slot} END`;
  const invalid = fieldCellInvalid(slot);
  // Joining the composite type-wide source can materialize it and scan it once per candidate.
  return `SELECT p.id,p.major,p.ord,v.entity_id _cell_entity,${kind} _cell_kind,${value} _cell_value,${invalid} _cell_invalid
    FROM (${sql}) p LEFT JOIN ${layout.table} v ON v.entity_id=p.id
    LEFT JOIN value_overflow o ON o.entity_id=p.id AND o.field='${field.replaceAll("'", "''")}'`;
}
