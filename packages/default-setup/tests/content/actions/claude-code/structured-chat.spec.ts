import { PassThrough } from 'node:stream';
import { mockService, startApp } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { chatService } from '#features/threads/be/services/chat.ts';
import * as store from '#features/code/be/services/claude-code/handle-store.ts';
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts';
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts';
import { action as chat } from '../../../../src/content/actions/claude-code/chat.ts';
import { action as selectDirectory } from '../../../../src/content/actions/claude-code/handle-directory-select.ts';
import { getClaudeState } from '../../../../src/content/actions/claude-code/_helpers/thread-context.ts';
import { replayQueuedMessage } from '../../../../src/content/actions/claude-code/_helpers/stream-consumer.ts';
import { actionLabel, writeDefaultFlows } from '../../../_support/flows.ts';

vi.mock('../../../../src/content/actions/claude-code/_helpers/context-usage.ts', () => ({
  refreshThreadContextUsage: vi.fn(async () => {}),
}));
afterEach(() => store.killAllHandles());

const schema = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'] };
const changed = { ...schema, required: [] };

function setup(context: Record<string, unknown> = { cwd: '/fixture' }, compiled = false) {
  const { id } = repository.threadCommands.create({ topic: 'Structured Chat', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: context } });
  const writers: { events: PassThrough; handle: QueryHandle; input: string }[] = [];
  let sequence = 0;
  const opened = vi.fn(async (key, launchKey, _options, consume) => {
    const events = new PassThrough({ objectMode: true });
    const writer = { events, handle: undefined as unknown as QueryHandle, input: '' };
    writer.handle = {
      events: events as AsyncIterable<StreamLine>,
      send: vi.fn(() => writer.input = 'schema-input-' + ++sequence),
      hasPendingBackgroundTasks: () => false,
      close: vi.fn(async () => { events.end(); }),
      kill: vi.fn(() => events.end()),
      getPermissionMode: vi.fn(async () => 'acceptEdits'),
      setPermissionMode: vi.fn(async mode => mode),
    } as unknown as QueryHandle;
    writers.push(writer);
    return store.openConversation(key, launchKey, async () => writer.handle, consume);
  });
  mockService<Services, 'cli'>('cli', {
    git: { checkpoint: vi.fn(async () => undefined) } as never,
    claudeCode: {
      profile: () => ({}), openConversation: opened, getConversation: store.getConversation,
      getNativeTerminal: store.getNativeTerminal, getNativeLaunch: store.getNativeLaunch,
      isConversationBusy: store.isConversationBusy, closeIdleConversation: store.closeIdleConversation,
      getHandle: store.getHandle, isCurrentTurn: store.isCurrentTurn, clearHandle: store.clearHandle,
      storeHandle: store.storeHandle, sessionExists: vi.fn(async () => true),
    } as never,
  });
  mockService<Services, 'chat'>('chat', {
    ...chatService, resolveReferences: vi.fn(async () => ({ textPrefix: '', imageBlocks: [] })),
  } as never);
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const execute = vi.fn(async (_label: string, _params: Record<string, unknown>) => ({}));
  if (!compiled) {
    mockService<Services, 'emitter'>('emitter', { tell: vi.fn(), broadcast: vi.fn() });
    mockService<Services, 'action'>('action', { executeIfFound: execute });
  }

  const invoke = (jsonSchema?: unknown) => chat({ threadId: id, text: 'Review the fixture', jsonSchema }, services);
  const result = (subtype: 'success' | 'error_max_structured_output_retries' = 'success') => {
    const writer = writers.at(-1)!;
    writer.events.write({ type: 'command_lifecycle', state: 'started', command_uuid: writer.input });
    writer.events.write({ type: 'system', subtype: 'init', session_id: 'fixture-session', cwd: '/fixture' });
    writer.events.write({ type: 'result', subtype, session_id: 'fixture-session',
      user_message_uuid: writer.input, ...(subtype === 'success'
        ? { result: '{"answer":42}', structured_output: { answer: 42 } }
        : { is_error: true, errors: ['Schema validation exhausted the retry limit'] }) });
  };
  const idle = () => vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
  return { id, opened, writers, invoke, result, idle, execute };
}

it('reuses an identical schema and restarts the saved session when it changes or is omitted', async () => {
  const fixture = setup();
  for (const requested of [schema, structuredClone(schema), changed, undefined]) {
    expect(await fixture.invoke(requested)).toMatchObject({ streaming: true });
    fixture.result();
    await fixture.idle();
  }
  expect(fixture.opened.mock.calls.map(([, , options]) => options.jsonSchema)).toEqual([schema, changed, undefined]);
  expect(fixture.opened.mock.calls.slice(1).map(([, , options]) => options.resume)).toEqual(['fixture-session', 'fixture-session']);
  expect(fixture.writers[0].handle.close).toHaveBeenCalledOnce();
  expect(fixture.writers[1].handle.close).toHaveBeenCalledOnce();
});

