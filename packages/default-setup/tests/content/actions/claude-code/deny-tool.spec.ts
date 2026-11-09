import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { getClaudeState } from '../../../../src/content/actions/claude-code/_helpers/thread-context.ts';
import { action } from '../../../../src/content/actions/claude-code/deny-tool.ts';

function setup(requestId?: string) {
  const { id } = repository.threadCommands.create({ topic: 'Tool denial', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: requestId ? { isRunning: false, pendingControlRequest: { requestId, toolName: 'Bash', approvalMessageId: 'approval' } } : {} } });
  const respond = vi.fn(), kill = vi.fn(), clear = vi.fn(), send = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: vi.fn(() => undefined), getHandle: vi.fn(() => ({ respond, kill })), clearHandle: clear } as never });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'logger'>('logger', { info: vi.fn() });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage: send });
  return { id, respond, kill, clear, send };
}

describe('CC: Deny Tool', () => {
  it.each([undefined, 'replacement'])('refuses stale denial or cancellation without affecting another request (%s)', async pending => {
    const { id, respond, kill, clear } = setup(pending);
    for (const response of [{ approved: false }, { cancelled: true }]) {
      await expect(action({ threadId: id, requestId: 'old', response }, services)).resolves.toEqual({ success: false, reason: 'denial is no longer pending' });
    }
    expect(respond).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(getClaudeState(services, id)?.pendingControlRequest?.requestId).toBe(pending);
  });
  it.each([undefined, '  use a safer command  '])('denies only the current native tool and resumes the owned process (%s)', async reason => {
    const { id, respond, kill, clear } = setup('current');
    await expect(action({ threadId: id, requestId: 'current', response: { approved: false, reason } }, services)).resolves.toEqual({ success: true });
    expect(respond).toHaveBeenCalledWith('current', { behavior: 'deny', message: reason?.trim() || 'The user denied this tool request.' });
    expect(kill).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ isRunning: true, chatState: 'working' });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined();
  });
  it('stops the current turn only for explicit interaction cancellation', async () => {
    const { id, respond, kill, clear } = setup('current');
    await action({ threadId: id, requestId: 'current', response: { cancelled: true } }, services);
    expect(respond).not.toHaveBeenCalled(); expect(kill).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ isRunning: false, chatState: 'idle' });
  });
  it.each(['missing', 'closed'])('retires an unsendable denial without starting new work (%s)', async process => {
    const { id, send } = setup('current');
    const respond = vi.fn(() => { throw Error('closed'); });
    mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: vi.fn(() => undefined), getHandle: vi.fn(() => process === 'missing' ? undefined : { respond }) } as never });
    await expect(action({ threadId: id, requestId: 'current', response: { approved: false } }, services)).resolves.toMatchObject({ success: false });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ isRunning: false, chatState: 'error' });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('request expired') }));
  });
  it('rejects the current plan draft without stopping native continuation', async () => {
    const { id, respond, kill } = setup('current');
    repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: {
      requestId: 'current', toolName: 'ExitPlanMode', approvalMessageId: 'approval',
    } } } });
    const { artifactId } = repository.chatCommands.createArtifact({ threadId: id, artifactType: 'plan', title: 'Native plan',
      content: { status: 'draft', notes: '# Review this plan', steps: [] } });
    mockService<Services, 'artifact'>('artifact', { update: vi.fn((artifact, options) => {
      repository.chatCommands.updateArtifact(artifact, { content: options.content });
    }) });
    await expect(action({ threadId: id, requestId: 'current', response: { approved: false, reason: 'Revise the plan' } }, services)).resolves.toEqual({ success: true });
    expect(respond).toHaveBeenCalledWith('current', { behavior: 'deny', message: 'Revise the plan' });
    expect(kill).not.toHaveBeenCalled();
    expect(repository.chatQueries.threadArtifacts(id).find(value => value.id === artifactId)?.content).toMatchObject({ status: 'rejected', notes: '# Review this plan' });
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
  if (matching) expect(answerFileDialog).toHaveBeenCalledWith({ id: 'dialog-1', revision: 'revision', sessionId: 'session', decision: 'deny', feedback: 'No thanks' });
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
  if (matching) expect(answerBashDialog).toHaveBeenCalledWith({ id: 'bash', revision: 'revision', sessionId: 'session', decision: 'deny', feedback: undefined });
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
  if (matching) expect(answerPlanDialog).toHaveBeenCalledWith({ id: 'plan', revision: 'revision', sessionId: 'session', choice: 'no', feedback: 'Keep tests', })
  else expect(answerPlanDialog).not.toHaveBeenCalled()
})

