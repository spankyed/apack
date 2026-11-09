import { boundFeHost } from '../runtime/fe-host.ts'
import type { ReferenceCatalogEntry, PackCatalogView } from '../framework/catalog-view.ts'
import type { FeatureRef } from '../ids/refs.ts'
import type { Component, Ref } from 'vue'

import type { ReferenceSvgElement } from '../framework/reference-declaration.ts'

export { getReferenceTypeDeclaration, getReferenceCategoryDeclarations, getReferenceTypeBinding, getReferenceCategoryBinding, onReferenceBindingsChanged } from './reference-reader.ts'
export { formatReferenceHref, parseReferenceHref } from '../framework/reference-link.ts'
export type { ReferenceTarget } from '../framework/reference-link.ts'
export type { ReferenceCategoryMetadata } from './reference-reader.ts'

/** Defines how a reference appears in the UI. */
export interface ReferenceTypeConfig {
  category: string
  icon: Component
  svgElements: readonly ReferenceSvgElement[]
}

export interface ReferenceItem {
  id: string
  shortCode: string
  label: string
  type: string
}

/** Executable bindings for one feature's declared reference contributions. */
export interface ReferenceBindings {
  types: Record<string, ReferenceTypeConfig>
  categories: Record<string, {
    label: string
    icon: Component
    /** The items a reference can name; `query` is what the user has typed, for a provider that searches rather than lists */
    useItems(query: Readonly<Ref<string>>): Readonly<Ref<ReferenceItem[]>>
  }>
}

/** An accepted reference contribution and the identity the host admitted it under. */
export interface ReferenceBinding<T> {
  readonly featureRef: FeatureRef
  readonly declarationRevision?: string
  readonly registrationId?: string
  readonly buildRevision?: string
  readonly binding: Readonly<T>
}

/** Metadata remains available without executing providers or components. */
export function getReferenceDeclarations(): readonly ReferenceCatalogEntry[] {
  return boundFeHost().catalog.references()
}

/** A retained snapshot may be unavailable after disconnect; execution must use current readiness. */
export function getReferenceCatalogStatus(): ReturnType<PackCatalogView['status']> {
  return boundFeHost().catalog.status()
}

/** Observe declaration updates independently of executable registration changes. */
export function onReferenceDeclarationsChanged(listener: () => void): () => void {
  return boundFeHost().catalog.subscribe(listener)
}
