import { state } from '@apackdev/state';
import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
// The renderer resolves each role to the surface that plays it; a pack claiming a role another plays is refused, as
// the backend registry refuses it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceDefinition } from '@apackdev/sdk/fe';
import { getDesignated } from '@apackdev/sdk/designations';
import { bindFeHost } from '@apackdev/sdk/runtime';

const { registerFixture, unregisterPackFE, ...registry } = createNativeFrontendTestRegistry();
bindFeHost({ catalog: {} as never, application: {} as never, secrets: {} as never, settings: {} as never, client: {} as never, packs: registry });

const surface = (label: string) => ({ label, state: state()({}) }) satisfies SurfaceDefinition;

const packs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const id of packs.splice(0)) unregisterPackFE(id);
});

/** A pack whose features each play a role: `register('p', [['main', 'notebook']])` */
function register(packId: string, roles: Array<[featureId: string, role: string]>): void {
  registerFixture({
    id: packId,
    features: Object.fromEntries(roles.map(([featureId, designation]) => [featureId, { surface: surface(featureId), designation }])),
  });
  packs.push(packId);
}

describe('frontend designations', () => {
  // The backend resolves a role its feature plays with no surface; the frontend has to agree
  it('resolve a role played by a feature with no surface to its ref, adding no surface', () => {
    registerFixture({ id: 'clock-pack', features: { scheduler: { designation: 'clock' } } });
    packs.push('clock-pack');

    expect(getDesignated('clock')).toBe('clock-pack/scheduler');
    expect(registry.getRegisteredSurfaces().map((p) => p.id)).not.toContain('clock-pack/scheduler');
  });

  it('refuse a pack claiming a role another plays, leaving nothing of it registered', () => {
    register('first-pack', [['firstNotebook', 'notebook']]);
    expect(() => register('second-pack', [['secondNotebook', 'notebook']])).toThrow('Designation collision: role "notebook" — pack "second-pack" vs "first-pack"');

    expect(getDesignated('notebook')).toBe('first-pack/firstNotebook');
    expect(registry.getRegisteredSurfaces().map((p) => p.id)).toEqual(['first-pack/firstNotebook']);
  });
});
