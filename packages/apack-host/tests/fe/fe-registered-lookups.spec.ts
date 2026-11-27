import { state } from '@apackdev/state';
import { selectDefaultSurfaceDeclaration, getEligibleSurface } from '../../src/fe/surface-selection.ts';
import type { FeatureRef } from '@apackdev/sdk/ids';
import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
// What a pack's frontend registration contributes, read the way the renderer and pack frontends read it: each
// lookup sees the pack once it registers and loses it when it unregisters.
import { afterEach, describe, expect, it } from 'vitest';
import type { Surface, SurfaceDefinition, PackFERegistration, TextEditorExtensions } from '@apackdev/sdk/fe';
import { textEditorExtensionsRegistry, getStepFrontendBindings } from '@apackdev/sdk/fe';
import { bindFeHost } from '@apackdev/sdk/runtime';
import { type StepDefinition } from '@apackdev/sdk/steps';
import { artifactRegistry } from '@apackdev/sdk/artifacts';
import { blockRegistry } from '@apackdev/sdk/blocks';
import { getDesignated, hasDesignation } from '@apackdev/sdk/designations';

// How this spec registers and reads: a frontend registry it creates, bound for the SDK's lookups
const registry = createNativeFrontendTestRegistry();
bindFeHost({ catalog: {} as never, application: {} as never, secrets: {} as never, settings: {} as never, client: {} as never, packs: registry });
const register = (packId: string, registration: Omit<PackFERegistration, 'id'>) => registry.registerFixture({ id: packId, ...registration });
const unregister = (packId: string) => registry.unregisterPackFE(packId);
const surfaces = () => registry.getRegisteredSurfaces();
const defaultSurface = () => {
  const catalog = { status: () => 'ready' as const, subscribe: () => () => {}, surfaces: () => [...registry.surfaceBindings()].map(([featureRef, accepted]) => ({
    featureRef: featureRef as FeatureRef, packId: accepted.packId, origin: 'native' as const, enabled: true, declaration: accepted.declaration,
  })) };
  const owner = selectDefaultSurfaceDeclaration(catalog);
  return owner && getEligibleSurface(catalog, registry.surfaceBindings(), owner.featureRef);
};
const appExtension = (slot: string) => registry.getAppExtension(slot);

const packs: string[] = [];
afterEach(() => {
  for (const id of packs.splice(0)) unregister(id);
});

function add(packId: string, registration: Omit<PackFERegistration, 'id'>): void {
  register(packId, registration);
  packs.push(packId);
}

function remove(packId: string): Surface[] {
  packs.splice(packs.indexOf(packId), 1);
  return unregister(packId);
}

const surface = (label: string) => ({ label, state: state()({}) }) satisfies SurfaceDefinition;
// A frontend registration carries `node` beside `fe`: the label and the field defaults are what both
// halves read, so codegen emits that facet into this registration and the backend's alike
const NoteNode = {}; const NoteForm = {}; const CardView = {}; const Choice = {};
const noteStepFE = { type: 'note', node: { label: 'Note' }, fe: { nodeConfig: { icon: {}, category: 'data', connectionRules: { inputs: 1, outputs: 1 } }, components: { node: NoteNode, form: NoteForm } } } satisfies StepDefinition;
const cardView = { type: 'card-view', fe: { icon: {}, component: CardView } };
const choice = { type: 'choice', fe: { component: Choice } };
const mentions: TextEditorExtensions = { extensions: {} };
const Welcome = { name: 'Welcome' };

