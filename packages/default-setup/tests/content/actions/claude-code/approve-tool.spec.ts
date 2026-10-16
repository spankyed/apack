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
