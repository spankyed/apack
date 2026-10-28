/// <reference types="node" />
// FTS5 owns text indexing/ranking. sqlite-vec owns vector distance evaluation; EARS owns chunks and model freshness.
// Fuzzy expansion and highlight adaptation are explicit application work, not native FTS5 capabilities.
import { createHash } from "node:crypto";
import { getLoadablePath } from "sqlite-vec";
import type { SqliteDatabase } from "./database.ts";
import { SqliteTrigrams } from "./trigrams.ts";
type Data = Record<string, any>;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const textOf = (v: any): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
    ? v.filter((x) => typeof x === "string").join("\n\n")
    : "";
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export class SqliteSearch {
  private vectorLoaded = false;
  readonly trigrams: SqliteTrigrams;
  constructor(private readonly db: SqliteDatabase) { this.trigrams = new SqliteTrigrams(db); }
  private textIndex(
    type: string,
    schema = this.db.schemaForQueries()
  ): [string, Data] {
    const entries = Object.entries(schema.types[type]?.indexes ?? {}).filter(
      ([, d]) => (d as Data).kind === "text"
    ) as Array<[string, Data]>;
    return entries[0] ?? fail("UNKNOWN_INDEX", `${type} has no text index`);
  }
  private vectorIndex(
    type: string,
    schema = this.db.schemaForQueries()
  ): [string, Data] {
    const entries = Object.entries(schema.types[type]?.indexes ?? {}).filter(
      ([, d]) => (d as Data).kind === "vector"
    ) as Array<[string, Data]>;
    return entries[0] ?? fail("UNKNOWN_INDEX", `${type} has no vector index`);
  }
  private table(type: string, name: string, index: Data) {
    return (
      "fts_" +
      digest(JSON.stringify([type, name, index.fields, index.stem])).slice(
        0,
        24
      )
    );
  }
  loadVectors(schema: Data) {
    if (
      !this.vectorLoaded &&
      Object.values(schema.types).some((d: any) =>
        Object.values(d.indexes ?? {}).some((i: any) => i.kind === "vector")
      )
    ) {
      this.db.sql.loadExtension(getLoadablePath());
      this.vectorLoaded = true;
    }
  }
  ensure(schema: Data) {
    this.loadVectors(schema);
    this.trigrams.ensure(schema);
    this.db.sql
      .exec(`CREATE TABLE IF NOT EXISTS text_meta(entity_id TEXT,index_name TEXT,hash TEXT NOT NULL,PRIMARY KEY(entity_id,index_name));
      CREATE TABLE IF NOT EXISTS chunks(entity_id TEXT NOT NULL,type TEXT NOT NULL,index_name TEXT NOT NULL,
      chunk INTEGER NOT NULL,model TEXT NOT NULL,dims INTEGER NOT NULL,hash TEXT NOT NULL,text TEXT NOT NULL,
      embedding BLOB,PRIMARY KEY(entity_id,index_name,chunk));
      CREATE INDEX IF NOT EXISTS chunk_pending ON chunks(type,index_name,embedding,entity_id,chunk);`);
    for (const [type, definition] of Object.entries(schema.types) as Array<
      [string, Data]
    >)
      for (const [name, index] of Object.entries(
        definition.indexes ?? {}
      ) as Array<[string, Data]>) {
        if (index.kind === "text") {
          if (index.stem && index.stem !== "en")
            fail(
              "UNSUPPORTED",
              "Evaluation FTS5 porter tokenizer supports English stemming only"
            );
          const table = this.table(type, name, index),
            cols = Object.keys(index.fields)
              .map((_, i) => `c${i}`)
              .join(",");
          this.db.sql
            .exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(entity_id UNINDEXED,${cols},tokenize='${
            index.stem ? "porter unicode61" : "unicode61"
          }');
          CREATE VIRTUAL TABLE IF NOT EXISTS ${table}_vocab USING fts5vocab(${table},row);`);
        }
      }
  }
  refile(row: Data, seq: number, schema = this.db.schemaForQueries(), changed?: ReadonlySet<string>) {
    this.trigrams.refile(row, schema, changed);
    for (const [name, index] of Object.entries(
      schema.types[row.entityType]?.indexes ?? {}
    ) as Array<[string, Data]>) {
      if (changed && (index.kind === 'text' || index.kind === 'vector')) {
        const inputs: string[] = index.kind === 'text' ? Object.keys(index.fields) : index.from;
        if (!inputs.some(field => changed.has(field))) continue;
        row = this.db.row(row.id, inputs)!;
      }
      if (index.kind === "text") {
        const fields = Object.keys(index.fields).map((f) => textOf(row[f])),
          hash = digest(JSON.stringify(fields));
        const old = this.db.get(
          "SELECT hash FROM text_meta WHERE entity_id=? AND index_name=?",
          [row.id, name]
        );
        if (old?.hash === hash) continue;
        const table = this.table(row.entityType, name, index);
        this.db.run(`DELETE FROM ${table} WHERE entity_id=?`, [row.id]);
        if (fields.some(Boolean))
          this.db.run(
            `INSERT INTO ${table}(rowid,entity_id,${fields
              .map((_, i) => "c" + i)
              .join(",")}) VALUES (${fields
              .map(() => "?")
              .concat(["?", "?"])
              .join(",")})`,
            [seq, row.id, ...fields]
          );
        this.db.run("INSERT OR REPLACE INTO text_meta VALUES (?,?,?)", [
          row.id,
          name,
          hash,
        ]);
      }
      if (index.kind === "vector") {
        const joined = index.from
          .map((f: string) => textOf(row[f]))
          .filter(Boolean)
          .join("\n\n")
          .trim();
        const texts =
          index.chunk === "paragraph"
            ? joined.split(/\n\s*\n/).filter(Boolean)
            : joined
            ? [joined]
            : [];
        for (let chunk = 0; chunk < texts.length; chunk++) {
          const text = texts[chunk],
            hash = digest(text);
          this.db.run(
            `INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,NULL) ON CONFLICT(entity_id,index_name,chunk) DO UPDATE SET
            model=excluded.model,dims=excluded.dims,hash=excluded.hash,text=excluded.text,
            embedding=CASE WHEN chunks.hash=excluded.hash AND chunks.model=excluded.model AND chunks.dims=excluded.dims THEN chunks.embedding ELSE NULL END`,
            [
              row.id,
              row.entityType,
              name,
              chunk,
              index.model,
              index.dims,
              hash,
              text,
            ]
          );
        }
        this.db.run(
          "DELETE FROM chunks WHERE entity_id=? AND index_name=? AND chunk>=?",
          [row.id, name, texts.length]
        );
      }
    }
  }
  remove(id: string, type: string, schema = this.db.schemaForQueries()) {
    this.trigrams.remove(id, type, schema);
    for (const [name, index] of Object.entries(
      schema.types[type]?.indexes ?? {}
    ) as Array<[string, Data]>)
      if (index.kind === "text")
        this.db.run(
          `DELETE FROM ${this.table(type, name, index)} WHERE entity_id=?`,
          [id]
        );
    this.db.run("DELETE FROM text_meta WHERE entity_id=?", [id]);
    this.db.run("DELETE FROM chunks WHERE entity_id=?", [id]);
  }
  clear(schema = this.db.schemaForQueries()) {
    this.trigrams.clear(schema);
    for (const [type, definition] of Object.entries(schema.types) as Array<
      [string, Data]
    >)
      for (const [name, index] of Object.entries(
        definition.indexes ?? {}
      ) as Array<[string, Data]>)
        if (index.kind === "text")
          this.db.sql.exec(`DELETE FROM ${this.table(type, name, index)};`);
    this.db.sql.exec("DELETE FROM text_meta; DELETE FROM chunks;");
  }
  pending(type: string, limit: number) {
    const [name, index] = this.vectorIndex(type);
    return {
      kind: "pending" as const,
      index: name,
      model: index.model,
      dims: index.dims,
      count: this.db.get(
        "SELECT count(*) n FROM chunks WHERE type=? AND index_name=? AND embedding IS NULL",
        [type, name]
      )!.n,
      chunks: this.db
        .all(
          "SELECT entity_id id,chunk,hash,text FROM chunks WHERE type=? AND index_name=? AND embedding IS NULL ORDER BY entity_id,chunk LIMIT ?",
          [type, name, limit]
        )
        .map((r) => ({ id: String(r.id), chunk: Number(r.chunk), hash: String(r.hash), text: String(r.text) })),
    };
  }
  embed(op: Data) {
    const row = this.db.row(op.id);
    if (!row) return { kind: "stale" };
    const [name, index] = this.vectorIndex(row.entityType);
    const chunk = this.db.get(
      "SELECT * FROM chunks WHERE entity_id=? AND index_name=? AND chunk=?",
      [op.id, name, op.chunk]
    );
    if (!chunk || chunk.hash !== op.hash || chunk.model !== op.model)
      return { kind: "stale" };
    if (
      op.vector.length !== index.dims ||
      op.vector.some((x: number) => !Number.isFinite(x))
    )
      fail("VALUE_INVALID", "Invalid embedding dimension/value");
    const embedding = Buffer.from(Float32Array.from(op.vector).buffer);
    this.db.run(
      "UPDATE chunks SET embedding=? WHERE entity_id=? AND index_name=? AND chunk=?",
      [embedding, op.id, name, op.chunk]
    );
    return { kind: "done" };
  }
  vector(
    ids: string[] | null,
    type: string,
    vector: number[],
    k: number,
    exclude?: string
  ): Data[] {
    const [name, index] = this.vectorIndex(type);
    if (vector.length !== index.dims || vector.some((x) => !Number.isFinite(x)))
      fail("VALUE_INVALID", "Invalid query vector");
    const embedding = Buffer.from(Float32Array.from(vector).buffer);
    return this.db
      .all(
        `SELECT c.entity_id id,1-min(vec_distance_cosine(c.embedding,?)) score FROM chunks c
      JOIN entities e ON e.id=c.entity_id WHERE c.type=? AND c.index_name=? AND c.embedding IS NOT NULL
      AND ${
        ids === null
          ? "e.trashed=0"
          : "c.entity_id IN (SELECT value FROM json_each(?))"
      } AND c.entity_id!=? GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`,
        [
          embedding,
          type,
          name,
          ...(ids === null ? [] : [JSON.stringify(ids)]),
          exclude ?? "",
          k,
        ]
      )
      .map((r) => ({ id: r.id, score: r.score, terms: [] }));
  }
  like(ids: string[] | null, type: string, id: string, k: number): Data[] {
    const [name] = this.vectorIndex(type);
    const row = this.db.get(
      "SELECT embedding FROM chunks WHERE entity_id=? AND index_name=? AND embedding IS NOT NULL ORDER BY chunk LIMIT 1",
      [id, name]
    );
    if (!row) return [];
    const bytes = Buffer.from(row.embedding);
    const vector = Array.from({ length: bytes.length / 4 }, (_, i) =>
      bytes.readFloatLE(i * 4)
    );
    return this.vector(ids, type, vector, k, id);
  }
  text(
    ids: string[] | null,
    type: string,
    query: string,
    options: Data = {},
    wantHits = true
  ): Data[] {
    const [name, index] = this.textIndex(type),
      table = this.table(type, name, index),
      fields = Object.keys(index.fields);
    const tokens = query.match(/-?"[^"]+"|-?\S+/g) ?? [];
    if (!tokens.length) return [];
    const vocabulary =
      options.fuzzy === false
        ? []
        : this.db
            .all(`SELECT term FROM ${table}_vocab`)
            .map((r) => String(r.term));
    const terms: string[] = [];
    const positive: string[] = [],
      negative: string[] = [];
    const distance = (a: string, b: string): number => {
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++)
          row[j] = Math.min(
            row[j - 1]! + 1,
            prev[j]! + 1,
            prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
          );
        prev = row;
      }
      return prev[b.length]!;
    };
    for (let token of tokens) {
      if (token === "OR") {
        positive.push("OR");
        continue;
      }
      const neg = token.startsWith("-");
      if (neg) token = token.slice(1);
      const phrase = token.startsWith('"');
      const normalized = fold(token.replace(/^"|"$/g, ""));
      if (!normalized) continue;
      terms.push(normalized);
      const max = normalized.length >= 9 ? 2 : normalized.length >= 5 ? 1 : 0;
      const expanded =
        !phrase && max
          ? vocabulary.filter(
              (t) =>
                Math.abs(t.length - normalized.length) <= max &&
                distance(t, normalized) <= max
            )
          : [];
      const words = [...new Set([normalized, ...expanded])];
      let expression = phrase
        ? quote(normalized)
        : `(${words.map(quote).join(" OR ")})`;
      if (options.prefix && !phrase) expression = `${quote(normalized)}*`;
      if (options.fields?.length) {
        const selected = options.fields
          .map((f: string) => fields.indexOf(f))
          .filter((n: number) => n >= 0)
          .map((n: number) => "c" + n);
        if (!selected.length) return [];
        expression = `{${selected.join(" ")}} : ${expression}`;
      }
      (neg ? negative : positive).push(expression);
    }
    if (!positive.length) return [];
    let match = positive.join(" AND ").replaceAll(" AND OR AND ", " OR ");
    for (const n of negative) match += ` NOT ${n}`;
    const weights = [0, ...fields.map((f) => index.fields[f].weight ?? 1)].join(
      ","
    );
    const highlights = fields
      .map((_, i) => `highlight(${table},${i + 1},char(1),char(2)) h${i}`)
      .join(",");
    const rows = this.db.all(
      `SELECT f.entity_id id,-bm25(${table},${weights}) score${
        wantHits ? "," + highlights : ""
      } FROM ${table} f
      JOIN entities e ON e.id=f.entity_id WHERE ${table} MATCH ? AND ${
        ids === null
          ? "e.trashed=0"
          : "f.entity_id IN (SELECT value FROM json_each(?))"
      } ORDER BY score DESC,e.seq`,
      [match, ...(ids === null ? [] : [JSON.stringify(ids)])]
    );
    const payloads = wantHits || options.recency ? new Map(this.db.rows(rows.map(row => row.id),
      [...new Set([...fields, 'updatedAt', 'createdAt'])]).map(row => [row.id, row])) : undefined;
    return rows
      .map((r) => {
        const ranges: Data = {},
          found = new Set<string>();
        const payload =
          payloads?.get(r.id);
        if (wantHits)
          fields.forEach((field, i) => {
            const marked = String(r["h" + i]);
            let clean = "",
              start = -1;
            const places: number[][] = [];
            for (const ch of marked) {
              if (ch === "\u0001") start = clean.length;
              else if (ch === "\u0002") {
                if (start >= 0) {
                  places.push([0, start, clean.length]);
                  found.add(fold(clean.slice(start)));
                  start = -1;
                }
              } else clean += ch;
            }
            const source = payload![field];
            let adapted = places;
            if (Array.isArray(source)) {
              let base = 0;
              const segments: Array<{
                element: number;
                start: number;
                end: number;
              }> = [];
              source.forEach((value, element) => {
                if (typeof value === "string") {
                  if (segments.length) base += 2;
                  segments.push({
                    element,
                    start: base,
                    end: base + value.length,
                  });
                  base += value.length;
                }
              });
              adapted = places.flatMap(([, start, end]) =>
                segments
                  .filter((s) => start >= s.start && end <= s.end)
                  .map((s) => [s.element, start! - s.start, end! - s.start])
              );
            }
            if (adapted.length)
              Object.defineProperty(ranges, field, {
                value: adapted,
                enumerable: true,
                writable: true,
                configurable: true,
              });
          });
        let score = r.score;
        if (options.recency) {
          const row = payload!,
            at = row[options.recency.field];
          if (typeof at === "number")
            score *= Math.pow(
              0.5,
              Math.max(0, (options.recency.now ?? Date.now()) - at) /
                options.recency.halfLife
            );
        }
        return { id: r.id, score, terms: [...found], highlights: ranges };
      })
      .sort((a, b) => b.score - a.score);
  }
}
