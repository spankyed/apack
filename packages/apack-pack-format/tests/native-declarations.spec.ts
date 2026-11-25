import { describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { _nativePackDeclarationProblem } from '../src/native-declarations.ts';
import { ManifestSchema, _EventContractsSchema, _NativePackDeclarationSchema, type _Exact, type _ExactReadonly } from '../src/declaration-schema.ts';
import { _parseEventContracts } from '@apackdev/sdk/framework';
import type { NativePackDeclaration } from '@apackdev/sdk/framework';

// Compile-time negative assertions proving `_Exact` and `_ExactReadonly` reject drift rather than silently passing.
type AssertTrue<T extends true> = T;
type _PositiveExact = [
  AssertTrue<_Exact<{ a: string; nested?: { x: number; items: readonly string[] } }, { a: string; nested?: { x: number; items: readonly string[] } }>>,
  AssertTrue<_ExactReadonly<{ a: string; items: string[] }, { readonly a: string; readonly items: readonly string[] }>>,
];
// Extra optional field on schema (top-level)
// @ts-expect-error extra optional field on schema must fail _Exact
type _FailSchemaExtraOptional = AssertTrue<_Exact<{ a: string; extra?: number }, { a: string }>>;
// Extra optional field on plain interface (one level nested)
// @ts-expect-error nested extra optional field on plain interface must fail _Exact
type _FailNestedPlainExtraOptional = AssertTrue<_Exact<{ nested?: { a: string } }, { nested?: { a: string; extra?: number } }>>;
// Extra optional field inside record / array / union
// @ts-expect-error extra optional field inside record value must fail _Exact
type _FailRecordExtraOptional = AssertTrue<_Exact<Record<string, { a: string; extra?: number }>, Record<string, { a: string }>>>;
// @ts-expect-error extra optional field inside array element must fail _Exact
type _FailArrayExtraOptional = AssertTrue<_Exact<Array<{ a: string }>, Array<{ a: string; extra?: number }>>>;
// @ts-expect-error extra optional field inside union branch must fail _Exact
type _FailUnionExtraOptional = AssertTrue<_Exact<string | { a: string; extra?: number }, string | { a: string }>>;
// Missing required field & widened property type
// @ts-expect-error missing required field must fail _Exact
type _FailMissingRequired = AssertTrue<_Exact<{ a: string }, { a: string; b: number }>>;
// @ts-expect-error widened property type must fail _Exact
type _FailWidenedProperty = AssertTrue<_Exact<{ a: string }, { a: string | number }>>;
// Readonly mismatch
// @ts-expect-error readonly mismatch must fail _Exact
type _FailReadonlyMismatch = AssertTrue<_Exact<{ a: string }, { readonly a: string }>>;
// Extra optional field nested inside _ExactReadonly still fails
// @ts-expect-error nested extra optional field must fail _ExactReadonly
type _FailReadonlyNestedExtraOptional = AssertTrue<_ExactReadonly<{ nested?: { a: string } }, { readonly nested?: { readonly a: string; readonly extra?: number } }>>;
// Dropping readonly declared by schema on object property, record index signature, or nested object must fail _ExactReadonly
// @ts-expect-error dropping readonly on object property must fail _ExactReadonly
type _FailReadonlyDroppedProp = AssertTrue<_ExactReadonly<{ readonly a: string }, { a: string }>>;
// @ts-expect-error dropping readonly on record index signature must fail _ExactReadonly
type _FailReadonlyDroppedRecord = AssertTrue<_ExactReadonly<{ readonly [k: string]: string }, { [k: string]: string }>>;
// @ts-expect-error dropping readonly on nested optional object property must fail _ExactReadonly
type _FailReadonlyDroppedNested = AssertTrue<_ExactReadonly<{ nested?: { readonly a: string } }, { readonly nested?: { a: string } }>>;
// `any` on either side fails
// @ts-expect-error any must fail _Exact
type _FailAny = AssertTrue<_Exact<any, { a: string }>>;
void (0 as unknown as [
  _PositiveExact, _FailSchemaExtraOptional, _FailNestedPlainExtraOptional, _FailRecordExtraOptional,
  _FailArrayExtraOptional, _FailUnionExtraOptional, _FailMissingRequired, _FailWidenedProperty,
  _FailReadonlyMismatch, _FailReadonlyNestedExtraOptional,
  _FailReadonlyDroppedProp, _FailReadonlyDroppedRecord, _FailReadonlyDroppedNested, _FailAny,
]);

const declaration = {
  id: 'native',
  features: { view: { description: 'Show native items.', designation: 'items' } },
  artifacts: { document: { icon: 'File', fe: 'native/document.vue' } },
  blocks: { answer: { kind: 'input', fe: 'native/answer.vue', be: 'native/block.ts#Answer' } },
  dslDefinitions: { items: 'export interface Item {}' },
  dsl: { items: { entry: 'native/items.ts', targets: ['monaco'], prefix: 'items', globals: { item: 'Item' } } },
} satisfies NativePackDeclaration;

describe('native declaration admission', () => {
  it('shares authored contribution grammar without requiring declared modules', () => {
    const { id, features, dslDefinitions, ...extensions } = declaration;
    const authored = ManifestSchema.parse({ id, name: 'Native', version: '1.0.0', features, extensions });
    expect(_NativePackDeclarationSchema.parse(declaration)).toEqual({ id, features: authored.features, ...authored.extensions, dslDefinitions });
    expect(_nativePackDeclarationProblem(declaration)).toBeUndefined();
    for (const contributions of [
      { artifacts: { document: { icon: 'invalid-icon' } } },
      { blocks: { answer: { kind: 'unknown' } } },
      { dsl: { items: { entry: 'native/types.ts#Export', targets: ['monaco'] } } },
    ]) {
      expect(_nativePackDeclarationProblem({ id, ...contributions })).toBeTypeOf('string');
      expect(ManifestSchema.safeParse({ id, name: 'Native', version: '1.0.0', extensions: contributions }).success).toBe(false);
    }
  });

  it('requires compiled native text editor data and rejects definitions without a declared target', () => {
    const { dslDefinitions, ...missing } = declaration;
    expect(_nativePackDeclarationProblem(missing)).toContain('Missing compiled Monaco');
    expect(_nativePackDeclarationProblem({ ...declaration, dslDefinitions: { ...dslDefinitions, foreign: '' } })).toContain('undeclared DSL "foreign"');
    expect(_nativePackDeclarationProblem({ id: 'native', dslDefinitions: {} })).toContain('no declared Monaco');
  });

  it('refuses impure declarations before reading accessors or normalizing prototypes', () => {
    const getter = vi.fn(() => 'native');
    expect(_nativePackDeclarationProblem(Object.defineProperty({}, 'id', { get: getter, enumerable: true })))
      .toContain('JSON data properties');
    expect(getter).not.toHaveBeenCalled();
    class Definition { id = 'native'; }
    expect(_nativePackDeclarationProblem(new Definition())).toContain('JSON data properties');
  });

  it('bundles @apackdev/sdk/framework for the browser without zod, build tooling, or pack modules', async () => {
    const result = await build({
      stdin: { contents: "export * from '../../apack-sdk/src/framework/index.ts'", resolveDir: import.meta.dirname },
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some(input => /(?:^|\/)src\/framework\/index\.ts$/.test(input))).toBe(true);
    expect(inputs.some(input => /(?:^|\/)src\/framework\/event-contracts\.ts$/.test(input))).toBe(true);
    expect(inputs.some(input => /(?:^|\/)node_modules\/zod\//.test(input))).toBe(false);
    expect(inputs.some(input => /(?:^|\/)src\/build\//.test(input))).toBe(false);
    expect(inputs.some(input => /(?:^|\/)default-setup\//.test(input))).toBe(false);
  });

  it('validates event contracts identically across _parseEventContracts and _EventContractsSchema', () => {
    const features = { shell: { system: {}, surface: {} } };
    const validCases: Array<{ name: string; input: unknown; native: boolean }> = [
      {
        name: 'full system, asks, and surface contract',
        input: { shell: { system: { incoming: ['START', 'QUERY'], outgoing: ['DONE'], asks: { QUERY: ['NOT_FOUND'] } }, surface: { receives: ['DONE'] } } },
        native: false,
      },
      {
        name: 'own __proto__ ask preserved with Object.prototype',
        input: JSON.parse('{"shell":{"system":{"incoming":["__proto__"],"outgoing":[],"asks":{"__proto__":["FAIL"]}}}}'),
        native: true,
      },
    ];
    for (const { input, native } of validCases) {
      const parsed = _parseEventContracts(input, features, native);
      const viaSchema = _EventContractsSchema.safeParse(input);
      expect(viaSchema.success).toBe(true);
      expect(viaSchema.data).toStrictEqual(parsed);
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(viaSchema.data)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(parsed.shell.system!.asks)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(viaSchema.data!.shell.system!.asks)).toBe(Object.prototype);
    }
    const protoAsk = _EventContractsSchema.parse(validCases[1].input);
    expect(Object.hasOwn(protoAsk.shell.system!.asks!, '__proto__')).toBe(true);

    // Shared invalid conformance table: both _parseEventContracts and _EventContractsSchema must reject every case
    const getter = vi.fn(() => ({ surface: { receives: [] } }));
    const invalidShapeCases: Array<{ name: string; input: unknown; match: string }> = [
      { name: 'null', input: null, match: 'Event contracts must be an object' },
      { name: 'array', input: [], match: 'Event contracts must be an object' },
      { name: 'duplicate event names', input: { shell: { system: { incoming: ['A', 'A'], outgoing: [] }, surface: { receives: [] } } }, match: 'unique' },
      { name: 'empty event name', input: { shell: { system: { incoming: [''], outgoing: [] }, surface: { receives: [] } } }, match: 'nonempty' },
      { name: 'missing incoming', input: { shell: { system: { outgoing: [] }, surface: { receives: [] } } }, match: 'incoming' },
      { name: 'missing outgoing', input: { shell: { system: { incoming: [] }, surface: { receives: [] } } }, match: 'outgoing' },
      { name: 'missing receives', input: { shell: { system: { incoming: [], outgoing: [] }, surface: {} } }, match: 'receives' },
      { name: 'unknown top-level feature key', input: { shell: { extra: {} } }, match: 'unknown field' },
      { name: 'unknown surface key', input: { shell: { surface: { receives: [], extra: 1 } } }, match: 'unknown field' },
      { name: 'unknown system key', input: { shell: { system: { incoming: ['A'], outgoing: [], extra: 1 }, surface: { receives: [] } } }, match: 'unknown field' },
      { name: 'empty ask name', input: { shell: { system: { incoming: ['A'], outgoing: [], asks: { '': [] } }, surface: { receives: [] } } }, match: 'empty ask name' },
      { name: 'ask not in incoming', input: { shell: { system: { incoming: ['A'], outgoing: [], asks: { MISSING: [] } }, surface: { receives: [] } } }, match: 'among the incoming' },
      { name: 'own __proto__ ask not in incoming', input: JSON.parse('{"shell":{"system":{"incoming":["A"],"outgoing":[],"asks":{"__proto__":[]}}}}'), match: 'among the incoming' },
      { name: 'bad feature id', input: { 'Bad-Id': { surface: { receives: [] } } }, match: 'Invalid event contract feature id' },
      { name: 'own __proto__ feature id', input: JSON.parse('{"__proto__": {"surface": {"receives": []}}}'), match: 'Invalid event contract feature id' },
      { name: 'accessor property', input: Object.defineProperty({}, 'shell', { get: getter, enumerable: true }), match: 'event contracts must contain finite, acyclic JSON data properties' },
    ];
    for (const { input, match } of invalidShapeCases) {
      expect(() => _parseEventContracts(input, features, true)).toThrow(match);
      const viaSchema = _EventContractsSchema.safeParse(input);
      expect(viaSchema.success).toBe(false);
      expect(viaSchema.error!.issues[0].message).toContain(match);
    }
    expect(getter).not.toHaveBeenCalled();

    // Ownership checks (only enforced when paired with features)
    expect(() => _parseEventContracts({ shell: { system: { incoming: [], outgoing: [] } } }, features, false)).toThrow('Missing compiled event contract');
    expect(() => _parseEventContracts({ shell: { surface: { receives: [] } } }, { shell: {} }, false)).toThrow('Undeclared event contract');
  });
});
