// Probe the pinned native baseline for edge semantics before encoding them in the SQLite compiler/validator.
// Runs only a database binding over owned temporary fixtures, not captured compiler/runtime tests.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Packr, Unpackr } from "msgpackr";
import { toElmdbSchema } from "../../src/schema.ts";
interface Native {
  write(bytes: Uint8Array): Uint8Array;
  readSync(bytes: Uint8Array): Uint8Array;
  bulkLoad(bytes: Uint8Array): void;
  setSchema(schema: object): unknown;
  close(): void;
}
const binding = createRequire(import.meta.url)(
  resolve(process.argv[2] ?? "vendor/elmdb/crates/elmdb-node")
) as { Database: { open(path: string, options: object): Native } };
const packer = new Packr({ useRecords: false }),
  unpacker = new Unpackr({ useRecords: false });
const pack = (v: unknown) => packer.pack(v),
  decode = (v: Uint8Array) => unpacker.unpack(v) as unknown;
const dir = mkdtempSync(join(tmpdir(), "ears-contract-probes-"));
const schema = toElmdbSchema({
  types: { Row: { required: [], indexes: ["n"] } },
  relations: {},
  roles: [],
}) as { types: Record<string, { fields: Record<string, object> }> };
const db = binding.Database.open(dir, { schema, syncs: false });
const result: Record<string, unknown> = {};
try {
  const rows: Record<string, object> = {
    missing: {},
    nil: { n: null },
    arrayNil: { n: [null] },
    empty: { n: [] },
    arrayOne: { n: [1] },
    arrayFalse: { n: [false] },
    flag: { n: false },
    zero: { n: 0 },
    negativeZero: { n: -0 },
    textZero: { n: "0" },
    arrayZero: { n: [0] },
    arrayMixed: { n: [null, 1] },
    nestedNil: { n: [[null]] },
  };
  db.write(
    pack({
      now: 0,
      ops: Object.entries(rows).map(([name, fields]) => ({
        op: "create",
        type: "Row",
        id: "Row-" + name,
        fields,
      })),
    })
  );
  for (const [name, step] of Object.entries({
    whereNull: { step: "where", field: "n", value: null },
    whereFalse: { step: "where", field: "n", value: false },
    whereZero: { step: "where", field: "n", value: 0 },
    has: { step: "has", field: "n" },
    lacks: { step: "lacks", field: "n" },
  })) {
    result[name] = decode(
      db.readSync(
        pack({
          reads: [
            {
              read: "query",
              plan: {
                scope: "live",
                start: { from: "types", types: ["Row"] },
                steps: [step],
                terminal: { answer: "ids" },
              },
            },
          ],
        })
      )
    );
  }
  const attempt = (fn: () => unknown) => {
    try {
      return { ok: true, result: fn() };
    } catch (e) {
      return {
        ok: false,
        code: (e as { code?: string }).code,
        message: (e as Error).message,
      };
    }
  };
  schema.types.Row.fields = {
    n: { type: "number", optional: true },
    required: { type: "string" },
  };
  result.admitIncompatible = attempt(() => db.setSchema(schema));
  result.changeUnrelatedOnOldData = attempt(() =>
    decode(
      db.write(
        pack({
          now: 1,
          ops: [{ op: "set", id: "Row-flag", fields: { other: "new" } }],
        })
      )
    )
  );
  result.changeTypedInvalid = attempt(() =>
    decode(
      db.write(
        pack({
          now: 1,
          ops: [{ op: "set", id: "Row-flag", fields: { n: "bad" } }],
        })
      )
    )
  );
  result.uncheckedLoad = attempt(() =>
    db.bulkLoad(
      pack([
        {
          load: "entity",
          id: "Row-repair",
          fields: { n: "deliberately invalid" },
          trashed: false,
        },
      ])
    )
  );
  result.negativeZero = decode(
    db.readSync(
      pack({ reads: [{ read: "field", id: "Row-negativeZero", field: "n" }] })
    )
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
