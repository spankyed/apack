import { describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { _nativePackDeclarationProblem } from '../../src/build/native-declarations.ts';
import { ManifestSchema, _NativePackDeclarationSchema } from '../../src/framework/declaration-schema.ts';
import { _parseEventContracts } from '../../src/framework/event-contracts.ts';
import type { NativePackDeclaration } from '../../src/framework/pack-catalog.ts';

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
      stdin: { contents: "export * from '../../src/framework/index.ts'", resolveDir: import.meta.dirname },
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some(input => /(?:^|\/)src\/framework\/index\.ts$/.test(input))).toBe(true);
    expect(inputs.some(input => /(?:^|\/)src\/framework\/event-contracts\.ts$/.test(input))).toBe(true);
    expect(inputs.some(input => /(?:^|\/)node_modules\/zod\//.test(input))).toBe(false);
    expect(inputs.some(input => /(?:^|\/)src\/build\//.test(input))).toBe(false);
    expect(inputs.some(input => /(?:^|\/)default-setup\//.test(input))).toBe(false);
  });

  it('validates event contracts in pure TypeScript without Zod', () => {
    const features = { shell: { system: {}, surface: {} } };
    const valid = { shell: { system: { incoming: ['START', 'QUERY'], outgoing: ['DONE'], asks: { QUERY: ['NOT_FOUND'] } }, surface: { receives: ['DONE'] } } };
    const parsed = _parseEventContracts(valid, features);
    expect(parsed).toStrictEqual(valid);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.shell.system!.asks)).toBe(Object.prototype);

    // Rejects duplicate event names, empty names, unknown fields, asks not in incoming, bad feature IDs, non-objects, and accessors
    expect(() => _parseEventContracts(null, features, true)).toThrow('Event contracts must be an object');
    expect(() => _parseEventContracts([], features, true)).toThrow('Event contracts must be an object');
    expect(() => _parseEventContracts({ shell: { system: { incoming: ['A', 'A'], outgoing: [] }, surface: { receives: [] } } }, features)).toThrow('unique');
    expect(() => _parseEventContracts({ shell: { system: { incoming: [''], outgoing: [] }, surface: { receives: [] } } }, features)).toThrow('nonempty');
    expect(() => _parseEventContracts({ shell: { system: { outgoing: [] }, surface: { receives: [] } } }, features)).toThrow('incoming');
    expect(() => _parseEventContracts({ shell: { system: { incoming: [] }, surface: { receives: [] } } }, features)).toThrow('outgoing');
    expect(() => _parseEventContracts({ shell: { system: { incoming: [], outgoing: [] }, surface: {} } }, features)).toThrow('receives');
    expect(() => _parseEventContracts({ shell: { extra: {} } }, features, true)).toThrow('unknown field');
    expect(() => _parseEventContracts({ shell: { surface: { receives: [], extra: 1 } } }, features, true)).toThrow('unknown field');
    expect(() => _parseEventContracts({ shell: { system: { incoming: ['A'], outgoing: [], extra: 1 }, surface: { receives: [] } } }, features)).toThrow('unknown field');
    expect(() => _parseEventContracts({ shell: { system: { incoming: ['A'], outgoing: [], asks: { '': [] } }, surface: { receives: [] } } }, features)).toThrow('empty ask name');
    expect(() => _parseEventContracts({ shell: { system: { incoming: ['A'], outgoing: [], asks: { MISSING: [] } }, surface: { receives: [] } } }, features)).toThrow('among the incoming');
    expect(() => _parseEventContracts(JSON.parse('{"shell":{"system":{"incoming":["A"],"outgoing":[],"asks":{"__proto__":[]}}}}'), features, true)).toThrow('among the incoming');
    const protoAsk = _parseEventContracts(JSON.parse('{"shell":{"system":{"incoming":["__proto__"],"outgoing":[],"asks":{"__proto__":["FAIL"]}}}}'), features, true);
    expect(Object.getPrototypeOf(protoAsk.shell.system!.asks)).toBe(Object.prototype);
    expect(Object.hasOwn(protoAsk.shell.system!.asks!, '__proto__')).toBe(true);
    expect(() => _parseEventContracts({ 'Bad-Id': { surface: { receives: [] } } }, features, true)).toThrow('Invalid event contract feature id');
    expect(() => _parseEventContracts(JSON.parse('{"__proto__": {"surface": {"receives": []}}}'), features, true)).toThrow('Invalid event contract feature id');
    expect(() => _parseEventContracts({ shell: { system: { incoming: [], outgoing: [] } } }, features, false)).toThrow('Missing compiled event contract');
    expect(() => _parseEventContracts({ shell: { surface: { receives: [] } } }, { shell: {} }, false)).toThrow('Undeclared event contract');
    const getter = vi.fn(() => ({ surface: { receives: [] } }));
    expect(() => _parseEventContracts(Object.defineProperty({}, 'shell', { get: getter, enumerable: true }), features, true)).toThrow('event contracts must contain finite, acyclic JSON data properties');
    expect(getter).not.toHaveBeenCalled();
  });
});
