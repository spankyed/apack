import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/answer-question.ts';

function setup(requestId?: string) {
  const { id } = repository.threadCommands.create({ topic: 'Question', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: requestId ? { pendingControlRequest: { requestId, toolName: 'AskUserQuestion', approvalMessageId: 'approval' } } : {} } });
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
  it.each(['missing', 'closed'])('retires an expired request without starting a model turn (%s process)', async state => {
    const { id } = setup('current');
    const update = vi.fn(), send = vi.fn(), execute = vi.fn();
    const respond = vi.fn(() => { throw new Error('stdin closed'); });
    mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => state === 'missing' ? undefined : { respond }) } as never });
    mockService<Services, 'chat'>('chat', { updateMessageState: update, sendBlockMessage: send });
    mockService<Services, 'action'>('action', { executeIfFound: execute });
    await expect(action({ threadId: id, requestId: 'current', response: 'Alpha' }, services))
      .resolves.toMatchObject({ success: false });
    expect(execute).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('approval', expect.objectContaining({ blockResponse: { cancelled: true } }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ threadId: id, text: expect.stringContaining('request expired') }));
    expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ isRunning: false, chatState: 'error' });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined();
  });

});

it.each(['matching', 'replaced', 'refused'])('routes native card answers through only the matching owner (%s)', async mode => {
  const { id, respond } = setup('current')
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: 'approval', toolName: 'AskUserQuestion',
    originalInput: { questions: [{ question: 'Original?' }] }, nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'dialog-1', revision: 'revision' } } } } })
  const answerQuestionDialog = vi.fn(async () => { if (mode === 'refused') throw Error('Native refused') }), update = vi.fn()
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => ({ respond })), getNativeTerminal: vi.fn(() => ({ state: { ownerId: mode === 'replaced' ? 'replacement' : 'owner', sessionId: 'session' }, answerQuestionDialog })) } as never })
  mockService<Services, 'chat'>('chat', { updateMessageState: update, sendBlockMessage: vi.fn() })
  const answer = { answers: { 'Original?': ['Alpha', 'Beta'] }, annotations: { 'Original?': { notes: 'A note' } } }
  const result = await action({ threadId: id, requestId: 'current', originalInput: { questions: [] }, response: { nativeQuestionAnswer: answer } }, services)
  expect(result.success).toBe(mode === 'matching'); expect(respond).not.toHaveBeenCalled()
  if (mode === 'replaced') expect(answerQuestionDialog).not.toHaveBeenCalled()
  else expect(answerQuestionDialog).toHaveBeenCalledWith({ id: 'dialog-1', revision: 'revision', sessionId: 'session', answer })
  if (mode === 'refused') {
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toMatchObject({ requestId: 'current' })
    expect(update).toHaveBeenCalledWith('approval', { responseTimestamp: undefined, blockResponse: undefined })
  }
})