describe("a pack's frontend", () => {
  it('is found once it registers, and gone once it unregisters', () => {
    add('notebook-pack', {
      features: { notebookMain: { surface: surface('Notebook'), designation: 'notebook' } },
      steps: [noteStepFE],
      artifacts: [cardView],
      blocks: [choice],
      textEditor: { mentions },
      appExtensions: { welcome: Welcome },
    });

    // Registered at the feature's address, which also answers the role
    expect(surfaces()).toMatchObject([{ label: 'Notebook', id: 'notebook-pack/notebookMain' }]);
    expect(getDesignated('notebook')).toBe('notebook-pack/notebookMain');
    expect(getStepFrontendBindings().get('note')?.binding.node?.label).toBe('Note');
    expect(getStepFrontendBindings().get('note')?.binding.fe).toBeDefined();
    expect([...getStepFrontendBindings().keys()]).toEqual(['note']);
    expect(artifactRegistry.all()).toEqual([cardView]);
    expect(blockRegistry.all()).toEqual([choice]);
    // Its components are accepted bindings
    expect(getStepFrontendBindings().get('note')?.binding.fe?.components?.node).toBe(NoteNode);
    expect(getStepFrontendBindings().get('note')?.binding.fe?.components?.form).toBe(NoteForm);
    expect(artifactRegistry.getComponent('card-view')).toBe(CardView);
    expect(blockRegistry.getComponent('choice')).toBe(Choice);
    expect(textEditorExtensionsRegistry.getAll()).toContainEqual({ packId: 'notebook-pack', groupId: 'mentions', binding: mentions });
    expect(appExtension('welcome')).toBe(Welcome);

    expect(remove('notebook-pack')).toMatchObject([{ label: 'Notebook', id: 'notebook-pack/notebookMain' }]);
    expect(surfaces()).toEqual([]);
    expect(hasDesignation('notebook')).toBe(false);
    expect(getStepFrontendBindings().get('note')?.binding).toBeUndefined();
    expect([...getStepFrontendBindings().values()].map(entry => entry.binding)).toEqual([]);
    expect(artifactRegistry.has('card-view')).toBe(false);
    expect(artifactRegistry.all()).toEqual([]);
    expect(blockRegistry.has('choice')).toBe(false);
    expect(textEditorExtensionsRegistry.getAll()).not.toContainEqual({ packId: 'notebook-pack', groupId: 'mentions', binding: mentions });
    expect(appExtension('welcome')).toBeUndefined();
  });

  it('refuses another pack supplying a facet of the same step wire', () => {
    const original: StepDefinition = { type: 'note', kind: 'step', node: { label: 'Original' } };
    add('first-pack', { steps: [original] });
    expect(() => add('notebook-pack', { steps: [noteStepFE], appExtensions: { welcome: Welcome } }))
      .toThrow(/Step "note".*first-pack.*notebook-pack/);
    expect(getStepFrontendBindings().get('note')?.binding?.node?.label).toBe('Original');
    expect(getStepFrontendBindings().get('note')?.binding.fe).toBeUndefined();
    expect(appExtension('welcome')).toBeUndefined();
    remove('first-pack');
    add('notebook-pack', { steps: [noteStepFE] });
    expect(getStepFrontendBindings().get('note')?.binding.fe).toBeDefined();
  });

  it('keeps unrelated slot contributions when another step owner unregisters', () => {
    const first: StepDefinition = { type: 'first', node: { label: 'First' } };
    const otherWelcome = { name: 'OtherWelcome' };
    add('first-pack', { steps: [first], appExtensions: { welcome: Welcome } });
    add('notebook-pack', { steps: [noteStepFE], appExtensions: { welcome: otherWelcome } });
    expect(getStepFrontendBindings().get('note')?.binding?.fe).toBeDefined();
    expect(appExtension('welcome')).toBe(otherWelcome);
    remove('notebook-pack');
    expect(getStepFrontendBindings().get('first')?.binding?.node?.label).toBe('First');
    expect(getStepFrontendBindings().get('note')?.binding).toBeUndefined();
    expect(appExtension('welcome')).toBe(Welcome);
  });

  // Two packs with a `notes` feature each get a surface, because a surface is addressed by its pack. Only
  // the default follows declaration order, independently of registration order.
  it("gives each pack its own surface, and selects its default by declaration identity", () => {
    add('first-pack', { features: { notes: { surface: surface('First notes'), default: true } } });
    add('second-pack', { features: { notes: { surface: surface('Second notes') }, cards: { surface: surface('Cards'), default: true } } });
    expect(surfaces().map((p) => p.id)).toEqual(['first-pack/notes', 'second-pack/notes', 'second-pack/cards']);
    expect(defaultSurface()?.id).toBe('first-pack/notes');
    expect(remove('second-pack').map((p) => p.id)).toEqual(['second-pack/notes', 'second-pack/cards']);
    expect(defaultSurface()?.id, "the first pack's default left with the second").toBe('first-pack/notes');
  });

  it('promotes the next default on removal and preserves priority during replacement', () => {
    add('first-pack', { features: { main: { surface: surface('First'), default: true } } });
    add('second-pack', { features: { main: { surface: surface('Second'), default: true } } });
    registry.replaceFixture({ id: 'first-pack', features: { main: { surface: surface('Updated'), default: true } } });
    expect(defaultSurface()?.id).toBe('first-pack/main');
    expect(defaultSurface()?.label).toBe('Updated');
    remove('first-pack');
    expect(defaultSurface()?.id).toBe('second-pack/main');
    add('first-pack', { features: { main: { surface: surface('Returned'), default: true } } });
    expect(defaultSurface()?.id).toBe('first-pack/main');
    remove('second-pack');
    expect(defaultSurface()?.id).toBe('first-pack/main');
  });

  it('refuses duplicate defaults atomically and refuses a default without a surface', () => {
    add('owner', { features: { main: { surface: surface('Accepted'), default: true } } });
    expect(() => registry.replaceFixture({ id: 'owner', features: {
      first: { surface: surface('First'), default: true }, second: { surface: surface('Second'), default: true },
    } })).toThrow('only one may be claimed');
    expect(defaultSurface()?.id).toBe('owner/main');
    expect(surfaces().map(surface => surface.id)).toEqual(['owner/main']);
    expect(() => register('invalid', { features: { absent: { default: true } } })).toThrow('without a surface');
    expect(registry.hasPackFE('invalid')).toBe(false);
  });
});

