/** CDX: Handle Summarize — roll back and trigger Codex app-server compaction. */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { createStreamWriter } from '../claude-code/_helpers/stream-writer.ts';
import { createToolActivityWriter } from '../claude-code/_helpers/tool-activity-writer.ts';
import { createThinkingWriter } from '../claude-code/_helpers/thinking-writer.ts';
import { createStreamConsumer } from './_helpers/stream-consumer.ts';
import { getCodexState, persistCodexState, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CDX: Handle Summarize',
  description: 'Rolls back Codex history and starts Codex app-server compaction.',
  category: 'codex',
  input: {
    threadId: { type: 'string', required: true },
    messageId: { type: 'string', required: true },
    deletedUserMessageCount: { type: 'number', required: false },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const { threadId, messageId, deletedUserMessageCount } = params as {
    threadId: string;
    messageId?: string;
    deletedUserMessageCount?: number;
  };
  if (!threadId) return { success: false, reason: 'missing threadId' };

  const revert = await services.action.executeIfFound('CDX: Handle Revert', {
    threadId,
    messageId,
    deletedUserMessageCount,
  });

  const state = getCodexState(services, threadId);
  if (!state?.threadId) {
    services.chat.sendBlockMessage({
      threadId: threadId as EntityId,
      text: '⚠️ Nothing to summarize — no active Codex thread yet.',
      blocks: [],
      forkable: false,
    });
    return { success: false, reason: 'no codex thread', revert };
  }

  const currentMessageId = services.chat.sendBlockMessage({
    threadId: threadId as EntityId,
    text: 'Compacting…',
    blocks: [],
    forkable: false,
    autoHide: true,
    asUser: true,
    asideContext: 'Summarize from here',
  }).messageId as EntityId;

  const thinking = createThinkingWriter(services, currentMessageId, { intervalMs: 250 });
  const writer = createStreamWriter(services, currentMessageId, { intervalMs: 80 });
  const toolActivity = createToolActivityWriter(services, currentMessageId, {
    intervalMs: 250,
  });

  persistCodexState(services, threadId, {
    activeMessageId: currentMessageId as string,
    isRunning: true,
  });
  updateChatState(services, threadId as EntityId, 'working');

  try {
    const { handlers } = createStreamConsumer(
      { services, threadId: threadId as EntityId, codexThreadId: state.threadId, text: '/compact', isCompaction: true },
      { writer, toolActivity, thinking, messageId: currentMessageId },
    );
    (services.codex as any).registerConsumer(state.threadId, handlers);
    await (services.codex as any).compactThread(state.threadId);
    return { success: true, revert, compacting: true };
  } catch (error: any) {
    try { (services.codex as any).unregisterConsumer(state.threadId); } catch { /* ok */ }
    persistCodexState(services, threadId, { activeMessageId: undefined, isRunning: false });
    updateChatState(services, threadId as EntityId, 'error');
    writer.finalize(`⚠️ Codex summarize failed — ${error?.message || 'unknown error'}.`);
    return { success: false, error: error?.message, revert };
  }
}
