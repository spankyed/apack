import { getClaudeState } from './_helpers/thread-context.ts';
import { claudeProfileOptions } from '../../../features/code/common/native-profile.ts';
/**
 * CC: Recap — summarizes the current thread's conversation history.
 *
 * Uses a disposable one-shot CLI query (noSessionPersistence) so the recap
 * prompt never pollutes the active session's JSONL history.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z, EntityId } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'CC: Recap',
  description: 'Summarize the current conversation thread',
  category: 'claude-code',
  input: {
    command: { type: 'string', required: true },
    text: { type: 'string', required: false },
    threadId: { type: 'string', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { threadId } = params;

  if (!threadId) {
    return { success: false, command: 'cc-recap', text: 'No active thread.' };
  }

  const { messageId: progressMsgId } = services.chat.sendBlockMessage({
    threadId,
    text: 'Generating recap…',
    blocks: [],
  });

  try {
    const recapText = await generateRecap(services, threadId as EntityId);
    services.chat.updateMessageState(progressMsgId as any, { text: recapText });
    return { success: true, command: 'cc-recap', text: recapText };
  } catch (error: any) {
    const errText = `cc-recap failed: ${error?.message || 'Unknown error'}`;
    services.chat.updateMessageState(progressMsgId as any, { text: errText });
    return { success: false, command: 'cc-recap', text: errText };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function serializeMessages(messages: any[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.compacted || msg.status === 'cancelled') continue;

    const role = msg.sender === 'user' ? 'User'
      : msg.sender === 'assistant' ? 'Assistant'
      : msg.sender === 'marker' ? 'Marker'
      : 'System';

    // Command messages
    if (msg.isCommand && msg.command) {
      lines.push(`[${role}] /${msg.command} ${msg.text || ''}`.trim());
    } else if (msg.text) {
      lines.push(`[${role}] ${msg.text}`);
    }

    // Tool activity blocks
    if (msg.blocks?.length) {
      for (const block of msg.blocks) {
        if (block.type === 'tool-activity' && block.props?.entries?.length) {
          const tools = block.props.entries
            .map((e: any) => `  - ${e.tool}: ${e.summary} (${e.status})`)
            .join('\n');
          lines.push(`[Tools]\n${tools}`);
        }
      }
    }
  }

  return lines.join('\n\n');
}

async function generateRecap(
  services: Services,
  threadId: EntityId,
): Promise<string> {
  const threadData = services.repository.chatQueries.threadData(threadId);
  const messages = threadData?.messages ?? [];

  if (messages.length === 0) {
    return 'No messages in this thread.';
  }

  const serialized = serializeMessages(messages);
  const recapSystemPrompt = services.prompt.usePrompt('Recap System', {});

  if (!recapSystemPrompt) {
    return 'Recap prompt not found. Please ensure the "Recap" prompt template has been applied.';
  }

  const handle = await services.cli.claudeCode.query({
    ...claudeProfileOptions(getClaudeState(services, threadId)),
    prompt: serialized,
    systemPrompt: recapSystemPrompt,
    permissionMode: 'plan',
    allowedTools: [],
    noSessionPersistence: true,
    maxTurns: 1,
  });

  // Drain events
  for await (const _ev of handle.events) { /* no-op */ }

  const result = await handle.result;
  return result.text || '(empty recap)';
}
