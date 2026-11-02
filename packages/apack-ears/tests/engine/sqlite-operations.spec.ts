import { afterEach, afterAll, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { SqliteDatabase } from "../../src/sqlite/database.ts";
import { createEarsEngine } from "../../src/index.ts";
import { toElmdbSchema } from "../../src/schema.ts";

const held: SqliteDatabase[] = [];
const root =
  process.env.EARS_EVALUATION_BACKEND === "sqlite"
    ? mkdtempSync(join(tmpdir(), "ears-sqlite-operations-"))
    : "";
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
let next = 0;
afterEach(() => {
  for (const db of held.splice(0)) db.close();
  rmSync(root, { recursive: true, force: true });
});
const schema = {
  types: {
    Note: {
      required: [],
      search: { fields: { title: 1 } },
      embed: { from: ["title"], model: "test", dims: 3 },
    },
  },
  relations: { refs: {} },
  roles: [],
} as const;
function open(
  path = join(root, String(++next)),
  rules: object | undefined = toElmdbSchema(schema),
  readOnly = false
) {
  const db = new SqliteDatabase({
    path,
    schema: readOnly ? undefined : rules,
    readOnly,
  });
  held.push(db);
  return db;
}
function engine(db: SqliteDatabase) {
  return createEarsEngine({ database: db });
}
function embed(e: ReturnType<typeof engine>) {
  const p = e.pendingEmbeddings("Note");
  e.embed(p.chunks.map((c) => ({ ...c, model: p.model, vector: [1, 0, 0] })));
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === "sqlite")(
  "SQLite operational feasibility",
  () => {
    it("selects adjacency and relation payloads without a binding call per source or edge", () => {
      const db = open(), e = engine(db);
      const pairs = e.transact(() => Array.from({ length: 64 }, (_, i) => {
        const root = e.create("Note", { title: `root ${i}` }).id();
        const leaf = e.create("Note", { title: `leaf ${i}` }).id();
        e.write(root).link("refs", leaf, { info: { n: i } });
        return { root, leaf };
      }));
      e.write(pairs[1].root).link("refs", pairs[0].leaf);
      const all = db.all.bind(db), relation = db.relation.bind(db);
      let selects = 0, edgeReads = 0;
      let selection: Parameters<SqliteDatabase["all"]> | undefined;
      db.all = (...args) => { selects++; selection = args; return all(...args); };
      db.relation = (...args) => { edgeReads++; return relation(...args); };
      const query = () => e.query.ids(pairs.map(pair => pair.root));
      expect(query().out("refs").ids()).toEqual(pairs.map(pair => pair.leaf));
      expect(selects).toBe(1);
      const plan = all("EXPLAIN QUERY PLAN " + selection![0], selection![1]);
      expect(plan.some(row => /SEARCH r USING(?: COVERING)? INDEX [^(]+\(source=\?/.test(String(row.detail)))).toBe(true);
      selects = 0;
      const edges = query().outEdges("refs");
      expect(edges).toHaveLength(65);
      expect(edges[0].info).toEqual({ n: 0 });
      expect(selects).toBe(2); // Ordered seeds, then one statement to hydrate every edge.
      expect(edgeReads).toBe(0);
      selects = 0;
      expect(e.findRelations()).toHaveLength(65);
      expect(selects).toBe(1);
      expect(edgeReads).toBe(0);
    });

    it("does not serialize transport envelopes or read answers", () => {
      const db = open(), e = engine(db);
      const persist = db.pack.bind(db);
      db.pack = (value) => {
        if (value && typeof value === "object" &&
            (Object.hasOwn(value, "ops") || Object.hasOwn(value, "reads") ||
             Object.hasOwn(value, "results") || Object.hasOwn(value, "touched") ||
             Array.isArray(value))) {
          throw new Error("Transport serialization reached the SQLite persistence codec");
        }
        return persist(value);
      };
      const id = e.create("Note", { title: "before" }).id();
      e.transact(() => {
        e.write(id).set("title", "after");
        expect(e.getAttr(id, "title")).toBe("after");
      });
      expect(e.query("Note").pickAll().map(row => row.title)).toEqual(["after"]);
      e.admin.putAttr(id, "extra", "unchecked");
      expect(e.getAttr(id, "extra")).toBe("unchecked");
    });

    it("reads and updates a scalar through EARS without decoding or encoding its large neighbors", () => {
      const db = open(), e = engine(db);
      const body = "unrelated large body ".repeat(4096);
      const id = e.create("Note", { title: "search stays", body, rank: 1, data: { nested: [1, 2] } }).id();
      const pack = db.pack.bind(db), unpack = db.unpack.bind(db);
      db.pack = value => {
        expect(JSON.stringify(value)).not.toContain("unrelated large body");
        return pack(value);
      };
      db.unpack = bytes => {
        const value = unpack(bytes);
        expect(JSON.stringify(value)).not.toContain("unrelated large body");
        return value;
      };
      expect(e.getAttr(id, "rank")).toBe(1);
      e.write(id).set("rank", 2);
      expect(e.query("Note").pick(["rank"])).toEqual([{ id, rank: 2 }]);
      expect(e.query("Note").search("stays").ids()).toEqual([id]);
      db.pack = pack; db.unpack = unpack;
      expect(e.getAttr(id, "body")).toBe(body);
      expect(e.getAttr(id, "data")).toEqual({ nested: [1, 2] });
      expect(db.all("PRAGMA table_info(entities)").map(row => row.name)).not.toContain("payload");
      expect(db.all("PRAGMA table_info(entities)").map(row => row.name)).not.toContain("doc");
    });

    it("replaces logical values when the source and destination have different physical field slots", () => {
      const source = open(), original = engine(source);
      original.admin.declare({ types: { Note: { required: [], indexes: ["alpha", "beta"] } }, relations: {}, roles: [] });
      const id = original.create("Note", { title: "original", alpha: 1, beta: "b", unknown: new Date(99) }).id();
      const destination = open(), current = engine(destination);
      current.admin.declare({ types: { Note: { required: [], indexes: ["beta", "alpha"] } }, relations: {}, roles: [] });
      const old = current.create("Note", { title: "incumbent" }).id();
      current.admin.replaceWith(source.path);
      expect(current.getRow(old)).toBeUndefined();
      expect(current.getRow(id)).toEqual(original.getRow(id));
      expect(current.query("Note").where("alpha", 1).ids()).toEqual([id]);
      expect(current.query("Note").where("beta", "b").ids()).toEqual([id]);
    });

    it("explains actual FTS and vector statements with their original bindings", () => {
      const e = engine(open());
      const id = e.create("Note", { title: "explain needle" }).id();
      embed(e);
      for (const [query, fragment] of [
        [e.query("Note").search("needle"), "bm25("],
        [e.query("Note").near([1, 0, 0]), "vec_distance_cosine("],
      ] as const) {
        const result = query.explain();
        expect(result.backend).toBe("sqlite");
        if (result.backend !== "sqlite") throw new Error("Wrong backend");
        expect(result.ids).toEqual([id]);
        const statement = result.statements.find(statement => statement.sql.includes(fragment))!;
        expect(statement.plan.length).toBeGreaterThan(0);
        expect(statement.parameters.length).toBeGreaterThan(0);
        if (fragment.startsWith("vec_")) expect(statement.parameters.some(value => value instanceof Uint8Array)).toBe(true);
      }
    });

    it("bounds explain capture while counting every executed query statement", () => {
      const db = open(), e = engine(db);
      const ids = e.transact(() => {
        const ids = Array.from({ length: 270 }, () => e.create("Note", {}).id());
        for (let i = 1; i < ids.length; i++) e.write(ids[i - 1]).link("refs", ids[i]);
        return ids;
      });
      const all = db.all.bind(db), iterate = db.iterate.bind(db);
      let calls = 0;
      db.all = (...args) => { calls++; return all(...args); };
      db.iterate = (...args) => { calls++; return iterate(...args); };
      const result = e.query.ids(ids[0]).descendants("refs").explain();
      expect(result.backend).toBe("sqlite");
      if (result.backend !== "sqlite") throw new Error("Wrong backend");
      expect(result.ids).toEqual(ids.slice(1));
      expect(result.statementCount).toBe(calls);
      expect(result.statementCount).toBeGreaterThan(256);
      expect(result.statements).toHaveLength(256);
    });

    it("reopens lossless payloads, FTS and embeddings, including read-only access", () => {
      const db = open(),
        e = engine(db);
      const value = JSON.parse(
        '{"__proto__":{"safe":true},"nested":[null,false,0]}'
      );
      const id = e
        .create("Note", {
          title: "durable needle",
          value,
          date: new Date("2020-01-01"),
          bytes: new Uint8Array([0, 255]),
        })
        .id();
      embed(e);
      db.close();
      const readOnlyDb = open(db.path, undefined, true);
      const read = engine(readOnlyDb);
      const copy = join(root, "read-only-backup");
      expect(() => readOnlyDb.backup(copy)).not.toThrow();
      expect(engine(open(copy, undefined, true)).getAttr(id, "title")).toBe(
        "durable needle"
      );
      expect(read.getAttr(id, "value")).toEqual(value);
      expect(read.getAttr(id, "date")).toEqual(new Date("2020-01-01"));
      expect([...(read.getAttr(id, "bytes") as Uint8Array)]).toEqual([0, 255]);
      expect(read.query("Note").search("needle").ids()).toEqual([id]);
      expect(read.query("Note").near([1, 0, 0]).ids()).toEqual([id]);
      expect(() => read.write(id).set("title", "bad")).toThrow(
        expect.objectContaining({ code: "READ_ONLY" })
      );
    });
    it("backs up and replaces a populated destination with text, relations and vectors intact", () => {
      const db = open(),
        e = engine(db),
        a = e.create("Note", { title: "source needle" }).id(),
        b = e.create("Note", { title: "source second" }).id();
      e.write(a).link("refs", b);
      embed(e);
      const backup = join(root, "backup");
      db.backup(backup);
      e.write(a).set("title", "changed");
      e.create("Note", { title: "incumbent needle" });
      e.admin.replaceWith(backup);
      expect(e.query("Note").search("needle").ids()).toEqual([a]);
      expect(e.query("Note").count()).toBe(2);
      expect(e.query.ids(a).out("refs", "Note").ids()).toEqual([b]);
      expect(e.pendingEmbeddings("Note").count).toBe(0);
      expect(e.query("Note").near([1, 0, 0]).count()).toBe(2);
      expect(engine(open(backup, undefined, true)).getAttr(a, "title")).toBe(
        "source needle"
      );
    });
    it("rolls back primary, FTS and pending-vector changes together", () => {
      const e = engine(open()),
        id = e.create("Note", { title: "before" }).id();
      embed(e);
      expect(() =>
        e.transact(() => {
          e.write(id).set("title", "after");
          throw new Error("abort");
        })
      ).toThrow("abort");
      expect(e.getAttr(id, "title")).toBe("before");
      expect(e.query("Note").search("after").ids()).toEqual([]);
      expect(e.query("Note").search("before").ids()).toEqual([id]);
      expect(e.pendingEmbeddings("Note").count).toBe(0);
    });
    it("admits new types and value indexes over existing data, and refuses stale handles", () => {
      const a = open(),
        e = engine(a),
        id = e.create("Note", { title: "existing", slug: "key" }).id(),
        b = open(a.path, undefined);
      const nextSchema = toElmdbSchema({
        ...schema,
        types: {
          ...schema.types,
          Note: { ...schema.types.Note, indexes: ["slug"] },
          Task: { required: [] },
        },
      });
      a.setSchema(nextSchema);
      expect(engine(a).query("Note").where("slug", "key").ids()).toEqual([id]);
      expect(engine(a).create("Task", {}).id()).toMatch(/^Task-/);
      expect(() => engine(b).query("Note").count()).toThrow(
        expect.objectContaining({ code: "SCHEMA_CHANGED" })
      );
      expect(() => b.setSchema(nextSchema)).toThrow(
        expect.objectContaining({ code: "SCHEMA_CHANGED" })
      );
      expect(() => engine(b).create("Note", {})).toThrow(
        expect.objectContaining({ code: "SCHEMA_CHANGED" })
      );
    });
    it("keeps the incumbent intact when replacement fails midway", () => {
      const a = open(),
        e = engine(a),
        id = e.create("Note", { title: "incumbent" }).id();
      const b = open();
      engine(b).create("Note", { title: "replacement" });
      b.close();
      a.sql.exec(
        "CREATE TRIGGER reject_incoming BEFORE INSERT ON entities BEGIN SELECT RAISE(ABORT,'injected copy failure'); END;"
      );
      expect(() => a.replaceWith(b.path)).toThrow("injected copy failure");
      expect(e.getAttr(id, "title")).toBe("incumbent");
      expect(e.query("Note").search("incumbent").ids()).toEqual([id]);
    });
    it("gives a consistent multi-statement snapshot while another handle commits", () => {
      const a = open(),
        e = engine(a),
        id = e.create("Note", { title: "before" }).id(),
        b = open(a.path, undefined),
        other = engine(b);
      const row = a.row.bind(a);
      let calls = 0;
      a.row = (key) => {
        const value = row(key);
        if (++calls === 1) other.write(id).set("title", "after");
        return value;
      };
      const answers = a.readSync({ reads: [{ read: "row", id }, { read: "row", id }] });
      expect(answers.map((v: any) => v.row.title)).toEqual([
        "before",
        "before",
      ]);
      expect(e.getAttr(id, "title")).toBe("after");
    });
    it("preserves the declared schema and data after unsupported index admission", () => {
      const db = open(),
        e = engine(db),
        id = e.create("Note", { title: "before" }).id(),
        before = db.schema;
      const next = toElmdbSchema({
        types: {
          Note: { required: [], search: { fields: { title: 1 }, stem: "fr" } },
        },
        relations: {},
        roles: [],
      });
      expect(() => db.setSchema(next)).toThrow(
        expect.objectContaining({ code: "UNSUPPORTED" })
      );
      expect(db.schema).toEqual(before);
      expect(e.query("Note").search("before").ids()).toEqual([id]);
    });
    it("allows another process to read a committed snapshot and refuses its competing writer", () => {
      const db = open(),
        e = engine(db),
        id = e.create("Note", { title: "before" }).id();
      const unit = db.begin();
      unit.write(
        { ops: [{ op: "set", id, fields: { title: "after" } }] }
      );
      const binding = createRequire(import.meta.url).resolve(
        "better-sqlite3"
      );
      const script = `const D=require(process.argv[1]);const d=new D(process.argv[2]);d.pragma('busy_timeout=25');let busy=false;try{d.exec('BEGIN IMMEDIATE');d.exec('ROLLBACK');}catch(e){busy=e.code==='SQLITE_BUSY';}console.log(JSON.stringify({title:d.prepare(${JSON.stringify("SELECT value title FROM (" + db.fieldSource("title", ["Note"]) + ") LIMIT 1")}).get().title,busy}));d.close();`;
      const child = () => {
        const p = spawnSync(
          process.execPath,
          ["-e", script, binding, join(db.path, "data.sqlite3")],
          { encoding: "utf8", timeout: 5000 }
        );
        expect(p.status, p.stderr).toBe(0);
        return JSON.parse(p.stdout);
      };
      expect(child()).toEqual({ title: "before", busy: true });
      unit.commit();
      expect(child()).toEqual({ title: "after", busy: false });
    });
    it("admits required fields over old data and checks only changed fields", () => {
      const db = open(),
        e = engine(db),
        id = e.create("Note", { title: "before" }).id();
      const next = toElmdbSchema({
        ...schema,
        types: { Note: { required: ["missing"] } },
      });
      expect(() => db.setSchema(next)).not.toThrow();
      expect(db.schema).toEqual(next);
      expect(() => e.write(id).set("title", "after")).not.toThrow();
      expect(e.getAttr(id, "title")).toBe("after");
      expect(e.getAttr(id, "missing")).toBeUndefined();
      expect(() => e.create("Note", { title: "new" })).toThrow(
        expect.objectContaining({ code: "REQUIRED_FIELD" })
      );
    });
    it("refuses an elmdb directory without creating SQLite files beside it", () => {
      const path = join(root, "wrong-format");
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "data.mdb"), "owned synthetic fixture");
      expect(() => open(path)).toThrow(
        expect.objectContaining({ code: "WRONG_FORMAT" })
      );
      expect(existsSync(join(path, "data.sqlite3"))).toBe(false);
    });
    it("preserves array-element and UTF-16 highlight locations", () => {
      const e = engine(open()),
        id = e.create("Note", { title: [7, "😀 zebra"] }).id();
      expect(
        e
          .query("Note")
          .search("zebra", { fuzzy: false })
          .hits({ highlights: true })
          .map((h) => ({ id: h.id, highlights: h.highlights }))
      ).toEqual([{ id, highlights: { title: [[1, 3, 8]] } }]);
    });
    it("reports its own commit sequence when another writer commits immediately after it", () => {
      const db = open(),
        e = engine(db),
        id = e.create("Note", { title: "before" }).id();
      const other = engine(open(db.path, undefined));
      const before = db.sequence,
        exec = db.sql.exec.bind(db.sql);
      let inject = true;
      db.sql.exec = (sql) => {
        const result = exec(sql);
        if (sql === "COMMIT" && inject) {
          inject = false;
          other.write(id).set("extra", "other writer");
        }
        return result;
      };
      const written = db.write({ ops: [{ op: "set", id, fields: { title: "mine" } }] });
      expect(written.changes!.sequence).toBe(before + 1);
      expect(db.sequence).toBe(before + 2);
      expect(e.getAttr(id, "title")).toBe("mine");
      expect(e.getAttr(id, "extra")).toBe("other writer");
    });
  }
);
