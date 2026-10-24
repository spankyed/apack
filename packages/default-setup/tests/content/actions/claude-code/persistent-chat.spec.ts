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
import { action as modelCommand } from '../../../../src/content/actions/claude-code/cc-command.ts';
import { action as chat } from '../../../../src/content/actions/claude-code/chat.ts';
import { action as updateMode } from '../../../../src/content/actions/claude-code/update-permission-mode.ts';
import { action as complete } from '../../../../src/content/actions/claude-code/turn-completed.ts';
vi.mock('../../../../src/content/actions/claude-code/_helpers/context-usage.ts', () => ({ refreshThreadContextUsage: vi.fn(async () => {}) }));

afterEach(() => store.killAllHandles());

it.each([['source', false, false], ['compiled flow', false, false], ['source', true, false], ['compiled flow', true, false], ['source', false, true], ['source', true, true]] as const)('%s reuses a process across host/autonomous work (worktree: %s)', async (mode, worktree, stagedModel) => {
  const { id } = repository.threadCommands.create({ topic: 'Persistent Claude', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { cwd: '/fixture', useWorktree: worktree, ...(stagedModel ? { modelOverride: 'sonnet' } : {}) } } });
  const events = new PassThrough({ objectMode: true });
  let sequence = 0;
  const native = { events: events as AsyncIterable<StreamLine>, send: vi.fn(() => `input-${++sequence}`),
    hasPendingBackgroundTasks: () => false, getPermissionMode: vi.fn(async () => 'acceptEdits'), close: vi.fn(async () => { events.end(); }), kill: vi.fn(() => events.end()),
    setPermissionMode: vi.fn(async mode => mode),
    setModel: vi.fn(async () => {}),
  } as unknown as QueryHandle;
  const opened = vi.fn(async (key, launchKey, _options, consume) => store.openConversation(key, launchKey, async () => native, consume));
  mockService<Services, 'cli'>('cli', { claudeCode: { openConversation: opened, getNativeTerminal: store.getNativeTerminal, getConversation: store.getConversation, getNativeLaunch: store.getNativeLaunch,
    isConversationBusy: store.isConversationBusy, closeIdleConversation: store.closeIdleConversation,
    getHandle: store.getHandle, isCurrentTurn: store.isCurrentTurn, clearHandle: store.clearHandle, storeHandle: store.storeHandle,
    sessionExists: vi.fn(async () => true),
  } as never });
  mockService<Services, 'chat'>('chat', { ...chatService, resolveReferences: vi.fn(async () => ({ textPrefix: '', imageBlocks: [] })) } as never);
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const emit = vi.fn();
  // Compiled flows consume the real completion bus; direct source runs record it.
  if (mode === 'source') mockService<Services, 'emitter'>('emitter', { sendToSystem: emit, broadcastToPlugin: vi.fn() });
  const completions = () => emit.mock.calls.map(([, event]) => event).filter(event => event.eventType === 'cc.stream.completed');
  const finish = async (number: number) => {
    events.write({ type: 'command_lifecycle', state: 'started', command_uuid: `input-${number}` });
    events.write({ type: 'system', subtype: 'init', session_id: 'fixture-session', cwd: worktree ? '/fixture/native-worktree' : '/fixture' });
    if (mode === 'source') events.write({ type: 'user', isReplay: true, uuid: 'foreign-input', message: { content: 'foreign rewrite' } });
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
  if (mode === 'source') expect(opened.mock.calls[0]![2].model).toBe(stagedModel ? 'sonnet' : undefined);
  await finish(1);
  expect(store.getHandle(id)).toBe(store.getConversation(id)?.owner.handle);
  expect(native.close).not.toHaveBeenCalled();
  if (mode === 'source') {
    expect((await modelCommand({ command: 'cc-model', threadId: id, text: 'haiku' }, services, {} as never, '')).text).toContain('selection accepted');
    expect(native.setModel).toHaveBeenCalledWith('haiku');
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.modelOverride).toBe('haiku');
  }
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
  expect(store.getHandle(id)).toBe(store.getConversation(id)?.owner.handle);
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
  if (mode === 'source') {
    expect(messages.find(message => message.id === user1.id)?.text).toBe('input 1');
    expect(messages.find(message => message.id === user2.id)?.text).toBe('input 2');
    expect(messages.find(message => message.id === user1.id)?.context?.claudeNativeUserMessage).toEqual({ uuid: 'input-1', sessionId: 'fixture-session', text: 'input 1', origin: { kind: 'unclassified' } });
    expect(messages.find(message => message.id === user2.id)?.context?.claudeNativeUserMessage).toEqual({ uuid: 'input-2', sessionId: 'fixture-session', text: 'input 2', origin: { kind: 'unclassified' } });
  }
  expect(messages.filter(message => message.sender === 'assistant').map(message => message.text)).toEqual(['reply 1', ...(mode === 'source' ? ['Model selection accepted: haiku. The next turn will report the effective model.'] : []), 'reply 2', 'native autonomous work']);
  expect(await store.closeIdleConversation(id)).toBe(true);
  expect(store.getHandle(id)).toBeUndefined();
  expect(native.close).toHaveBeenCalledOnce();
});

