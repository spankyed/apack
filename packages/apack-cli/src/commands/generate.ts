import * as path from 'node:path';
import type { PackDependencySnapshot, PackTypeManifest } from '@apackdev/pack-format';
import { resolveDepFiles, type DependencyResolutionOptions, type ResolvedDepFiles } from './fetch-deps';

export async function resolveDependencyFiles(root: string, deps: Record<string, string> = {}, options: DependencyResolutionOptions = {}): Promise<Map<string, ResolvedDepFiles>> {
  const result = new Map<string, ResolvedDepFiles>();
  const unresolved: string[] = [];
  for (const [depId, depValue] of Object.entries(deps)) {
    const files = await resolveDepFiles(root, depId, depValue, options);
    if (!files) {
      unresolved.push(depValue.startsWith('file:')
        ? `${depId}: no build output at ${path.resolve(root, depValue.slice('file:'.length).trim())} (run "apack pack build" there first)`
        : `${depId} ("${depValue}"): not found in the installed app, a workspace, a GitHub release or the local cache`);
      continue;
    }
    result.set(depId, files);
  }
  // Generated types and flow helpers depend on every dependency; continuing would fail
  // later with misleading errors (e.g. missing flow helper exports)
  if (unresolved.length > 0) {
    throw new Error(`Unresolved pack dependencies:\n${unresolved.map(u => `  - ${u}`).join('\n')}\nUse "file:<path>" or "github:<owner>/<repo> <range>" in apack.json dependencies.`);
  }
  return result;
}

export interface ResolvedDeps {
  readonly depTypes: Map<string, PackTypeManifest>;
  readonly depSnapshots: Map<string, PackDependencySnapshot>;
  readonly files: ReadonlyMap<string, ResolvedDepFiles>;
}

export async function resolveDeps(root: string, deps?: Record<string, string>, options: DependencyResolutionOptions = {}): Promise<ResolvedDeps> {
  const files = await resolveDependencyFiles(root, deps, options);
  return dependencyTypes(files);
}

/** Project the snapshots already resolved for this frame; validation and generation share it. */
export function dependencyTypes(files: ReadonlyMap<string, ResolvedDepFiles>): ResolvedDeps {
  const depSnapshots = new Map([...files].map(([id, files]) => [id, files.snapshot]));

  const depTypes = new Map<string, PackTypeManifest>();
  for (const [id, snap] of depSnapshots) depTypes.set(id, snap.types);

  return { depTypes, depSnapshots, files };
}
