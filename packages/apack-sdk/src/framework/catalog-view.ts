import type { ArtifactDeclaration, BlockDeclaration, DslDeclaration, StepEntry } from './declaration-types.ts';
import type { FeatureRef } from '../ids/refs.ts';
import type { ReferenceDeclarations } from './reference-declaration.ts';
import type { FrontendDeclaration } from './frontend-declaration.ts';
import type { FeatureEventContract } from './event-contracts.ts';

export type { DslDeclaration, ArtifactDeclaration, BlockDeclaration };

/** Declaration data is immutable independently of executable binding availability. */
export type DeclarationData<T> = T extends object ? { readonly [K in keyof T]: DeclarationData<T[K]> } : T;

export interface ReferenceCatalogEntry {
  readonly featureRef: FeatureRef;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: DeclarationData<ReferenceDeclarations>;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly enabled?: boolean;
}

export interface FrontendCatalogEntry {
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: DeclarationData<FrontendDeclaration>;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly enabled?: boolean;
}

/** Step wire identity belongs to its declaring pack; runtime readiness is a separate concern. */
export interface StepCatalogEntry {
  readonly type: string;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: DeclarationData<StepEntry>;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly enabled?: boolean;
}

export interface ArtifactCatalogEntry {
  readonly type: string;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: DeclarationData<ArtifactDeclaration>;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly enabled?: boolean;
}

export interface BlockCatalogEntry {
  readonly type: string;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: DeclarationData<BlockDeclaration>;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly enabled?: boolean;
}

/** Type data can be discovered before activation; source declarations may not have compiled definitions. */
export interface DslCatalogEntry {
  readonly type: string;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: DeclarationData<DslDeclaration>;
  readonly definitions?: string;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
  readonly enabled?: boolean;
}

/** Declared endpoint names; source previews distinguish uncompiled contracts from empty inboxes. */
export type FeatureEventCatalogEntry = {
  readonly featureRef: FeatureRef;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly enabled?: boolean;
  readonly declarationRevision?: string;
  readonly buildRevision?: string;
} & ({ readonly status: 'compiled'; readonly declaration: DeclarationData<FeatureEventContract> }
  | { readonly status: 'unavailable'; readonly declaration?: never });

/** Typed projections of the common declaration inventory; reading never activates a pack. */
export interface PackCatalogView {
  status(): 'loading' | 'ready' | 'disconnected' | 'error' | 'disposed';
  problem(): string | undefined;
  references(): readonly ReferenceCatalogEntry[];
  frontend(): readonly FrontendCatalogEntry[];
  steps(): readonly StepCatalogEntry[];
  artifacts(): readonly ArtifactCatalogEntry[];
  blocks(): readonly BlockCatalogEntry[];
  dsl(): readonly DslCatalogEntry[];
  /** Static endpoint contracts, independently of runtime binding availability. */
  events(): readonly FeatureEventCatalogEntry[];
  subscribe(listener: () => void): () => void;
}
