import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Plan', description: 'Show the current native Claude Code plan', category: 'claude-code',
  input: {
    command: { type: 'string', required: true }, text: { type: 'string', required: false },
    threadId: { type: 'string', required: false }, references: { type: 'object', required: false },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const { threadId } = params as { threadId?: EntityId };
  if (!threadId) return { success: false, command: 'cc-plan', text: 'No active thread.' };
  const session = getClaudeState(services, threadId);
  const handle = services.cli.claudeCode.getHandle(threadId);
  let text: string;
  try {
    if (!handle && !session?.sessionId) {
      text = 'No active Claude Code session — run a Claude Code turn first.';
    } else {
      const plan = handle ? await handle.getPlan() : await services.cli.claudeCode.getPlan({
        sessionId: session!.sessionId!, cwd: session?.cwd,
      });
      const current = getClaudeState(services, threadId);
      if (services.cli.claudeCode.getHandle(threadId) !== handle || current?.sessionId !== session?.sessionId || current?.cwd !== session?.cwd) {
        return { success: false, command: 'cc-plan', text: 'Claude Code session changed while reading the plan.' };
      }
      text = plan.exists ? 'Current Claude Code plan' : 'No plan has been written for this session.';
      services.chat.sendBlockMessage({ threadId, text,
        blocks: plan.exists ? [{ type: 'markdown', props: { content: plan.content || 'The current plan is empty.', label: 'Plan' } }] : [],
        forkable: false,
      });
      return { success: true, command: 'cc-plan', text, data: plan };
    }
  } catch (error) {
    text = `cc-plan failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    services.chat.sendBlockMessage({ threadId, text, blocks: [], forkable: false });
    return { success: false, command: 'cc-plan', text };
  }
  services.chat.sendBlockMessage({ threadId, text, blocks: [], forkable: false });
  return { success: false, command: 'cc-plan', text };
}
