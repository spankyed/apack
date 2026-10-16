import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services, type EntityId } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { consumeStream } from '../../../../src/content/actions/claude-code/_helpers/stream-consumer.ts';
import { createStreamWriter } from '../../../../src/content/actions/claude-code/_helpers/stream-writer.ts';
import { createThinkingWriter } from '../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts';
import { createToolActivityWriter } from '../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts';
import { createBackgroundTaskTracker } from '../../../../src/features/code/be/services/claude-code/background-tasks.ts';
import type { StreamLine } from '../../../../src/features/code/be/services/claude-code/types.ts';
vi.mock('../../../../src/content/actions/claude-code/_helpers/context-usage.ts', () => ({ refreshThreadContextUsage: vi.fn(async () => {}) }));

describe('background continuation action consumer', () => {
  it('maps only the input replay UUID when tool-result user events arrive first', async () => {
    const { id } = repository.threadCommands.create({ topic: 'Replay identity', instructions: '', tags: [] });
    const update = vi.fn();
    mockService<Services, 'chat'>('chat', { updateMessageState: update, sendBlockMessage: vi.fn() });
    mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    mockService<Services, 'emitter'>('emitter', { sendToSystem: vi.fn(), broadcastToPlugin: vi.fn() });
    const lines = [
      { type: 'user', uuid: 'tool-result-row', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown-tool', content: 'Done' }] } },
      { type: 'user', uuid: 'child-input', isReplay: true, parent_tool_use_id: 'child-task', message: { role: 'user', content: 'Child prompt' } },
      { type: 'user', uuid: 'host-input', isReplay: true, parent_tool_use_id: null, message: { role: 'user', content: 'Host prompt' } },
      { type: 'user', uuid: 'later-input', isReplay: true, parent_tool_use_id: null, message: { role: 'user', content: 'Later prompt' } },
      { type: 'result', subtype: 'success', session_id: 'fixture', result: 'Done' },
    ];
    const handle = { events: (async function* () { yield* lines; })(), hasPendingBackgroundTasks: () => false,
      close: vi.fn(async () => {}), kill: vi.fn() };
    mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle), clearHandle: vi.fn() } as never });
    const messageId = 'replay-assistant' as EntityId;
    const thinking = createThinkingWriter(services, messageId);
    await consumeStream(handle, { services, threadId: id, text: 'Host prompt', userMessageId: 'app-user' }, {
      messageId, writer: createStreamWriter(services, messageId), thinking,
      toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
    });
    const mapped = update.mock.calls.filter(([target, patch]) => target === 'app-user' && patch.context?.cliUuid);
    expect(mapped).toEqual([['app-user', { context: { cliUuid: 'host-input' } }]]);
  });

  it('persists follow-up assistant output and uses the final cumulative usage', async () => {
    const { id } = repository.threadCommands.create({ topic: 'Background', instructions: '', tags: [] });
    repository.threadCommands.update(id, { context: { claudeCode: { isRunning: true } } });
    const update = vi.fn();
    mockService<Services, 'chat'>('chat', { updateMessageState: update,
      sendBlockMessage: vi.fn(() => ({ messageId: 'after-background' } as never)) });
    mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    const emit = vi.fn();
    mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
    const tracker = createBackgroundTaskTracker();
    const lines = [
      { type: 'system', subtype: 'task_started', task_id: 'background-fixture' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Initial response' },
        { type: 'tool_use', id: 'background-tool', name: 'Bash', input: { command: 'synthetic fixture' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'background-tool', content: 'Running in background' }] } },
      { type: 'result', subtype: 'success', session_id: 'fixture', total_cost_usd: 1, duration_ms: 10 },
      { type: 'system', subtype: 'task_notification', task_id: 'background-fixture', status: 'completed' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Background follow-up' }] } },
      { type: 'result', subtype: 'success', session_id: 'fixture', total_cost_usd: 2, duration_ms: 20 },
    ] as StreamLine[];
    const handle = { events: (async function* () { for (const line of lines) { tracker.observe(line); yield line; } })(),
      hasPendingBackgroundTasks: tracker.hasPendingTasks, close: vi.fn(async () => {}), kill: vi.fn() };
    mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle), clearHandle: vi.fn() } as never });
    const messageId = 'initial-message' as EntityId;
    const thinking = createThinkingWriter(services, messageId);
    await consumeStream(handle, { services, threadId: id, text: 'Fixture' }, {
      messageId, writer: createStreamWriter(services, messageId), thinking,
      toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
    });
    expect(update).toHaveBeenCalledWith('initial-message', expect.objectContaining({ text: 'Initial response' }));
    expect(update).toHaveBeenCalledWith('after-background', expect.objectContaining({ text: 'Background follow-up' }));
    expect(emit).toHaveBeenCalledWith({ role: 'brain' }, expect.objectContaining({
      eventType: 'cc.stream.completed', payload: expect.objectContaining({ costUsd: 2, durationMs: 20, toolCallCount: 1 }),
    }));
    expect(handle.close).toHaveBeenCalledOnce();
    expect(handle.kill).not.toHaveBeenCalled();
  });
});
