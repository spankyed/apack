// Authoritative attribute storage: declared scalar columns, with large/composite and undeclared values outside
// the row. Layout handles belong to the caller's admitted schema; no process-global schema cache is kept here.
export interface SqliteValuesSql {
  all(sql: string, parameters?: unknown[]): Record<string, unknown>[];
  get(sql: string, parameters?: unknown[]): Record<string, unknown> | undefined;
  run(sql: string, parameters?: unknown[]): unknown;
}

export interface SqliteValuesCodec {
  encode(value: unknown): Uint8Array;
  decode(bytes: Uint8Array): unknown;
}

export interface SqliteValueLayout {
  readonly name: string;
  readonly table: string;
  readonly fields: ReadonlyMap<string, number>;
}

type Cell = { kind: string; value: string | number | Uint8Array | null };
const refusal = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };

/** The caller owns row-rule validation and the surrounding transaction, including metadata and derived updates. */
export class SqliteValues {
  private readonly sql: SqliteValuesSql;
  private readonly codec: SqliteValuesCodec;
  private readonly inlineTextLimit: number;
  private readonly nativeFieldLimit: number;
  constructor(sql: SqliteValuesSql, codec: SqliteValuesCodec, inlineTextLimit = 256, nativeFieldLimit = 128) {
    this.sql = sql; this.codec = codec; this.inlineTextLimit = inlineTextLimit; this.nativeFieldLimit = nativeFieldLimit;
  }

  initialize(): void {
    this.sql.run(`CREATE TABLE IF NOT EXISTS value_types(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE BINARY)`);
    this.sql.run(`CREATE TABLE IF NOT EXISTS value_fields(id INTEGER PRIMARY KEY,type_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE BINARY,UNIQUE(type_id,name))`);
    // Keep large payloads out of the primary-key B-tree. WITHOUT ROWID makes key traversal expensive when a
    // neighboring attribute carries a large value, even for a projection that never returns that attribute.
    this.sql.run(`CREATE TABLE IF NOT EXISTS value_overflow(entity_id TEXT NOT NULL,field TEXT NOT NULL COLLATE BINARY,
      kind TEXT NOT NULL,value,PRIMARY KEY(entity_id,field))`);
    this.sql.run(`CREATE TABLE IF NOT EXISTS value_members(entity_id TEXT NOT NULL,field TEXT NOT NULL COLLATE BINARY,
      kind TEXT NOT NULL,value NOT NULL,PRIMARY KEY(entity_id,field,kind,value)) WITHOUT ROWID`);
  }

  /** Removes primary values and derived list membership inside the caller's transaction. */
  delete(layout: SqliteValueLayout, ids: readonly string[]): void {
    const input = JSON.stringify(ids);
    this.sql.run(`DELETE FROM ${layout.table} WHERE entity_id IN (SELECT value FROM json_each(?))`, [input]);
    for (const table of ['value_overflow', 'value_members']) this.sql.run(
      `DELETE FROM ${table} WHERE entity_id IN (SELECT value FROM json_each(?))`, [input]);
  }

  clear(): void {
    for (const row of this.sql.all('SELECT id FROM value_types')) this.sql.run(`DELETE FROM values_t${Number(row.id)}`);
    this.sql.run('DELETE FROM value_overflow');
    this.sql.run('DELETE FROM value_members');
  }

  /** Caller owns the offline write transaction: readers see the old or complete rebuilt membership. */
  rebuildMembers(): void {
    this.sql.run('DELETE FROM value_members');
    this.sql.run(`INSERT OR IGNORE INTO value_members(entity_id,field,kind,value)
      SELECT o.entity_id,o.field,json_extract(member.value,'$.kind'),json_extract(member.value,'$.value')
      FROM value_overflow o JOIN entities e ON e.id=o.entity_id, json_each(ears_rebuild_members(o.value)) member
      WHERE o.kind='array'`);
  }

