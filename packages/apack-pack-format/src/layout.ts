/**
 * The layout's major version, which `verifyPack` and the loader refuse a mismatch of.
 *
 * **Bump it whenever a path in `PACK_LAYOUT` changes.** A pack built against an older layout is still a
 * readable directory, so nothing else notices: it is found, registered, and quietly contributes whichever
 * part has moved — no error, no missing file, just an app running without content it was given. The
 * version is what turns that into a refusal naming the pack and asking for a rebuild.
 */
export const PACK_LAYOUT_VERSION = 2;

export const PACK_LAYOUT = {
  manifest: 'apack.json',
  integrity: 'integrity.json',
  runtimeDir: 'runtime',
  runtimeEntry: 'runtime/index.cjs',
  feEntry: 'runtime/fe.js',
  feStyles: 'runtime/fe.css',
  contentDir: 'runtime/content',
  buildDir: 'build',
  stepsBuild: 'build/steps.build.mjs',
  typesDir: 'types',
  snapshot: 'types/snapshot.json',
} as const;

export interface PackIntegrity {
  formatVersion: number;
  id: string;
  version: string;
  hostVersion?: string;
  sdkVersion?: string;
  provenance?: { repo?: string; commit?: string };
  /** sha256 of every file in the pack except integrity.json, keyed by pack-relative path. */
  files: Record<string, string>;
}