it('snapshots a queued schema and forwards it when replayed', async () => {
  const fixture = setup({ cwd: '/fixture', forkPending: true });
  const requested = structuredClone(schema);
  expect(await fixture.invoke(requested)).toMatchObject({ queued: true });
  requested.required.push('mutated');
  const queued = getClaudeState(services, fixture.id)?.queuedMessage;
  expect(queued?.jsonSchema).toEqual(schema);
  await replayQueuedMessage(services, fixture.id, queued!, services.logger);
  expect(fixture.execute).toHaveBeenCalledWith('Claude Code Chat', expect.objectContaining({ jsonSchema: schema }));
  expect(fixture.opened).not.toHaveBeenCalled();
});

it('forwards the exact schema when resuming after directory selection', async () => {
  const fixture = setup({});
  mockService<Services, 'settings'>('settings', {
    get: vi.fn(({ kind }) => kind === 'app' ? { projects: [] } : {}), update: vi.fn(),
  } as never);
  expect(await fixture.invoke(schema)).toMatchObject({ awaitingDirectory: true });
  const pending = getClaudeState(services, fixture.id)?.pendingDirectorySelect;
  expect(pending?.jsonSchema).toEqual(schema);
  await selectDirectory({ threadId: fixture.id, response: { path: '/fixture' }, pendingDirectorySelect: pending }, services);
  expect(fixture.execute).toHaveBeenCalledWith('Claude Code Chat', expect.objectContaining({ jsonSchema: schema }));
});

it('rejects cyclic schema input before queueing or starting a process', async () => {
  const fixture = setup({ cwd: '/fixture', forkPending: true });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(await fixture.invoke(cyclic)).toEqual({ success: false, error: 'jsonSchema must be JSON serializable' });
  expect(getClaudeState(services, fixture.id)?.queuedMessage).toBeUndefined();
  expect(fixture.opened).not.toHaveBeenCalled();
});

it('drains a changed schema through the Chat action after the original turn retires', async () => {
  const fixture = setup();
  fixture.execute.mockImplementation((_label, params) => chat(params, services));
  expect(await fixture.invoke(schema)).toMatchObject({ streaming: true });
  expect(await fixture.invoke(changed)).toMatchObject({ queued: true });
  fixture.result();
  await vi.waitFor(() => expect(fixture.opened).toHaveBeenCalledTimes(2));
  expect(fixture.opened.mock.calls[1][2]).toMatchObject({ jsonSchema: changed, resume: 'fixture-session' });
  fixture.result();
  await fixture.idle();
});

it('keeps the native session after schema retry exhaustion', async () => {
  const fixture = setup();
  expect(await fixture.invoke(schema)).toMatchObject({ streaming: true });
  fixture.result('error_max_structured_output_retries');
  await fixture.idle();
  expect(getClaudeState(services, fixture.id)).toMatchObject({
    sessionId: 'fixture-session', sessionError: 'Schema validation exhausted the retry limit',
  });
  expect(await fixture.invoke()).toMatchObject({ streaming: true });
  expect(fixture.opened.mock.calls[1][2]).toMatchObject({ resume: 'fixture-session' });
  expect(getClaudeState(services, fixture.id)?.sessionError).toBeUndefined();
  fixture.result();
  await fixture.idle();
});

it('drains a changed schema through the compiled flow and pack-bound action service', async () => {
  writeDefaultFlows();
  const fixture = setup({ cwd: '/fixture' }, true);
  const app = await startApp({ systems: ['brain'] });
  await app.runFlow('Claude Code');
  for (const jsonSchema of [schema, changed]) {
    const run = await app.runFlow('Claude Code', {
      event: 'user.message',
      data: { threadId: fixture.id, text: 'Review the fixture', mode: 'Claude Code', jsonSchema },
    });
    expect(run.steps.map(actionLabel)).toContain('Claude Code Chat');
  }
  expect(fixture.opened).toHaveBeenCalledOnce();
  expect(fixture.opened.mock.calls[0][2].jsonSchema).toEqual(schema);
  expect(getClaudeState(services, fixture.id)?.queuedMessage?.jsonSchema).toEqual(changed);
  fixture.result();
  await vi.waitFor(() => expect(fixture.opened).toHaveBeenCalledTimes(2));
  expect(fixture.opened.mock.calls[1][2]).toMatchObject({ jsonSchema: changed, resume: 'fixture-session' });
  fixture.result();
  await fixture.idle();
  expect(fixture.writers[0].handle.close).toHaveBeenCalledOnce();
});
