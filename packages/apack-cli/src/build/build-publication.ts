import path from 'node:path';
import { PACK_BUILD_STAGING_DIR } from '@apackdev/host/build/pack-workdir';
import { packInputsHash } from '@apackdev/host/build/pack-inputs';
import { readPackBuild } from '@apackdev/host/packs';
import { replaceDir } from '@apackdev/host/replace-dir';

/** Candidate identity is a publication handoff, not a complete source-freshness receipt. */
export interface PackBuildCandidate {
  readonly inputHash: string;
  readonly revision: string;
}

/** Keep candidates on the same filesystem as dist; the build lock lives outside this cleared tree. */
export function buildStagingDir(root: string): string {
  return path.join(root, PACK_BUILD_STAGING_DIR);
}

/** The caller holds the pack lock and, for public builds, has waited for compiler process closure. */
export function publishPackBuild(root: string, candidate: PackBuildCandidate): void {
  if (packInputsHash(root) !== candidate.inputHash) throw new Error('Pack inputs changed before publication; retry the build');
  const staged = buildStagingDir(root);
  if (readPackBuild(staged).revision !== candidate.revision) throw new Error('Build candidate changed before publication');
  replaceDir(staged, path.join(root, 'dist'));
  console.log(`\nOutput: ${path.relative(process.cwd(), path.join(root, 'dist'))}/`);
}

const MESSAGE = 'apack:build-candidate';
export function readPackBuildCandidate(message: unknown): PackBuildCandidate | undefined {
  if (!message || typeof message !== 'object') return;
  const value = message as Record<string, unknown>;
  if (value.type !== MESSAGE) return;
  const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!hash(value.inputHash) || !hash(value.revision)) throw new Error('Build worker reported an invalid candidate');
  return { inputHash: value.inputHash, revision: value.revision };
}

export async function reportPackBuildCandidate(candidate: PackBuildCandidate): Promise<void> {
  if (!process.send || !process.connected) throw new Error('Build candidate requires its parent IPC channel');
  await new Promise<void>((resolve, reject) => process.send!({ type: MESSAGE, ...candidate }, (error: Error | null) => error ? reject(error) : resolve()));
}
