import { importFlows, startApp } from '@apackdev/testing/harness';
import { repository } from '#generated/repository.ts';
import claudeFlow from '../../src/content/flows/claude-code-flow.ts';

it('routes MCP replies through the actual interaction listener and keeps ordinary messages on the chat listener', async () => {
  const labels = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if ('type' in value && value.type === 'action' && 'action' in value && typeof value.action === 'string') labels.add(value.action);
    for (const child of Object.values(value)) visit(child);
  }
  visit(claudeFlow);
  for (const label of labels) repository.actionCommands.create({ label, actionFn: label === 'CC: Route Response' ? "return { success: true, elicitation: true, ...params, requestId: 'native-input' }" : 'return params' });
  importFlows({ 'Claude Code': { root: true, tracks: claudeFlow['Claude Code'] } });
  const app = await startApp({ systems: ['brain'] });
  const payload = { threadId: 'Thread-fixture', messageId: 'Message-input', response: { buttonId: 'accept', content: { enabled: false, count: 0 } } };
  const reply = await app.runFlow('Claude Code', { event: 'interactive.message.response', data: payload });
  expect(reply.steps.find(step => step.label === 'answer-elicitation')?.input.params).toEqual({ ...payload, requestId: 'native-input' });
  expect(reply.steps.some(step => step.label === 'claude-code')).toBe(false);
  const message = await app.runFlow('Claude Code', { event: 'user.message', data: { mode: 'Claude Code', text: 'Continue reviewing.' } });
  expect(message.steps.some(step => step.label === 'claude-code')).toBe(true);
  expect(message.steps.some(step => step.label === 'answer-elicitation')).toBe(false);
});