// Pack and group insertion order determines the order presented to the editor.
describe('text editor extension groups', () => {
  const mentions: TextEditorExtensions = { extensions: {} };
  const slashes: TextEditorExtensions = { extensions: {} };

  it('are listed in registration order, which the editor resolves extensions by', () => {
    add('first-pack', { textEditor: { mentions } });
    add('second-pack', { textEditor: { slashes } });

    expect(textEditorExtensionsRegistry.getAll()).toEqual([{ packId: 'first-pack', groupId: 'mentions', binding: mentions }, { packId: 'second-pack', groupId: 'slashes', binding: slashes }]);
  });

  it('exposes immutable ownership and observes only committed changes until unsubscribed', () => {
    add('first-pack', { textEditor: { mentions } });
    const incumbent = textEditorExtensionsRegistry.getAll()[0];
    expect(Object.isFrozen(incumbent)).toBe(true);
    let changes = 0;
    const stop = textEditorExtensionsRegistry.onChanged(() => { changes++; });
    try {
      const candidate = registry.prepareFixture({ id: 'first-pack', textEditor: { mentions } }, undefined, true);
      expect(changes).toBe(0);
      candidate.dispose();
      expect(changes).toBe(0);
      expect(() => registry.registerFixture({ id: 'first-pack' })).toThrow('already registered');
      expect(changes).toBe(0);
      add('unrelated-pack', {});
      expect(changes).toBe(1);
      expect(textEditorExtensionsRegistry.getAll()[0].binding).toBe(incumbent.binding);
      registry.replaceFixture({ id: 'first-pack', textEditor: { renamed: mentions } });
      expect(changes).toBe(2);
      expect(textEditorExtensionsRegistry.getAll()[0]).toMatchObject({ packId: 'first-pack', groupId: 'renamed' });
      stop();
      remove('unrelated-pack');
      expect(changes).toBe(2);
    } finally { stop(); }
  });

  it('loses every one of a pack when it unregisters, not just the first', () => {
    add('many-pack', { textEditor: { mentions, slashes } });

    unregister('many-pack');

    expect(textEditorExtensionsRegistry.getAll()).toEqual([]);
  });

  // The read hands out a copy, as the backend's command store does, so a reader cannot edit what every
  // other reader sees. It used to hand out the live array by reference.
  it('cannot be added to or emptied by a reader', () => {
    add('first-pack', { textEditor: { mentions } });

    textEditorExtensionsRegistry.getAll().push({ packId: 'reader', groupId: 'slashes', binding: slashes });
    textEditorExtensionsRegistry.getAll().length = 0;

    expect(textEditorExtensionsRegistry.getAll()).toEqual([{ packId: 'first-pack', groupId: 'mentions', binding: mentions }]);
  });
});
