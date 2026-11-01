import { describe, expect, it } from 'vitest';
import { formatManifest } from '../src/manifest-writer.ts';
import type { PackManifest } from '@apackdev/sdk/build';

describe('manifest formatting', () => {
  it('canonicalizes structural fields without changing contribution or data order', () => {
    const manifest: PackManifest = {
      checks: { allow: ['backend-console', 'untyped-sends'] },
      extensions: { services: { zeta: 'z.ts#service', alpha: 'a.ts#service' } },
      features: {
        zeta: { types: 'z.ts', settings: { defaults: { zeta: 1, alpha: 2 }, schema: { properties: { zeta: {}, alpha: {} } } }, description: 'Zeta purpose.' },
        alpha: { description: 'Alpha purpose.' },
      },
      dependencies: { zeta: '*', alpha: '*' },
      data: { entities: { Zeta: {}, Alpha: {} }, relations: { zeta: {}, alpha: { key: ['page'] } } },
      version: '1.0.0', name: 'Fixture', id: 'fixture',
    };
    const before = structuredClone(manifest);
    const text = formatManifest(manifest);
    const formatted = JSON.parse(text);
    expect(Object.keys(formatted)).toEqual(['id', 'name', 'version', 'dependencies', 'data', 'features', 'extensions', 'checks']);
    expect(Object.keys(formatted.features.zeta)).toEqual(['description', 'settings', 'types']);
    expect(Object.keys(formatted.extensions)).toEqual(['services']);
    expect(Object.keys(formatted.features)).toEqual(['zeta', 'alpha']);
    expect(Object.keys(formatted.extensions.services)).toEqual(['zeta', 'alpha']);
    expect(Object.keys(formatted.features.zeta.settings.defaults)).toEqual(['zeta', 'alpha']);
    expect(Object.keys(formatted.features.zeta.settings.schema.properties)).toEqual(['zeta', 'alpha']);
    expect(Object.keys(formatted.data.entities)).toEqual(['Zeta', 'Alpha']);
    expect(Object.keys(formatted.dependencies)).toEqual(['zeta', 'alpha']);
    expect(Object.keys(formatted.data.relations)).toEqual(['zeta', 'alpha']);
    expect(formatted.checks.allow).toEqual(['backend-console', 'untyped-sends']);
    expect(formatted).toEqual(before);
    expect(manifest).toEqual(before);
    expect(formatManifest(formatted)).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
  });
});
