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
});
