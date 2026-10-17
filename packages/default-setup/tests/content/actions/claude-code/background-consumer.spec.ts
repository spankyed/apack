import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services, type EntityId } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { consumeStream, consumeConversationTurn } from '../../../../src/content/actions/claude-code/_helpers/stream-consumer.ts';
import { createStreamWriter } from '../../../../src/content/actions/claude-code/_helpers/stream-writer.ts';
import { createThinkingWriter } from '../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts';
import { createToolActivityWriter } from '../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts';
import { createClaudeNestedActivity } from '../../../../src/features/code/be/services/claude-code/nested-activity.ts';
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
    await consumeStream(handle, { services, activity: createClaudeNestedActivity(), threadId: id, text: 'Host prompt', userMessageId: 'app-user' }, {
      messageId, writer: createStreamWriter(services, messageId), thinking,
      toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
    });
    const mapped = update.mock.calls.filter(([target, patch]) => target === 'app-user' && patch.context?.cliUuid);
    expect(mapped).toEqual([['app-user', { context: { cliUuid: 'host-input' } }]]);
  });

  it('keeps nested prose, thinking, tools and UUIDs out of the parent while retaining launching-tool details', async () => {
    const { id } = repository.threadCommands.create({ topic: 'Nested Agent', instructions: '', tags: [] });
    const update = vi.fn(), emit = vi.fn();
    mockService<Services, 'chat'>('chat', { updateMessageState: update });
    mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
    const activity = createClaudeNestedActivity();
    const child = { type: 'assistant', uuid: 'child-uuid', parent_tool_use_id: 'agent-tool', message: { content: [
      { type: 'text', text: 'Private worker response' }, { type: 'tool_use', id: 'nested-read', name: 'Read', input: { file_path: '/fixture/child.txt' } },
      { type: 'tool_use', id: 'nested-write', name: 'Write', input: { file_path: '/fixture/changed.txt' } },
    ] } };
    const lines = [
      { type: 'assistant', uuid: 'parent-tool-uuid', message: { content: [{ type: 'tool_use', id: 'agent-tool', name: 'Agent', input: { prompt: 'worker' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'agent-tool', content: 'Launched in background' }] } },
      { type: 'stream_event', parent_tool_use_id: 'agent-tool', event: { type: 'message_start' } },
      { type: 'stream_event', parent_tool_use_id: 'agent-tool', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Worker thinking' } } },
      { type: 'stream_event', parent_tool_use_id: 'agent-tool', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Worker partial' } } },
      child, child,
      { type: 'user', uuid: 'nested-result', parent_tool_use_id: 'agent-tool', message: { content: [{ type: 'tool_result', tool_use_id: 'nested-read', content: 'Worker file result' }] } },
      { type: 'assistant', uuid: 'grandchild-uuid', parent_tool_use_id: 'nested-read', message: { content: [{ type: 'text', text: 'Nested descendant response' }] } },
      { type: 'assistant', uuid: 'foreign-child-uuid', parent_tool_use_id: 'foreign-tool', message: { content: [{ type: 'text', text: 'Foreign worker' }] } },
      { type: 'assistant', uuid: 'parent-reply-uuid', message: { content: [{ type: 'text', text: 'Parent response only' }] } },
      { type: 'result', subtype: 'success', session_id: 'fixture', result: 'Parent response only' },
    ];
    const handle = { events: (async function* () { for (const line of lines) if (!activity.receive(line as StreamLine)) yield line; })(), hasPendingBackgroundTasks: () => false, close: vi.fn(async () => {}) };
    mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle), clearHandle: vi.fn() } as never });
    const messageId = 'nested-parent' as EntityId;
    const thinking = createThinkingWriter(services, messageId);
    const tools = createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() });
    const writer = createStreamWriter(services, messageId);
    await consumeStream(handle, { services, activity, threadId: id, text: 'Host' }, { messageId, thinking, toolActivity: tools, writer });
    expect(writer.text).toBe('Parent response only');
    expect(emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'cc.stream.completed', payload: expect.objectContaining({ toolCallCount: 3, mutatedPaths: ['/fixture/changed.txt'] }) }));
    expect(tools.entries.map(entry => entry.tool)).toEqual(['Agent']);
    expect(tools.entries[0]?.details?.output).toContain('Launched in background');
    expect(tools.entries[0]?.details?.output?.match(/Private worker response/g)).toHaveLength(1);
    expect(tools.entries[0]?.details?.output).toContain('Worker file result');
    expect(tools.entries[0]?.details?.output).toContain('Nested descendant response');
    expect(tools.entries[0]?.details?.output).not.toContain('Worker partial');
    expect(tools.entries[0]?.details?.output).not.toContain('Foreign worker');
    expect(update.mock.calls.filter(([, patch]) => patch.context?.cliUuid).map(([, patch]) => patch.context.cliUuid)).toEqual(['parent-tool-uuid', 'parent-reply-uuid']);
    expect(update.mock.calls.some(([, patch]) => JSON.stringify(patch.blocks ?? []).includes('Worker thinking'))).toBe(false);
  });

  it('retains late child details on the launching message and accounts changes once in a later result', async () => {
    const { id } = repository.threadCommands.create({ topic: 'Cross-turn child', instructions: '', tags: [] });
    const update = vi.fn(), emit = vi.fn();
    mockService<Services, 'chat'>('chat', { updateMessageState: update });
    mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
    mockService<Services, 'cli'>('cli', { claudeCode: { isCurrentTurn: vi.fn(() => true), clearHandle: vi.fn() } as never });
    const activity = createClaudeNestedActivity();
    const run = async (messageId: EntityId, lines: unknown[], costBaseline: number) => {
      const thinking = createThinkingWriter(services, messageId);
      const tools = createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() });
      const writer = createStreamWriter(services, messageId);
      const handle = { events: (async function* () { yield* lines; })(), hasPendingBackgroundTasks: () => true, close: vi.fn() };
      await consumeStream(handle, { services, threadId: id, text: 'Host', persistent: true, activity, costBaseline }, { messageId, thinking, toolActivity: tools, writer });
      expect(handle.close).not.toHaveBeenCalled();
      return { tools, writer };
    };
    const first = await run('launching-message' as EntityId, [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-root', name: 'Agent', input: {} }] } },
      { type: 'result', subtype: 'success', total_cost_usd: 1 },
    ], 0);
    const child = { type: 'assistant', parent_tool_use_id: 'agent-root', uuid: 'late-child', message: { content: [
      { type: 'text', text: 'Late worker output' },
      { type: 'tool_use', id: 'child-edit', name: 'Edit', input: { file_path: '/fixture/changed.ts' } },
    ] } } as StreamLine;
    activity.receive(child); activity.receive(child);
    activity.receive({ type: 'user', parent_tool_use_id: 'agent-root', uuid: 'late-error', message: { content: [{ type: 'tool_result', tool_use_id: 'child-edit', is_error: true, content: 'edit failed' }] } } as StreamLine);
    expect(first.tools.entries[0]?.details?.output?.match(/Late worker output/g)).toHaveLength(1);
    expect(first.tools.entries[0]?.details?.output).toContain('edit failed');
    const second = await run('later-message' as EntityId, [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Parent follow-up' }] } },
      { type: 'result', subtype: 'success', total_cost_usd: 3 },
    ], 1);
    expect(second.writer.text).toBe('Parent follow-up');
    expect(second.tools.entries).toEqual([]);
    const completed = emit.mock.calls.map(([, event]) => event).filter(event => event.eventType === 'cc.stream.completed');
    expect(completed.map(event => event.payload)).toEqual([
      expect.objectContaining({ toolCallCount: 1, costUsd: 1, mutatedPaths: [], hadErrors: false }),
      expect.objectContaining({ toolCallCount: 1, costUsd: 2, mutatedPaths: ['/fixture/changed.ts'], hadErrors: true }),
    ]);
    activity.close();
    const writes = update.mock.calls.length;
    activity.receive({ ...child, uuid: 'retired-child' });
    expect(update).toHaveBeenCalledTimes(writes);
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
    await consumeStream(handle, { services, activity: createClaudeNestedActivity(), threadId: id, text: 'Fixture' }, {
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
  it('does not repersist an old background result when ownership changes as its stream ends', async () => {
    const { id } = repository.threadCommands.create({ topic: 'Superseded background', instructions: '', tags: [] });
    repository.threadCommands.update(id, { context: { claudeCode: { sessionId: 'old-session', isRunning: true } } });
    const emit = vi.fn();
    mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
    mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn() });
    let current: object | undefined;
    const handle = { events: (async function* () {
      yield { type: 'result', subtype: 'success', session_id: 'old-session', total_cost_usd: 1 };
      repository.threadCommands.update(id, { context: { claudeCode: { sessionId: 'replacement-session', isRunning: true } } });
      current = undefined;
    })(), hasPendingBackgroundTasks: () => true, close: vi.fn(async () => {}) };
    current = handle;
    mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => current), clearHandle: vi.fn() } as never });
    const messageId = 'superseded-message' as EntityId;
    const thinking = createThinkingWriter(services, messageId);
    await consumeStream(handle, { services, activity: createClaudeNestedActivity(), threadId: id, text: 'Superseded input' }, {
      messageId, thinking, writer: createStreamWriter(services, messageId),
      toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
    });
    expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ sessionId: 'replacement-session', isRunning: true });
    expect(emit).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'cc.stream.completed' }));
    expect(handle.close).not.toHaveBeenCalled();
  });

});