it.each(['WebFetch', 'Skill'] as const)('dispatches only the original %s choice token with exact feedback', async toolName => {
  const { id } = setup('current')
  const answerToolPermissionDialog = vi.fn(async () => {})
  const native = { ownerId: 'native-owner', sessionId: 'native-session', dialogId: 'native-dialog', revision: 'native-revision' }
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: 'approval', toolName, nativeTerminal: native } } } })
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => ({ state: native, answerToolPermissionDialog }) } as never })
  const response = { choice: 'no', choiceToken: 'original-token', reason: '  Keep exact native feedback.  ' }
  await expect(action({ threadId: id, requestId: 'current', toolName, response }, services)).resolves.toEqual({ success: true })
  expect(answerToolPermissionDialog).toHaveBeenCalledExactlyOnceWith({ decision: 'deny', id: native.dialogId, revision: native.revision, sessionId: native.sessionId, toolName, choice: response.choice, choiceToken: response.choiceToken, feedback: response.reason })
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined()
})


it.each(['mcp__research__echo', 'Bash'])('keeps original generic %s decisions out of specialized and print routes', async toolName => {
  const { id } = setup('current')
  const answerGenericToolPermissionDialog = vi.fn(async () => {}), answerBashDialog = vi.fn(), respond = vi.fn()
  const native = { ownerId: 'native-owner', sessionId: 'native-session', dialogId: 'native-dialog', revision: 'native-revision', genericTool: { title: 'Tool use', ready: true, token: 'a'.repeat(64), details: [], choices: [], canCancel: true, defaultFocusValue: 'yes', choiceDescriptions: {} } }
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: 'approval', toolName, nativeTerminal: native } } } })
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => ({ state: native, answerGenericToolPermissionDialog, answerBashDialog }), getHandle: () => ({ respond }) } as never })
  const response = { choice: 'no', choiceToken: 'original-token', reason: '  Preserve native feedback.  ' }
  await expect(action({ threadId: id, requestId: 'current', toolName, response }, services)).resolves.toEqual({ success: true })
  expect(answerGenericToolPermissionDialog).toHaveBeenCalledExactlyOnceWith({ decision: 'deny', id: native.dialogId, revision: native.revision, sessionId: native.sessionId, toolName, choice: response.choice, choiceToken: response.choiceToken, feedback: response.reason })
  expect(answerBashDialog).not.toHaveBeenCalled(); expect(respond).not.toHaveBeenCalled()
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined()
})

it('routes generic cancellation to the original native callback without killing its owner', async () => {
  const { id } = setup('current')
  const answerGenericToolPermissionDialog = vi.fn(async () => {}), stopNativeTerminal = vi.fn(), kill = vi.fn()
  const native = { ownerId: 'native-owner', sessionId: 'native-session', dialogId: 'native-dialog', revision: 'native-revision', genericTool: { title: 'Tool use', ready: true, token: 'a'.repeat(64), details: [], choices: [], canCancel: true, choiceDescriptions: {} } }
  repository.threadCommands.update(id, { context: { claudeCode: { pendingControlRequest: { requestId: 'current', approvalMessageId: 'approval', toolName: 'mcp__research__echo', nativeTerminal: native } } } })
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => ({ state: native, answerGenericToolPermissionDialog }), stopNativeTerminal, getHandle: () => ({ kill }) } as never })
  await expect(action({ threadId: id, requestId: 'current', response: { cancelled: true, choiceToken: native.genericTool.token } }, services)).resolves.toEqual({ success: true })
  expect(answerGenericToolPermissionDialog).toHaveBeenCalledExactlyOnceWith({ decision: 'cancel', id: native.dialogId, revision: native.revision, sessionId: native.sessionId, toolName: 'mcp__research__echo', choice: '', choiceToken: native.genericTool.token, feedback: undefined })
  expect(stopNativeTerminal).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled()
})
