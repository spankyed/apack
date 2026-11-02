import type { PackFERegistration, SurfaceDefinition } from '@apackdev/sdk/fe';
import { HOST_PACK_ID } from '@apackdev/sdk/ids';
import { packsMachine, hostSurfaceDeclarations } from '@apackdev/host/fe';
import { ReferenceNode, ReadOnlyReferences } from '@apackdev/ui/components/tiptap/extensions/reference-node';
import { Package } from 'lucide-vue-next';
import canvas from './canvas.vue';
import { settingsSurface } from '@/views/settings/surface';

const packsSurface: SurfaceDefinition = {
  ...hostSurfaceDeclarations.packs,
  icon: Package,
  state: packsMachine,
  canvas,
};

/** The app's own frontend, registered as the pack `host` like any pack's: the Packs tab */
export const hostFrontend: PackFERegistration = {
  id: HOST_PACK_ID,
  textEditor: { references: { readOnly: ReadOnlyReferences, extensions: { reference: ReferenceNode } } },
  features: {
    packs: { surface: packsSurface },
    // The app's settings: the host's machine, this window's views
    settings: { surface: settingsSurface },
  },
};
