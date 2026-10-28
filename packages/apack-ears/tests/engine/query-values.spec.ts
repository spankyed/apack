// Null is both an absent scalar and a direct list member; nested lists are not flattened by equality.
// These cases are pinned against the current native baseline, then shared by every backend.
import { describe, expect, it } from "vitest";
import { freshEngine } from "./engine-under-test.ts";

describe.each([false, true])(
  "value comparisons with declared index=%s",
  (indexed) => {
    it("keeps null/missing/list membership and scalar types consistent", () => {
      const e = freshEngine({
        types: ["Row"],
        relationKinds: [],
        roles: [],
        rowRules: { Row: { required: [], indexes: indexed ? ["value"] : [] } },
      });
      const values: Array<[string, Record<string, unknown>]> = [
        ["missing", {}],
        ["nil", { value: null }],
        ["arrayNil", { value: [null] }],
        ["empty", { value: [] }],
        ["arrayOne", { value: [1] }],
        ["arrayFalse", { value: [false] }],
        ["flag", { value: false }],
        ["zero", { value: 0 }],
        ["negativeZero", { value: -0 }],
        ["textZero", { value: "0" }],
        ["arrayZero", { value: [0] }],
        ["arrayMixed", { value: [null, 1] }],
        ["nestedNil", { value: [[null]] }],
      ];
      const ids = new Map(
        values.map(([name, fields]) => [name, e.create("Row", fields).id()])
      );
      const named = (names: string[]) => names.map((n) => ids.get(n)!);
      expect(e.query("Row").where("value", null).ids()).toEqual(
        named(["missing", "nil", "arrayNil", "arrayMixed"])
      );
      expect(e.query("Row").where("value", false).ids()).toEqual(
        named(["arrayFalse", "flag"])
      );
      expect(e.query("Row").where("value", 0).ids()).toEqual(
        named(["zero", "negativeZero", "arrayZero"])
      );
      expect(e.query("Row").where("value", "0").ids()).toEqual(
        named(["textZero"])
      );
      expect(e.query("Row").lacks("value").ids()).toEqual(named(["missing"]));
      expect(e.query("Row").has("value").ids()).toEqual(
        [...ids.values()].slice(1)
      );
    });
  }
);
