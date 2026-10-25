// Types describing what a pack contributes — pack-facing, unlike the
// registration functions in ./host.

// The preload bridge: its declaration, and the `window.electronAPI` global that is a view of it. Naming
// the types is also what keeps this module in the emitted declarations — without a re-export of some kind,
// every pack importing `@apackdev/sdk/fe` loses the global with nothing to say so.
export type { _HostBridge } from './electron-api.ts';
// The event type that global's `speech.onEvent` hands back. Exported by name because two host packages need
// it too — they reached it through a `types/speech.d.ts` at the repo root until 2026-10-02, which no
// manifest could describe, so nothing could derive that they compile this file
export type { SpeechEvent } from './speech-event.ts';
export type { Surface, SurfaceDefinition, SurfaceInbox, SurfaceInboxAudiences, SurfaceLifecycleEvent, SurfaceStateOf, RouteComponents } from './surface.ts'
export type { PackFEFeature, PackFERegistration } from './pack-fe-registration.ts'
export { surfaceStorage, useSurfaceStorage, type SurfaceStorage } from './surface-storage.ts'
export { pasteIntoElement } from './input-paste.ts'
export { SurfaceScope, useSurface } from './actor-system.ts'
export { surfaceIsRunning, readUntypedSurfaceState, useUntypedSurfaceState } from './surface-state.ts'
export { untypedUseView, type UseViewOptions, type ViewState } from './views.ts'
export { untypedFromView } from './view-actor.ts'
export { viewRead, viewWrites, writeAnswered, writeSent, writing, type ViewWrites } from './view-writes.ts'
export type { ViewRequest, ViewUpdate } from '../framework/views.ts'
export { useShell, type Shell, type HostShell, type HostShellEvent, type HostShellSnapshot, type HostShellState, type ShellPanelSizes } from './shell.ts'
export { isAnyMenuOpen, onMenuOpenChange, useTrackedMenuOpen } from './menu-state.ts'
export { getDslDeclaration, getDslDeclarations, onDslDeclarationsChanged, useDslDeclarations } from './dsl-reader.ts'
export { EXTRA_BLOCK_ITEMS_KEY, textEditorExtensionsRegistry, type BlockItem, type TextEditorExtensions, type TextEditorExtensionsBinding } from './text-editor-extensions.ts'

export { default, default as breadcrumb, breadcrumbWithParams, breadcrumbList, staticBreadcrumbList } from './breadcrumb.ts'
export { safeEvents, safeEvents as feSafeEvents, type ExtractEvent } from './safe-events.ts'
export { contextMenu, contextMenuFn, type ContextMenuItem, type ContextMenuMeta } from './context-menu.ts'
export { createNavHistory, pushNavHistory, goBack, goForward, canGoBack, canGoForward, type NavHistory } from './nav-history.ts'
export { createHotkeyProcessor, matchesHotkey, processHotkeys, type HotkeyEvent, type HotkeysMap, type KeyboardShortcut, type SurfaceHotkeyDefinition } from './hotkeys.ts'
export { saveTabGroups, loadTabGroups, clearTabGroups, getNextAvailableColor, ALL_COLORS, type TabGroup, type TabGroupColor } from './tab-groups.ts'
export { targetIs, TRAIL_CLICK, type TrailClickEvent } from './route-trailer.ts'
export { getDesignated, hasDesignation } from '../designations/index.ts'

export { secretsClient, type SecretsClient, type SecretsSnapshot } from './secrets-client.ts'
export { useSettingsDraft } from './settings-draft.ts'
export {
  _createFeSettings, useFeatureSettings, useSettingsSave, useSettingsStatus, useAppSettings, usePackSettings,
  type FeSettingsHandle, type ReadonlyFeSettingsHandle, type SettingsPort, type SettingsSaveStatus, type SettingsTarget, type SettingUpdate,
} from './settings.ts'

export {
  untypedOpenSurface,
  openEntity, entityIs, entityTypeOf,
  openLink,
  openHelp,
  type SurfaceEvent,
} from './navigation.ts'

/**
 * What hands a surface's handlers the answer for the message being handled — the same wrapper a system's
 * `defineSystem` gives, over a machine's own context and events.
 *
 * Re-exported here because `@apackdev/sdk/framework` is **not** in `SDK_FE_MODULES`
 * (`@apackdev/host/build/shared-deps`): a pack frontend can import its types but cannot load it at runtime, so
 * without this a pack's surface could be handed no `reply` and the frontend half of answering would exist for
 * host code alone. One implementation serves both sides — `define-system.ts` imports only xstate types,
 * `safeEvents`, `eventTypes` and `@apackdev/sdk/events`, all frontend-safe.
 *
 * A surface's `reply` is the open form, and that is right rather than a gap: a surface's contract declares the
 * state it publishes and the inbox it opens, not an outgoing union, so there is nothing to bound it by. A
 * system's is bound by its contract's `outgoing`.
 */
export { defineHandlers, type Handlers } from '../framework/define-system.ts'

export { getStepFrontendBindings, type StepFrontendBinding } from './step-bindings.ts';
export { getStepDeclarations, getStepDeclaration, getStepBinding, onStepsChanged, useStepDeclarations } from './step-reader.ts';

export type { ArtifactFrontendBinding, BlockFrontendBinding } from './viewer-bindings.ts';
export { getArtifactDeclarations, getArtifactDeclaration, getArtifactBinding, useArtifactDeclarations } from './artifact-reader.ts';
export { getBlockDeclarations, getBlockDeclaration, getBlockBinding, useBlockDeclarations } from './block-reader.ts';
