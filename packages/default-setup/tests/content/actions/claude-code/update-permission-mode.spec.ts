import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/update-permission-mode.ts';

function setup(handle?: { setPermissionMode: ReturnType<typeof vi.fn>; respond?: ReturnType<typeof vi.fn> }, pending = false) {
  const { id } = repository.threadCommands.create({ topic: 'Permission mode', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { permissionMode: 'default',
    ...(pending ? { pendingControlRequest: { requestId: 'permission-1', toolName: 'Write',
      approvalMessageId: 'approval-1', originalInput: { file_path: '/fixture' } } } : {}),
  } } });
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle) } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn() });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  return id;
}
function state(id: Parameters<typeof repository.threadQueries.byId>[0]) {
  return repository.threadQueries.byId(id)?.context?.claudeCode;
}

describe('CC: Update Permission Mode', () => {
  it('saves the acknowledged live mode only after the CLI replies', async () => {
    let acknowledge!: (mode: string) => void;
    const setPermissionMode = vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; }));
    const threadId = setup({ setPermissionMode });
    const update = action({ threadId, mode: 'plan' }, services);
    expect(setPermissionMode).toHaveBeenCalledWith('plan');
    expect(state(threadId)).toMatchObject({ permissionMode: 'default' });
    acknowledge('plan');
    await expect(update).resolves.toEqual({ success: true });
    expect(state(threadId)).toMatchObject({ permissionMode: 'plan' });
  });

  it('preserves mode and pending approval when the live CLI rejects bypass', async () => {
    const respond = vi.fn();
    const threadId = setup({ setPermissionMode: vi.fn().mockRejectedValue(new Error('disabled by policy')), respond }, true);
    await expect(action({ threadId, mode: 'bypassPermissions' }, services)).resolves.toEqual({ success: false, reason: 'disabled by policy' });
    expect(state(threadId)).toMatchObject({ permissionMode: 'default', pendingControlRequest: { requestId: 'permission-1' } });
    expect(respond).not.toHaveBeenCalled();
    expect(services.chat.updateMessageState).not.toHaveBeenCalled();
  });

  it('saves a valid next-turn choice without a running process and rejects unknown modes', async () => {
    const threadId = setup();
    await expect(action({ threadId, mode: 'acceptEdits' }, services)).resolves.toEqual({ success: true });
    await expect(action({ threadId, mode: 'unknown' }, services)).resolves.toEqual({ success: false, reason: 'invalid permission mode' });
    expect(state(threadId)).toMatchObject({ permissionMode: 'acceptEdits' });
  });

  it('approves a pending ordinary tool only after bypass is acknowledged', async () => {
    const respond = vi.fn();
    const threadId = setup({ setPermissionMode: vi.fn().mockResolvedValue('bypassPermissions'), respond }, true);
    await expect(action({ threadId, mode: 'bypassPermissions' }, services)).resolves.toEqual({ success: true });
    expect(respond).toHaveBeenCalledWith('permission-1', { behavior: 'allow', updatedInput: { file_path: '/fixture' } });
    expect(state(threadId)).toMatchObject({ permissionMode: 'bypassPermissions', isRunning: true });
    expect(state(threadId)?.pendingControlRequest).toBeUndefined();
    expect(services.threads.updateChatState).toHaveBeenCalledWith(threadId, 'working');
  });

  it('keeps a replacement user-interaction request when it changes during the mode acknowledgement', async () => {
    let acknowledge!: (mode: string) => void;
    const respond = vi.fn();
    const threadId = setup({ setPermissionMode: vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; })), respond }, true);
    const update = action({ threadId, mode: 'bypassPermissions' }, services);
    repository.threadCommands.update(threadId, { context: { claudeCode: { permissionMode: 'default', pendingControlRequest: {
      requestId: 'replacement-question', approvalMessageId: 'question-1', toolName: 'AskUserQuestion',
    } } } });
    acknowledge('bypassPermissions'); await update;
    expect(respond).not.toHaveBeenCalled();
    expect(state(threadId)).toMatchObject({ permissionMode: 'bypassPermissions', pendingControlRequest: { requestId: 'replacement-question' } });
  });

  it('does not claim a replacement running process changed its mode', async () => {
    let acknowledge!: (mode: string) => void;
    const respond = vi.fn();
    const original = { setPermissionMode: vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; })), respond };
    const threadId = setup(original, true);
    const update = action({ threadId, mode: 'bypassPermissions' }, services);
    vi.mocked(services.cli.claudeCode.getHandle).mockReturnValue({ setPermissionMode: vi.fn() } as never);
    acknowledge('bypassPermissions');
    await expect(update).resolves.toMatchObject({ success: false, reason: 'active Claude session changed while changing mode' });
    expect(respond).not.toHaveBeenCalled();
    expect(state(threadId)).toMatchObject({ permissionMode: 'default', pendingControlRequest: { requestId: 'permission-1' } });
  });

});
