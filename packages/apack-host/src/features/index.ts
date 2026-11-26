// The pack `host`: what the app registers as its own features, and the systems each runs. The API composes its
// registration from here in one import, rather than from the runtime folders the halves used to live in.
export { hostRegistration } from './registration.ts';
export { hostState, type HostNet } from '../state.ts';
export { PACKS_SURFACE_EVENT_TYPES, SETTINGS_SURFACE_EVENT_TYPES, APPLICATION_SYSTEM_EVENTS, packsEvents, settingsEvents, type OutgoingPacksEvents } from './event-contracts.ts';
export { hostDeclaration } from './declaration.ts';
export { createApplicationSystem, surfaceVisibility } from './application/be/system.ts';
export { createPacksSystem, packsSpec } from './packs/be/system.ts';
export { createSettingsSystem, settingsSpec } from './settings/be/system.ts';
export type { OutgoingSettingsEvents } from './settings/be/types.ts';
