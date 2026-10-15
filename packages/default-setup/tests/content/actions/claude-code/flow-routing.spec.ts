import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockService, startApp, type TestApp } from '@apackdev/testing/harness';
import type { Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { actionLabel, writeDefaultFlows } from '../../../_support/flows.ts';

let app: TestApp;
const kill = vi.fn(), respond = vi.fn();
beforeEach(async () => {
  writeDefaultFlows();
  mockService<Services, 'cli'>('cli', { claudeCode: { getHandle: vi.fn(() => ({ kill, respond })), clearHandle: vi.fn() } as never });
  mockService<Services, 'chat'>('chat', { updateMessageState: vi.fn(), sendBlockMessage: vi.fn(), createThreadAndNotify: vi.fn() });
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() });
  app = await startApp({ systems: ['brain'] });
  await app.runFlow('Claude Code');
});
function thread(toolName = 'ExitPlanMode') {
  const { id } = repository.threadCommands.create({ topic: 'Plan response', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { isRunning: true,
    pendingControlRequest: { requestId: 'current-plan', toolName, approvalMessageId: 'approval-fixture' },
  } } });
  return id;
}

describe('compiled Claude response routing', () => {
  it('forwards the current native request identity to clear-context approval', async () => {
    const id = thread();
    const run = await app.runFlow('Claude Code', { event: 'interactive.message.response',
      data: { threadId: id, messageId: 'approval-fixture', response: { approved: true, clearContext: true } } });
    expect(run.steps.map(actionLabel).filter(Boolean)).toEqual(['CC: Route Response', 'CC: Approve Plan Clear Context']);
    const approval = run.steps.find(step => actionLabel(step) === 'CC: Approve Plan Clear Context');
    expect(approval?.params).toMatchObject({ threadId: id, requestId: 'current-plan' });
    // No plan draft exists: the real compiled action must preserve the process, not create an empty replacement.
    expect(kill).not.toHaveBeenCalled();
    expect(repository.threadQueries.byId(id)?.context?.claudeCode?.pendingControlRequest).toBeDefined();
  });
  it('does not route a response from a superseded approval block', async () => {
    const id = thread();
    const run = await app.runFlow('Claude Code', { event: 'interactive.message.response',
      data: { threadId: id, messageId: 'obsolete-approval', response: { approved: true, clearContext: true } } });
    expect(run.steps.map(actionLabel).filter(Boolean)).toEqual(['CC: Route Response']);
    expect(kill).not.toHaveBeenCalled();
  });
  it('still routes a current ordinary tool approval to its native responder', async () => {
    const id = thread('Bash');
    const run = await app.runFlow('Claude Code', { event: 'interactive.message.response',
      data: { threadId: id, messageId: 'approval-fixture', response: { approved: true } } });
    expect(run.steps.map(actionLabel).filter(Boolean)).toEqual(['CC: Route Response', 'CC: Approve Tool']);
    expect(respond).toHaveBeenCalledWith('current-plan', { behavior: 'allow', updatedInput: {} });
    expect(kill).not.toHaveBeenCalled();
  });

});
