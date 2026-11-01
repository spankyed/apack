import { HOST_PACK_ID, splitRef } from '@apackdev/sdk/ids';
import type { NativePackDeclaration, SurfaceDeclaration } from '@apackdev/sdk/framework';
import { HOST } from '../refs.ts';
import { hostEventContracts } from './event-contracts.ts';

export const hostFeatureIds = Object.fromEntries(
  (['application', 'packs', 'settings', 'help'] as const).map(name => [name, splitRef(HOST[name])!.featureId]),
) as Record<'application' | 'packs' | 'settings' | 'help', string>;

/** Host declarations exist before any host system is constructed or registered. */
export const hostSurfaceDeclarations = {
  packs: { label: 'Packs', icon: 'Package', isPinned: true, state: '@apackdev/host/fe#packsMachine',
    canvas: 'packages/renderer/src/views/packs/canvas.vue' },
  settings: { label: 'Settings', icon: 'Settings', isPinned: true, state: '@apackdev/host/fe#createSettingsMachine',
    canvas: 'packages/renderer/src/views/settings/canvas/index.vue' },
} satisfies Record<string, SurfaceDeclaration>;

export const hostDeclaration: NativePackDeclaration = {
  id: HOST_PACK_ID,
  eventContracts: hostEventContracts,
  textEditor: { references: { readOnly: '@apackdev/ui/components/tiptap/reference-node#ReadOnlyReferences', extensions: {
    reference: '@apackdev/ui/components/tiptap/reference-node#ReferenceNode',
  } } },
  features: {
    [hostFeatureIds.application]: { description: 'Manage sidebar visibility and the last active surface.' },
    [hostFeatureIds.help]: { description: 'Browse help articles from installed packs.' },
    [hostFeatureIds.packs]: { description: 'Manage installed packs and their update choices.', surface: hostSurfaceDeclarations.packs },
    [hostFeatureIds.settings]: { description: 'Edit app, pack and feature preferences.', surface: hostSurfaceDeclarations.settings },
  },
};
