import { describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/build/validate.ts';

const settings = { schema: { type: 'object', additionalProperties: false,
  properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'],
}, defaults: { count: 10 } };
const manifest = (declaration: unknown) => ({ id: 'memos', name: 'Memos', version: '1.0.0',
  features: { memos: { description: 'Feature declaration fixture.', settings: declaration } },
});

describe('declarative feature settings', () => {
  it('validates data without deriving defaults or transforming authored values', () => {
    const raw = manifest(settings);
    const before = structuredClone(raw);
    expect(parseManifest(raw).status).toBe('valid');
    expect(raw).toEqual(before);
  });

  it.each([
    'src/settings.ts', { visible: false }, { defaults: {} },
    { ...settings, schema: { type: 'string' } },
    { ...settings, surfaces: {} },
  ])('refuses structurally invalid declarations: %j', declaration => {
    const result = parseManifest(manifest(declaration));
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(issue => issue.path.slice(0, 3).join('.') === 'features.memos.settings')).toBe(true);
  });

  it('allows navigation visibility without inventing a settings definition', () => {
    expect(parseManifest({ id: 'memos', name: 'Memos', version: '1.0.0',
      features: { memos: { description: 'Feature declaration fixture.', surface: { label: 'Fixture', state: 'src/surface.ts', defaultVisible: false } } },
    }).status).toBe('valid');
  });
});