it('preserves native assistant rows when one provider reply becomes several transcript rows', async () => {
  const { id } = repository.threadCommands.create({ topic: 'Native row identity', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { cwd: '/fixture' } } });
  const events = new PassThrough({ objectMode: true });
  const native = { events: events as AsyncIterable<StreamLine>, send: vi.fn(() => 'input-paired'),
    hasPendingBackgroundTasks: () => false, getPermissionMode: vi.fn(async () => 'acceptEdits'), close: vi.fn(async () => events.end()), kill: vi.fn(() => events.end()),
  } as unknown as QueryHandle;
  mockService<Services, 'cli'>('cli', { claudeCode: {
    openConversation: (key, launchKey, _options, consume) => store.openConversation(key, launchKey, async () => native, consume),
    getNativeTerminal: store.getNativeTerminal, getConversation: store.getConversation, getNativeLaunch: store.getNativeLaunch, isConversationBusy: store.isConversationBusy,
    getHandle: store.getHandle, isCurrentTurn: store.isCurrentTurn, clearHandle: store.clearHandle, storeHandle: store.storeHandle,
    sessionExists: vi.fn(async () => true),
  } as never });
  mockService<Services, 'chat'>('chat', { ...chatService, resolveReferences: vi.fn(async () => ({ textPrefix: '', imageBlocks: [] })) } as never);
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  const errors = vi.fn();
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errors });
  const emitted = vi.fn();
  mockService<Services, 'emitter'>('emitter', { sendToSystem: emitted, broadcastToPlugin: vi.fn() });
  const user = repository.chatCommands.addMessage({ threadId: id, sender: 'user', text: 'paired reply' });
  expect(await chat({ threadId: id, text: 'paired reply', messageId: user.id }, services, {} as never, '')).toMatchObject({ streaming: true });
  events.write({ type: 'command_lifecycle', state: 'started', command_uuid: 'input-paired' });
  events.write({ type: 'system', subtype: 'init', session_id: 'paired-session', cwd: '/fixture' });
  events.write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'First' } } });
  events.write({ type: 'assistant', uuid: 'native-summary', session_id: 'paired-session', message: { id: 'same-provider-id', content: [{ type: 'thinking', thinking: 'First summary.', signature: 'Eg0KC0IJbmFycmF0aW9u' }] } });
  events.write({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  events.write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Repeated text' } } });
  events.write({ type: 'assistant', uuid: 'native-row-a', session_id: 'paired-session', message: { id: 'same-provider-id', content: [{ type: 'text', text: 'Repeated text' }] } });
  // The second row deliberately has no text deltas; it must still be retained.
  events.write({ type: 'assistant', uuid: 'native-row-b', session_id: 'paired-session', message: { id: 'same-provider-id', content: [{ type: 'text', text: 'Repeated text' }] } });
  events.write({ type: 'result', subtype: 'success', session_id: 'paired-session', total_cost_usd: 0, result: 'Repeated text\nRepeated text' });
  await vi.waitFor(() => expect({ emitted: emitted.mock.calls, errors: errors.mock.calls }).toMatchObject({ emitted: expect.arrayContaining([[expect.anything(), expect.objectContaining({ eventType: 'cc.stream.completed' })]]) }));
  await vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
  const replies = repository.chatQueries.threadData(id)?.messages?.filter(message => message.sender === 'assistant') ?? [];
  expect(replies.map(message => message.text)).toEqual(['Repeated text\nRepeated text']);
  expect(replies[0]?.text).toBe('Repeated text\nRepeated text');
  expect(replies[0]?.blocks?.find(block => block.type === 'thinking')?.props).toMatchObject({ content: 'First summary.', state: 'done', nativeMessages: [
    { uuid: 'native-summary', sessionId: 'paired-session', apiMessageId: 'same-provider-id', text: 'First summary.', start: 0, end: 14, isSummary: true },
  ] });
  expect(replies[0]?.context).toMatchObject({ cliUuid: 'native-row-b', claudeNativeMessages: [
    { uuid: 'native-row-a', sessionId: 'paired-session', apiMessageId: 'same-provider-id', text: 'Repeated text', start: 0, end: 13 },
    { uuid: 'native-row-b', sessionId: 'paired-session', apiMessageId: 'same-provider-id', text: 'Repeated text', start: 14, end: 27 },
  ] });
});


