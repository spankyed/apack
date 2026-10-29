import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { parseMcpElicitationForm, validateMcpElicitationForm } from '#features/code/common/mcp-elicitation-form.ts';
import { action } from '../../../../src/content/actions/claude-code/answer-elicitation.ts';
import { getClaudeState } from '../../../../src/content/actions/claude-code/_helpers/thread-context.ts';
import { action as route } from '../../../../src/content/actions/claude-code/route-response.ts';

function fixture(mode: 'form' | 'url' = 'form') {
  const { id } = repository.threadCommands.create({ topic: 'Release review input', instructions: '', tags: [] });
  const form = parseMcpElicitationForm({ type: 'object', properties: { enabled: { type: 'boolean' }, count: { type: 'integer', minimum: 0 } }, required: ['enabled', 'count'] });
  const pending = { requestId: 'original-input', approvalMessageId: 'input-message', ownerPid: 123, mode, serverName: 'research', message: 'Review release input', ...(mode === 'form' ? { form } : {}) };
  repository.threadCommands.update(id, { context: { claudeCode: { pendingElicitation: pending, isRunning: false } } });
  const respondElicitation = vi.fn(), send = vi.fn(() => ({ messageId: 'correction-message' as const })), update = vi.fn();
  const handle = { pid: 123, respondElicitation }, owner = { handle, hasPendingElicitation: vi.fn(() => true) };
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: () => handle, getConversation: () => ({ owner }), parseMcpElicitationForm, validateMcpElicitationForm } as never });
  mockService<Services, 'chat'>('chat', { sendBlockMessage: send, updateMessageState: update });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  return { id, pending, owner, handle, respondElicitation, send, update, params: { threadId: id, messageId: pending.approvalMessageId, requestId: pending.requestId } };
}
it.each(['form', 'url'] as const)('routes and answers original %s choices independently of tool permissions', async mode => {
  for (const choice of ['accept', 'decline', 'cancel'] as const) {
    const f = fixture(mode), response = { buttonId: choice, ...(choice === 'accept' && mode === 'form' ? { content: { enabled: false, count: 0 } } : {}) };
    expect(await route({ ...f.params, response }, services)).toMatchObject({ success: true, elicitation: true, requestId: f.pending.requestId, messageId: f.pending.approvalMessageId });
    await expect(action({ ...f.params, response }, services)).resolves.toEqual({ success: true });
    expect(f.respondElicitation).toHaveBeenCalledExactlyOnceWith(f.pending.requestId, { action: choice, ...(response.content ? { content: response.content } : {}) });
    const state = repository.threadQueries.byId(f.id)?.context?.claudeCode;
    expect(state).toMatchObject({ isRunning: true, chatState: 'working' });
    expect(state).not.toHaveProperty('pendingElicitation');
  }
});
it('retains the original request for correction and refuses responses from its retired input message', async () => {
  const f = fixture();
  await expect(action({ ...f.params, response: { buttonId: 'accept', content: { enabled: false, count: '0' } } }, services)).resolves.toMatchObject({ success: false, reason: 'invalid form content' });
  expect(f.respondElicitation).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ blocks: [expect.objectContaining({ type: 'mcp-elicitation', props: expect.objectContaining({ initialValues: { enabled: false, count: '0' } }) })] }));
  expect(repository.threadQueries.byId(f.id)?.context?.claudeCode?.pendingElicitation).toMatchObject({ requestId: f.pending.requestId, approvalMessageId: 'correction-message' });
  await expect(action({ ...f.params, response: { buttonId: 'cancel' } }, services)).resolves.toMatchObject({ success: false, reason: 'elicitation is no longer pending' });
  await action({ ...f.params, messageId: 'correction-message', response: { buttonId: 'accept', content: { enabled: false, count: 0 } } }, services);
  expect(f.respondElicitation).toHaveBeenCalledExactlyOnceWith(f.pending.requestId, { action: 'accept', content: { enabled: false, count: 0 } });
});
it.each(['withdrawn', 'replaced', 'write-failed'] as const)('retires an expired %s input without altering independent tool approval or sending a new prompt', async failure => {
  const f = fixture('url');
  repository.threadCommands.update(f.id, { context: { claudeCode: { pendingElicitation: f.pending, pendingControlRequest: { requestId: 'separate-tool', approvalMessageId: 'tool-message', toolName: 'Read' } } } });
  if (failure === 'withdrawn') f.owner.hasPendingElicitation.mockReturnValue(false);
  if (failure === 'replaced') f.handle.pid = 456;
  if (failure === 'write-failed') f.respondElicitation.mockImplementationOnce(() => { throw Error('closed') });
  await expect(action({ ...f.params, response: { buttonId: 'accept' } }, services)).resolves.toMatchObject({ success: false, reason: 'MCP input request expired' });
  const state = getClaudeState(services, f.id);
  expect(state?.pendingElicitation).toBeUndefined(); expect(state?.pendingControlRequest?.requestId).toBe('separate-tool');
  expect(f.update).toHaveBeenCalledExactlyOnceWith('input-message', expect.objectContaining({ blockResponse: { cancelled: true } }));
  if (failure !== 'write-failed') expect(f.respondElicitation).not.toHaveBeenCalled();
});
