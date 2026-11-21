import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action as handleRevert } from '../../../../src/content/actions/claude-code/handle-revert.ts';
import type { EARS } from '@apackdev/sdk';

// The action runs on the harness's services: a real thread and messages in the in-memory database,
// with the CLI and the chat, threads, settings and artifact services it drives mocked
async function createServices(viewSessionResult: unknown[] | Error = [], sendBlockMessage = vi.fn()) {
  const { id: threadId } = repository.threadCommands.create({ topic: 'Revert', instructions: '', tags: ['claude-code'] });
  repository.threadCommands.update(threadId, { context: { claudeCode: { sessionId: 'session-1', cwd: '/project', isRunning: true } } });
  repository.chatCommands.addMessage({ threadId, sender: 'user', text: 'hello' });
  const assistant = repository.chatCommands.addMessage({ threadId, sender: 'assistant', text: 'hi', context: { cliUuid: 'uuid-1' } });

  mockService<Services, 'cli'>('cli', {
    claudeCode: {
      getHandle: vi.fn(() => undefined),
      clearHandle: vi.fn(),
      viewSession: vi.fn(async () => {
        if (viewSessionResult instanceof Error) throw viewSessionResult;
        return viewSessionResult;
      }),
    } as never,
  });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage });
  const updateChatState = vi.fn();
  mockService<Services, 'threads'>('threads', { updateChatState });
  mockService<Services, 'artifact'>('artifact', { findOrCreateByType: vi.fn(() => ({ artifactId: 'Artifact-art-1' as EARS.EntityId, created: true })) });
  const warn = vi.fn();
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });
  return { threadId, messageId: assistant.id, updateChatState, warn };
}

describe('CC: Handle Revert', () => {
  it('reverts with valid cliUuid when viewSession confirms it', async () => {
    const { threadId, messageId, updateChatState } = await createServices([
      { type: 'assistant', uuid: 'uuid-1' },
    ]);

    const result = await handleRevert({ threadId, messageId }, services);

    expect(result).toMatchObject({
      success: true,
      cliUuid: 'uuid-1',
    });
    expect(updateChatState).toHaveBeenLastCalledWith(threadId, 'idle');
  });

  it('clears cliUuid when viewSession shows UUID not in session (post-compaction)', async () => {
    const { threadId, messageId, updateChatState } = await createServices([]);

    const result = await handleRevert({ threadId, messageId }, services);

    expect(result).toMatchObject({
      success: true,
      cliUuid: undefined,
    });
    expect(updateChatState).toHaveBeenLastCalledWith(threadId, 'idle');
  });

  it('clears cliUuid when viewSession throws', async () => {
    const { threadId, messageId, warn } = await createServices(new Error('JSONL not found'));

    const result = await handleRevert({ threadId, messageId }, services);

    expect(result).toMatchObject({
      success: true,
      cliUuid: undefined,
    });
    expect(warn).toHaveBeenCalledWith(
      '[revert] could not validate cliUuid against session JSONL',
      expect.objectContaining({ cliUuid: 'uuid-1' }),
    );
  });
});
