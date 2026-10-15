import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { cancelPendingControlRequest, getClaudeState } from '../../../../src/content/actions/claude-code/_helpers/thread-context.ts';

function setup() {
  const { id } = repository.threadCommands.create({ topic: 'Cancellation', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: {
    sessionId: 'session-fixture', isRunning: true,
    pendingControlRequest: { requestId: 'current-request', toolName: 'Bash', approvalMessageId: 'approval-fixture' },
  } } });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn() });
  return id;
}

describe('native control cancellation', () => {
  it('preserves a replacement approval when an earlier request is cancelled', () => {
    const id = setup();
    expect(cancelPendingControlRequest(services, id, 'old-request')).toBe(false);
    expect(getClaudeState(services, id)?.pendingControlRequest?.requestId).toBe('current-request');
    expect(services.chat.updateMessageState).not.toHaveBeenCalled();
  });
  it('retires the matching UI block once and preserves the running session', () => {
    const id = setup();
    expect(cancelPendingControlRequest(services, id, 'current-request')).toBe(true);
    expect(services.chat.updateMessageState).toHaveBeenCalledWith('approval-fixture', {
      responseTimestamp: expect.any(Number), blockResponse: { cancelled: true },
    });
    const state = getClaudeState(services, id);
    expect(state?.pendingControlRequest).toBeUndefined();
    expect(state).toMatchObject({ sessionId: 'session-fixture', isRunning: true });
    expect(cancelPendingControlRequest(services, id, 'current-request')).toBe(false);
    expect(services.chat.updateMessageState).toHaveBeenCalledTimes(1);
  });
});
