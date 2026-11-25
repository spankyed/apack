import type { PackManifest } from '@apackdev/sdk/framework';

/** A pack whose frontend the renderer loads (the API's `packs.loaded`) */
export interface LoadedPackEntry {
  id: string;
  /** Host-issued accepted runtime identity, independent of build content identity. */
  registrationId: string;
  /** Declaration identity of the active backend; frontend bindings must match it. */
  declarationRevision: string;
  /** Accepted declarations of the active backend, used to validate frontend binding membership. */
  manifest?: PackManifest;
  /** Verified accepted build identity; native host registrations have no installed build. */
  buildRevision?: string;
  name: string;
  version: string;
  /** The pack's runtime/fe.js, when it has one */
  feEntry?: string;
  /** The pack's runtime/fe.css, when it has one */
  feStyles?: string;
  /** Explicit source delivery for apack pack dev; never used by an installed build request. */
  developmentBaseUrl?: string;
}
