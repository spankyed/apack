/**
 * CC: Update Permission Mode — persists the user's permission mode choice
 * after the running CLI acknowledges it, and auto-approves any pending control request when
 * switching to bypass mode.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, updateChatState, type PermissionMode } from './_helpers/thread-context.ts';
import { DONT_BYPASS } from './_helpers/auto-approve.ts';

export const meta: ActionMeta = {
  label: 'CC: Update Permission Mode',
  description: 'Persists the permission mode toggle and auto-approves pending requests on bypass.',
  category: 'claude-code',
  input: {
    threadId: { type: 'string', description: 'Thread ID', required: true },
    mode: { type: 'string', description: 'Permission mode to set', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { threadId, mode: requestedMode } = params as { threadId: string; mode: string };
  let mode = requestedMode;
  if (!threadId || !mode) return { success: false, reason: 'missing threadId or mode' };

  const prior = getClaudeState(services, threadId);
  if (!prior) return { success: false, reason: 'no claude state on thread' };

  const modes: readonly PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto'];
  if (!modes.includes(mode as PermissionMode)) return { success: false, reason: 'invalid permission mode' };

  const handle = services.cli.claudeCode.getHandle(threadId);
  const native = services.cli.claudeCode.getNativeTerminal(threadId);
  const control = native ?? handle;
  if (control) {
    try {
      mode = await control.setPermissionMode(mode as PermissionMode);
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const current = getClaudeState(services, threadId);
  if (!current) return { success: false, reason: 'claude state removed while changing mode' };
  const currentHandle = services.cli.claudeCode.getHandle(threadId);
  const currentNative = services.cli.claudeCode.getNativeTerminal(threadId);
  if (control && (currentNative ?? currentHandle) !== control || !control && currentNative) {
    return { success: false, reason: 'active Claude session changed while changing mode' };
  }
  const updates: Record<string, unknown> = { permissionMode: mode };

  // If switching to bypass and there's a paused control request, auto-approve it.
  if (mode === 'bypassPermissions') {
    const pending = current.pendingControlRequest;
    if (pending?.requestId && !DONT_BYPASS.has(pending.toolName)) {
      if (handle && currentHandle === handle) {
        handle.respond(pending.requestId, {
          behavior: 'allow',
          updatedInput: pending.originalInput ?? {},
        });
        services.chat.updateMessageState(pending.approvalMessageId as any, {
          responseTimestamp: Date.now(),
          blockResponse: { approved: true },
        } as any);
        updates.pendingControlRequest = undefined;
        updates.isRunning = true;
      }
    }
  }

  persistClaudeState(services, threadId, updates as any);

  // If bypass auto-approved a paused turn, transition chat state immediately.
  if (updates.isRunning) {
    updateChatState(services, threadId as EntityId, 'working');
  }

  return { success: true };
}
