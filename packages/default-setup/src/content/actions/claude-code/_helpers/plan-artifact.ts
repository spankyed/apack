/**
 * Plan artifact helper — create a draft plan and resolve it to
 * approved/rejected when the user responds to the plan-approval block.
 *
 * Lifecycle semantics:
 *   - A thread has at most ONE draft plan artifact at a time.
 *   - Once a plan is approved or rejected, any future ExitPlanMode call
 *     creates a fresh artifact so plan history stays legible in the right
 *     panel.
 *   - Previous plans remain as persistent artifacts — we don't delete
 *     rejected/approved ones.
 *
 * All lookups go directly through the in-memory EARS repository — no
 * module-level cache. EARS is LMDB-backed and kept in memory, so the
 * repository query is essentially a Map access.
 *
 * Shape contract: PlanArtifactContent, from the threads feature types (the plan viewer reads the same type)
 *
 * Files without `export const meta` are auto-inlined into the consuming
 * action at compile time (see packages/default-setup/CLAUDE.md), so this
 * helper adds zero runtime dependencies.
 */

import type { Services, EntityId } from '#generated/services.ts';
import type { PlanArtifactContent } from '#features/threads/be/types.ts';

export type { PlanArtifactContent };

/**
 * Extract a human-readable title from the plan markdown.
 * Looks for the first `# heading` line and prefixes it with "plan:".
 * Falls back to "Implementation Plan" when no heading is found.
 */
function extractPlanTitle(planMarkdown: string): string {
  const match = planMarkdown.match(/^#\s+(.+)/m);
  return match ? `[Plan] ${match[1].trim()}` : 'Implementation Plan';
}

/**
 * Create a new plan artifact in `draft` status containing the given
 * markdown body and notify the frontend.
 *
 * Always creates a fresh artifact — historical plans (approved or
 * rejected) remain in the thread so the user can scroll back and see
 * what Claude proposed at each stage.
 */
export function createPlanDraft(
  services: Services,
  threadId: EntityId,
  planMarkdown: string,
  title?: string,
  opts?: { branch?: string; prNumber?: string },
): EntityId {
  const resolvedTitle = title ?? extractPlanTitle(planMarkdown);
  const content: PlanArtifactContent = {
    notes: planMarkdown,
    status: 'draft',
    steps: [],
    ...(opts?.branch && { branch: opts.branch }),
    ...(opts?.prNumber && { prNumber: opts.prNumber }),
  };
  const { artifactId } = services.artifact.create({
    artifactType: 'plan',
    title: resolvedTitle,
    content,
    threadId,
  });
  return artifactId as EntityId;
}

/**
 * Flip the most recent draft plan for this thread to `approved` or
 * `rejected`. Reads the current content off the repository so existing
 * fields (notes, steps) are preserved. No-op if there's no draft plan
 * (e.g. ExitPlanMode never fired, or the previous call already resolved
 * it).
 */
export function resolvePlanDraft(
  services: Services,
  threadId: EntityId,
  nextStatus: 'approved' | 'rejected',
): void {
  // Find the most recent plan artifact still in draft status.
  const artifacts = services.repository.chatQueries.threadArtifacts(threadId) as Array<{
    id: EntityId;
    type: string;
    content: unknown;
  }>;
  const draft = artifacts.find(
    a => a.type === 'plan' && (a.content as Partial<PlanArtifactContent>)?.status === 'draft',
  );
  if (!draft) return;

  const prevContent = (draft.content as Partial<PlanArtifactContent>) ?? {};
  const nextContent: PlanArtifactContent = {
    notes: prevContent.notes ?? '',
    steps: prevContent.steps ?? [],
    status: nextStatus,
  };

  services.artifact.update(draft.id, {
    content: nextContent,
  });
}
