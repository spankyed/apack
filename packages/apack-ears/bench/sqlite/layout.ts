// Storage-layout diagnostic, not an EARS backend benchmark. All variants preserve the same lossless fixture.
// This isolates the cost of selective fields, whole rows/pages and partial writes before choosing an authority layout.
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Packr, Unpackr } from "msgpackr";

type Bind = string | number | Uint8Array | null;
type RecordRow = Record<string, unknown>;
interface Statement {
  all(...values: Bind[]): RecordRow[];
  get(...values: Bind[]): RecordRow | undefined;
  run(...values: Bind[]): unknown;
}
interface Sql {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  close(): void;
}
interface Layout {
  name: string;
  db: Sql;
  path: string;
  insert(row: RecordRow, seq: number): void;
  field(id: string): unknown;
  row(id: string): RecordRow;
  page(thread: string): RecordRow[];
  updateRank(id: string, rank: number, at: number): void;
}
const Database = createRequire(import.meta.url)(
  "./extensions/node_modules/better-sqlite3"
) as new (path: string) => Sql;
const packer = new Packr({ useRecords: false }),
  unpacker = new Unpackr({ useRecords: false });
const pack = (value: unknown): Buffer => Buffer.from(packer.pack(value));
const unpack = (value: unknown): unknown =>
  unpacker.unpack(value as Uint8Array);
const root = mkdtempSync(join(tmpdir(), "ears-sqlite-layout-"));
const count = Number(process.env.EARS_LAYOUT_ROWS ?? 3000),
  bodyBytes = Number(process.env.EARS_LAYOUT_BODY_BYTES ?? 4096);
