import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { declarationRecord, declarationRecordGrammar } from '../../src/framework/declaration-record.ts';

const own = <T>(value: T) => Object.fromEntries([['__proto__', value]]);
// A union's alternatives report paths relative to the union, so a leaf's full path is the union's and its own
const leaves = (issues: z.core.$ZodIssue[], at: PropertyKey[] = []): z.core.$ZodIssue[] => issues.flatMap(issue =>
  issue.code === 'invalid_union' && issue.errors.length > 0
    ? issue.errors.flatMap(alternative => leaves(alternative, [...at, ...issue.path]))
    : [{ ...issue, path: [...at, ...issue.path] }]);

describe('declaration dictionary decoding', () => {
  it('preserves own keys, parses values once and retains record input/output types', () => {
    let reads = 0;
    const schema = declarationRecord(z.string(), z.string().transform(value => { reads++; return Number(value); }));
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Record<string, number>>();
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<Record<string, string>>();
    const result = schema.parse({ ...own('1'), constructor: '2', toString: '3' });
    expect(Object.entries(result)).toEqual([['__proto__', 1], ['constructor', 2], ['toString', 3]]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(reads).toBe(3);
  });

  it('retains enum key optionality and validates keys before emitting entries', () => {
    const schema = declarationRecord(z.enum(['first', 'second']), z.literal(true));
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Partial<Record<'first' | 'second', true>>>();
    expect(schema.parse({ first: true })).toEqual({ first: true });
    expect(schema.safeParse(own(true)).success).toBe(false);
  });

  it.each([null, [], 1, 'data', new Date(), new Map()])('refuses non-dictionaries: %s', input => {
    expect(declarationRecord(z.string()).safeParse(input).success).toBe(false);
  });

  it('keeps nested union diagnostic paths identical to record grammar paths', () => {
    const value = z.object({ value: z.union([z.string(), z.number()]) });
    // An ordinary key, since a record drops an own __proto__ key without a word
    const input = { groups: { group: { value: true } } };
    const ordinary = z.object({ groups: z.record(z.string(), value) }).safeParse(input);
    const owned = z.object({ groups: declarationRecord(value) }).safeParse(input);
    if (ordinary.success || owned.success) throw new Error('Invalid union accepted');
    expect(leaves(owned.error.issues).map(issue => issue.path)).toEqual(leaves(ordinary.error.issues).map(issue => issue.path));
    const proto = z.object({ groups: declarationRecord(value) }).safeParse({ groups: own({ value: true }) });
    if (proto.success) throw new Error('Invalid union under __proto__ accepted');
    expect(leaves(proto.error.issues).map(issue => issue.path.join('.'))).toEqual(['groups.__proto__.value', 'groups.__proto__.value']);
  });

  it('retains nested dictionary paths in union errors', () => {
    const record = declarationRecord(z.union([z.string(), z.object({ nested: declarationRecord(z.number()) })]));
    const result = z.object({ groups: record }).safeParse({ groups: own({ nested: own(false) }) });
    if (result.success) throw new Error('Invalid nested value accepted');
    expect(leaves(result.error.issues).map(issue => issue.path)).toEqual([
      ['groups', '__proto__'], ['groups', '__proto__', 'nested', '__proto__'],
    ]);
  });

  it('renders the same JSON Schema grammar through description and optional wrappers', () => {
    const key = z.string().regex(/^[a-z]+$/);
    const value = z.object({ count: z.number().int() });
    const ordinary = z.object({ groups: z.record(key, value).describe('Declared groups.').optional() });
    const owned = z.object({ groups: declarationRecord(key, value).describe('Declared groups.').optional() });
    const options: Parameters<typeof z.toJSONSchema>[1] = { io: 'input', unrepresentable: 'any', override({ zodSchema, jsonSchema }) {
      const grammar = declarationRecordGrammar(zodSchema);
      if (!grammar) return;
      const { $schema: _, ...rendered } = z.toJSONSchema(grammar, options);
      Object.assign(jsonSchema, rendered);
    } };
    expect(z.toJSONSchema(owned, options)).toEqual(z.toJSONSchema(ordinary, { io: 'input' }));
  });
});
