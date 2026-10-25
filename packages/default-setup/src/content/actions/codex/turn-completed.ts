/** CDX: Turn Completed — finalizes session stats and creates diff artifact. */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getCodexState, persistCodexState, updateCodexState, updateChatState } from './_helpers/thread-context.ts';
import { parseUnifiedDiff } from '../claude-code/_helpers/parse-diff.ts';

export const meta: ActionMeta = {
  label: 'CDX: Turn Completed',
  description: 'Finalizes session stats and creates diff artifact after a Codex turn.',
  category: 'codex',
  input: {
    threadId: { type: 'string', required: true },
    usage: { type: 'object', required: false },
    toolCallCount: { type: 'number', required: false },
    recentTools: { type: 'array', required: false },
    mutatedPaths: { type: 'array', required: false },
    hadErrors: { type: 'boolean', required: false },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const { threadId, usage, hadErrors, mutatedPaths, toolCallCount, recentTools } = params as {
    threadId: string;
    usage?: { input: number; output: number; reasoning?: number };
    hadErrors?: boolean;
    mutatedPaths?: string[];
    toolCallCount?: number;
    recentTools?: Array<{ name: string; summary?: string; at: number }>;
  };

  if (!threadId) return { success: false, reason: 'missing threadId' };

  // Snapshot previous state for goal token delta calculation
  const prevState = getCodexState(services, threadId);
  const prevTotalSum = (prevState?.totalTokens?.input ?? 0) + (prevState?.totalTokens?.output ?? 0);

  updateCodexState(services, threadId as EntityId, (prev) => ({
    turns: (prev.turns ?? 0) + 1,
    totalTokens: usage ?? prev.totalTokens,
    toolCallCount: (prev.toolCallCount ?? 0) + (toolCallCount ?? 0),
    recentTools: Array.isArray(recentTools) && recentTools.length > 0
      ? [...(prev.recentTools ?? []), ...recentTools.map(tool => ({
        name: tool.name,
        summary: tool.summary ?? '',
        at: tool.at,
      }))].slice(-5)
      : prev.recentTools,
    lastTurnAt: Date.now(),
  }));

  // ─── Goal token accounting ────────────────────────────────────────
  const goal = prevState?.goal;
  if (goal && goal.status === 'active' && usage) {
    const currTotalSum = (usage.input ?? 0) + (usage.output ?? 0);
    const turnDelta = Math.max(0, currTotalSum - prevTotalSum);
    const newUsed = (goal.tokensUsed ?? 0) + turnDelta;

    const goalPatch: Record<string, any> = { tokensUsed: newUsed };

    if (goal.tokenBudget && newUsed >= goal.tokenBudget) {
      goalPatch.status = 'budget_limited';
    }
    if (goal.objectiveEdited) {
      goalPatch.objectiveEdited = false;
    }

    persistCodexState(services, threadId as string, { goal: { ...goal, ...goalPatch } });
  }

  const cdxState = getCodexState(services, threadId);
  if (!cdxState?.isRunning && cdxState?.chatState !== 'error') {
    const wasPaused = cdxState?.chatState === 'idle';
    updateChatState(services, threadId as EntityId, !hadErrors && !wasPaused ? 'success' : 'idle');
  }

  // Diff artifact
  let artifactId: string | undefined;
  const paths = Array.isArray(mutatedPaths) ? mutatedPaths : [];
  if (paths.length > 0) {
    try {
      const parsed = parseUnifiedDiff(await services.cli.git.getDiff(paths));
      if (parsed.files.length > 0) {
        const basenames = parsed.files.map(f => f.path.split('/').pop() ?? f.path);
        const prefix = `[Diff][${parsed.files.length}] `;
        let title = prefix + basenames.join(', ');
        if (title.length > 80) title = prefix + basenames.slice(0, 3).join(', ') + '…';
        artifactId = services.artifact.create({ artifactType: 'diff', title, content: parsed, threadId: threadId as EntityId }).artifactId;
      }
    } catch (e: any) {
      services.logger.warn('[codex] diff failed', { message: e?.message });
    }
  }

  const shouldContinueGoal = !!(
    cdxState?.goal?.status === 'active' &&
    !cdxState?.isRunning &&
    !hadErrors
  );

  return { success: true, hadErrors: !!hadErrors, artifactId, shouldContinueGoal };
}
