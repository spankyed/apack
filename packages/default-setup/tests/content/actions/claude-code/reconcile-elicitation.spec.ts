import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/reconcile-state.ts';

it.each([false, true])('reconciles MCP input only when its original owner is absent: live=%s', async live => {
  const { id } = repository.threadCommands.create({ topic: 'MCP input', instructions: '', tags: [] });
  const pending = { requestId: 'original-mcp', approvalMessageId: 'input-message', ownerPid: 123, mode: 'url', serverName: 'research', message: 'Confirm release' };
  repository.threadCommands.update(id, { chatState: 'paused', context: { claudeCode: { pendingElicitation: pending, isRunning: false } } });
  const update = vi.fn();
  mockService<Services, 'chat'>('chat', { updateMessageState: update });
  mockService<Services, 'cli'>('cli', { claudeCode: { getConversation: () => live ? { owner: { handle: { pid: 123 }, hasPendingElicitation: () => true } } : undefined } as never });
  await action({}, services);
  const thread = repository.threadQueries.byId(id);
  expect(thread?.context?.claudeCode?.pendingElicitation).toEqual(live ? pending : undefined);
  expect(thread?.chatState).toBe(live ? 'paused' : 'idle');
  expect(update).toHaveBeenCalledTimes(live ? 0 : 1);
});

it.each([
  { status: 'live', ownerId: 'incumbent', sessionId: 'native-session' },
  { status: 'live', ownerId: 'replacement', sessionId: 'native-session' },
  { status: 'live', ownerId: 'incumbent', sessionId: 'different-session' },
  { status: 'exited', ownerId: 'incumbent', sessionId: 'native-session' },
  undefined,
])('reconciles a paused native question against the exact active owner: %j', async nativeState => {
  const { id } = repository.threadCommands.create({ topic: 'Restore Pack question', instructions: '', tags: [] });
  const pending = {
    requestId: 'question-revision', approvalMessageId: 'question-message', toolName: 'AskUserQuestion',
    nativeTerminal: { ownerId: 'incumbent', sessionId: 'native-session', dialogId: 'question-id', revision: 'question-revision' },
  };
  const saved = { sessionId: 'native-session', turns: 2, totalCostUsd: 0.04, pendingControlRequest: pending };
  repository.threadCommands.update(id, { chatState: 'paused', context: { claudeCode: saved } });
  const update = vi.fn();
  mockService<Services, 'chat'>('chat', { updateMessageState: update });
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => nativeState && { state: nativeState } } as never });

  await action({}, services);
  await action({}, services);

  const live = nativeState?.status === 'live' && nativeState.ownerId === 'incumbent' && nativeState.sessionId === 'native-session';
  const thread = repository.threadQueries.byId(id);
  expect(thread?.context?.claudeCode).toMatchObject({ sessionId: 'native-session', turns: 2, totalCostUsd: 0.04 });
  expect(thread?.context?.claudeCode?.pendingControlRequest).toEqual(live ? pending : undefined);
  expect(thread?.chatState).toBe(live ? 'paused' : 'idle');
  expect(update).toHaveBeenCalledTimes(live ? 0 : 1);
  if (!live) expect(update).toHaveBeenCalledWith('question-message', {
    responseTimestamp: expect.any(Number), blockResponse: { cancelled: true },
  });
});

it('keeps an independent paused print decision during Claude reconciliation', async () => {
  const { id } = repository.threadCommands.create({ topic: 'Print question', instructions: '', tags: [] });
  const pending = { requestId: 'print-question', approvalMessageId: 'print-message', toolName: 'AskUserQuestion' };
  repository.threadCommands.update(id, { chatState: 'paused', context: { claudeCode: { pendingControlRequest: pending } } });
  const update = vi.fn();
  mockService<Services, 'chat'>('chat', { updateMessageState: update });

  await action({}, services);

  const thread = repository.threadQueries.byId(id);
  expect(thread?.context?.claudeCode?.pendingControlRequest).toEqual(pending);
  expect(thread?.chatState).toBe('paused');
  expect(update).not.toHaveBeenCalled();
});
