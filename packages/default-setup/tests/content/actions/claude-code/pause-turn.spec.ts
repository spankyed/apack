import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/pause-turn.ts';

function setup(kind: 'native' | 'print' | 'idle', pending = false) {
  const { id } = repository.threadCommands.create({ topic: 'Pause ownership', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { isRunning: kind === 'print',
    ...(pending ? { pendingControlRequest: { requestId: 'permission', toolName: 'Write', approvalMessageId: 'approval' } } : {}),
  } } });
  const native = { kill: vi.fn() }, print = { kill: vi.fn() };
  const getNativeTerminal = vi.fn(() => kind === 'native' ? native : undefined);
  const clearHandle = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal, getHandle: vi.fn(() => kind === 'print' ? print : undefined), isConversationBusy: vi.fn(() => kind === 'native'), clearHandle } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn() });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { id, native, print, getNativeTerminal, clearHandle };
}
it.each(['native', 'print'] as const)('pauses the owning %s process and clears pending interaction', async kind => {
  const f = setup(kind, true);
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true });
  expect(kind === 'native' ? f.native.kill : f.print.kill).toHaveBeenCalledOnce();
  expect(kind === 'native' ? f.print.kill : f.native.kill).not.toHaveBeenCalled();
  expect(f.clearHandle).toHaveBeenCalledWith(f.id);
  expect(repository.threadQueries.byId(f.id)?.context?.claudeCode).toMatchObject({ isRunning: false, pendingControlRequest: undefined });
  expect(services.chat.updateMessageState).toHaveBeenCalledWith('approval', expect.objectContaining({ blockResponse: { cancelled: true } }));
});
it('leaves an idle thread alone', async () => {
  const f = setup('idle');
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true, noop: true });
  expect(f.native.kill).not.toHaveBeenCalled(); expect(f.print.kill).not.toHaveBeenCalled(); expect(f.clearHandle).not.toHaveBeenCalled();
});
