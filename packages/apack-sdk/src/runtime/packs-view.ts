// What the registered packs contributed, as the SDK reads it. The app that registers them owns the data (host's
// createPackRegistry and createFePackRegistry) and binds read-only views: HostRuntime.packs in a backend process,
// FeHostRuntime.packs (FePackRegistryView, fe-host.ts) in the renderer.
import type { ProjectionDefinition } from '../framework/projections.ts';
import type { FeatureRef } from '../ids/refs.ts';
import type { StepDefinition } from '../steps/types.ts';
import type { StepBackendBinding } from '../steps/catalog.ts';
import type { StepCatalogEntry } from '../framework/catalog-view.ts';
import type { ArtifactDefinition } from '../artifacts/types.ts';
import type { BlockDefinition } from '../blocks/types.ts';
import type { ContentWriter } from '../content/writers.ts';
import type { ContentApplier } from '../utils/apply.ts';
import type { SettingsCatalog } from '../framework/pack-settings.ts';
import type { HelpCatalog } from '../framework/pack-help.ts';

/** Entity types, relation kinds and roles by the name they're declared under (their EARS constants) */
export interface EarsNames {
  entities: Record<string, string>;
  relKinds: Record<string, string>;
  roles: Record<string, string>;
}
import { _isHostBound, boundHost } from './host-runtime.ts';
import { _isFeHostBound, boundFeHost } from './fe-host.ts';

/** What backend and frontend code both look up in the registered packs */
export interface PackExtensionsView {
  /** The id of the system (backend) or surface (frontend) that plays a role */
  designation(role: string): FeatureRef | undefined;
  artifact(type: string): ArtifactDefinition | undefined;
  artifacts(): ArtifactDefinition[];
  block(type: string): BlockDefinition | undefined;
  blocks(): BlockDefinition[];
}

/** The registered packs, read-only: what the SDK looks up in them in a backend process */
export interface PackRegistryView extends PackExtensionsView {
  step(type: string): StepDefinition | undefined;
  /** Every registered step definition, in registration order */
  steps(): StepDefinition[];
  /** Committed declarations, independent of backend activation. */
  stepDeclarations(): readonly StepCatalogEntry[];
  /** Accepted backend bindings; current declaration eligibility is checked separately. */
  stepBindings(): ReadonlyMap<string, StepBackendBinding>;
  /** Every registered pack's services, by name */
  getRegisteredServices(): Record<string, unknown>;
  /** Every registered feature's projections, with the name each is known by */
  projections(): ReadonlyArray<{ name: string; projection: ProjectionDefinition }>;
  /** The repository a registered pack declares under `name`, or undefined */
  repository(name: string): unknown;
  /** The refs of every registered system, the host's included */
  systemIds(): readonly FeatureRef[];
  /** The refs of every registered surface, the host's included */
  surfaceIds(): readonly FeatureRef[];
  /** The content writers registered for an entity type */
  contentWriters(entity: string): ContentWriter | undefined;
  /** A registered pack's appliers */
  appliers(packId: string): readonly ContentApplier[];
  settingsCatalog(): SettingsCatalog;
  onCatalogChanged(listener: () => void): () => void;
  /** Navigation policy is separate from preference definitions. */
  surfaceDefaults(): Record<string, boolean>;
  /** Every registered pack's help entries, for the Settings view's Help list */
  help(): HelpCatalog;
  /** The app's own entity types and relation kinds and every registered pack's, by the name each declares them under */
  earsNames(): EarsNames;
  /**
   * The entity type a short code belongs to, from the prefixes the SDK and every registered pack declare: `THR-41` →
   * `Thread`. Undefined for a code that isn't `<prefix>-<n>` or whose prefix no registered type numbers with. Find the
   * entity with the typed query, `query(type).where('shortCode', code)`, which the value index answers
   */
  entityTypeOfShortCode(code: string): string | undefined;
}

/**
 * @internal The registered packs' extensions: the frontend's in the renderer, the backend's elsewhere. Throws,
 * naming bindHost and bindFeHost, when neither is bound.
 */
export function _boundPackExtensions(): PackExtensionsView {
  if (_isFeHostBound()) return boundFeHost().packs;
  if (_isHostBound()) return boundHost().packs;
  throw new Error(
    'No host is bound, so no registered packs to look up: the app binds one at boot with bindHost(runtime) from '
    + '@apackdev/sdk/runtime (the renderer with bindFeHost(runtime)), and unit tests with startTestRuntime() from @apackdev/sdk/testing',
  );
}
