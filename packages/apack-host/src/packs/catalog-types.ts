import type {
  HelpDocument, NativePackDeclaration, PackEventContracts, PackManifest, PackSnapshot, SettingsDefinition, SurfaceDeclaration,
} from '@apackdev/sdk/framework';
import type { FeatureRef } from '@apackdev/sdk/ids';
import type { PackIntegrity } from './layout-paths.ts';

export type CatalogData<T> = T extends object ? { readonly [K in keyof T]: CatalogData<T[K]> } : T;

/** An app's offered default, not an installed or active settings owner. */
export interface AppPackSource {
  readonly id: string;
  readonly dir: string;
  readonly snapshot: PackSnapshot;
  readonly files: Readonly<Record<string, string>>;
  readonly sourceRevision: string;
}

export interface AppPackSourceProblem {
  readonly id: string;
  readonly dir: string;
  readonly message: string;
}

export interface AppPackSources {
  readonly sources: readonly AppPackSource[];
  readonly problems: readonly AppPackSourceProblem[];
}

/** An installed build's declarations and host-owned enablement, independent of activation. */
export interface PackCatalogEntry {
  readonly snapshot: CatalogData<PackSnapshot>;
  readonly dir: string;
  readonly enabled: boolean;
  /** Verified installed asset receipt; source/dependency data projections do not manufacture one. */
  readonly integrity?: CatalogData<PackIntegrity>;
  readonly buildRevision?: string;
}

export interface PackCatalogSource {
  snapshot: unknown;
  dir: string;
  enabled: boolean;
  integrity?: PackIntegrity;
}

/** Source authoring declares its manifest before a bundle exists; this is not installed admission. */
export interface SourcePackDeclaration {
  readonly manifest: CatalogData<PackManifest>;
  readonly dir: string;
  readonly declarationRevision: string;
  readonly help?: CatalogData<HelpDocument[]>;
  readonly eventContracts?: CatalogData<PackEventContracts>;
}

/** Known surface data; availability and accepted executable bindings are separate. */
export interface SurfaceCatalogEntry {
  readonly featureRef: FeatureRef;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: CatalogData<SurfaceDeclaration>;
  /** Compiled claims; absent on authoring-source previews that have no built contracts. */
  readonly opens?: readonly string[];
  readonly declarationRevision?: string;
  readonly enabled?: boolean;
  readonly buildRevision?: string;
}

/** A visible installed directory whose candidate declarations could not be accepted. */
export interface PackCatalogProblem {
  readonly id: string;
  readonly dir: string;
  readonly enabled: boolean;
  readonly message: string;
}

export interface PackCatalogSnapshot {
  readonly revision: number;
  readonly appSettings: CatalogData<SettingsDefinition>;
  readonly packs: readonly PackCatalogEntry[];
  readonly problems: readonly PackCatalogProblem[];
  readonly native: readonly CatalogData<NativePackDeclaration>[];
  readonly sourcePacks: readonly SourcePackDeclaration[];
  readonly appPackSources: readonly CatalogData<AppPackSource>[];
  readonly appPackSourceProblems: readonly CatalogData<AppPackSourceProblem>[];
}

/** One backend run's committed declaration snapshot, independent of executable availability. */
export interface PackCatalogFrame {
  readonly runId: string;
  readonly snapshot: PackCatalogSnapshot;
}