  /** Reopens an admitted layout without DDL or writes, including on a read-only connection. */
  layout(name: string): SqliteValueLayout | undefined {
    const type = this.sql.get('SELECT id FROM value_types WHERE name=?', [name]);
    if (!type) return undefined;
    return { name, table: `values_t${Number(type.id)}`, fields: new Map(
      this.sql.all('SELECT id,name FROM value_fields WHERE type_id=?', [type.id])
        .map(row => [String(row.name), Number(row.id)])) };
  }

  /** Conservative absence proof for offline rebuild: missing primary rows still require normal validation. */
  hasStoredField(layout: SqliteValueLayout, field: string): boolean {
    const slot = layout.fields.get(field);
    return this.sql.get(`SELECT 1 FROM entities e LEFT JOIN ${layout.table} v ON v.entity_id=e.id
      WHERE e.type=? AND (v.entity_id IS NULL ${slot === undefined ? '' : `OR v.k${slot} IS NOT NULL`}
      OR EXISTS(SELECT 1 FROM value_overflow o WHERE o.entity_id=e.id AND o.field=?)) LIMIT 1`, [layout.name, field]) !== undefined;
  }

  /** Adds physical slots without rewriting incumbent values. Old flexible values remain readable until replaced. */
  declare(name: string, names: Iterable<string>): SqliteValueLayout {
    this.sql.run('INSERT OR IGNORE INTO value_types(name) VALUES (?)', [name]);
    const type = this.sql.get('SELECT id FROM value_types WHERE name=?', [name])!;
    const table = `values_t${Number(type.id)}`;
    this.sql.run(`CREATE TABLE IF NOT EXISTS ${table}(entity_id TEXT PRIMARY KEY) WITHOUT ROWID`);
    const fields = new Map(this.sql.all('SELECT id,name FROM value_fields WHERE type_id=?', [type.id])
      .map(row => [String(row.name), Number(row.id)]));
    for (const field of names) {
      if (field === 'id' || field === 'entityType' || fields.has(field) || fields.size >= this.nativeFieldLimit) continue;
      this.sql.run('INSERT INTO value_fields(type_id,name) VALUES (?,?)', [type.id, field]);
      const id = Number(this.sql.get('SELECT id FROM value_fields WHERE type_id=? AND name=?', [type.id, field])!.id);
      this.sql.run(`ALTER TABLE ${table} ADD COLUMN k${id} TEXT`);
      this.sql.run(`ALTER TABLE ${table} ADD COLUMN v${id}`);
      fields.set(field, id);
    }
    return { name, table, fields };
  }

  /** Patches only supplied fields; neither reads nor encodes unrelated values. Undefined fields are omitted. */
  set(layout: SqliteValueLayout, id: string, fields: Readonly<Record<string, unknown>>, removed: readonly string[] = []): void {
    const values = Object.entries(fields).filter(([name, value]) => name !== 'id' && name !== 'entityType' && value !== undefined);
    const deleting = new Set(removed.filter(name => name !== 'id' && name !== 'entityType'));
    if (values.some(([name]) => deleting.has(name))) refusal('VALUE_INVALID', 'A patch cannot set and remove the same field');
    // Encode before making any SQL changes: a codec refusal must not leave half a field batch behind.
    const cells = values.map(([name, value]) => [name, this.cell(value)] as const);
    this.sql.run(`INSERT OR IGNORE INTO ${layout.table}(entity_id) VALUES (?)`, [id]);
    const changed = [...values.map(([name]) => name), ...deleting];
    if (changed.length) this.sql.run('DELETE FROM value_overflow WHERE entity_id=? AND field IN (SELECT value FROM json_each(?))',
      [id, JSON.stringify(changed)]);
    if (changed.length) this.sql.run('DELETE FROM value_members WHERE entity_id=? AND field IN (SELECT value FROM json_each(?))',
      [id, JSON.stringify(changed)]);
    for (const [name, value] of values) for (const member of this.members(value)) {
      this.sql.run('INSERT OR IGNORE INTO value_members VALUES (?,?,?,?)', [id, name, member.kind, member.value]);
    }
    const assignments: string[] = [], parameters: unknown[] = [];
    for (const [name, cell] of cells) {
      const field = layout.fields.get(name);
      const outside = this.outside(layout, name, cell);
      if (outside) this.sql.run('INSERT INTO value_overflow(entity_id,field,kind,value) VALUES (?,?,?,?)',
        [id, name, cell.kind, cell.value]);
      if (field !== undefined) {
        assignments.push(`k${field}=?`, `v${field}=?`);
        parameters.push(outside ? '@' : cell.kind, outside ? null : cell.value);
      }
    }
    for (const name of deleting) {
      const field = layout.fields.get(name);
      if (field !== undefined) assignments.push(`k${field}=NULL`, `v${field}=NULL`);
    }
    if (assignments.length) this.sql.run(`UPDATE ${layout.table} SET ${assignments.join(',')} WHERE entity_id=?`, [...parameters, id]);
  }

