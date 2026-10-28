import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import { searchTable, type SqliteIndexJob } from './index-builds.ts';
import type { SqliteSearchStructure } from './search-structures.ts';
import { createRegexCompiler, type SqlitePattern } from './regex.ts';
type Data = Record<string, any>;
type Definition = { type: string; name: string; fields: string[]; table: string };
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };

/** FTS5 narrows candidates; exact Rust matching verifies one original string at a time. */
export class SqliteTrigrams {
  private readonly compiler = createRegexCompiler();
  private readonly matchers = new Map<string, SqlitePattern>();
  private installed = false;
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.db = db; }
  private definitions(type: string, schema: Data): Definition[] {
    return Object.entries(schema.types[type]?.indexes ?? {}).flatMap(([name, value]) => {
      const index = value as Data;
      if (index.kind !== 'trigram') return [];
      return [{ type, name, fields: index.fields, table: searchTable(this.db.indexBuilds.index(type, 'trigram', name)) }];
    });
  }
  structure(job: SqliteIndexJob): SqliteSearchStructure {
    const table = searchTable(job);
    return {
      types: [job.type], indexes: [job],
      objects: [['table', table], ...['data', 'idx', 'docsize', 'config'].map(suffix => ['table', table + '_' + suffix] as const),
        ['table', table + '_docs'], ['index', table + '_docs_entity'],
        ...['ai', 'ad', 'au'].map(suffix => ['trigger', table + '_docs_' + suffix] as const)],
      reset: ['ai', 'ad', 'au'].map(suffix => `DROP TRIGGER IF EXISTS ${table}_docs_${suffix};`).join('') +
        `DROP TABLE IF EXISTS ${table}; DROP TABLE IF EXISTS ${table}_docs;`,
    };
  }
  structures(schema: Data): SqliteSearchStructure[] {
    return Object.keys(schema.types).flatMap(type => this.definitions(type, schema).map(({ name }) =>
      this.structure(this.db.indexBuilds.index(type, 'trigram', name))));
  }
  ensure(schema: Data) {
    for (const type of Object.keys(schema.types)) for (const { table } of this.definitions(type, schema)) {
      const docs = table + '_docs';
      this.db.sql.exec(`CREATE TABLE IF NOT EXISTS ${docs}(id INTEGER PRIMARY KEY,entity_id TEXT NOT NULL,raw TEXT NOT NULL,folded TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS ${docs}_entity ON ${docs}(entity_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(folded,content='${docs}',content_rowid='id',tokenize='trigram case_sensitive 1');
        CREATE TRIGGER IF NOT EXISTS ${docs}_ai AFTER INSERT ON ${docs} BEGIN INSERT INTO ${table}(rowid,folded) VALUES(new.id,new.folded); END;
        CREATE TRIGGER IF NOT EXISTS ${docs}_ad AFTER DELETE ON ${docs} BEGIN INSERT INTO ${table}(${table},rowid,folded) VALUES('delete',old.id,old.folded); END;
        CREATE TRIGGER IF NOT EXISTS ${docs}_au AFTER UPDATE ON ${docs} BEGIN
          INSERT INTO ${table}(${table},rowid,folded) VALUES('delete',old.id,old.folded);
          INSERT INTO ${table}(rowid,folded) VALUES(new.id,new.folded); END;`);
    }
  }
  refile(row: Data, schema: Data, changed?: ReadonlySet<string>) {
    for (const definition of this.definitions(row.entityType, schema)) {
      if (changed && !definition.fields.some(field => changed.has(field))) continue;
      this.writeFields(this.db.row(row.id, definition.fields)!, definition.fields, definition.table);
    }
  }
  refileIndex(row: Data, job: SqliteIndexJob): void { this.writeFields(row, job.definition.fields, searchTable(job)); }
  private writeFields(row: Data, fields: string[], table: string): void {
    this.db.run(`DELETE FROM ${table}_docs WHERE entity_id=?`, [row.id]);
    for (const field of fields) {
      const value = row[field];
      const strings: string[] = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
      for (const text of strings) this.db.run(`INSERT INTO ${table}_docs(entity_id,raw,folded) VALUES(?,?,?)`, [row.id, text, this.compiler.fold(text)]);
    }
  }
  remove(id: string, type: string, schema: Data) {
    for (const { table } of this.definitions(type, schema)) this.db.run(`DELETE FROM ${table}_docs WHERE entity_id=?`, [id]);
  }
  clear(schema: Data) {
    for (const type of Object.keys(schema.types)) for (const { table } of this.definitions(type, schema)) this.db.run(`DELETE FROM ${table}_docs`);
  }
  select(input: { sql: string; parameters: unknown[]; types: string[]; direct: boolean },
    step: { step: 'matching'; pattern: string } | { step: 'containing'; text: string; caseInsensitive?: boolean },
  ): { sql: string; parameters: unknown[]; close(): void } {
    // Compile first, including on an empty input or a type with no index, as the native matcher does.
    const matcher = step.step === 'matching' ? this.compiler.compile(step.pattern) : this.compiler.substring(step.text, step.caseInsensitive === true);
    let key: string | undefined;
    try {
      const schema = this.db.schemaForQueries(), definitions: Definition[] = [];
      for (const type of new Set(input.types)) {
        const found = this.definitions(type, schema);
        if (found.length > 1) fail('UNKNOWN_INDEX', `${step.step}: ${type} has several trigram indexes; name the one to read`);
        if (!found.length && input.direct) fail('UNKNOWN_INDEX', `${step.step}: ${type} has no trigram index`);
        if (found.length) {
          this.db.indexBuilds.requireReady(type, 'trigram', found[0].name);
          definitions.push(found[0]);
        }
        this.db.trackRange(`rows:${type}`);
      }
      if (!this.installed) {
        this.db.sql.function('ears_text_match', { deterministic: true }, (key: unknown, text: unknown) => {
          const active = this.matchers.get(String(key));
          if (!active) return fail('CLOSED', 'The text matcher query scope is closed');
          if (typeof text !== 'string') return fail('CORRUPT', 'A derived text document is not a string');
          return active.matches(text) ? 1 : 0;
        });
        this.installed = true;
      }
      key = randomUUID(); const ownedKey = key; this.matchers.set(key, matcher);
      const close = () => { if (this.matchers.delete(ownedKey)) matcher.close(); };
      if (!definitions.length) return { sql: `SELECT p.* FROM (${input.sql}) p WHERE 0`, parameters: input.parameters, close };
      // Index-driven starts consume only FTS candidates. Set-based prefixes instead verify just their input
      // entities via the docs owner index; a broad regex must not scan the entire corpus for a two-ID input.
      if (input.direct && matcher.literal !== undefined) {
        const parameters: unknown[] = [], quoted = '"' + matcher.literal.replaceAll('"', '""') + '"';
        const candidates = definitions.map(({ type, table }) => {
          parameters.push(type, quoted, key);
          return `SELECT d.entity_id id FROM ${table} f CROSS JOIN ${table}_docs d CROSS JOIN entities owner
            WHERE f.rowid=d.id AND owner.id=d.entity_id AND owner.type=? AND f.folded MATCH ? AND ears_text_match(?,d.raw)`;
        }).join(' UNION ');
        return { sql: `SELECT p.* FROM (SELECT DISTINCT id FROM (${candidates})) matches CROSS JOIN (${input.sql}) p WHERE matches.id=p.id`,
          parameters: [...parameters, ...input.parameters], close };
      }
      const parameters = [...input.parameters];
      const conditions = definitions.map(({ type, table }) => {
        parameters.push(type, key);
        return `(e.type=? AND EXISTS(SELECT 1 FROM ${table}_docs d WHERE d.entity_id=p.id AND ears_text_match(?,d.raw)))`;
      });
      return { sql: `SELECT p.* FROM (${input.sql}) p JOIN entities e ON e.id=p.id WHERE ${conditions.join(' OR ')}`, parameters, close };
    } catch (error) { if (key) this.matchers.delete(key); matcher.close(); throw error; }
  }
}
