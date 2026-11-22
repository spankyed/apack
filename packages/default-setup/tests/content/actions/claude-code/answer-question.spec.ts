import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/answer-question.ts';
import { CLAUDE_QUESTION_IMAGE_REFUSAL } from '#features/code/common/native-ui-problem.ts';

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

it.each(['matching', 'replaced', 'refused', 'invalid-image'])('routes native card answers through only the matching owner (%s)', async mode => {
  const { id, respond } = setup('current')
  const replyMessage = repository.chatCommands.addMessage({ threadId: id, sender: 'assistant', text: 'Original?' })
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: replyMessage.id, toolName: 'AskUserQuestion',
    originalInput: { questions: [{ question: 'Original?' }] }, nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'dialog-1', revision: 'revision' } } } } })
  const answerQuestionDialog = vi.fn(async () => {
    if (mode === 'refused') throw Error('Native refused')
    if (mode === 'invalid-image') throw Error(CLAUDE_QUESTION_IMAGE_REFUSAL)
  })
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => ({ respond })), getNativeTerminal: vi.fn(() => ({ state: { ownerId: mode === 'replaced' ? 'replacement' : 'owner', sessionId: 'session' }, answerQuestionDialog })) } as never })
  mockService<Services, 'chat'>('chat', {
    updateMessageState: (messageId, updates) => { repository.chatCommands.updateMessageState({ messageId, updates }) },
    sendBlockMessage: vi.fn(),
  })
  const answer = { answers: { 'Original?': ['Alpha', 'Beta'] }, annotations: { 'Original?': { notes: 'A note' } } }
  const images = mode === 'invalid-image' ? [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] : undefined
  const response = { nativeQuestionAnswer: answer, nativeQuestionRenderToken: 'drawing', nativeQuestionDecision: 'clarify', ...(images ? { nativeQuestionImages: images } : {}) }
  repository.chatCommands.updateMessageBlockResponse({ messageId: replyMessage.id, response })
  expect(repository.chatQueries.messageById(replyMessage.id)?.responseTimestamp).toBeDefined()
  const result = await action({ threadId: id, requestId: 'current', originalInput: { questions: [] }, response }, services)
  expect(result.success).toBe(mode === 'matching'); expect(respond).not.toHaveBeenCalled()
  if (mode === 'replaced') expect(answerQuestionDialog).not.toHaveBeenCalled()
  else expect(answerQuestionDialog).toHaveBeenCalledWith({ id: 'dialog-1', revision: 'revision', sessionId: 'session', answer, decision: 'clarify', ...(images ? { images } : {}), renderToken: 'drawing', draftStarted: false })
  if (mode === 'refused' || mode === 'invalid-image') {
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toMatchObject({
      requestId: 'current',
      nativeTerminal: { problem: mode === 'invalid-image' ? CLAUDE_QUESTION_IMAGE_REFUSAL : 'Claude Code did not accept that answer. Review it and try again.' },
    })
    const current = repository.chatQueries.messageById(replyMessage.id)
    expect(current?.responseTimestamp).toBeUndefined()
    expect(current?.blockResponse).toBeUndefined()
  }
})

it('clears a native refusal when retry starts and preserves the pending question until original acknowledgement', async () => {
  const { id } = setup('current')
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: 'approval', toolName: 'AskUserQuestion', nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'dialog', revision: 'revision', problem: 'Previous refusal' } } } } })
  let finish!: () => void
  const answerQuestionDialog = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => ({ state: { ownerId: 'owner', sessionId: 'session' }, answerQuestionDialog }) } as never })
  const waiting = action({ threadId: id, requestId: 'current', response: { nativeQuestionAnswer: { answers: { Name: 'Corrected' } } } }, services)
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toEqual({ requestId: 'current', approvalMessageId: 'approval', toolName: 'AskUserQuestion', nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'dialog', revision: 'revision' } })
  finish(); await expect(waiting).resolves.toEqual({ success: true })
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined()
})
