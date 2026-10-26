/**
 * CC: Turn Completed — finalizes the session artifact and creates the diff
 * artifact after a streaming turn ends.
 *
 * Triggered by the `cc.stream.completed` brain event emitted from the
 * stream consumer (both success and error paths). The consumer handles
 * ordering-critical state (writer finalize, toolActivity finalise,
 * clearHandle, setRunning) synchronously before emitting the event.
 * This action handles the async-safe work: UI updates and artifact creation.
 * Queue drain stays in the consumer (ordering-critical).
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, updateClaudeState, updateChatState, endGoal } from './_helpers/thread-context.ts';
import { parseUnifiedDiff } from './_helpers/parse-diff.ts';

export const meta: ActionMeta = {
  label: 'CC: Turn Completed',
  description: 'Finalizes session stats and creates diff artifact after a turn.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    sessionId: { type: 'string', description: 'CLI session ID', required: false },
    costUsd: { type: 'number', description: 'Total cost in USD', required: false },
    durationMs: { type: 'number', description: 'Turn duration in ms', required: false },
    toolCallCount: { type: 'number', description: 'Number of tool calls', required: false },
    mutatedFileCount: { type: 'number', description: 'Files mutated', required: false },
    mutatedPaths: { type: 'array', description: 'File paths that were mutated', required: false },
    hadErrors: { type: 'boolean', description: 'Whether errors occurred', required: false },
    error: { type: 'string', description: 'Error message if failed', required: false },
    userText: { type: 'string', description: 'Original user message', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const {
    threadId,
    costUsd,
    durationMs,
    hadErrors,
    error: errorMsg,
    mutatedPaths,
  } = params as {
    threadId: string;
    sessionId?: string;
    costUsd?: number;
    durationMs?: number;
    toolCallCount?: number;
    mutatedFileCount?: number;
    mutatedPaths?: string[];
    hadErrors?: boolean;
    error?: string;
    userText?: string;
  };

  const log = services.logger;

  if (!threadId) return { success: false, reason: 'missing threadId' };

  // ─── Update session artifact ──────────────────────────────────────
  const { toolCallCount } = params as { toolCallCount?: number };

  updateClaudeState(services, threadId as EntityId, (prev) => ({
    turns: (prev.turns ?? 0) + 1,
    totalCostUsd: (prev.totalCostUsd ?? 0) + (costUsd ?? 0),
    toolCallCount: (prev.toolCallCount ?? 0) + (toolCallCount ?? 0),
    lastTurnAt: Date.now(),
  }));

  // A queued-message replay re-enters chat.ts BEFORE this action fires
  // (stream-consumer awaits `replayQueuedMessage` before emitting
  // cc.stream.completed). That replay already set isRunning=true and
  // chatState='working' synchronously, so an unconditional 'idle' write
  // here would overwrite 'working' and leave the chat panel looking
  // stuck in idle for the entire replayed turn — until a permission
  // prompt or its own turn-completed fires. When a follow-up turn is
  // in flight, skip the idle transition AND the success flash;
  // the replayed turn's own turn-completed will handle both.
  const ccState = getClaudeState(services, threadId);
  const running = ccState?.isRunning === true;

  // ─── Goal loop (checked before chatState transition to avoid success flash) ──
  const goalState = ccState?.goal;
  if (goalState?.status === 'active' && !running && !ccState?.commandActive) {
    const MAX_GOAL_ITERATIONS = 20;

    // Check if model signaled goal met in the most recent assistant message
    const threadData = services.repository.chatQueries.threadData(threadId as any);
    const messages = threadData?.messages ?? [];
    const lastAssistant = [...messages].reverse().find(
      (m: any) => m.sender !== 'user' && m.text && !m.compacted,
    );
    const goalMet = lastAssistant?.text ? /\bGOAL_MET\b/.test(lastAssistant.text) : false;

    if (goalMet) {
      endGoal(services, threadId, 'met');
      services.chat.sendBlockMessage({
        threadId: threadId as any,
        text: `Goal achieved: ${goalState.condition}`,
        blocks: [],
      });
      // Fall through to chatState transition + diff artifact below
    } else if (goalState.iterations + 1 >= MAX_GOAL_ITERATIONS) {
      endGoal(services, threadId, 'failed');
      services.chat.sendBlockMessage({
        threadId: threadId as any,
        text: `Goal failed after ${MAX_GOAL_ITERATIONS} iterations: ${goalState.condition}`,
        blocks: [],
      });
      // Fall through to chatState transition + diff artifact below
    } else {
      // Increment iteration and auto-continue — skip chatState transition
      updateClaudeState(services, threadId as EntityId, {
        goal: { ...goalState, iterations: goalState.iterations + 1 },
      });
      updateChatState(services, threadId as EntityId, 'working');

      const iteration = goalState.iterations + 1;
      const prompt = [
        `Continue working toward the goal: "${goalState.condition}" (iteration ${iteration}/${MAX_GOAL_ITERATIONS}).`,
        'If the goal is fully met, say "GOAL_MET" in your response. Otherwise, keep working.',
      ].join('\n');

      try {
        await services.action.executeIfFound('Claude Code Chat', {
          threadId,
          text: prompt,
        });
      } catch (goalErr: any) {
        log.warn('goal continuation failed', { message: goalErr?.message });
        endGoal(services, threadId, 'failed');
        services.chat.sendBlockMessage({
          threadId: threadId as any,
          text: `Goal loop error: ${goalErr?.message || 'Unknown error'}`,
          blocks: [],
        });
      }

      return { success: true, goalContinuation: true };
    }
  }

  if (!running && !ccState?.commandActive) {
    // Don't overwrite a persistent 'error' state (e.g. session-not-found) —
    // markSessionBroken already set it and the user needs to see it.
    const currentChatState = ccState?.chatState;
    if (currentChatState !== 'error') {
      // If chatState is already 'idle', the turn was paused/cancelled by the
      // user (pause-turn sets 'idle' before this action fires). Skip the
      // success state — the turn didn't complete, it was interrupted.
      const wasPaused = currentChatState === 'idle';
      const nextState = !hadErrors && !wasPaused ? 'success' : 'idle';
      log.debug('turn-completed chatState decision', {
        threadId, hadErrors, currentChatState, wasPaused, nextState,
      });
      updateChatState(services, threadId as EntityId, nextState);
      if (nextState === 'success') {
        services.emitter.broadcastToSurface('default-setup/threads', {
          type: 'FLASH_CHAT_STATE', threadId, stateId: 'success', durationMs: 3000,
        });
      }
    }
  }

  // ─── Diff artifact ────────────────────────────────────────────────
  let artifactId: string | undefined;
  try {
    const paths = Array.isArray(mutatedPaths) ? mutatedPaths : [];
    if (paths.length > 0) {
      log.debug('collecting diff for mutated files', { paths });
      const unified = await services.cli.git.getDiff(paths);
      const parsed = parseUnifiedDiff(unified);
      if (parsed.files.length > 0) {
        const diffTitle = deriveDiffTitle(parsed.files);
        const result = services.artifact.create({
          artifactType: 'diff',
          title: diffTitle,
          content: parsed,
          threadId: threadId as EntityId,
        });
        artifactId = result.artifactId;
        log.debug('diff artifact created', { artifactId, fileCount: parsed.files.length });
      }
    }
  } catch (diffErr: any) {
    log.warn('diff artifact assembly failed', { message: diffErr?.message });
  }

  return {
    success: true,
    hadErrors: !!hadErrors,
    error: errorMsg,
    costUsd,
    durationMs,
    artifactId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function deriveDiffTitle(files: { path: string }[]): string {
  if (files.length === 0) return '[Diff] No changes';
  const basenames = files.map(f => f.path.split('/').pop() ?? f.path);
  const prefix = `[Diff][${files.length}] `;
  const joined = basenames.join(', ');
  if (prefix.length + joined.length <= 80) return prefix + joined;
  let result = '';
  for (let i = 0; i < basenames.length; i++) {
    const next = result ? result + ', ' + basenames[i] : basenames[i];
    if (prefix.length + next.length + 1 > 80) {
      return prefix + result + '…';
    }
    result = next;
  }
  return prefix + result;
}
