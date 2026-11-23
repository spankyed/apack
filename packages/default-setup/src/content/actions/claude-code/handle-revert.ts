/**
 * CC: Handle Revert — cleans up Claude Code state when a thread is reverted
 * and sets up CLI-level session truncation for the next turn.
 *
 * Triggered by the `thread.revert` brain event with `kind: 'revert'`.
 * Kills any active CLI process, clears turn-level state, and stores a
 * `revertTo` flag with the CLI UUID of the last assistant message before
 * the revert point. The next chat action uses this to pass
 * `--resume-session-at` + `--fork-session` so the CLI creates a truncated
 * forked session.
 *
 * Variant paths (file rewind via `--rewind-files`, or `/compact`
 * summarization) live in sibling actions — `CC: Handle Rewind` and
 * `CC: Handle Summarize` — which delegate the common setup back to this
 * action via `services.action.executeIfFound`.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { persistClaudeState, getClaudeState, killTurn, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Handle Revert',
  description: 'Cleans up Claude Code state and sets up CLI session truncation on revert.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    messageId: { type: 'string', description: 'Message ID being reverted to', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId, messageId } = params as {
    threadId: string;
    messageId: string;
  };

  if (!threadId) return { success: false, reason: 'missing threadId' };

  const log = services.logger;
  const state = getClaudeState(services, threadId);

  log.debug('[revert] state BEFORE revert', {
    threadId,
    messageId,
    sessionId: state?.sessionId ?? 'NONE',
    isRunning: state?.isRunning ?? false,
    hasForkFrom: !!state?.forkFrom,
    hasRevertTo: !!state?.revertTo,
  });

  // ── 1. Clean up turn state ──────────────────────────────────────────
  // The flow's pause step (CC: Pause Turn) already ran before this
  // action. killTurn() is idempotent — it serves as a safety net to
  // clean up plan drafts, approval blocks, queued messages, and all
  // mid-turn flags if the pause step was skipped or incomplete.
  const hadActiveHandle = !!services.cli.claudeCode.getHandle(threadId);
  killTurn(services, threadId);

  // ── 2. Find the CLI UUID of the last remaining assistant message ──
  // The threads system already soft-deleted the target message and
  // everything after it. threadData.messages only has messages before
  // the revert point.
  let cliUuid: string | undefined;
  if (state?.sessionId) {
    const threadData = services.repository.chatQueries.threadData(threadId as EntityId);
    const messages = (threadData?.messages ?? []) as Array<{
      id?: string;
      sender?: string;
      context?: Record<string, unknown>;
    }>;
    const lastAssistant = messages.findLast(
      m => m.sender === 'assistant' && m.context?.cliUuid,
    );
    cliUuid = lastAssistant?.context?.cliUuid as string | undefined;

    // Validate the cliUuid exists in the current session's JSONL.
    // After compaction the sessionId changes but existing messages retain
    // cliUuids from the old session. Passing a stale UUID to
    // --resume-session-at would trigger a confusing "session file deleted"
    // error. Check the transcript and fall back to a fresh session if the
    // UUID doesn't exist in the current session.
    if (cliUuid && state.sessionId) {
      let uuidValid = false;
      try {
        const transcript = await services.cli.claudeCode.viewSession(
          state.sessionId,
          { cwd: state.cwd },
        ) as Array<Record<string, unknown>>;
        uuidValid = transcript.some(
          (e: any) => e.type === 'assistant' && e.uuid === cliUuid,
        );
      } catch (err: any) {
        log.warn('[revert] could not validate cliUuid against session JSONL', {
          threadId, sessionId: state.sessionId, cliUuid, err: err?.message,
        });
        // Validation failed — treat as invalid to avoid a worse error later.
      }
      if (!uuidValid) {
        log.info('[revert] cliUuid not found in current session (likely post-compaction) — starting fresh', {
          threadId, cliUuid, sessionId: state.sessionId,
        });
        cliUuid = undefined;
      }
    }
  }

  // ── 3. Set revert flag ────────────────────────────────────────────
  persistClaudeState(services, threadId, (cliUuid ? { revertTo: { cliUuid }, forkFrom: undefined } : {
      // No CLI UUID found (reverting to first message, no prior assistant,
      // or stale UUID from a compacted session). Clear sessionId and any
      // stale one-shot flags so the next turn starts fresh.
      sessionId: undefined,
      forkFrom: undefined,
      revertTo: undefined,
    }));

  // Flip the session artifact to idle.
  updateChatState(services, threadId as EntityId, 'idle');

  log.debug('[revert] state AFTER revert', {
    threadId,
    messageId,
    cliUuid: cliUuid ?? 'NONE (will start fresh)',
    sessionIdPreserved: !!cliUuid,
    hadActiveHandle,
  });

  return { success: true, hadActiveHandle, cliUuid };
}
