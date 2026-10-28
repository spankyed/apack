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


it('filters unchecked primary entities whose type is not currently declared', () => {
  const e = freshEngine({ types: [], relationKinds: [], roles: [] });
  const id = 'Uninstalled-held';
  e.admin.putAttr(id, 'flag', true);
  expect(e.getRow(id)).toMatchObject({ id, entityType: 'Uninstalled', flag: true });
  expect(e.query.all().where('flag', true).ids()).toEqual([id]);
  expect(e.query.ids(id).has('flag').ids()).toEqual([id]);
  expect(e.query.all().where('flag', false).ids()).toEqual([]);
});


it('omits undefined object properties and refuses undefined list positions', () => {
  const e = freshEngine({ types: ['Row'], relationKinds: [], roles: [] });
  const id = e.create('Row', { omitted: undefined, data: { omitted: undefined, kept: 1 }, list: [null, 1] }).id();
  expect(Object.hasOwn(e.getRow(id)!, 'omitted')).toBe(false);
  expect(e.getAttr(id, 'data')).toEqual({ kept: 1 });
  expect(e.getAttr(id, 'list')).toEqual([null, 1]);
  e.write(id).set('data', { omitted: undefined, kept: 2 });
  e.write(id).append('list', { omitted: undefined, kept: 3 });
  expect(e.getAttr(id, 'data')).toEqual({ kept: 2 });
  expect(e.getAttr(id, 'list')).toEqual([null, 1, { kept: 3 }]);
  expect(e.query('Row').where('list', null).ids()).toEqual([id]);
  expect(() => e.create('Row', { bad: [undefined] })).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
  expect(e.query('Row').count()).toBe(1);
});

it('keeps undeclared primary types when a declared type indexes the same field', () => {
  const e = freshEngine({ types: ['Row'], relationKinds: [], roles: [], rowRules: { Row: { required: [], indexes: ['flag'] } } });
  e.admin.putAttr('Uninstalled-held', 'flag', true);
  const declared = e.create('Row', { flag: true }).id();
  expect(e.query.all().where('flag', true).ids()).toEqual(['Uninstalled-held', declared]);
  expect(e.query.ids(['Uninstalled-held', declared]).where('flag', true).ids()).toEqual(['Uninstalled-held', declared]);
});
