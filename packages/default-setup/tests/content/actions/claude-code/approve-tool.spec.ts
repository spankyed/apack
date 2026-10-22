import { action as routeResponse } from '../../../../src/content/actions/claude-code/route-response.ts';
import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/approve-tool.ts';

function setup(requestId?: string) {
  const { id } = repository.threadCommands.create({ topic: 'Approval', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: requestId ? { pendingControlRequest: { requestId, toolName: 'Bash', approvalMessageId: 'approval' } } : {} } });
  const respond = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => ({ respond })) } as never });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  return { id, respond };
}

describe('CC: Approve Tool', () => {
  it.each([undefined, 'replacement'])('rejects cancelled or replaced approvals (%s)', async pending => {
    const { id, respond } = setup(pending);
    await expect(action({ threadId: id, requestId: 'old', toolName: 'ExitPlanMode' }, services))
      .resolves.toEqual({ success: false, reason: 'approval is no longer pending' });
    expect(respond).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest)
      .toEqual(pending ? { requestId: pending, toolName: 'Bash', approvalMessageId: 'approval' } : undefined);
  });
  it('approves only the current tool with its original input', async () => {
    const { id, respond } = setup('current');
    const originalInput = { command: 'synthetic fixture' };
    await expect(action({ threadId: id, requestId: 'current', toolName: 'Bash', originalInput }, services))
      .resolves.toEqual({ success: true });
    expect(respond).toHaveBeenCalledWith('current', { behavior: 'allow', updatedInput: originalInput });
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

  it('rejects the old plan draft rather than approving it when its process has gone', async () => {
    const { id } = setup('current');
    repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: {
      requestId: 'current', toolName: 'ExitPlanMode', approvalMessageId: 'approval',
    } } } });
    const { artifactId } = repository.chatCommands.createArtifact({ threadId: id, artifactType: 'plan', title: 'Expired plan',
      content: { status: 'draft', notes: '# Native plan', steps: [] } });
    const execute = vi.fn();
    mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => undefined) } as never });
    mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage: vi.fn() });
    mockService<Services, 'action'>('action', { executeIfFound: execute });
    mockService<Services, 'artifact'>('artifact', { updateAndNotify: vi.fn((artifact, options) => {
      repository.chatCommands.updateArtifact(artifact, { content: options.content });
    }) });
    await expect(action({ threadId: id, requestId: 'current', toolName: 'ExitPlanMode' }, services)).resolves.toMatchObject({ success: false });
    expect(repository.chatQueries.threadArtifacts(id).find(value => value.id === artifactId)?.content).toMatchObject({ status: 'rejected', notes: '# Native plan' });
    expect(execute).not.toHaveBeenCalled();
  });

});

it.each(['Read', 'Write', 'Edit'].flatMap(toolName => [true, false].map(matching => ({ toolName, matching }))))('answers native $toolName only for the matching owner: $matching', async ({ toolName, matching }) => {
  const { id } = setup('current');
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: {
    requestId: 'current', toolName, approvalMessageId: 'approval', originalInput: { file_path: '/original' },
    nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'dialog-1', revision: 'revision' },
  } } } });
  const answerFileDialog = vi.fn(async () => {}), respond = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: vi.fn(() => ({ state: { ownerId: matching ? 'owner' : 'replacement', sessionId: 'session' }, answerFileDialog })), getHandle: vi.fn(() => ({ respond })) } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage: vi.fn() });
  const result = await action({ threadId: id, requestId: 'current', originalInput: { file_path: '/tampered' }, response: { autoAccept: true, reason: 'No thanks' } }, services);
  expect(result.success).toBe(matching);
  expect(respond).not.toHaveBeenCalled();
  if (matching) expect(answerFileDialog).toHaveBeenCalledWith({ id: 'dialog-1', revision: 'revision', sessionId: 'session', decision: 'allow' });
  else expect(answerFileDialog).not.toHaveBeenCalled();
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.autoAcceptEdits).toBeUndefined();
});

