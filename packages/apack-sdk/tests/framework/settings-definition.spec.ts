import { describe, expect, it } from 'vitest';
import type { SettingsDefinition } from '../../src/framework/settings-definition.ts';
import { _compileSettingsDefinition } from '../../src/framework/settings-validation.ts';

const definition: SettingsDefinition = {
  defaults: { directory: null, order: 'visited', limit: 25, paths: { shell: '/bin/zsh' }, projects: [] },
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      optional: { type: 'string', default: 'Annotation only' },
      directory: { type: ['string', 'null'] },
      order: { type: 'string', enum: ['created', 'visited', 'message'] },
      limit: { type: 'integer', minimum: 0, maximum: 25 },
      paths: { type: 'object', additionalProperties: { type: 'string' } },
      projects: { type: 'array', items: { $ref: '#/definitions/project' } },
    },
    required: ['directory', 'order', 'limit', 'paths', 'projects'],
    definitions: { project: {
      type: 'object', additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1 }, directories: { type: 'array', items: { type: 'string', minLength: 1 } } },
      required: ['name', 'directories'],
    } },
  },
};

describe('settings data contract', () => {
  it('validates explicit defaults without populating annotations or modifying declarations', () => {
    const before = structuredClone(definition);
    const validator = _compileSettingsDefinition(definition);
    expect(validator.validate(definition.defaults)).toEqual([]);
    expect(definition).toEqual(before);
    expect(definition.defaults).not.toHaveProperty('optional');
  });

  it.each([
    { limit: -1 }, { limit: 1.5 }, { limit: '5' }, { order: 'other' },
    { extra: true }, { paths: { shell: 5 } }, { projects: [{ name: '', directories: ['/tmp'] }] },
  ])('refuses invalid values without coercing or deleting them: %j', patch => {
    const value = { ...definition.defaults, ...patch };
    const before = structuredClone(value);
    expect(_compileSettingsDefinition(definition).validate(value).length).toBeGreaterThan(0);
    expect(value).toEqual(before);
  });

  it('reports required, unexpected and JSON Pointer escaped keys at their exact paths', () => {
    const validator = _compileSettingsDefinition({
      defaults: { 'a/b~c': { value: '' } }, schema: {
        type: 'object', additionalProperties: false, required: ['a/b~c'],
        properties: { 'a/b~c': { type: 'object', required: ['value'], properties: { value: { type: 'string' } } } },
      },
    });
    expect(validator.validate({})).toContainEqual(expect.objectContaining({ path: ['a/b~c'], keyword: 'required' }));
    expect(validator.validate({ 'a/b~c': { value: 1 }, extra: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['a/b~c', 'value'], keyword: 'type' }),
      expect.objectContaining({ path: ['extra'], keyword: 'additionalProperties' }),
    ]));
  });

  it('rejects incomplete defaults and schemas that cannot describe a settings object', () => {
    expect(() => _compileSettingsDefinition({ ...definition, defaults: {} })).toThrow('Invalid settings defaults');
    expect(() => _compileSettingsDefinition({ schema: {}, defaults: {} })).toThrow('object at its root');
    expect(_compileSettingsDefinition(definition).validate(null)).toContainEqual(expect.objectContaining({ keyword: 'type', path: [] }));
  });

  it.each(['https://example.invalid/schema.json', 'file:///tmp/schema.json', './schema.json', '#anchor'])('refuses unsupported references even in unused definitions: %s', ref => {
    expect(() => _compileSettingsDefinition({ defaults: {}, schema: { type: 'object', definitions: { unused: { $ref: ref } } } }))
      .toThrow('document-local JSON Pointer');
  });

  it('refuses unresolved local references, nested bases and custom keywords', () => {
    expect(() => _compileSettingsDefinition({ defaults: {}, schema: { type: 'object', properties: { x: { $ref: '#/definitions/missing' } } } })).toThrow();
    expect(() => _compileSettingsDefinition({ defaults: {}, schema: { type: 'object', definitions: { x: { $id: 'https://example.invalid/' } } } })).toThrow('Nested');
    expect(() => _compileSettingsDefinition({ defaults: {}, schema: { type: 'object', customValidation: true } })).toThrow('unknown keyword');
  });

  it('keeps annotation data and property names separate from schema references', () => {
    expect(() => _compileSettingsDefinition({ defaults: { $id: '', $ref: '' }, schema: {
      type: 'object', properties: { $id: { type: 'string' }, $ref: { type: 'string' } },
      default: { $id: 'data', $ref: 'https://example.invalid/data' },
    } })).not.toThrow();
  });

  it('keeps schema identifiers isolated between owners', () => {
    const schema = { type: 'object', $id: 'https://apack.dev/settings', properties: { name: { type: 'string' } } };
    expect(_compileSettingsDefinition({ schema, defaults: { name: 'A' } }).validate({ name: 'B' })).toEqual([]);
    expect(_compileSettingsDefinition({ schema, defaults: { name: 'C' } }).validate({ name: 'D' })).toEqual([]);
  });

  it('keeps different local references isolated when owners reuse a schema identifier', () => {
    const schemaFor = (type: string) => ({
      type: 'object', $id: 'https://apack.dev/reused-settings',
      properties: { value: { $ref: '#/definitions/value' } }, definitions: { value: { type } },
    });
    const text = _compileSettingsDefinition({ schema: schemaFor('string'), defaults: { value: 'text' } });
    const number = _compileSettingsDefinition({ schema: schemaFor('number'), defaults: { value: 1 } });
    expect(text.validate({ value: 'text' })).toEqual([]);
    expect(text.validate({ value: 1 }).length).toBeGreaterThan(0);
    expect(number.validate({ value: 1 })).toEqual([]);
    expect(number.validate({ value: 'text' }).length).toBeGreaterThan(0);
  });

  it('rechecks schema metadata after a previously accepted definition changes', () => {
    const changing: SettingsDefinition = { schema: { type: 'object', title: 'Valid title' }, defaults: {} };
    const accepted = _compileSettingsDefinition(changing);
    changing.schema.title = 17;
    expect(() => _compileSettingsDefinition(changing)).toThrow('schema is invalid');
    expect(accepted.validate({})).toEqual([]);
  });

  it('rejects asynchronous schemas instead of mistaking a promise for valid defaults', () => {
    expect(() => _compileSettingsDefinition({ defaults: {}, schema: { type: 'object', $async: true } })).toThrow('$async is unsupported');
  });

  it.each([undefined, NaN, Infinity, new Date(), () => {}, 1n])('refuses non-JSON values even with an unconstrained property: %s', value => {
    const validator = _compileSettingsDefinition({ schema: { type: 'object' }, defaults: {} });
    expect(validator.validate({ value })).toContainEqual(expect.objectContaining({ path: ['value'], keyword: 'json' }));
  });

  it('refuses cycles and array holes, while repeated values remain valid JSON', () => {
    const validator = _compileSettingsDefinition({ schema: { type: 'object' }, defaults: {} });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(validator.validate(cycle)).toContainEqual(expect.objectContaining({ path: ['self'], keyword: 'json' }));
    const holes: unknown[] = [];
    holes.length = 1;
    expect(validator.validate({ holes })).toContainEqual(expect.objectContaining({ path: ['holes', '0'], keyword: 'json' }));
    const repeated = { value: 'valid' };
    expect(validator.validate({ a: repeated, b: repeated })).toEqual([]);
  });

  it('refuses properties JSON would drop and accessors without invoking them', () => {
    const validator = _compileSettingsDefinition({ schema: { type: 'object' }, defaults: {} });
    const extra = Object.assign([], { extra: 'dropped by JSON' });
    expect(validator.validate({ extra })).toContainEqual(expect.objectContaining({ path: ['extra', 'extra'], keyword: 'json' }));
    expect(validator.validate({ [Symbol('hidden')]: true })).toContainEqual(expect.objectContaining({ keyword: 'json' }));
    const hidden = Object.defineProperty({}, 'hidden', { value: 'dropped by JSON' });
    expect(validator.validate(hidden)).toContainEqual(expect.objectContaining({ path: ['hidden'], keyword: 'json' }));
    const accessor = Object.defineProperty({}, 'name', { enumerable: true, get() { throw new Error('Must not execute'); } });
    expect(validator.validate(accessor)).toContainEqual(expect.objectContaining({ path: ['name'], keyword: 'json' }));
  });
});


it.each([{ ...definition, visible: false }, { ...definition, access: 'private' }, { ...definition, title: 3 }])('refuses invalid definition metadata in native registrations too: %j', invalid => {
  expect(() => _compileSettingsDefinition(invalid as SettingsDefinition)).toThrow();
});


it('owns the compiled schema even when validation retains a large enum by reference', () => {
  const values = Array.from({ length: 201 }, (_, i) => `value${i}`);
  const validator = _compileSettingsDefinition({ schema: {
    type: 'object', properties: { mode: { type: 'string', enum: values } }, required: ['mode'],
  }, defaults: { mode: 'value0' } });
  values[0] = 'changed';
  expect(validator.validate({ mode: 'value0' })).toEqual([]);
  expect(validator.validate({ mode: 'changed' }).length).toBeGreaterThan(0);
});
