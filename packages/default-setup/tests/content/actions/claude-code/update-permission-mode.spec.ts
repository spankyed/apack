import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/update-permission-mode.ts';

let getHandle: ReturnType<typeof vi.fn>;
let getNativeTerminal: ReturnType<typeof vi.fn>;
let updateMessageState: ReturnType<typeof vi.fn>;
let updateChatState: ReturnType<typeof vi.fn>;

function setup(handle?: { setPermissionMode: ReturnType<typeof vi.fn>; respond?: ReturnType<typeof vi.fn> }, pending = false) {
  const { id } = repository.threadCommands.create({ topic: 'Permission mode', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { permissionMode: 'default',
    ...(pending ? { pendingControlRequest: { requestId: 'permission-1', toolName: 'Write',
      approvalMessageId: 'approval-1', originalInput: { file_path: '/fixture' } } } : {}),
  } } });
  getHandle = vi.fn(() => handle);
  getNativeTerminal = vi.fn();
  updateMessageState = vi.fn();
  updateChatState = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle, getNativeTerminal } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState });
  mockService<Services, 'threads'>('threads', { updateChatState });
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
    expect(updateMessageState).not.toHaveBeenCalled();
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
    expect(updateChatState).toHaveBeenCalledWith(threadId, 'working');
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
    getHandle.mockReturnValue({ setPermissionMode: vi.fn() } as never);
    acknowledge('bypassPermissions');
    await expect(update).resolves.toMatchObject({ success: false, reason: 'active Claude session changed while changing mode' });
    expect(respond).not.toHaveBeenCalled();
    expect(state(threadId)).toMatchObject({ permissionMode: 'default', pendingControlRequest: { requestId: 'permission-1' } });
  });

});


describe('native terminal permission ownership', () => {
  it('persists only the acknowledged native mode', async () => {
    const threadId = setup();
    let acknowledge!: (mode: string) => void;
    const native = { state: { session: { prePlanMode: 'default' } }, setPermissionMode: vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; })) };
    getNativeTerminal.mockReturnValue(native as never);
    const changing = action({ threadId, mode: 'plan' }, services);
    expect(state(threadId)?.permissionMode).toBe('default');
    acknowledge('plan');
    await expect(changing).resolves.toEqual({ success: true });
    expect(native.setPermissionMode).toHaveBeenCalledWith('plan');
    expect(state(threadId)).toMatchObject({ permissionMode: 'plan', prePlanMode: 'default' });
  });
  it('retains app mode when native policy refuses or the owner changes', async () => {
    const threadId = setup();
    const native = { setPermissionMode: vi.fn().mockRejectedValue(new Error('Native policy refused')) };
    getNativeTerminal.mockReturnValue(native as never);
    await expect(action({ threadId, mode: 'plan' }, services)).resolves.toEqual({ success: false, reason: 'Native policy refused' });
    let acknowledge!: (mode: string) => void;
    native.setPermissionMode.mockImplementation(() => new Promise<string>(resolve => { acknowledge = resolve; }));
    const changing = action({ threadId, mode: 'plan' }, services);
    getNativeTerminal.mockReturnValue(undefined);
    acknowledge('plan');
    await expect(changing).resolves.toMatchObject({ success: false });
    expect(state(threadId)?.permissionMode).toBe('default');
  });
});
