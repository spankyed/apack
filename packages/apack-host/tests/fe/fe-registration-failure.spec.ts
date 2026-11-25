import { createMachine } from 'xstate';
import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
import { describe, expect, it } from 'vitest';
import type { PackFERegistration, SurfaceDefinition } from '@apackdev/sdk/fe';
import type { StepDefinition } from '@apackdev/sdk/steps';

const surface = (label: string) => ({ label, icon: {}, state: createMachine({}), canvas: {} } satisfies SurfaceDefinition);
const step = (type: string): StepDefinition => ({ type, kind: 'step', node: { label: type } });
const registration = (id: string, r: Partial<PackFERegistration>) => ({ id, ...r }) as PackFERegistration;

describe('a surface', () => {
  // The registration names features and the registry addresses them, so no pack's surface can be registered
  // in another pack's namespace, whatever the pack writes
  it("is registered at its feature's address", () => {
    const registry = createNativeFrontendTestRegistry();
    registry.registerFixture(registration('memo-pack', { features: { memos: { surface: surface('Memos') } } }));
    expect(registry.getRegisteredSurfaces().map((p) => p.id)).toEqual(['memo-pack/memos']);
  });

  // As the backend registry refuses them: a key with a `/` would land at another pack's ref, and `x` beside
  // `memo-pack/x` would register one surface twice
  it('is refused when its key is no feature id, and nothing of the pack is registered', () => {
    const registry = createNativeFrontendTestRegistry();
    expect(() => registry.registerFixture(registration('memo-pack', { features: { memos: { surface: surface('Memos') }, 'other-pack/notes': { surface: surface('Notes') } } })))
      .toThrow('feature "other-pack/notes" isn\'t a feature id');
    expect(registry.getRegisteredSurfaces()).toEqual([]);
    expect(registry.unregisterPackFE('memo-pack')).toEqual([]);
  });
});

describe('a frontend registration that throws partway', () => {
  it('leaves the registry as it found it', () => {
    const registry = createNativeFrontendTestRegistry();
    registry.registerFixture(registration('neighbour-pack', { features: { neighbour: { surface: surface('neighbour'), designation: 'occupied' } } }));

    expect(() => registry.registerFixture(registration('partial-pack', { features: { ghost: { surface: surface('ghost'), designation: 'occupied' } }, artifacts: [{ type: 'ghost-view', fe: { icon: {} } }], steps: [step('ghost-step')] }))).toThrow(/Designation collision/);

    expect(registry.getRegisteredSurfaces().map((p) => p.id), 'its surface stayed in the list').toEqual(['neighbour-pack/neighbour']);
    expect(registry.stepBindings().get('ghost-step'), 'its step stayed registered').toBeUndefined();
    expect(registry.artifact('ghost-view'), 'its artifact stayed registered').toBeUndefined();
    expect(registry.unregisterPackFE('partial-pack'), 'it was recorded as registered').toEqual([]);
  });

  it("doesn't make its failure the next pack's", () => {
    const registry = createNativeFrontendTestRegistry();
    expect(() => registry.registerFixture(registration('broken-pack', { steps: [step('theirs')], features: { first: { designation: 'duplicate' }, second: { designation: 'duplicate' } } }))).toThrow();

    expect(() => registry.registerFixture(registration('later-pack', { features: { mine: { surface: surface('mine') } }, steps: [step('mine')] }))).not.toThrow();
    expect(registry.getRegisteredSurfaces().map((p) => p.id)).toEqual(['later-pack/mine']);
  });

  it('gives back the default surface it had taken', () => {
    const registry = createNativeFrontendTestRegistry();
    expect(() => registry.registerFixture(registration('default-pack', { features: { first: { surface: surface('first'), default: true, designation: 'duplicate' }, second: { designation: 'duplicate' } }, steps: [step('boom')] }))).toThrow();

    expect(registry.surfaceBindings().size, 'it kept a provisional surface binding').toBe(0);
  });
});

// The backend registry refuses a pack id it already holds; this one used to overwrite what it had recorded,
// so the first registration's way back out was dropped and its surfaces could never be removed.
describe('a pack registering its frontend twice', () => {
  it('is refused, as the backend registry refuses it', () => {
    const registry = createNativeFrontendTestRegistry();
    registry.registerFixture(registration('twice-pack', { features: { once: { surface: surface('once') } } }));

    expect(() => registry.registerFixture(registration('twice-pack', { features: { again: { surface: surface('again') } } })))
      .toThrow('Pack "twice-pack" frontend is already registered');

    expect(registry.unregisterPackFE('twice-pack').map((p) => p.id)).toEqual(['twice-pack/once']);
    expect(registry.getRegisteredSurfaces()).toEqual([]);
  });
});
