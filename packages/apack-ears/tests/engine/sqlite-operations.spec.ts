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
import { SqliteDatabase } from "../../bench/sqlite/database.ts";
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
        "../../bench/sqlite/extensions/node_modules/better-sqlite3"
      );
      const script = `const D=require(process.argv[1]);const d=new D(process.argv[2]);d.pragma('busy_timeout=25');let busy=false;try{d.exec('BEGIN IMMEDIATE');d.exec('ROLLBACK');}catch(e){busy=e.code==='SQLITE_BUSY';}console.log(JSON.stringify({title:d.prepare("SELECT json_extract(doc,'$.title') title FROM entities LIMIT 1").get().title,busy}));d.close();`;
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
