/**
 * Artifact Service
 *
 * Creates and updates the artifacts a thread holds. A window sees them through the thread's `tab` view, which runs
 * again after each of these writes, so nothing here tells a window anything.
 */

import { EARS } from '#generated/ears.ts';

import { repository } from '#generated/repository.ts';
import type { ArtifactType } from '#features/threads/be/types.ts';

export interface CreateArtifactOptions {
  artifactType: ArtifactType;
  title: string;
  content: any;
  threadId?: EARS.EntityId;
  color?: string;
}

export interface UpdateArtifactOptions {
  title?: string;
  content?: unknown;
}

/**
 * Create an artifact, linked to `threadId` when it names one
 * @example
 * const { artifactId } = create({ artifactType: 'todo', title: 'Tasks', content: { tasks: [...] }, threadId });
 */
export function create(options: CreateArtifactOptions): { artifactId: EARS.EntityId } {
  return repository.chatCommands.createArtifact(options);
}

/**
 * Patch an artifact's title and/or content in place: for artifacts that change across turns (the Claude Code session
 * card, which tracks live status, cost and turn count)
 */
export function update(artifactId: EARS.EntityId, options: UpdateArtifactOptions): void {
  repository.chatCommands.updateArtifact(artifactId, { title: options.title, content: options.content });
}

/**
 * Find-or-create an artifact by (thread, artifactType). Guarantees at most
 * one artifact of the given type per thread. Useful for singletons like the
 * Claude Code session card that should only ever exist once per thread.
 */
export function findOrCreateByType(
  threadId: EARS.EntityId,
  artifactType: ArtifactType,
  initial: { title: string; content: any; color?: string },
): { artifactId: EARS.EntityId; created: boolean } {
  const existing = repository.chatCommands.findArtifactByType(threadId, artifactType);
  if (existing?.id) {
    return { artifactId: existing.id, created: false };
  }
  const { artifactId } = create({
    artifactType,
    title: initial.title,
    content: initial.content,
    ...(initial.color ? { color: initial.color } : {}),
    threadId,
  });
  return { artifactId, created: true };
}

/** `services.artifact`: a thread's artifact writes */
export const artifactService = {
  create,
  update,
  findOrCreateByType,
};
