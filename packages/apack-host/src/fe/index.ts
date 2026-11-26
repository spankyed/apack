// What `@apackdev/host/fe` offers a frontend: the things a window needs that aren't a feature's — the registered pack
// frontends, the client's contract, a window's migrations, the ports the renderer implements — and, below, each
// host feature's frontend. The features' halves are named here rather than each keeping a `public.ts` of its own:
// this is the package's export surface, which is why naming a feature's frontend from here is not the crossing
// `check:specifiers` refuses. A feature's modules are otherwise its own, exactly as a pack's are.
import { vueBinding } from '@apackdev/state/vue';
import { HOST_PACK_ID, resolveName } from '@apackdev/sdk/ids';
import type { ShellState } from '../features/application/fe/machine.ts';
import type packsMachineRef from '../features/packs/fe/machine.ts';
import type { createSettingsMachine as createSettingsMachineRef } from '../features/settings/fe/machine.ts';

export type { Surface } from '@apackdev/sdk/fe';
export { createFePackRegistry, type FePackRegistry, type FrontendSettingsBinding, type PreparedFrontend } from './pack-store.ts';
export { HOST } from '../refs.ts';
export { hostState, type HostNet } from '../state.ts';
export { hostDeclaration, hostSurfaceDeclarations } from '../features/declaration.ts';
export type { PackFERegistration } from '@apackdev/sdk/fe';
export { describeFailure, type ShellClient, type ShellConnection, type ShellFailure } from './client.ts';
export type { LoadedPackEntry } from '../packs/layout-types.ts';
export { runWindowStorageMigrations, type WindowStorageMigration, type WindowStorage } from './window-storage/index.ts';
export type { ShellPackFrontends } from './pack-frontends.ts';

// The app shell (`features/application/fe/`)
export {
  createShell,
  createShellState,
  type ShellObserver,
  type ShellRuntime,
  type ShellShape,
  type ShellSnapshot,
  type ShellState,
} from '../features/application/fe/machine.ts';
export { withHostLast } from '../features/application/fe/surfaces.ts';
export { surfaceNavigationItems, type SurfaceNavigationItem } from './surface-navigation.ts';
export { notifySurfaceActor, sendToSurfaceActor, type SurfaceEventTarget } from './surface-delivery.ts';
export { computeCrumbs, type BreadcrumbItem, type TrailSurfaceState } from '../features/application/fe/trail.ts';
export {
  computeTrail,
  topLevelState,
  type ComputedTrail,
  type SurfaceChrome,
  type SurfaceStateChrome,
  type SurfaceStateValue,
} from '../features/application/fe/chrome.ts';
export type { ShellNotify, ShellOptions, ShellParams, ShellStorage } from '../features/application/fe/types.ts';

// The Packs surface, the pack-frontend loader the shell is given, and the install a deep link asks for
// (`features/packs/fe/`)
export { default as packsMachine, packsChrome, type PacksContext, type PacksState, type InstalledPackSummary, type AppPackSourceSummary } from '../features/packs/fe/machine.ts';
export { createPackFrontends, loadPackFEEntry, type DevPackFrontends, type PackFrontendIO, type PackFrontendStyles, type PackFrontendStyle } from '../features/packs/fe/frontends.ts';
export { installFromProtocol, packInstallRequest, requestPackInstall, type PackInstallRequest } from '../features/packs/fe/install-url.ts';

// The Settings view's machine, as the renderer pairs it with the view's components (`features/settings/fe/`)
export { createSettingsMachine, settingsChrome, type SettingsContext, type SettingsEvents, type SettingsIO, type SettingsState } from '../features/settings/fe/machine.ts';

export type HostSurfaces = {
  application: ShellState;
  packs: typeof packsMachineRef;
  settings: ReturnType<typeof createSettingsMachineRef>;
};

export const { provide: provideHostState, useState: useHostState } = /*#__PURE__*/ vueBinding<HostSurfaces>(
  (name) => resolveName(name, HOST_PACK_ID),
);

export { createWindowSettingsRuntime, type WindowSettingsIO } from './settings-runtime.ts';
export { settingsProblems, isEqual } from '../features/settings/document.ts';
export { compileSettingsCatalog } from '../features/settings/validation.ts';

export { createWindowPackCatalog, type WindowPackCatalogIO } from './pack-catalog.ts';
export type { PackCatalogFrame, PackCatalogSnapshot } from '../packs/catalog-types.ts';

export type { FrontendAdmission } from './frontend-admission.ts';
