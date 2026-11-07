import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generateSettingsTypes } from '../../src/build/settings-types.ts';

describe('settings type generation', () => {
  it('uses the requested name and preserves optionality, nullability, enums, records, arrays and local references', async () => {
    const definition = {
      defaults: { directory: null, order: 'visited', paths: {}, projects: [] },
      schema: {
        type: 'object', title: 'Display title', additionalProperties: false,
        required: ['directory', 'order', 'paths', 'projects'],
        properties: {
          optional: { type: 'string', default: 'Annotation only' }, directory: { type: ['string', 'null'] },
          order: { type: 'string', enum: ['created', 'visited'] },
          paths: { type: 'object', additionalProperties: { type: 'string' } },
          projects: { type: 'array', items: { $ref: '#/definitions/project' } },
        },
        definitions: { project: {
          type: 'object', additionalProperties: false, required: ['name', 'directories'],
          properties: { name: { type: 'string' }, directories: { type: 'array', items: { type: 'string' } } },
        } },
      },
    };
    const before = structuredClone(definition);
    const [types, alternate] = await Promise.all([
      generateSettingsTypes(definition, 'GeneratedSettings'),
      generateSettingsTypes(definition, 'AlternateSettings'),
    ]);
    expect(alternate).toContain('interface AlternateSettings');
    expect(alternate).not.toContain('interface GeneratedSettings');
    expect(definition).toEqual(before);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-settings-types-'));
    try {
      const file = path.join(dir, 'settings.ts');
      fs.writeFileSync(file, types + `
const valid: GeneratedSettings = ${JSON.stringify(definition.defaults)};
const optional: GeneratedSettings = {...valid, optional: 'yes', directory: '/tmp'};
const populated: GeneratedSettings = {...valid, projects: [{name:'Demo', directories:['/tmp']}], paths: {shell:'/bin/zsh'}};
// @ts-expect-error enum values stay precise
const badEnum: GeneratedSettings = {...valid, order:'unknown'};
// @ts-expect-error records keep their value type
const badRecord: GeneratedSettings = {...valid, paths:{shell:5}};
// @ts-expect-error referenced object fields remain required
const badProject: GeneratedSettings = {...valid, projects:[{name:'Demo'}]};
// @ts-expect-error required root fields remain required
const missing: GeneratedSettings = {};
// @ts-expect-error unknown fields stay unknown
const extra: GeneratedSettings = {...valid, extra:true};
`);
      const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022 });
      expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses invalid defaults before emitting a usable declaration', async () => {
    await expect(generateSettingsTypes({ defaults: {}, schema: {
      type: 'object', required: ['name'], properties: { name: { type: 'string' } },
    } }, 'Settings')).rejects.toThrow('Invalid settings defaults');
  });

  it('refuses local-file and network references without reading or fetching them', async () => {
    for (const ref of ['file:///tmp/settings.json', 'https://example.invalid/settings.json']) {
      await expect(generateSettingsTypes({ defaults: {}, schema: {
        type: 'object', definitions: { unused: { $ref: ref } },
      } }, 'Settings')).rejects.toThrow('document-local JSON Pointer');
    }
  });
});