it('cancels an unsupported generic dialog without sending tool denial, pausing or opening UI input', async () => {
  const { id } = repository.threadCommands.create({ topic: 'Unsupported native dialog', instructions: '', tags: [] });
  const sendBlockMessage = vi.fn(), emit = vi.fn();
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
  const cancelUserDialog = vi.fn(), respond = vi.fn();
  const lines = [
    { type: 'control_request', request_id: 'native-dialog', request: { subtype: 'request_user_dialog', dialog_kind: 'fable_overage_consent_prompt', payload: { modelName: 'Fixture' } } },
    { type: 'result', subtype: 'success', session_id: 'fixture', result: 'Done' },
  ];
  const handle = { events: (async function* () { yield* lines; })(), cancelUserDialog, respond,
    hasPendingBackgroundTasks: () => false, close: vi.fn(async () => {}), kill: vi.fn() };
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle), clearHandle: vi.fn() } as never });
  const messageId = 'dialog-assistant' as EntityId;
  const thinking = createThinkingWriter(services, messageId);
  await consumeStream(handle, { services, activity: createClaudeNestedActivity(), threadId: id, text: 'Fixture' }, {
    messageId, writer: createStreamWriter(services, messageId), thinking,
    toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
  });
  expect(cancelUserDialog).toHaveBeenCalledWith('native-dialog');
  expect(respond).not.toHaveBeenCalled();
  expect(sendBlockMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('cannot display'), blocks: [] }));
  expect(emit).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'cc.stream.paused' }));
  expect(handle.kill).not.toHaveBeenCalled();
});


