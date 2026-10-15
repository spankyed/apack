import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/cc-context.ts';
import { refreshThreadContextUsage } from '../../../../src/content/actions/claude-code/_helpers/context-usage.ts';
import { nativeContextUsage } from '../../../_support/claude-context.ts';

function setup(active?: { getContextUsage: ReturnType<typeof vi.fn> }) {
  const { id } = repository.threadCommands.create({ topic: 'Context', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { sessionId: 'session-1', cwd: '/fixture' } } });
  const getContextUsage = vi.fn().mockResolvedValue(nativeContextUsage);
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => active), getContextUsage, query: vi.fn() } as never });
  mockService<Services, 'chat'>('chat', { sendBlockMessage: vi.fn() });
  return { threadId: id, getContextUsage };
}
const run = (threadId: string) => action({ threadId }, services, {} as never, 'context-flow');

describe('native context action and refresh', () => {
  it('uses the active process and renders native categories, memory and skill details', async () => {
    const read = vi.fn().mockResolvedValue(nativeContextUsage);
    const { threadId, getContextUsage } = setup({ getContextUsage: read });
    const result = await run(threadId);
    expect(result.success).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(getContextUsage).not.toHaveBeenCalled();
    expect(services.cli.claudeCode.query).not.toHaveBeenCalled();
    expect(services.chat.sendBlockMessage).toHaveBeenCalledWith(expect.objectContaining({
      threadId, blocks: [{ type: 'context-usage', props: { data: expect.objectContaining({
        model: 'fixture-model', totalTokens: 250, maxTokens: 1000, percentage: 25,
        categories: [{ name: 'System prompt', tokens: 100, percentage: 10 }, { name: 'Messages', tokens: 150, percentage: 15 }],
        memoryFiles: nativeContextUsage.memoryFiles, skills: nativeContextUsage.skills.skillFrontmatter,
      }) } }],
    }));
  });

  it('uses the saved-session service while idle and exposes native failure without a prompt fallback', async () => {
    const { threadId, getContextUsage } = setup();
    await run(threadId);
    expect(getContextUsage).toHaveBeenCalledWith({ sessionId: 'session-1', cwd: '/fixture' });
    getContextUsage.mockRejectedValue(new Error('native context unavailable'));
    await expect(run(threadId)).resolves.toMatchObject({ success: false, text: 'cc-context failed: native context unavailable' });
    expect(services.cli.claudeCode.query).not.toHaveBeenCalled();
  });

  it('publishes thresholds once for the current session and drops a summary after a session switch', async () => {
    const { threadId, getContextUsage } = setup();
    await refreshThreadContextUsage(services, threadId, { sessionId: 'session-1', cwd: '/fixture' });
    await refreshThreadContextUsage(services, threadId, { sessionId: 'session-1', cwd: '/fixture' });
    expect(services.chat.sendBlockMessage).toHaveBeenCalledOnce();
    expect(repository.threadQueries.byId(threadId)?.context?.claudeCode).toMatchObject({ alertedThresholds: [25], contextUsage: { totalTokens: 250 } });
    let resolve!: (value: typeof nativeContextUsage) => void;
    getContextUsage.mockImplementation(() => new Promise(done => { resolve = done; }));
    const refresh = refreshThreadContextUsage(services, threadId, { sessionId: 'session-1', cwd: '/fixture' });
    repository.threadCommands.update(threadId, { context: { claudeCode: { sessionId: 'session-2' } } });
    resolve({ ...nativeContextUsage, percentage: 90 });
    await refresh;
    expect(repository.threadQueries.byId(threadId)?.context?.claudeCode).toEqual({ sessionId: 'session-2' });
    expect(services.chat.sendBlockMessage).toHaveBeenCalledOnce();
  });
});
