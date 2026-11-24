import type { PackConsumption } from './service-consumption.ts';
import type { ArtifactDeclaration, BlockDeclaration, DslDeclaration, PackMigrationsDeclaration, StepEntry } from './declaration-types.ts';
import type { PackLifecycleDeclaration } from './lifecycle-declaration.ts';
import type { PackDataDeclarations, PackEntityDeclaration } from './data-declaration.ts';
import { boundHost } from '../runtime/host-runtime.ts';
import type { SettingsDefinition } from './settings-definition.ts';
import type { DeclarationData } from './catalog-view.ts';
import type { ReferenceDeclarations } from './reference-declaration.ts';
import type { SurfaceDeclaration } from './surface-declaration.ts';
import type { FrontendDeclaration } from './frontend-declaration.ts';

/** Native composition data, admitted independently of its executable bindings. */
export interface NativePackDeclaration extends PackDataDeclarations, FrontendDeclaration {
  id: string;
  /** This native pack's own version; required for pack-line migrations, independent of the app version. */
  version?: string;
  /** Versioned changes declared independently of their executable bindings. */
  migrations?: PackMigrationsDeclaration;
  lifecycle?: PackLifecycleDeclaration;
  /** Native writers and explicitly applied content; compilation and automatic application belong to installed builds. */
  content?: {
    writers?: Record<string, string>;
    sources?: Record<string, { applier: string }>;
  };
  steps?: Record<string, StepEntry>;
  artifacts?: Record<string, ArtifactDeclaration>;
  blocks?: Record<string, BlockDeclaration>;
  dsl?: Record<string, DeclarationData<DslDeclaration>>;
  /** Compiled type data supplied by native composition, independently of frontend activation. */
  dslDefinitions?: Record<string, string>;
  /** Compiled entity wire name to local surface feature, supplied by native composition. */
  entityDestinations?: Record<string, string>;
  /** Static transport contracts, including native inboxes without contributed UI panes. */
  eventContracts?: import('./event-contracts.ts').PackEventContracts;
  dependencies?: Record<string, string>;
  /** Required service refs in addition to the implicit SDK baseline and own services. */
  consumes?: PackConsumption;
  settings?: Record<string, SettingsDefinition>;
  /** Native APIs without a feature owner; values identify their composition bindings. */
  services?: Record<string, string>;
  repositories?: Record<string, string>;
  features?: Record<string, {
    description: string;
    entities?: Record<string, PackEntityDeclaration>;
    designation?: string;
    settings?: SettingsDefinition;
    surface?: SurfaceDeclaration;
    references?: ReferenceDeclarations;
    services?: Record<string, string>;
    repositories?: Record<string, string>;
  }>;
}

/** Observe committed declaration changes, independently of executable pack activation. */
export function onPackCatalogChanged(listener: () => void): () => void {
  return boundHost().packs.onCatalogChanged(listener);
}
