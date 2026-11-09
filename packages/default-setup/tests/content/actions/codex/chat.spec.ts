import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action as codexChat } from '../../../../src/content/actions/codex/chat.ts';

// The action runs on the harness's services: a real thread in the in-memory database, with the Codex app server and
// the chat and threads services it drives mocked
function startCodex(resolved: { textPrefix: string; imageBlocks: unknown[]; addDirs: string[] }) {
  const { id } = repository.threadCommands.create({ topic: 'Codex', instructions: '', tags: [] });
  const startTurn = vi.fn().mockResolvedValue({ turnId: 'turn-1' });
  const resolveReferences = vi.fn().mockResolvedValue(resolved);
  mockService<Services, 'codex'>('codex', {
    status: 'ready', getHandle: vi.fn(), registerConsumer: vi.fn(), storeHandle: vi.fn(),
    startThread: vi.fn().mockResolvedValue({ threadId: 'codex-thread-1', cwd: '/work' }),
    startTurn,
  });
  mockService<Services, 'chat'>('chat', {
    sendBlockMessage: vi.fn().mockReturnValue({ messageId: 'Message-1' }),
    updateMessageState: vi.fn(),
    streamMessageText: vi.fn(),
    resolveReferences,
  });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  return { threadId: id, startTurn, resolveReferences };
}

describe('Codex Chat', () => {
  it("puts what the user attached before their text, as Claude Code's chat does", async () => {
    const references = { context: [{ refType: 'note', refId: 'Note-1', shortCode: 'NOT-1', label: 'Plan' }] };
    const { threadId, startTurn, resolveReferences } = startCodex({ textPrefix: '--- Note: Plan ---\nShip it\n---', imageBlocks: [], addDirs: [] });

    await codexChat({ threadId, text: 'what does the plan say?', references, cwdOverride: '/work' }, services);

    expect(resolveReferences).toHaveBeenCalledWith(references);
    const sent = startTurn.mock.calls[0]![0].input[0].text as string;
    expect(sent).toContain('--- Note: Plan ---\nShip it\n---\n\nwhat does the plan say?');
  });
});
