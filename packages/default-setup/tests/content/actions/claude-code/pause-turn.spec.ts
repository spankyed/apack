import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/pause-turn.ts';

function setup(kind: 'native' | 'print' | 'idle', pending = false, busy = kind === 'native') {
  const { id } = repository.threadCommands.create({ topic: 'Pause ownership', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { isRunning: kind === 'print',
    ...(pending ? { pendingControlRequest: { requestId: 'permission', toolName: 'Write', approvalMessageId: 'approval' } } : {}),
  } } });
  const events: unknown[][] = [], requests: Record<string, unknown>[] = [];
  const control = { turn: { id: 'original-turn', cancelled: false } as { id: string; cancelled: boolean } | null, replace: false, refuse: false, nativeForm: false, nativeUrl: false };
  const native = { state: { sessionId: 'original-session', get mcpUrl() { return control.nativeUrl ? { id: 'url', revision: 'url-revision', sessionId: 'original-session' } : undefined }, get mcpForm() { return control.nativeForm ? { id: 'form', revision: 'original-revision', sessionId: 'original-session' } : undefined } }, kill: () => { events.push(['native.kill']); }, cancelMcpInput: async (form: unknown) => { events.push(['native.cancelMcpInput', form]); }, uiTransport: { request: async (request: Record<string, unknown>) => {
    requests.push(request);
    if (request.subtype === 'apack_turn_state') return { turn: control.turn };
    if (control.refuse) throw new Error('Native turn changed or ended');
    return { cancelled: true };
  } } };
  const print = { kill: () => { events.push(['print.kill']); } };
  let nativeReads = 0;
  mockService<Services, 'cli'>('cli', { claudeCode: {
    getNativeTerminal: () => kind === 'native' && !(control.replace && nativeReads++ > 0) ? native : undefined,
    getHandle: () => kind === 'print' ? print : undefined,
    isConversationBusy: () => busy,
    clearHandle: (threadId: string) => { events.push(['clearHandle', threadId]); },
  } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState: (messageId: any, value: any) => { events.push(['message', messageId, value]); } });
  mockService<Services, 'threads'>('threads', { updateChatState: (threadId: any, value: any) => { events.push(['state', threadId, value]); } });
  mockService<Services, 'logger'>('logger', { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
  return { id, events, requests, control };
}
it.each(['native', 'print'] as const)('stops the owning %s process for pending-dialog cancellation', async kind => {
  const f = setup(kind, true);
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true });
  expect(f.events.filter(row => row[0] === kind + '.kill')).toHaveLength(1);
  expect(f.events).toContainEqual(['clearHandle', f.id]);
  expect(repository.threadQueries.byId(f.id)?.context?.claudeCode).toMatchObject({ isRunning: false, pendingControlRequest: undefined });
  expect(f.events).toContainEqual(['message', 'approval', expect.objectContaining({ blockResponse: { cancelled: true } })]);
  expect(f.requests).toEqual([]);
});
it('leaves an idle thread alone', async () => {
  const f = setup('idle');
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true, noop: true });
  expect(f.events).toEqual([]);
});
it('interrupts the original native turn without killing its owner even before the next busy poll', async () => {
  const f = setup('native', false, false);
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true, interrupted: true });
  expect(f.requests).toEqual([{ subtype: 'apack_turn_state', session_id: 'original-session' }, { subtype: 'apack_abort_turn', session_id: 'original-session', turn_id: 'original-turn' }]);
  expect(f.events).toEqual([]);
});
it.each([null, { id: 'ending-turn', cancelled: true }])('does not stop the native owner without an active cancellable turn', async turn => {
  const f = setup('native'); f.control.turn = turn;
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true, noop: true });
  expect(f.requests).toHaveLength(1); expect(f.events).toEqual([]);
});
it('refuses a replaced owner before issuing cancellation', async () => {
  const f = setup('native'); f.control.replace = true;
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: false, reason: 'native owner changed' });
  expect(f.requests).toHaveLength(1); expect(f.events).toEqual([]);
});
it('preserves the owner when native turn identity changes during cancellation', async () => {
  const f = setup('native'); f.control.refuse = true;
  await expect(action({ threadId: f.id }, services)).rejects.toThrow('Native turn changed or ended');
  expect(f.events).toEqual([]);
});

it.each([false, true])('interrupts pending MCP input before stop and preserves a replacement owner: replace=%s', async replace => {
  const f = setup('print');
  repository.threadCommands.update(f.id, { context: { claudeCode: { isRunning: false, pendingElicitation: { requestId: 'input', approvalMessageId: 'input-message', ownerPid: 123, serverName: 'research', mode: 'url', message: 'Review' } } } });
  const events: string[] = [], handle = { interrupt: async () => { events.push('interrupt'); current = replace ? replacement : handle; }, kill: () => { events.push('kill'); } }, replacement = { kill: () => { events.push('replacement.kill'); } };
  let current: typeof handle | typeof replacement = handle;
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => undefined, getHandle: () => current, isConversationBusy: () => true, clearHandle: () => events.push('clear') } as never });
  const result = await action({ threadId: f.id }, services);
  expect(result).toEqual(replace ? { success: false, reason: 'MCP input owner changed' } : { success: true });
  expect(events).toEqual(replace ? ['interrupt'] : ['interrupt', 'kill', 'clear']);
});

it('uses the current native MCP form owner when a prior permission projection has not retired yet', async () => {
  const f = setup('native', true); f.control.nativeForm = true;
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true, interrupted: true });
  expect(f.requests.map(request => request.subtype)).toEqual(['apack_turn_state', 'apack_abort_turn']);
  expect(f.events).toEqual([['native.cancelMcpInput', { id: 'form', revision: 'original-revision', sessionId: 'original-session' }]]);
});

it('retires an independent native URL waiting dialog after its tool turn has already ended', async () => {
  const f = setup('native', true); f.control.nativeUrl = true; f.control.turn = null;
  await expect(action({ threadId: f.id }, services)).resolves.toEqual({ success: true, interrupted: true });
  expect(f.events).toEqual([['native.cancelMcpInput', { id: 'url', revision: 'url-revision', sessionId: 'original-session' }]]);
  expect(f.requests).toEqual([{ subtype: 'apack_turn_state', session_id: 'original-session' }]);
});
