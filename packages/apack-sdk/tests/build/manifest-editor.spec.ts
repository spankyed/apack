import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getLanguageService, TextDocument, type JSONSchema } from 'vscode-json-languageservice';

const schema: JSONSchema = JSON.parse(readFileSync(new URL('../../apack.schema.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const manifest = { id: 'editor-fixture', name: 'Editor fixture', version: '1.0.0' };

function editor(text: string) {
  const service = getLanguageService({
    schemaRequestService: async uri => {
      if (uri === 'http://json-schema.org/draft-07/schema') {
        return readFileSync(require.resolve('ajv/dist/refs/json-schema-draft-07.json'), 'utf8');
      }
      throw new Error(`Unexpected external schema request: ${uri}`);
    },
  });
  service.configure({ schemas: [{ uri: 'https://apack.dev/schemas/apack.json', fileMatch: ['apack.json'], schema }] });
  const document = TextDocument.create('file:///fixture/apack.json', 'json', 1, text);
  return { service, document, parsed: service.parseJSONDocument(document) };
}

async function complete(text: string) {
  const offset = text.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const { service, document, parsed } = editor(text.replace('|', ''));
  const result = await service.doComplete(document, document.positionAt(offset), parsed);
  return result!.items;
}

describe('shipped manifest schema in a JSON editor', () => {
  it('describes every declared field, including nested and union component forms', () => {
    const missing: string[] = [];
    const visit = (node: JSONSchema | boolean, path: string[]) => {
      if (typeof node === 'boolean') return;
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        if (typeof child !== 'boolean' && !child.description?.trim()) missing.push([...path, name].join('.'));
        visit(child, [...path, name]);
      }
      if (typeof node.additionalProperties === 'object') visit(node.additionalProperties, [...path, '*']);
      for (const child of Array.isArray(node.items) ? node.items : node.items ? [node.items] : []) visit(child, [...path, '*']);
      for (const child of [...node.anyOf ?? [], ...node.oneOf ?? [], ...node.allOf ?? []]) visit(child, path);
    };
    visit(schema, []);
    expect(missing).toEqual([]);
    expect(Object.keys(schema.properties!)).toContain('features');
  });

  it('offers root and feature declarations with useful field documentation', async () => {
    const root = await complete('{ | }');
    expect(root.map(item => item.label)).toEqual(expect.arrayContaining(['features', 'data', 'lifecycle', 'checks']));
    const feature = await complete('{ "features": { "memos": { | } } }');
    expect(feature.map(item => item.label)).toEqual(expect.arrayContaining(['description', 'entities', 'settings', 'types', 'surface']));
    expect(feature.find(item => item.label === 'entities')!.documentation).toContain('untyped');
  });

  it('offers static build and trigger data alongside explicit callable references', async () => {
    const build = await complete('{ "extensions": { "steps": { "memo": { "build": { | } } } } }');
    expect(build.map(item => item.label)).toEqual(expect.arrayContaining(['compile', 'validate', 'getLabel', 'decompile', 'branches', 'relation']));
    const trigger = await complete('{ "extensions": { "steps": { "pulse": { "kind": "trigger", "trigger": { | } } } } }');
    expect(trigger.map(item => item.label)).toEqual(expect.arrayContaining(['trackField', 'persistent', 'queryFields', 'compile', 'decompile', 'validate', 'register']));
    expect(trigger.find(item => item.label === 'trackField')!.documentation).toContain('generated flow helper');
  });

  it('completes policy values and component loading modes', async () => {
    const policy = await complete('{ "features": { "memos": { "settings": { "access": | } } } }');
    expect(policy.map(item => item.label)).toEqual(expect.arrayContaining(['"shared"', '"owner"']));
    const loading = await complete('{ "features": { "memos": { "surface": { "panel": { "load": | } } } } }');
    expect(loading.map(item => item.label)).toContain('"eager"');
  });

  it('shows behavior-specific hover help for component loading', async () => {
    const text = '{ "features": { "memos": { "surface": { "panel": { "entry": "src/panel.vue", "load": "eager" } } } } }';
    const { service, document, parsed } = editor(text);
    const hover = await service.doHover(document, document.positionAt(text.indexOf('"load"') + 2), parsed);
    expect(JSON.stringify(hover?.contents)).toContain('Import the component eagerly');
  });

  it('accepts typed and untyped entity declarations without reading their source modules', async () => {
    const { service, document, parsed } = editor(JSON.stringify({ ...manifest, features: {
      memos: { description: 'Manage memos.', entities: { Memo: { shape: 'src/missing-types.ts#Memo' }, Index: {} } },
    } }));
    expect(await service.doValidation(document, parsed)).toEqual([]);
  });

  it.each([
    [{ version: '1.0.0garbage' }, '1.0.0garbage'],
    [{ features: { memos: { description: ' ' } } }, ' '],
    [{ features: { memos: { description: 'Manage memos.', entities: { Memo: 'src/types.ts' } } } }, 'src/types.ts'],
    [{ dependencies: { '../invalid': '*' } }, '../invalid'],
    [{ checks: { allow: ['unknown-check'] } }, 'unknown-check'],
  ])('flags a malformed current-contract value at its actual editor range: %s', async (fields, badValue) => {
    const { service, document, parsed } = editor(JSON.stringify({ ...manifest, ...fields }));
    const diagnostics = await service.doValidation(document, parsed);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some(issue => document.getText(issue.range).includes(badValue))).toBe(true);
  });
});