it.each([true, false])('routes a native Bash decision only to its owning process: %s', async matching => {
  const { id } = setup('current');
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', toolName: 'Bash', approvalMessageId: 'approval', originalInput: { command: 'original' }, nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'bash', revision: 'revision' } } } } });
  const answerBashDialog = vi.fn(async () => {}), answerFileDialog = vi.fn(), respond = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: vi.fn(() => ({ state: { ownerId: matching ? 'owner' : 'replacement', sessionId: 'session' }, answerBashDialog, answerFileDialog })), getHandle: vi.fn(() => ({ respond })) } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage: vi.fn() });
  const result = await action({ threadId: id, requestId: 'current', originalInput: { command: 'tampered' }, response: { autoAccept: true } }, services);
  expect(result.success).toBe(matching); expect(answerFileDialog).not.toHaveBeenCalled(); expect(respond).not.toHaveBeenCalled();
  if (matching) expect(answerBashDialog).toHaveBeenCalledWith({ id: 'bash', revision: 'revision', sessionId: 'session', decision: 'allow' });
  else expect(answerBashDialog).not.toHaveBeenCalled();
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.autoAcceptEdits).toBeUndefined();
});

it.each(['EnterPlanMode', 'ExitPlanMode'].flatMap(toolName => [true, false].map(matching => ({ toolName, matching }))))('routes native $toolName only to its current owner: $matching', async ({ toolName, matching }) => {
  const { id } = setup('current')
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', toolName, approvalMessageId: 'approval', originalInput: {}, nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'plan', revision: 'revision' } } } } })
  const answerPlanDialog = vi.fn(async () => {}), respond = vi.fn()
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: vi.fn(() => ({ state: { ownerId: matching ? 'owner' : 'replacement', sessionId: 'session' }, answerPlanDialog })), getHandle: vi.fn(() => ({ respond })) } as never })
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage: vi.fn() })
  const result = await action({ threadId: id, requestId: 'current', response: { choice: 'yes-default-keep-context', reason: 'Keep tests', plan: '# Reviewed', clearContext: true } }, services)
  expect(result.success).toBe(matching); expect(respond).not.toHaveBeenCalled()
  if (matching) expect(answerPlanDialog).toHaveBeenCalledWith({ id: 'plan', revision: 'revision', sessionId: 'session', choice: 'yes-default-keep-context', feedback: 'Keep tests', plan: '# Reviewed' })
  else expect(answerPlanDialog).not.toHaveBeenCalled()
})

it('keeps native clear-context choices out of the print-session reset branch', async () => {
  const { id } = setup('current')
  const pending = { requestId: 'current', toolName: 'ExitPlanMode', approvalMessageId: 'approval', originalInput: {} }
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { ...pending, nativeTerminal: { ownerId: 'owner', sessionId: 'session', dialogId: 'plan', revision: 'revision' } } } } })
  expect(await routeResponse({ threadId: id, messageId: 'approval', response: { approved: true, clearContext: true, choice: 'yes-auto-clear-context' } }, services)).toMatchObject({ success: true, toolName: 'ExitPlanMode', clearContext: false, denied: false })
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: pending } } })
  expect(await routeResponse({ threadId: id, messageId: 'approval', response: { approved: true, clearContext: true } }, services)).toMatchObject({ clearContext: true })
})

it.each(['WebFetch', 'Skill'] as const)('dispatches only the original %s choice token with exact feedback', async toolName => {
  const { id } = setup('current')
  const answerToolPermissionDialog = vi.fn(async () => {})
  const native = { ownerId: 'native-owner', sessionId: 'native-session', dialogId: 'native-dialog', revision: 'native-revision' }
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: 'approval', toolName, nativeTerminal: native } } } })
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => ({ state: native, answerToolPermissionDialog }) } as never })
  const response = { choice: 'yes', choiceToken: 'original-token', reason: '  Keep exact native feedback.  ' }
  await expect(action({ threadId: id, requestId: 'current', toolName, response }, services)).resolves.toEqual({ success: true })
  expect(answerToolPermissionDialog).toHaveBeenCalledExactlyOnceWith({ decision: 'allow', id: native.dialogId, revision: native.revision, sessionId: native.sessionId, toolName, choice: response.choice, choiceToken: response.choiceToken, feedback: response.reason })
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined()
})