it('marks a success/is_error result as failed while preserving refusal detail and turn cost', async () => {
  const { id } = repository.threadCommands.create({ topic: 'Native refusal result', instructions: '', tags: [] });
  const update = vi.fn(), emit = vi.fn();
  mockService<Services, 'chat'>('chat', { updateMessageState: update, sendBlockMessage: vi.fn() });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
  const raw = { type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error', session_id: 'refusal-session', result: 'API Error: fixed native refusal', total_cost_usd: 0.25, duration_ms: 42, errors: [] };
  const handle = { events: (async function* () { yield raw; })(), hasPendingBackgroundTasks: vi.fn(() => true), close: vi.fn(async () => {}), kill: vi.fn() };
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => handle), clearHandle: vi.fn() } as never });
  const messageId = 'refusal-assistant' as EntityId;
  const thinking = createThinkingWriter(services, messageId);
  const writer = createStreamWriter(services, messageId);
  await consumeStream(handle, { services, activity: createClaudeNestedActivity(), threadId: id, text: 'Fixture' }, {
    messageId, writer, thinking,
    toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
  });
  expect(writer.text).toContain('API Error: fixed native refusal');
  expect(repository.threadQueries.byId(id)?.context?.claudeCode?.sessionId).toBeUndefined();
  expect(handle.hasPendingBackgroundTasks).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'cc.stream.completed', payload: expect.objectContaining({ hadErrors: true, costUsd: 0.25, durationMs: 42 }) }));
});


it('uses the owner baseline updated during a reset when emitting completion cost', async () => {
  const { id } = repository.threadCommands.create({ topic: 'Reset cost', instructions: '', tags: [] })
  const emit = vi.fn()
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn() })
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() })
  mockService<Services, 'cli'>('cli', { claudeCode: { storeHandle: vi.fn(), isCurrentTurn: () => true, clearHandle: vi.fn() } as never })
  const activity = createClaudeNestedActivity()
  let turn!: import('../../../../src/features/code/be/services/claude-code/conversation.ts').ClaudeConversationTurn
  turn = { stopped: false, costBaseline: 2, activity, handle: {
    events: (async function* () {
      turn.costBaseline = 0
      yield { type: 'conversation_reset', new_conversation_id: 'conversation-only-id' }
      yield { type: 'result', subtype: 'success', session_id: 'new-session', total_cost_usd: 0.5 }
    })(), hasPendingBackgroundTasks: () => false, close: vi.fn(), kill: vi.fn(),
  } } as unknown as import('../../../../src/features/code/be/services/claude-code/conversation.ts').ClaudeConversationTurn
  const messageId = 'reset-cost-message' as EntityId
  const thinking = createThinkingWriter(services, messageId)
  await consumeConversationTurn(turn, { services, threadId: id, text: '/clear' }, {
    messageId, thinking, writer: createStreamWriter(services, messageId),
    toolActivity: createToolActivityWriter(services, messageId, { getThinkingBlock: () => thinking.buildBlock() }),
  })
  expect(emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'cc.stream.completed', payload: expect.objectContaining({ sessionId: 'new-session', costUsd: 0.5 }) }))
  activity.close()
})
