import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/cc-plan.ts';

const plan = { exists: true as const, content: '# Native plan', path: '/private/plan.md' };
function setup(handle?: { getPlan: ReturnType<typeof vi.fn> }) {
  const { id } = repository.threadCommands.create({ topic: 'Plan lookup', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { sessionId: 'native-session', cwd: '/fixture' } } });
  const read = vi.fn().mockResolvedValue(plan), query = vi.fn(), send = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle), getPlan: read, query } as never });
  mockService<Services, 'chat'>('chat', { sendBlockMessage: send });
  return { id, read, query, send };
}

describe('current native plan command', () => {
  it('uses the live handle and renders native markdown without a new query', async () => {
    const getPlan = vi.fn().mockResolvedValue(plan);
    const { id, read, query, send } = setup({ getPlan });
    await expect(action({ threadId: id }, services)).resolves.toMatchObject({ success: true, data: plan });
    expect(getPlan).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ threadId: id, text: 'Current Claude Code plan', forkable: false,
      blocks: [{ type: 'markdown', props: { content: '# Native plan', label: 'Plan' } }] });
  });
  it('reads saved native state while idle and distinguishes missing plan from failure', async () => {
    const { id, read, query, send } = setup();
    read.mockResolvedValue({ exists: false });
    await expect(action({ threadId: id }, services)).resolves.toMatchObject({ success: true, data: { exists: false } });
    expect(read).toHaveBeenCalledWith({ sessionId: 'native-session', cwd: '/fixture' });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'No plan has been written for this session.', blocks: [] }));
    read.mockRejectedValue(new Error('native lookup failed'));
    await expect(action({ threadId: id }, services)).resolves.toMatchObject({ success: false, text: 'cc-plan failed: native lookup failed' });
    expect(query).not.toHaveBeenCalled();
  });
  it('does not read a replacement session or publish a stale response after the session changes', async () => {
    const { id, read, send } = setup();
    let resolve!: (value: typeof plan) => void;
    read.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = action({ threadId: id }, services);
    repository.threadCommands.update(id, { context: { claudeCode: { sessionId: 'replacement', cwd: '/fixture' } } });
    resolve(plan);
    await expect(pending).resolves.toMatchObject({ success: false, text: 'Claude Code session changed while reading the plan.' });
    expect(send).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
  });
  it('does not fall back to saved state when a live lookup fails', async () => {
    const { id, read, send } = setup({ getPlan: vi.fn().mockRejectedValue(new Error('closed')) });
    await expect(action({ threadId: id }, services)).resolves.toMatchObject({ success: false, text: 'cc-plan failed: closed' });
    expect(read).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledOnce();
  });
  it('does not start a query when no native session exists', async () => {
    const { id, read, query } = setup();
    repository.threadCommands.update(id, { context: {} });
    await expect(action({ threadId: id }, services)).resolves.toMatchObject({ success: false });
    expect(read).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
});