assert.ok(Number.isSafeInteger(count) && count >= 1000 && count <= 20_000);
assert.ok(
  Number.isSafeInteger(bodyBytes) && bodyBytes >= 0 && bodyBytes <= 65_536
);
const fixtures = Array.from(
  { length: count },
  (_, i): RecordRow => ({
    id: `Message-${i}`,
    slug: `slug-${i}`,
    thread: `thread-${i % 20}`,
    rank: i,
    body: `${i} ${"x".repeat(bodyBytes)}`,
    note: `note-${i}`,
    flag: i % 2 === 0,
    at: new Date(1_700_000_000_000 + i),
    bytes: Buffer.from([i % 256, 255]),
    meta: { n: i },
    nil: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  })
);
function open(name: string): { db: Sql; path: string } {
  const path = join(root, name + ".sqlite3"),
    db = new Database(path);
  db.exec(
    "PRAGMA journal_mode=WAL;PRAGMA synchronous=OFF;PRAGMA cache_size=-65536;"
  );
  return { db, path };
}
function documentLayout(): Layout {
  const { db, path } = open("document");
  db.exec(`CREATE TABLE entities(id TEXT PRIMARY KEY,seq INTEGER UNIQUE,payload BLOB,doc TEXT);
    CREATE INDEX by_thread ON entities(json_extract(doc,'$.thread'),seq);
    CREATE UNIQUE INDEX by_slug ON entities(json_extract(doc,'$.slug'));`);
  const insert = db.prepare("INSERT INTO entities VALUES(?,?,?,?)"),
    get = db.prepare("SELECT payload FROM entities WHERE id=?");
  const page = db.prepare(
    "SELECT payload FROM entities WHERE json_extract(doc,'$.thread')=? ORDER BY seq LIMIT 50"
  );
  const update = db.prepare("UPDATE entities SET payload=?,doc=? WHERE id=?");
  const row = (id: string) => unpack(get.get(id)!.payload) as RecordRow;
  return {
    name: "document",
    db,
    path,
    insert: (r, s) => {
      insert.run(r.id as string, s, pack(r), JSON.stringify(r));
    },
    row,
    field: (id) => row(id).note,
    page: (t) => page.all(t).map((r) => unpack(r.payload) as RecordRow),
    updateRank(id, rank, at) {
      const r = row(id);
      r.rank = rank;
      r.updatedAt = at;
      update.run(pack(r), JSON.stringify(r), id);
    },
  };
}
function attributeLayout(): Layout {
  const { db, path } = open("attributes");
  db.exec(`CREATE TABLE entities(id TEXT PRIMARY KEY,seq INTEGER UNIQUE);
    CREATE TABLE attributes(entity_id TEXT,name TEXT,value BLOB,scalar TEXT,PRIMARY KEY(entity_id,name));
    CREATE INDEX by_value ON attributes(name,scalar,entity_id);`);
  const entity = db.prepare("INSERT INTO entities VALUES(?,?)"),
    insert = db.prepare("INSERT INTO attributes VALUES(?,?,?,?)");
  const field = db.prepare(
    "SELECT value FROM attributes WHERE entity_id=? AND name='note'"
  );
  const select = db.prepare(
    "SELECT name,value FROM attributes WHERE entity_id=? ORDER BY name"
  );
  const page =
    db.prepare(`WITH chosen AS(SELECT e.id,e.seq FROM attributes a JOIN entities e ON e.id=a.entity_id
    WHERE a.name='thread' AND a.scalar=? ORDER BY e.seq LIMIT 50)
    SELECT c.id,a.name,a.value FROM chosen c JOIN attributes a ON a.entity_id=c.id ORDER BY c.seq,a.name`);
  const update = db.prepare(
    "UPDATE attributes SET value=? WHERE entity_id=? AND name=?"
  );
  return {
    name: "attributes",
    db,
    path,
    insert(r, s) {
      entity.run(r.id as string, s);
      for (const [k, v] of Object.entries(r))
        insert.run(
          r.id as string,
          k,
          pack(v),
          k === "slug" || k === "thread" ? (v as string) : null
        );
    },
    field: (id) => unpack(field.get(id)!.value),
    row: (id) =>
      Object.fromEntries(select.all(id).map((r) => [r.name, unpack(r.value)])),
    page(thread) {
      const rows = new Map<string, RecordRow>();
      for (const r of page.all(thread)) {
        let row = rows.get(r.id as string);
        if (!row) rows.set(r.id as string, (row = {}));
        Object.defineProperty(row, r.name as string, {
          value: unpack(r.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return [...rows.values()];
    },
    updateRank(id, rank, at) {
      update.run(pack(rank), id, "rank");
      update.run(pack(at), id, "updatedAt");
    },
  };
}
function columnLayout(): Layout {
  const { db, path } = open("columns");
  db.exec(`CREATE TABLE messages(id TEXT PRIMARY KEY,seq INTEGER UNIQUE,slug TEXT UNIQUE,thread TEXT,rank REAL,body TEXT,note TEXT,
    flag INTEGER,at INTEGER,bytes BLOB,meta BLOB,nil BLOB,created_at INTEGER,updated_at INTEGER);
    CREATE INDEX by_thread ON messages(thread,seq);`);
  const insert = db.prepare(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ),
    get = db.prepare("SELECT * FROM messages WHERE id=?");
  const field = db.prepare("SELECT note FROM messages WHERE id=?"),
    page = db.prepare(
      "SELECT * FROM messages WHERE thread=? ORDER BY seq LIMIT 50"
    );
  const update = db.prepare(
    "UPDATE messages SET rank=?,updated_at=? WHERE id=?"
  );
  const row = (r: RecordRow): RecordRow => ({
    id: r.id,
    slug: r.slug,
    thread: r.thread,
    rank: r.rank,
    body: r.body,
    note: r.note,
    flag: !!r.flag,
    at: new Date(r.at as number),
    bytes: Buffer.from(r.bytes as Uint8Array),
    meta: unpack(r.meta),
    nil: null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  return {
    name: "columns",
    db,
    path,
    insert(r, s) {
      insert.run(
        r.id as string,
        s,
        r.slug as string,
        r.thread as string,
        r.rank as number,
        r.body as string,
        r.note as string,
        Number(r.flag),
        (r.at as Date).getTime(),
        r.bytes as Uint8Array,
        pack(r.meta),
        null,
        r.createdAt as number,
        r.updatedAt as number
      );
    },
    field: (id) => field.get(id)!.note,
    row: (id) => row(get.get(id)!),
    page: (t) => page.all(t).map(row),
    updateRank(id, rank, at) {
      update.run(rank, at, id);
    },
  };
}
function splitColumnLayout(): Layout {
  const { db, path } = open("split-columns");
  db.exec(`CREATE TABLE messages(id TEXT PRIMARY KEY,seq INTEGER UNIQUE,slug TEXT UNIQUE,thread TEXT,rank REAL,note TEXT,
    flag INTEGER,at INTEGER,bytes BLOB,meta BLOB,nil BLOB,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE bodies(id TEXT PRIMARY KEY,body TEXT);
    CREATE INDEX by_thread ON messages(thread,seq);`);
  const insert = db.prepare(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ),
    body = db.prepare("INSERT INTO bodies VALUES(?,?)");
  const get = db.prepare(
    "SELECT m.*,b.body FROM messages m JOIN bodies b ON b.id=m.id WHERE m.id=?"
  );
  const field = db.prepare("SELECT note FROM messages WHERE id=?");
  const page =
    db.prepare(`WITH chosen AS(SELECT * FROM messages WHERE thread=? ORDER BY seq LIMIT 50)
    SELECT c.*,b.body FROM chosen c JOIN bodies b ON b.id=c.id ORDER BY c.seq`);
  const update = db.prepare(
    "UPDATE messages SET rank=?,updated_at=? WHERE id=?"
  );
  const row = (r: RecordRow): RecordRow => ({
    id: r.id,
    slug: r.slug,
    thread: r.thread,
    rank: r.rank,
    body: r.body,
    note: r.note,
    flag: !!r.flag,
    at: new Date(r.at as number),
    bytes: Buffer.from(r.bytes as Uint8Array),
    meta: unpack(r.meta),
    nil: null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  return {
    name: "split-columns",
    db,
    path,
    insert(r, s) {
      insert.run(
        r.id as string,
        s,
        r.slug as string,
        r.thread as string,
        r.rank as number,
        r.note as string,
        Number(r.flag),
        (r.at as Date).getTime(),
        r.bytes as Uint8Array,
        pack(r.meta),
        null,
        r.createdAt as number,
        r.updatedAt as number
      );
      body.run(r.id as string, r.body as string);
    },
    field: (id) => field.get(id)!.note,
    row: (id) => row(get.get(id)!),
    page: (t) => page.all(t).map(row),
    updateRank(id, rank, at) {
      update.run(rank, at, id);
    },
  };
}
const layouts: Layout[] = [];
try {
  const setup: Record<string, number> = {};
  for (const make of [
    documentLayout,
    attributeLayout,
    columnLayout,
    splitColumnLayout,
  ]) {
    const layout = make();
    layouts.push(layout);
    const start = performance.now();
    layout.db.exec("BEGIN");
    fixtures.forEach((r, i) => layout.insert(r, i));
    layout.db.exec("COMMIT");
    setup[layout.name] = performance.now() - start;
    for (const i of [0, 17, count - 1]) {
      assert.deepEqual(layout.row(`Message-${i}`), fixtures[i]);
      assert.equal(layout.field(`Message-${i}`), `note-${i}`);
    }
    assert.deepEqual(
      layout.page("thread-7"),
      fixtures.filter((_, i) => i % 20 === 7).slice(0, 50)
    );
  }
  const samples: Record<string, Record<string, number[]>> = {};
  let consumed: unknown;
  const tasks: Record<
    string,
    { n: number; run: (l: Layout, i: number) => unknown }
  > = {
    field: { n: 2000, run: (l, i) => l.field(`Message-${(i * 7919) % count}`) },
    row: { n: 500, run: (l, i) => l.row(`Message-${(i * 7919) % count}`) },
    page50: { n: 60, run: (l, i) => l.page(`thread-${i % 20}`) },
    update100: {
      n: 15,
      run: (l, i) => {
        l.db.exec("BEGIN");
        for (let j = 0; j < 100; j++)
          l.updateRank(`Message-${j}`, i * 100 + j, 1_700_000_000_001 + i);
        l.db.exec("COMMIT");
      },
    },
  };
  for (const l of layouts) {
    samples[l.name] = {};
    for (const [name, t] of Object.entries(tasks)) {
      samples[l.name][name] = [];
      for (let i = 0; i < 3; i++) consumed = t.run(l, i);
    }
  }
  for (let round = 0; round < 5; round++)
    for (const l of [
      ...layouts.slice(round % layouts.length),
      ...layouts.slice(0, round % layouts.length),
    ])
      for (const [name, t] of Object.entries(tasks)) {
        globalThis.gc?.();
        const start = performance.now();
        for (let i = 0; i < t.n; i++) consumed = t.run(l, i + round * t.n);
        samples[l.name][name].push(((performance.now() - start) * 1000) / t.n);
      }
  for (const l of layouts) {
    const row = l.row("Message-99");
    assert.equal(row.note, "note-99");
    assert.equal(row.body, fixtures[99].body);
    assert.notEqual(row.rank, 99);
  }
  console.log(
    JSON.stringify({
      kind: "storage-layout-diagnostic",
      node: process.version,
      count,
      bodyBytes,
      cacheKiB: 65536,
      syncs: false,
      setupMs: setup,
      samples,
      files: Object.fromEntries(
        layouts.map((l) => [
          l.name,
          readdirSync(root)
            .filter((f) => f.startsWith(l.name + ".sqlite3"))
            .reduce((n, f) => n + statSync(join(root, f)).size, 0),
        ])
      ),
      consumed: consumed !== undefined,
    })
  );
} finally {
  for (const l of layouts) l.db.close();
  rmSync(root, { recursive: true, force: true });
}