it.each([['Plan','acceptEdits',undefined,'plan','acceptEdits'],['Edit','plan','acceptEdits','acceptEdits',undefined],[undefined,'plan','acceptEdits','plan','acceptEdits']] as const)('acknowledges print phase %s and preserves the original pre-Plan choice',async(phase,priorMode,priorPrePlan,target,expectedPrePlan)=>{
 const {id}=repository.threadCommands.create({topic:'Print phase transition',instructions:'',tags:[]})
 repository.threadCommands.update(id,{context:{claudeCode:{cwd:'/fixture',permissionMode:priorMode,prePlanMode:priorPrePlan}}})
 const events=new PassThrough({objectMode:true})
 const native={events:events as AsyncIterable<StreamLine>,send:vi.fn(()=>'phase-input'),hasPendingBackgroundTasks:()=>false,getPermissionMode:vi.fn(async()=>target),setPermissionMode:vi.fn(async mode=>mode),close:vi.fn(async()=>events.end()),kill:vi.fn(()=>events.end())} as unknown as QueryHandle
 const opened=vi.fn(async(key,launchKey,_options,consume)=>store.openConversation(key,launchKey,async()=>native,consume))
 mockService<Services,'cli'>('cli',{claudeCode:{openConversation:opened,getNativeTerminal:store.getNativeTerminal,getConversation:store.getConversation,getNativeLaunch:store.getNativeLaunch,isConversationBusy:store.isConversationBusy,closeIdleConversation:store.closeIdleConversation,getHandle:store.getHandle,isCurrentTurn:store.isCurrentTurn,clearHandle:store.clearHandle,storeHandle:store.storeHandle,sessionExists:vi.fn(async()=>true)} as never})
 mockService<Services,'chat'>('chat',{...chatService,resolveReferences:vi.fn(async()=>({textPrefix:'',imageBlocks:[]}))} as never)
 mockService<Services,'threads'>('threads',{updateChatState:vi.fn()})
 mockService<Services,'logger'>('logger',{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()})
 mockService<Services,'emitter'>('emitter',{sendToSystem:vi.fn(),broadcastToPlugin:vi.fn()})
 const user=repository.chatCommands.addMessage({threadId:id,sender:'user',text:'Phase review'})
 expect(await chat({threadId:id,text:'Phase review',messageId:user.id,phase},services,{} as never,'')).toMatchObject({streaming:true})
 expect(opened.mock.calls[0]![2].permissionMode).toBe('acceptEdits')
 if(target==='plan')expect(native.setPermissionMode).toHaveBeenCalledWith('plan')
 expect(repository.threadQueries.byId(id)?.context?.claudeCode).toMatchObject({permissionMode:target,prePlanMode:expectedPrePlan})
 expect(native.send).toHaveBeenCalledOnce()
})

it('retains explicit channel intent while a fork queues input and refuses live native changes',async()=>{
 const {id}=repository.threadCommands.create({topic:'Channel ownership',instructions:'',tags:[]})
 repository.threadCommands.update(id,{context:{claudeCode:{cwd:'/fixture',forkPending:true}}})
 const getNativeTerminal=vi.fn(()=>undefined as unknown)
 mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal} as never})
 mockService<Services,'logger'>('logger',{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()})
 const channels=['plugin:review@owned']
 expect(await chat({threadId:id,text:'Review',channels},services,{} as never,'')).toMatchObject({queued:true})
 channels.push('plugin:other@owned')
 expect(repository.threadQueries.byId(id)?.context?.claudeCode?.queuedMessage?.channels).toEqual(['plugin:review@owned'])
 getNativeTerminal.mockReturnValue({})
 expect(await chat({threadId:id,text:'Replace',channels:[]},services,{} as never,'')).toMatchObject({success:false,error:'Stop the native session before changing channel selection'})
 expect(repository.threadQueries.byId(id)?.context?.claudeCode?.queuedMessage?.text).toBe('Review')
 expect(await chat({threadId:id,text:'Invalid',channels:['--dangerously-load-development-channels']},services,{} as never,'')).toMatchObject({success:false})
})
