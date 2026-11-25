import { describe, expect, it, vi } from 'vitest';
import { ManifestSchema, _NativePackDeclarationSchema } from '../src/declaration-schema.ts';
import { _BASELINE_HOST_SERVICE_NAMES, _packServiceDeclarations } from '@apackdev/sdk/framework';
import { _packServiceSelection } from '../src/service-selection.ts';

const consumer = { id: 'consumer', name: 'Consumer', version: '1.0.0' };
const provider = { id: 'provider', features: { search: { services: { SearchAPI: 'missing.ts#search' } } } };

describe('consumed service declarations', () => {
  it('uses the same qualified grammar and membership check for authored and native packs', () => {
    const declaration = { ...consumer, dependencies: { provider: '*' }, consumes: { services: ['host/onboarding', 'provider/SearchAPI'] } };
    expect(ManifestSchema.parse(declaration).consumes).toEqual(declaration.consumes);
    expect(_NativePackDeclarationSchema.parse({ id: declaration.id, dependencies: declaration.dependencies, consumes: declaration.consumes }).consumes).toEqual(declaration.consumes);
    const missing = { ...declaration, dependencies: {} };
    for (const schema of [ManifestSchema, _NativePackDeclarationSchema]) {
      const result = schema.safeParse(schema === ManifestSchema ? missing : { id: missing.id, consumes: missing.consumes });
      expect(result.success).toBe(false);
      if (result.success) throw new Error('Undeclared provider accepted');
      expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({
        path: ['consumes', 'services', 1], message: expect.stringContaining('provider "provider" is not a direct dependency'),
      })]));
    }
  });

  it.each([
    { services: ['host/unknown'] }, { services: ['onboarding'] },
    { services: ['provider/bad-name'] }, { services: ['host/onboarding', 'host/onboarding'] },
  ])('refuses unknown, malformed or duplicated refs: %j', ({ services }) => {
    expect(ManifestSchema.safeParse({ ...consumer, dependencies: { provider: '*' }, consumes: { services } }).success).toBe(false);
  });

  it('projects direct feature and pack ownership without reading source targets', () => {
    expect(_packServiceDeclarations({ ...provider, services: { status: 'also-missing.ts#status' } })).toEqual([
      { packId: 'provider', name: 'SearchAPI', ref: 'provider/SearchAPI', target: 'missing.ts#search', featureId: 'search' },
      { packId: 'provider', name: 'status', ref: 'provider/status', target: 'also-missing.ts#status' },
    ]);
    expect(() => _packServiceDeclarations({ ...provider, services: { SearchAPI: 'other.ts#api' } }))
      .toThrow('declared by both feature "search" and pack');
  });

  it('selects the baseline, own declarations and requested direct services exactly once', () => {
    const declarations = { ...consumer, services: { own: 'missing.ts#own' }, dependencies: { provider: '*' },
      consumes: { services: ['host/onboarding', 'provider/SearchAPI', 'host/settings', 'consumer/own'] } };
    const find = vi.fn(() => provider);
    const selected = _packServiceSelection(declarations, find).map(entry => entry.ref);
    expect(selected).toEqual([..._BASELINE_HOST_SERVICE_NAMES.map(name => `host/${name}`), 'consumer/own', 'host/onboarding', 'provider/SearchAPI']);
    expect(selected).not.toContain('host/appData');
    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith('provider', 'provider/SearchAPI');
  });

  it('refuses missing declarations and facade members that the named provider does not own', () => {
    const declarations = { ...consumer, dependencies: { provider: '*' }, consumes: { services: ['provider/toString'] } };
    expect(() => _packServiceSelection(declarations, () => provider))
      .toThrow('Pack "consumer" consumes "provider/toString", but provider "provider" does not declare service "toString"');
    expect(() => _packServiceSelection(declarations, () => undefined))
      .toThrow('provider "provider" has no available declaration');
    expect(() => _packServiceSelection({ ...consumer, services: { logger: 'missing.ts#logger' } }, () => undefined))
      .toThrow('collides with the host');
  });

  it('refuses two provider refs that would collide on the generated services object', () => {
    const declarations = { ...consumer, dependencies: { first: '*', second: '*' },
      consumes: { services: ['first/search', 'second/search'] } };
    expect(() => _packServiceSelection(declarations, id => ({ id, services: { search: 'missing.ts#search' } })))
      .toThrow('Pack "consumer" selects service "search" from both "first" and "second"');
  });

  it.each([
    ['^1.0.0', '1.2.0', true], ['^1.0.0', '2.0.0', false],
    ['^1.0.0', '1.2.0-beta.1', true], ['file:../provider', undefined, true],
    ['*', undefined, true], ['^1.0.0', undefined, false],
  ])('checks provider version %s against %s', (spec, version, accepted) => {
    const select = () => _packServiceSelection({ ...consumer, dependencies: { provider: spec },
      consumes: { services: ['provider/SearchAPI'] } }, () => ({ ...provider, version }));
    if (accepted) expect(select).not.toThrow();
    else expect(select).toThrow('does not satisfy');
  });

  it('does not mistake an inherited dependency key for an owned provider', () => {
    const find = vi.fn();
    expect(() => _packServiceSelection({ ...consumer, consumes: { services: ['constructor/open'] } }, find))
      .toThrow('provider "constructor" is not a direct dependency');
    expect(find).not.toHaveBeenCalled();
  });
});
