import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/answer-question.ts';

function setup(requestId?: string) {
  const { id } = repository.threadCommands.create({ topic: 'Question', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: {
    ...(requestId ? { pendingControlRequest: { requestId, toolName: 'AskUserQuestion', approvalMessageId: 'approval' } } : {}),
  } } });
  const respond = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => ({ respond })) } as never });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  return { id, respond };
}

describe('CC: Answer Question', () => {
  it.each([undefined, 'replacement-request'])('rejects an answer after cancellation or replacement (%s)', async pending => {
    const { id, respond } = setup(pending);
    await expect(action({ threadId: id, requestId: 'old-request', response: 'Alpha' }, services))
      .resolves.toEqual({ success: false, reason: 'question is no longer pending' });
    expect(respond).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest)
      .toEqual(pending ? { requestId: pending, toolName: 'AskUserQuestion', approvalMessageId: 'approval' } : undefined);
  });
  it('sends current question answers in the verified native updatedInput shape', async () => {
    const { id, respond } = setup('current-request');
    const originalInput = { questions: [{ question: 'Which fixture?' }] };
    await expect(action({ threadId: id, requestId: 'current-request', originalInput, response: 'Alpha' }, services))
      .resolves.toEqual({ success: true });
    expect(respond).toHaveBeenCalledWith('current-request', { behavior: 'allow',
      updatedInput: { ...originalInput, answers: { 'Which fixture?': 'Alpha' } } });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined();
  });
});
