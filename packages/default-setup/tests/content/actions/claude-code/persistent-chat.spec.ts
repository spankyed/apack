import { PassThrough } from 'node:stream';
import { mockService, startApp, importFlows, type TestApp } from '@apackdev/testing/harness';
import { actionLabel } from '../../../_support/flows.ts';
import { importCompiledContent } from '@apackdev/sdk/utils';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { chatService } from '#features/threads/be/services/chat.ts';
import * as store from '#features/code/be/services/claude-code/handle-store.ts';
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts';
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts';
import { action as chat } from '../../../../src/content/actions/claude-code/chat.ts';
import { action as updateMode } from '../../../../src/content/actions/claude-code/update-permission-mode.ts';
import { action as complete } from '../../../../src/content/actions/claude-code/turn-completed.ts';
vi.mock('../../../../src/content/actions/claude-code/_helpers/context-usage.ts', () => ({ refreshThreadContextUsage: vi.fn(async () => {}) }));

afterEach(() => store.killAllHandles());

it.each([['source', false], ['compiled flow', false], ['source', true], ['compiled flow', true]] as const)('%s reuses a process across host/autonomous work (worktree: %s)', async (mode, worktree) => {
  const { id } = repository.threadCommands.create({ topic: 'Persistent Claude', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { cwd: '/fixture', useWorktree: worktree } } });
  const events = new PassThrough({ objectMode: true });
  let sequence = 0;
  const native = { events: events as AsyncIterable<StreamLine>, send: vi.fn(() => `input-${++sequence}`),
    hasPendingBackgroundTasks: () => false, close: vi.fn(async () => { events.end(); }), kill: vi.fn(() => events.end()),
    setPermissionMode: vi.fn(async mode => mode),
  } as unknown as QueryHandle;
  const opened = vi.fn(async (key, launchKey, _options, consume) => store.openConversation(key, launchKey, async () => native, consume));
  mockService<Services, 'cli'>('cli', { claudeCode: { openConversation: opened, getConversation: store.getConversation,
    isConversationBusy: store.isConversationBusy, closeIdleConversation: store.closeIdleConversation,
    getHandle: store.getHandle, isCurrentTurn: store.isCurrentTurn, clearHandle: store.clearHandle, storeHandle: store.storeHandle,
    sessionExists: vi.fn(async () => true),
  } as never });
  mockService<Services, 'chat'>('chat', { ...chatService, resolveReferences: vi.fn(async () => ({ textPrefix: '', imageBlocks: [] })) } as never);
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const emit = vi.fn();
  mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
  const completions = () => emit.mock.calls.map(([, event]) => event).filter(event => event.eventType === 'cc.stream.completed');
  const finish = async (number: number) => {
    events.write({ type: 'command_lifecycle', state: 'started', command_uuid: `input-${number}` });
    events.write({ type: 'system', subtype: 'init', session_id: 'fixture-session', cwd: worktree ? '/fixture/native-worktree' : '/fixture' });
    events.write({ type: 'user', isReplay: true, uuid: `input-${number}`, message: { content: `input ${number}` } });
    events.write({ type: 'assistant', uuid: `assistant-${number}`, message: { content: [{ type: 'text', text: `reply ${number}` }] } });
    events.write({ type: 'result', subtype: 'success', session_id: 'fixture-session', user_message_uuid: `input-${number}`, total_cost_usd: number, result: `reply ${number}` });
    if (app) await vi.waitFor(() => expect(repository.threadQueries.byId(id)?.context?.claudeCode?.turns).toBe(number));
    else {
      await vi.waitFor(() => expect(completions()).toHaveLength(number));
      await complete(completions()[number - 1].payload, services);
    }
    await vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
  };
  let app: TestApp | undefined;
  if (mode === 'compiled flow') {
    const compiledDir = resolve(import.meta.dirname, '../../../../dist/runtime/content');
    importCompiledContent({ compiledDir,
      include: { flows: new Set(), library: new Set(), notes: new Set(), settings: new Set() } });
    const flows = JSON.parse(readFileSync(resolve(compiledDir, 'flows.content.json'), 'utf8'));
    importFlows({ 'Claude Code': { ...flows['Claude Code'], root: true } });
    app = await startApp({ systems: ['brain'] });
    await app.runFlow('Claude Code');
  }
  const invoke = async (text: string, messageId: string) => {
    if (!app) return chat({ threadId: id, text, messageId }, services, {} as never, '');
    const run = await app.runFlow('Claude Code', { event: 'user.message', data: { threadId: id, text, messageId, mode: 'Claude Code' } });
    expect(run.steps.map(actionLabel)).toContain('Claude Code Chat');
    return { streaming: store.isConversationBusy(id) };
  };
  const user1 = repository.chatCommands.addMessage({ threadId: id, sender: 'user', text: 'first' });
  expect(await invoke('first', user1.id)).toMatchObject({ streaming: true });
  await finish(1);
  expect(store.getHandle(id)).toBe(native);
  expect(native.close).not.toHaveBeenCalled();
  const user2 = repository.chatCommands.addMessage({ threadId: id, sender: 'user', text: 'second' });
  expect(await invoke('second', user2.id)).toMatchObject({ streaming: true });
  await finish(2);
  expect(opened).toHaveBeenCalledOnce();
  expect(native.send).toHaveBeenCalledTimes(2);
  const beforeUi = repository.chatQueries.threadData(id)?.messages?.length;
  const observed = vi.fn();
  const unsubscribe = store.getConversation(id)!.owner.subscribe(observed);
  events.write({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' });
  await vi.waitFor(() => expect(observed).toHaveBeenCalled());
  expect(repository.chatQueries.threadData(id)?.messages).toHaveLength(beforeUi!);
  unsubscribe();
  let modeReady!: () => void;
  vi.mocked(native.setPermissionMode).mockImplementationOnce(() => new Promise<'default'>(resolve => { modeReady = () => resolve('default'); }));
  const changingMode = updateMode({ threadId: id, mode: 'default' }, services);
  events.write({ type: 'assistant', uuid: 'autonomous-assistant', message: { content: [{ type: 'text', text: 'native autonomous work' }] } });
  await vi.waitFor(() => expect(store.getConversation(id)?.owner.busy).toBe(true));
  expect(store.getHandle(id)).toBe(native);
  modeReady();
  expect(await changingMode).toMatchObject({ success: true });
  events.write({ type: 'result', subtype: 'success', session_id: 'fixture-session', total_cost_usd: 3, result: 'native autonomous work' });
  if (app) await vi.waitFor(() => expect(repository.threadQueries.byId(id)?.context?.claudeCode?.turns).toBe(3));
  else {
    await vi.waitFor(() => expect(completions()).toHaveLength(3));
    await complete(completions()[2].payload, services);
    expect(completions().map(event => event.payload.costUsd)).toEqual([1, 1, 1]);
  }
  await vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
  expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({ totalCostUsd: 3, turns: 3, isRunning: false });
  const messages = repository.chatQueries.threadData(id)?.messages ?? [];
  expect(messages.find(message => message.id === user1.id)?.context?.cliUuid).toBe('input-1');
  expect(messages.find(message => message.id === user2.id)?.context?.cliUuid).toBe('input-2');
  expect(messages.filter(message => message.sender === 'assistant').map(message => message.text)).toEqual(['reply 1', 'reply 2', 'native autonomous work']);
  expect(await store.closeIdleConversation(id)).toBe(true);
  expect(store.getHandle(id)).toBeUndefined();
  expect(native.close).toHaveBeenCalledOnce();
});
