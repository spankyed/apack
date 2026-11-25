import { describe, expect, it, vi } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, type PackManifest } from '@apackdev/pack-format';
import type { NativePackDeclaration } from '@apackdev/sdk/framework';
import { createContributionCatalog, type PackCatalogEntry, type PackCatalogSnapshot } from '../../src/packs/catalog.ts';
import { assertPackServiceRequirements } from '../../src/packs/service-requirements.ts';

import { createPackRegistry } from '../../src/packs/registry.ts';

const empty = createContributionCatalog({ schema: { type: 'object' }, defaults: {} }).getSnapshot();
const consumer: PackManifest = { id: 'consumer', name: 'Consumer', version: '1.0.0',
  dependencies: { provider: '^1.0.0' }, consumes: { services: ['provider/search'] } };
const provider: PackManifest = { id: 'provider', name: 'Provider', version: '1.2.0',
  extensions: { services: { search: 'unavailable.ts#search' } } };
function installed(manifest: PackManifest, enabled = true): PackCatalogEntry {
  return { dir: `/unavailable/${manifest.id}`, enabled, snapshot: {
    format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest), manifest,
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
  } };
}
function check(changes: Partial<PackCatalogSnapshot>, manifest = consumer, origin: 'installed' | 'source' = 'installed') {
  return () => assertPackServiceRequirements({ ...empty, ...changes }, { origin, declaration: manifest });
}

describe('service requirement admission', () => {
  it('accepts installed and native declarations without authored modules', () => {
    expect(check({ packs: [installed(provider)] })).not.toThrow();
    const native: NativePackDeclaration = { id: provider.id, version: provider.version,
      services: provider.extensions!.services };
    expect(check({ native: [native] })).not.toThrow();
  });

  it('refuses missing, disabled, invalid, incompatible and non-owning providers', () => {
    expect(check({})).toThrow('has no available declaration');
    expect(check({ packs: [installed(provider, false)] })).toThrow('is disabled');
    expect(check({ packs: [installed({ ...provider, version: '2.0.0' })] })).toThrow('does not satisfy ^1.0.0');
    expect(check({ packs: [installed({ ...provider, extensions: {} })] })).toThrow('does not declare service "search"');
    expect(check({ problems: [{ id: 'provider', dir: '/bad', enabled: true, message: 'Broken receipt' }] }))
      .toThrow('is unavailable: Broken receipt');
  });

  it('keeps authoring previews out of installed admission and cannot hide a broken installed provider', () => {
    const sources = [{ manifest: provider, dir: '/source', declarationRevision: _declarationRevision(provider) }];
    expect(check({ sourcePacks: sources })).toThrow('only authoring source declarations');
    expect(check({ sourcePacks: sources }, consumer, 'source')).not.toThrow();
    expect(check({ sourcePacks: sources, packs: [installed(provider, false)] }, consumer, 'source')).toThrow('is disabled');
    expect(check({ sourcePacks: sources, problems: [{ id: 'provider', dir: '/bad', enabled: true, message: 'Broken' }] }, consumer, 'source'))
      .toThrow('is unavailable: Broken');
  });

  it('checks the providers own requirements with the entire dependency path attributed', () => {
    const dependent = { ...provider, dependencies: { absent: '*' }, consumes: { services: ['absent/lookup'] } };
    expect(check({ packs: [installed(dependent)] })).toThrow(
      'Pack "consumer" consumes "provider/search", but provider "provider" cannot satisfy its requirements: Pack "provider" consumes "absent/lookup"');
  });

  it('refuses direct native replacement before binding and retains the accepted registration', () => {
    const packs = createPackRegistry({ nativeDeclarations: [{ id: 'consumer' }] });
    const incumbent = { id: 'consumer' };
    packs.registerPack(incumbent);
    packs.catalog.setNative([{ id: 'consumer', dependencies: { provider: '*' }, consumes: { services: ['provider/search'] } }]);
    const bindServices = vi.fn();
    expect(() => packs.replacePack({ id: 'consumer', dependencies: { provider: '*' }, bindServices }))
      .toThrow('has no available declaration');
    expect(bindServices).not.toHaveBeenCalled();
    expect(packs.getPackRegistration('consumer')).toBe(incumbent);
  });

  it('checks cycles against the prospective candidate rather than the replaced declaration', () => {
    const replacement = { ...consumer, extensions: { services: { lookup: 'unavailable.ts#lookup' } } };
    const dependent = { ...provider, dependencies: { consumer: '^1.0.0' }, consumes: { services: ['consumer/lookup'] } };
    expect(check({ packs: [installed(consumer), installed(dependent)] }, replacement)).not.toThrow();
    expect(check({ packs: [installed(consumer), installed(dependent)] })).toThrow('does not declare service "lookup"');
  });
});
