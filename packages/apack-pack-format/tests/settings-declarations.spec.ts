import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/parse-manifest.ts';
import { parseSnapshot } from '../src/snapshot.ts';
import { _declarationRevision } from '../src/declaration-revision.ts';
import { PACK_SNAPSHOT_FORMAT } from '../src/manifest.ts';

const definition = {
  schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
  defaults: { name: '' },
};
const manifest = <T>(settings: T) => ({ id: 'settings-pack', name: 'Settings', version: '1.0.0', extensions: { settings } });

describe('declarative pack settings', () => {
  it('accepts JSON definitions with presentation and access metadata', () => {
    expect(parseManifest(manifest({ assistant: { ...definition, title: 'Assistant', description: 'Display name', access: 'owner' } })).status).toBe('valid');
  });

  it.each([
    'src/defaults.ts#defaults',
    { defaults: {} },
    { schema: { type: 'object' } },
    { ...definition, schema: null },
    { ...definition, defaults: null },
    { ...definition, unexpected: true },
    { ...definition, access: 'private' },
    { ...definition, schema: { type: 'string' } },
    { ...definition, schema: { type: 'object', properties: { name: { $ref: 'https://example.test/value.json' } } } },
    { ...definition, schema: { type: 'object', $async: true } },
    { ...definition, schema: { type: 'object', definitions: { nested: { $id: 'https://example.test/nested' } } } },
  ])('refuses structurally invalid definitions without executing or normalizing them: %j', declaration => {
    const before = structuredClone(declaration);
    const result = parseManifest(manifest({ assistant: declaration }));
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(issue => issue.path.slice(0, 3).join('.') === 'extensions.settings.assistant')).toBe(true);
    expect(declaration).toEqual(before);
  });

  it.each(['other/assistant', '../assistant', '', '__proto__'])('rejects a group claiming a nonlocal ID: %j', group => {
    expect(parseManifest(manifest({ [group]: definition })).status).toBe('invalid');
  });

  it('preserves own prototype-like value names through snapshot validation', () => {
    const defaults = JSON.parse('{"__proto__":"value","constructor":"name"}');
    const data = manifest({ assistant: {
      schema: { type: 'object', additionalProperties: { type: 'string' } },
      defaults,
    } });
    const snapshot = { format: PACK_SNAPSHOT_FORMAT, manifest: data, declarationRevision: _declarationRevision(data), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} };
    const result = parseSnapshot(snapshot);
    expect(result.status).toBe('valid');
    expect(Object.keys(result.snapshot!.manifest.extensions!.settings!.assistant.defaults)).toEqual(['__proto__', 'constructor']);
  });
});
