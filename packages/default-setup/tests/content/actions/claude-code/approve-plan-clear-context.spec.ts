import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/approve-plan-clear-context.ts';

function setup(requestId?: string, toolName = 'ExitPlanMode') {
  const { id } = repository.threadCommands.create({ topic: 'Plan', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { isRunning: true,
    ...(requestId ? { pendingControlRequest: { requestId, toolName, approvalMessageId: 'approval' } } : {}),
  } } });
  const kill = vi.fn(), clearHandle = vi.fn(), create = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => ({ kill })), clearHandle } as never });
  mockService<Services, 'chat'>('chat', { createThreadAndNotify: create });
  return { id, kill, clearHandle, create };
}

describe('CC: Approve Plan Clear Context', () => {
  it.each([undefined, 'replacement'])('rejects cancelled/replaced plan approval before killing or creating anything (%s)', async pending => {
    const { id, kill, clearHandle, create } = setup(pending);
    await expect(action({ threadId: id, requestId: 'obsolete' }, services))
      .resolves.toEqual({ success: false, reason: 'plan approval is no longer pending' });
    expect(kill).not.toHaveBeenCalled(); expect(clearHandle).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.isRunning).toBe(true);
  });
  it('rejects an unrelated tool request even when its ID matches', async () => {
    const { id, kill, create } = setup('current', 'Bash');
    await expect(action({ threadId: id, requestId: 'current' }, services))
      .resolves.toEqual({ success: false, reason: 'plan approval is no longer pending' });
    expect(kill).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it('preserves the current session when the plan draft is missing', async () => {
    const { id, kill, create } = setup('current');
    await expect(action({ threadId: id, requestId: 'current' }, services))
      .resolves.toEqual({ success: false, reason: 'plan content is unavailable' });
    expect(kill).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeDefined();
  });
});