  private outside(layout: SqliteValueLayout, field: string, cell: Cell): boolean {
    return !layout.fields.has(field) || cell.kind === 'array' || cell.kind === 'object' ||
      (typeof cell.value === 'string' && cell.value.length > this.inlineTextLimit) ||
      (cell.value instanceof Uint8Array && cell.value.byteLength > this.inlineTextLimit);
  }

  /** Private staged restore: validate representation and retain raw payload bytes, bypassing declared row rules. */
  restoreCell(layout: SqliteValueLayout, id: string, field: string, kind: string, value: Cell['value']): void {
    if (field === 'id' || field === 'entityType') refusal('VALUE_INVALID', 'A logical field cannot replace entity identity');
    const decoded = this.value(kind, value), members = this.members(decoded), cell = { kind, value };
    const outside = this.outside(layout, field, cell), slot = layout.fields.get(field);
    // Decode and derive before writes, so a malformed blob cannot leave a partially replaced field.
    this.sql.run(`INSERT OR IGNORE INTO ${layout.table}(entity_id) VALUES (?)`, [id]);
    this.sql.run('DELETE FROM value_overflow WHERE entity_id=? AND field=?', [id, field]);
    this.sql.run('DELETE FROM value_members WHERE entity_id=? AND field=?', [id, field]);
    if (outside) this.sql.run('INSERT INTO value_overflow VALUES (?,?,?,?)', [id, field, kind, value]);
    if (slot !== undefined) this.sql.run(`UPDATE ${layout.table} SET k${slot}=?,v${slot}=? WHERE entity_id=?`,
      [outside ? '@' : kind, outside ? null : value, id]);
    for (const member of members) this.sql.run('INSERT OR IGNORE INTO value_members VALUES (?,?,?,?)', [id, field, member.kind, member.value]);
  }

