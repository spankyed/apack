import { cancelPendingElicitation } from './_helpers/thread-context.ts';
/**
 * CC: Reconcile State — clears stale Claude Code run-state left over from a previous process.
 *
 * CLI query handles live in a module-level Map (handle-store.ts) — i.e.
 * process-memory only — so after the BE restarts, every thread whose
 * `context.claudeCode.isRunning === true` is stale by definition.
 *
 * Without this:
 *   - chat.ts keeps queueing every new user message against the phantom
 *     "running" turn and the queue never drains.
 *   - The FE initialises chatStates from the thread entity, so the chat panel
 *     shows "working" indefinitely after a crash mid-turn.
 *
 * Runs on flow entry before keepAlive.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'CC: Reconcile State',
  description: 'Clears stale Claude Code run-state left over from a previous process.',
  category: 'claude-code',
  input: {},
};

export async function action(_params: Record<string, any>, services: Services) {
  const threads = (services.repository.threadQueries as any).allUnfiltered() as any[];
  let threadsFixed = 0;
  let artifactsFixed = 0;

  for (const thread of threads) {
    const cc = thread.context?.claudeCode;
    const isPaused = thread.chatState === 'paused';
    const elicitation = cc?.pendingElicitation;
    const owner = elicitation ? services.cli.claudeCode.getConversation(thread.id)?.owner : undefined;
    if (elicitation && owner?.handle.pid === elicitation.ownerPid && owner?.hasPendingElicitation(elicitation.requestId)) continue;
    if (elicitation) cancelPendingElicitation(services, thread.id, elicitation.requestId);

    const needsContextRepair = cc && (
      cc.pendingElicitation !== undefined ||
      cc.isRunning === true ||
      cc.autoAcceptEdits !== undefined ||
      cc.queuedMessage !== undefined ||
      (!isPaused && cc.pendingControlRequest !== undefined)
    );
    const staleChatState = thread.chatState === 'working' || !!elicitation && isPaused && !cc?.pendingControlRequest;

    if (!needsContextRepair && !staleChatState) continue;

    const updates: Record<string, any> = {};

    if (needsContextRepair) {
      const nextCc = {
        ...cc,
        isRunning: false,
        pendingElicitation: undefined,
        autoAcceptEdits: undefined,
        queuedMessage: undefined,
        ...(!isPaused && { pendingControlRequest: undefined }),
      };
      updates.context = { ...thread.context, claudeCode: nextCc };
    }

    if (staleChatState) {
      updates.chatState = 'idle';
    }

    if (needsContextRepair) {
      // Also fix stale claude-session artifact chatState on this thread
      const artifact = services.repository.chatCommands.findArtifactByType(thread.id, 'claude-session' as any);
      if (artifact) {
        const content = artifact.content as any;
        if (content?.chatState === 'working') {
          services.repository.chatCommands.updateArtifact(artifact.id, { content: { ...content, chatState: 'idle' } });
          artifactsFixed++;
        }
      }
    }

    services.repository.threadCommands.update(thread.id, updates);
    threadsFixed++;
  }

  if (threadsFixed || artifactsFixed) {
    services.logger.info(`[claude-code] Reconciled stale state (threads=${threadsFixed}, artifacts=${artifactsFixed})`);
  }

  return { success: true, threadsFixed, artifactsFixed };
}
