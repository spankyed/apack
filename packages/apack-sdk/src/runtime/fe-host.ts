import type { PerformanceExecution } from './performance.ts';
import type { StepFrontendBinding } from '../fe/step-bindings.ts';
import type { ArtifactFrontendBinding, BlockFrontendBinding } from '../fe/viewer-bindings.ts';
import type { PackCatalogView } from '../framework/catalog-view.ts';
// The frontend's port: what the SDK's frontend code reaches in the renderer, bound once per window
import type { ReferenceTypeConfig, ReferenceBindings, ReferenceBinding } from '../fe/reference-types.ts';
import type { Message } from '../events/index.ts';
import type { ViewRequest, ViewUpdate } from '../framework/views.ts';
import type { SecretsClient } from '../fe/secrets-client.ts';
import type { SettingsPort } from '../fe/settings.ts';
import type { Component } from 'vue';
import type { Surface } from '../fe/surface.ts';
import type { HostShell } from '../fe/shell.ts';
import type { TextEditorExtensionsBinding } from '../fe/text-editor-extensions.ts';
import type { PackExtensionsView } from './packs-view.ts';

/**
 * The window's client to the API, as SDK code uses it: sending to backend systems and subscribing to views. The
 * host's shell extends it with what only the host reads (the bus subscription, the loaded packs), in
 * `@apackdev/host/fe`.
 */
export interface FeClient {
  /** Delivers a message to a backend system */
  send(message: Message): void;
  /**
   * Subscribes this window to a view: `observer` hears its result, and each changed result after it, until the
   * returned function is called, after which it hears nothing. A dropped connection subscribes again once it is
   * back, so a subscription outlives a reconnect.
   */
  watchView(request: ViewRequest, observer: (update: ViewUpdate) => void): () => void;
}

/** The packs whose frontends the renderer registered, read-only */
export interface FePackRegistryView extends PackExtensionsView {
  /** Observe committed contribution changes; refused or disposed candidates publish nothing. */
  onChanged(listener: (packId: string) => void): () => void;
  /** Every registered surface, in registration order */
  surfaces(): Surface[];
  textEditor(): TextEditorExtensionsBinding[];
  /** Accepted step bindings; catalog declarations can outlive their implementations. */
  stepBindings(): ReadonlyMap<string, StepFrontendBinding>;
  artifactBindings(): ReadonlyMap<string, ArtifactFrontendBinding>;
  blockBindings(): ReadonlyMap<string, BlockFrontendBinding>;
  /** Accepted executable reference bindings; declarations have a separate catalog lifetime. */
  referenceTypes(): ReadonlyMap<string, ReferenceBinding<ReferenceTypeConfig>>;
  referenceCategories(): ReadonlyMap<string, ReferenceBinding<ReferenceBindings['categories'][string]>>;
  /** The component a pack registered for an app extension slot */
  appExtension(slot: string): Component | undefined;
}

/** The running app, as the SDK reaches it in the renderer */
export interface FeHostRuntime {
  /** Opt-in diagnostics owned by this window; absent in ordinary production operation. */
  diagnostics?: PerformanceExecution;
  /** Common declarations, independent of the accepted executable frontend registry. */
  catalog: PackCatalogView;
  /** The app shell, which spawns the surfaces, holds which is open and lays out the panels */
  application: HostShell;
  /** The API's secrets procedures */
  secrets: SecretsClient;
  /** The app's settings, as frontend code reads and changes them */
  settings: SettingsPort;
  /** The window's client to the API */
  client: FeClient;
  /** The packs whose frontends the renderer registered */
  packs: FePackRegistryView;
}

let bound: FeHostRuntime | undefined;

/** Binds the renderer's app; once per window, before any surface or pack frontend runs */
export function bindFeHost(runtime: FeHostRuntime): void {
  if (bound) throw new Error('A frontend host is already bound: bindFeHost runs once, at boot');
  bound = runtime;
}

/** @internal Tests only: forgets the bound frontend host */
export function unbindFeHost(): void {
  bound = undefined;
}

/** @internal Whether a frontend host is bound */
export function _isFeHostBound(): boolean {
  return bound !== undefined;
}

/** @internal The bound frontend host; throws, naming bindFeHost, when none is */
export function boundFeHost(): FeHostRuntime {
  if (!bound) throw new Error('No frontend host is bound: the renderer binds one at boot with bindFeHost(runtime) from @apackdev/sdk/runtime');
  return bound;
}
