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
