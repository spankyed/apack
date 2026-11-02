import type { PackFERegistration, SurfaceDefinition } from '../fe/index.ts';
import type { NativePackDeclaration } from '../framework/pack-catalog.ts';
import type { SurfaceDeclaration } from '../framework/surface-declaration.ts';
import type { StepFrontendDeclaration } from '../framework/step-frontend-declaration.ts';
import type { StepFEFacet } from '../steps/types.ts';
import type { StepEntry } from '../build/manifest.ts';

/** Declare an authored frontend fixture before admitting its runtime stand-ins; never calls its code. */
export function nativeFrontendDeclarationFixture(fixture: PackFERegistration): NativePackDeclaration {
  const component = 'fixtures/frontend.ts#Component';
  const form = (name: string) => ({ schema: { type: 'object' }, defaults: {}, form: `fixtures/${name}.vue` });
  return {
    id: fixture.id,
    ...(fixture.settingsForms && { settings: Object.fromEntries(Object.keys(fixture.settingsForms).map(id => [id, form(id)])) }),
    features: Object.fromEntries(Object.entries(fixture.features ?? {}).map(([id, feature]) => {
      if (feature.default && !feature.surface) throw new Error(`Native feature fixture "${id}" claims a default without a surface`);
      const references = feature.references;
      return [id, {
        description: `Frontend fixture for ${id}.`,
        ...(feature.designation !== undefined && { designation: feature.designation }),
        ...(feature.settingsForm !== undefined && { settings: form(id) }),
        ...(feature.surface && { surface: { ...surfaceDeclaration(feature.surface), ...(feature.default && { default: true }) } }),
        ...(references && { references: {
          types: Object.fromEntries(Object.entries(references.types).map(([name, value]) => [name,
            { category: value.category, icon: 'Box', svgElements: value.svgElements }])),
          categories: Object.fromEntries(Object.entries(references.categories).map(([name, value]) => [name,
            { label: value.label, icon: 'Box', useItems: 'fixtures/references.ts#useItems' }])),
        } }),
      }];
    })),
    ...(fixture.steps && { steps: Object.fromEntries(fixture.steps.map(step => {
      if (step.node === undefined) throw new Error(`Native step fixture "${fixture.id}/${step.type}" needs declared node data`);
      const fe = step.fe;
      return [step.type, { node: step.node, ...(step.kind !== undefined && { kind: step.kind }),
        ...(fe && { fe: frontendDeclaration(fe) }),
      } satisfies StepEntry];
    })) }),
    ...(fixture.artifacts && { artifacts: Object.fromEntries(fixture.artifacts.map(value => [value.type,
      { icon: 'File', ...(value.fe?.component !== undefined && { fe: 'fixtures/artifact.vue' }) }])) }),
    ...(fixture.blocks && { blocks: Object.fromEntries(fixture.blocks.map(value => [value.type,
      { ...(value.kind !== undefined && { kind: value.kind }), ...(value.fe !== undefined && { fe: 'fixtures/block.vue' }) }])) }),
    ...(fixture.appExtensions && { appExtensions: Object.fromEntries(Object.keys(fixture.appExtensions).map(id => [id, 'fixtures/extension.vue'])) }),
    ...(fixture.textEditor && { textEditor: Object.fromEntries(Object.entries(fixture.textEditor).map(([id, value]) => [id, {
      ...(value.readOnly !== undefined && { readOnly: value.readOnly === false ? false : 'fixtures/editor.ts#readOnly' }),
      ...(value.extensions && { extensions: Object.fromEntries(Object.keys(value.extensions).map(name => [name, component])) }),
      ...(value.popups && { popups: Object.fromEntries(Object.keys(value.popups).map(name => [name, 'fixtures/popup.vue'])) }),
      ...(value.isSuggestionActive !== undefined && { isSuggestionActive: 'fixtures/editor.ts#isSuggestionActive' }),
    }])) }),
  };
}

function surfaceDeclaration(surface: SurfaceDefinition): SurfaceDeclaration {
  return {
    label: surface.label, state: 'fixtures/frontend.ts#State',
    ...(surface.icon !== undefined && { icon: 'Box' }),
    ...(surface.canvas !== undefined && { canvas: 'fixtures/canvas.vue' }),
    ...(surface.panel !== undefined && { panel: 'fixtures/panel.vue' }),
    ...(surface.chat !== undefined && { chat: 'fixtures/chat.vue' }),
    ...(surface.isPinned !== undefined && { isPinned: surface.isPinned }),
    ...(surface.hotkeys !== undefined && { hotkeys: surface.hotkeys }),
    ...(surface.options !== undefined && { options: surface.options }),
    ...(surface.fallbackPanel !== undefined && { fallbackPanel: { label: surface.fallbackPanel.label,
      toggle: surface.fallbackPanel.toggle, isShown: 'fixtures/frontend.ts#isShown' } }),
  };
}

function frontendDeclaration(fe: StepFEFacet): StepFrontendDeclaration {
  const component = 'fixtures/frontend.ts#Component';
  return {
    nodeConfig: { ...fe.nodeConfig, icon: 'Box' },
    ...(fe.colorKey !== undefined && { colorKey: fe.colorKey }),
    ...(fe.handlePrefix !== undefined && { handlePrefix: fe.handlePrefix }),
    ...(fe.components && { components: Object.fromEntries(Object.keys(fe.components).map(name => [name, component])) }),
    ...(fe.layout && { layout: {
      ...(fe.layout.getHeight !== undefined && { getHeight: 'fixtures/layout.ts#getHeight' }),
      ...(fe.layout.getPorts !== undefined && { getPorts: 'fixtures/layout.ts#getPorts' }),
      ...(fe.layout.hasInput !== undefined && { hasInput: fe.layout.hasInput }),
      ...(fe.layout.usesExitCount !== undefined && { usesExitCount: fe.layout.usesExitCount }),
    } }),
  };
}
