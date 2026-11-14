import { claudeProfileOptions } from '../../../../features/code/common/native-profile.ts';
/**
 * Retroactive `context.cliUuid` backfill for user messages.
 *
 * The stream-consumer writes `msg.context.cliUuid` on each user turn as
 * events stream in. Pre-existing threads (chatted with before the fix
 * that enabled CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING) may be missing
 * those writes, which blocks `--rewind-files` — `handle-rewind.ts` needs
 * the pivot user message's CLI UUID to anchor the rewind at.
 *
 * This helper pulls the authoritative UUIDs from Claude's own session
 * JSONL transcript and pairs them with the thread's surviving user
 * messages by position (both lists are append-only and chronological, so
 * index-based pairing is sound). It's called lazily on a failed rewind
 * so non-rewind flows incur no extra I/O.
 */

import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState } from './thread-context.ts';

export async function backfillUserCliUuids(
  services: Services,
  threadId: EntityId,
): Promise<number> {
  const log = services.logger;
  const state = getClaudeState(services, threadId);
  if (!state?.sessionId) return 0;

  // cwd resolution mirrors how chat.ts spawns the CLI — the session
  // artifact records the cwd on turn 1 via the `system` stream event.
  // Worktree threads have a worktree path here; non-worktree threads
  // have the project cwd. Either way it's the bucket key Claude used
  // to store the JSONL.
  const cwd = state.cwd;

  let transcript: Array<Record<string, unknown>>;
  try {
    transcript = (await services.cli.claudeCode.viewSession(state.sessionId, { cwd, ...claudeProfileOptions(state) })) as Array<Record<string, unknown>>;
  } catch (err: any) {
    log.warn('backfill: could not read session JSONL', {
      sessionId: state.sessionId,
      cwd,
      err: err?.message ?? String(err),
    });
    return 0;
  }

  // Collect user-message UUIDs in session order. Claude emits both
  // input-echo `user` events (uuid often absent) and post-persistence
  // replays (uuid required); only entries with uuid + role: 'user'
  // survive the filter. Tool-result user events also carry `type: 'user'`
  // so we match on message.role to exclude them.
  const jsonlUserUuids = transcript
    .filter((e: any) => {
      if (e?.type !== 'user') return false;
      if (typeof e.uuid !== 'string') return false;
      const role = e.message?.role;
      return role === 'user';
    })
    .map((e: any) => e.uuid as string);

  if (jsonlUserUuids.length === 0) return 0;

  // Pair with the thread's user messages in creation order. The
  // skip-if-populated guard below prevents cross-session overwrites in
  // multi-revert threads (e.g. a forked S2 JSONL mispairing against S1
  // messages).
  const thread = services.repository.chatQueries.threadData(threadId);
  const threadUserMsgs = ((thread?.messages ?? []) as Array<{
    id?: string;
    sender?: string;
    context?: Record<string, unknown>;
  }>).filter(m => m.sender === 'user');

  let written = 0;
  const limit = Math.min(jsonlUserUuids.length, threadUserMsgs.length);
  for (let i = 0; i < limit; i++) {
    const msg = threadUserMsgs[i];
    if (!msg.id) continue;
    if (msg.context && typeof (msg.context as any).cliUuid === 'string') continue;
    services.chat.updateMessageState(msg.id as EntityId, {
      context: { ...msg.context, cliUuid: jsonlUserUuids[i] },
    } as any);
    written++;
  }

  if (written > 0) {
    log.debug('backfill: populated missing user cliUuids', { threadId, written });
  }
  return written;
}