  /** A single-field projection joins its overflow cell in one crossing; wider pages use two in one snapshot. */
  read(layout: SqliteValueLayout, ids: readonly string[], requested?: readonly string[]): Array<Record<string, unknown> | undefined> {
    if (!ids.length) return [];
    const names = requested === undefined ? [...layout.fields.keys()] : [...new Set(requested)];
    const selected = names.flatMap(name => {
      const field = layout.fields.get(name);
      return field === undefined ? [] : [field];
    });
    const columns = selected.flatMap(field => [`v.k${field}`, `v.v${field}`]);
    const input = JSON.stringify(ids), singleField = requested !== undefined && names.length === 1;
    const rows = this.sql.all(`SELECT v.entity_id${columns.length ? ',' + columns.join(',') : ''}${singleField ?
      ',o.field overflow_field,o.kind overflow_kind,o.value overflow_value' : ''}
      FROM json_each(?) seed JOIN ${layout.table} v ON v.entity_id=seed.value${singleField ?
        ' LEFT JOIN value_overflow o ON o.entity_id=v.entity_id AND o.field=?' : ''} ORDER BY seed.key`,
      [input, ...(singleField ? [names[0]!] : [])]);
    const native = new Map(rows.map(row => [String(row.entity_id), row]));
    const overflow = singleField ? [...native.values()].flatMap(row => row.overflow_field === null ? [] : [{
      entity_id: row.entity_id, field: row.overflow_field, kind: row.overflow_kind, value: row.overflow_value,
    }]) : this.sql.all(`SELECT o.entity_id,o.field,o.kind,o.value FROM value_overflow o
      WHERE o.entity_id IN (SELECT value FROM json_each(?))${requested === undefined ? '' :
        ' AND o.field IN (SELECT value FROM json_each(?))'}`, [input, ...(requested === undefined ? [] : [JSON.stringify(names)])]);
    const extra = new Map<string, Record<string, unknown>[]>();
    for (const row of overflow) {
      const id = String(row.entity_id), held = extra.get(id) ?? [];
      held.push(row);
      extra.set(id, held);
    }
    return ids.map(id => {
      const row = native.get(id);
      if (!row) return undefined;
      const out = Object.fromEntries([['id', id], ['entityType', layout.name]]);
      const outside = new Set<string>();
      for (const name of names) {
        const field = layout.fields.get(name);
        if (field === undefined) continue;
        const kind = row[`k${field}`];
        if (kind === '@') outside.add(name);
        if (kind !== null && kind !== '@') Object.defineProperty(out, name,
          { value: this.value(String(kind), row[`v${field}`]), enumerable: true, writable: true, configurable: true });
      }
      for (const field of extra.get(id) ?? []) {
        const name = String(field.field);
        if (Object.hasOwn(out, name)) refusal('CORRUPT', `Duplicate authoritative value for ${name}`);
        outside.delete(name);
        Object.defineProperty(out, name,
          { value: this.value(String(field.kind), field.value), enumerable: true, writable: true, configurable: true });
      }
      if (outside.size) refusal('CORRUPT', 'Missing overflow attribute value');
      return out;
    });
  }

  /** The rebuildable scalar membership of an authoritative list; null uses a non-null key sentinel. */
  members(value: unknown): Cell[] {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item === null || ['string', 'number', 'boolean'].includes(typeof item)).map(item => {
      const cell = this.cell(item);
      return { kind: cell.kind === 'zero' ? 'num' : cell.kind, value: cell.value ?? 0 };
    });
  }

  private cell(value: unknown): Cell {
    if (value === null) return { kind: 'null', value: null };
    if (typeof value === 'boolean') return { kind: 'bool', value: Number(value) };
    if (typeof value === 'number' && Number.isFinite(value)) return { kind: Object.is(value, -0) ? 'zero' : 'num', value };
    if (typeof value === 'string') return { kind: 'text', value };
    if (value instanceof Date && Number.isFinite(value.getTime())) return { kind: 'date', value: value.getTime() };
    if (value instanceof Uint8Array) return { kind: 'bytes', value };
    if (Array.isArray(value)) return { kind: 'array', value: this.codec.encode(value) };
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) return { kind: 'object', value: this.codec.encode(value) };
    return refusal('VALUE_INVALID', 'Invalid stored attribute value');
  }

  /** Validate a raw logical cell while allowing an exporter to retain the original binary payload. */
  validateCell(kind: string, value: unknown): void { this.value(kind, value); }

  private value(kind: string, value: unknown): unknown {
    switch (kind) {
      case 'null': if (value === null) return null; break;
      case 'bool': if (value === 0 || value === 1) return value === 1; break;
      case 'num': if (typeof value === 'number' && Number.isFinite(value)) return value; break;
      case 'zero': if (value === 0) return -0; break;
      case 'text': if (typeof value === 'string') return value; break;
      case 'date': if (typeof value === 'number' && Number.isFinite(new Date(value).getTime())) return new Date(value); break;
      case 'bytes':
        if (value instanceof Uint8Array) return Uint8Array.from(value);
        break;
      case 'array': case 'object':
        if (value instanceof Uint8Array) {
          const decoded = this.codec.decode(value);
          if (kind === 'array' && Array.isArray(decoded)) return decoded;
          if (kind === 'object' && decoded !== null && typeof decoded === 'object' &&
              !Array.isArray(decoded) && !(decoded instanceof Date) && !(decoded instanceof Uint8Array)) return decoded;
        }
        break;
    }
    return refusal('CORRUPT', `Invalid stored attribute kind ${kind}`);
  }
}
