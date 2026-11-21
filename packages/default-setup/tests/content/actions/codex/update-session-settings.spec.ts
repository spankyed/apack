import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action as updateSessionSettings } from '../../../../src/content/actions/codex/update-session-settings.ts';
import type { EARS } from '@apackdev/sdk';

// The action runs on the harness's services: a real thread in the in-memory database, with the Codex
// app server and the chat and threads services it drives mocked
function createThread(codexState: Record<string, unknown>) {
  const { id } = repository.threadCommands.create({ topic: 'Codex', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { codex: codexState } });
  const respondToApproval = vi.fn().mockResolvedValue(undefined);
  const updateMessageState = vi.fn();
  const updateChatState = vi.fn();
  mockService<Services, 'codex'>('codex', { respondToApproval });
  mockService<Services, 'chat'>('chat', { updateMessageState });
  mockService<Services, 'threads'>('threads', { updateChatState });
  return { threadId: id, respondToApproval, updateMessageState, updateChatState };
}

const codexState = (threadId: EARS.EntityId) =>
  (repository.threadQueries.byId(threadId)?.context as { codex?: Record<string, unknown> } | undefined)?.codex;

describe('CDX: Update Session Settings', () => {
  it('approves a pending Codex tool approval when switching to auto', async () => {
    const { threadId, respondToApproval, updateMessageState, updateChatState } = createThread({
      pendingApproval: {
        requestId: 0,
        method: 'item/commandExecution/requestApproval',
        approvalMessageId: 'approval-1',
      },
      isRunning: false,
    });

    const result = await updateSessionSettings({ threadId, approvalMode: 'auto_review' }, services);

    expect(result).toEqual({ success: true });
    expect(respondToApproval).toHaveBeenCalledWith(0, 'acceptForSession');
    expect(updateMessageState).toHaveBeenCalledWith('approval-1', expect.objectContaining({
      blockResponse: { approved: true, decision: 'acceptForSession' },
    }));
    expect(updateChatState).toHaveBeenCalledWith(threadId, 'working');
    const state = codexState(threadId);
    expect(state).toMatchObject({ approvalMode: 'auto_review', isRunning: true });
    expect(state?.pendingApproval).toBeUndefined();
  });

  it('does not approve a pending plan approval when switching to auto', async () => {
    const { threadId, respondToApproval, updateMessageState, updateChatState } = createThread({
      pendingApproval: {
        requestId: -1,
        method: 'plan/approval',
        approvalMessageId: 'approval-plan',
      },
      isRunning: false,
    });

    const result = await updateSessionSettings({ threadId, approvalMode: 'auto_review' }, services);

    expect(result).toEqual({ success: true });
    expect(respondToApproval).not.toHaveBeenCalled();
    expect(updateMessageState).not.toHaveBeenCalled();
    expect(updateChatState).not.toHaveBeenCalled();
    expect(codexState(threadId)).toMatchObject({
      approvalMode: 'auto_review',
      pendingApproval: expect.objectContaining({ method: 'plan/approval' }),
    });
  });
});
