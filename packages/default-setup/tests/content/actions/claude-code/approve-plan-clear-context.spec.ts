import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services, type EntityId } from '#generated/services.ts';
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
  it('preserves an approved plan in a fresh thread without resuming the old session', async () => {
    const { id, kill, clearHandle, create } = setup('current');
    const plan = '# Fixture plan\n\nImplement the disposable feature.';
    const { artifactId } = repository.chatCommands.createArtifact({ threadId: id, artifactType: 'plan',
      title: 'Fixture implementation', content: { status: 'draft', notes: plan, steps: [] } });
    create.mockImplementation((options: { topic: string; instructions: string }) => repository.threadCommands.create(options));
    const open = vi.fn(), execute = vi.fn(async () => undefined);
    mockService<Services, 'chat'>('chat', { createThreadAndNotify: create, openThreadChatAndRefreshRecent: open });
    mockService<Services, 'action'>('action', { executeIfFound: execute });
    mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
    mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    mockService<Services, 'emitter'>('emitter', { broadcastToSurface: vi.fn() });
    mockService<Services, 'artifact'>('artifact', {
      updateAndNotify: vi.fn((artifact: EntityId, options: { content?: unknown }) => {
        repository.chatCommands.updateArtifact(artifact, { content: options.content });
      }),
      findOrCreateByType: vi.fn((threadId: EntityId) => ({ ...repository.chatCommands.createArtifact({
        threadId, artifactType: 'claude-session', title: 'Session', content: {},
      }), created: true })),
    });
    const result = await action({ threadId: id, requestId: 'current' }, services);
    expect(result).toMatchObject({ success: true });
    const newId = (result as { newThreadId: EntityId }).newThreadId;
    expect(newId).not.toBe(id);
    expect(kill).toHaveBeenCalledOnce(); expect(clearHandle).toHaveBeenCalledWith(id);
    expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ isRunning: false });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeUndefined();
    expect(repository.chatQueries.threadArtifacts(id).find(item => item.id === artifactId)?.content)
      .toMatchObject({ status: 'approved', notes: plan });
    expect(repository.threadQueries.messages(newId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sender: 'user', text: `Implement the following plan:\n\n${plan}` }),
    ]));
    const state = repository.threadQueries.byId(newId)?.context?.claudeCode;
    expect(state).toMatchObject({ permissionMode: 'acceptEdits', chatState: 'working' });
    expect(state?.sessionId).toBeUndefined();
    expect(repository.chatQueries.threadArtifacts(newId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'claude-session' }),
    ]));
    expect(open).toHaveBeenCalledWith(newId);
    expect(execute).toHaveBeenCalledWith('Claude Code Chat', { threadId: newId, text: `Implement the following plan:\n\n${plan}` });
  });

});
