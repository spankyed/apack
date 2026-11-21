/**
 * CC: Handle Directory Select — processes the user's directory-picker
 * response, saves the chosen directory to settings, and retries the
 * original chat query that was blocked by the missing CWD.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { persistClaudeState, setProjectDirectory, updateClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Handle Directory Select',
  description: 'Saves the user-selected project directory and retries the blocked chat query.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    response: { type: 'any', description: 'File-picker response ({ path, toggles })', required: true },
    pendingDirectorySelect: { type: 'object', description: 'Stored original message params', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId, response, pendingDirectorySelect } = params as {
    threadId: string;
    response: any;
    pendingDirectorySelect: {
      pickerMessageId: string;
      text: string;
      mode?: string;
      phase?: string;
      model?: string;
      allowedTools?: string[];
      disallowedTools?: string[];
      channels?: string[];
      systemPrompt?: string;
      messageId?: string;
      references?: any;
    };
  };

  // The picker message always carries a toggles block, so the chat wraps the
  // picked path as `{ path, toggles }` (`InteractionContainer.handleSubmitFrom`).
  const selectedDir: string | undefined =
    typeof response?.path === 'string' ? response.path : response?.path?.[0];
  const useWorktree: boolean = response?.toggles?.worktree ?? false;

  if (!selectedDir) {
    return { success: false, error: 'No directory selected' };
  }

  // Save the selected directory as the default base directory.
  setProjectDirectory(services, selectedDir);

  // Persist worktree preference on the session artifact so chat.ts reads it.
  if (useWorktree) {
    updateClaudeState(services, threadId as EntityId, { useWorktree: true });
  }

  // Clear pending state.
  persistClaudeState(services, threadId, { pendingDirectorySelect: undefined });

  // Mark the picker message as responded (store full response for toggle display).
  services.chat.updateMessageState(pendingDirectorySelect.pickerMessageId as EntityId, {
    responseTimestamp: Date.now(),
    blockResponse: response,
  } as any);

  // Re-invoke the chat action with the original params.
  await services.action.executeIfFound('Claude Code Chat', {
    threadId,
    text: pendingDirectorySelect.text,
    mode: pendingDirectorySelect.mode,
    phase: pendingDirectorySelect.phase,
    model: pendingDirectorySelect.model,
    allowedTools: pendingDirectorySelect.allowedTools,
    disallowedTools: pendingDirectorySelect.disallowedTools,
    channels: pendingDirectorySelect.channels,
    systemPrompt: pendingDirectorySelect.systemPrompt,
    messageId: pendingDirectorySelect.messageId,
    references: pendingDirectorySelect.references,
  });

  return { success: true, directory: selectedDir };
}
