import { describe, expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';
import { repository } from '#generated/repository.ts';

async function fixture(kind: 'question' | 'approval' = 'question') {
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  const owner = repository.threadCommands.create({ topic: 'Question owner', instructions: '' });
  const foreign = repository.threadCommands.create({ topic: 'Other thread', instructions: '' });
  const message = repository.chatCommands.addMessage({ threadId: owner.id, text: 'Fixture', sender: 'assistant',
    autoHide: true, blocks: kind === 'approval' ? [{ type: 'approval', props: { requireReason: false, autoAcceptOption: false } }] : [{ type: 'question', props: { questions: [{ question: 'Which fixture?', options: [{ id: 'Alpha', label: 'Alpha' }] }] } }] });
  return { app, owner, foreign, message };
}

describe('interactive question delivery ownership', () => {
  it('does not mutate another thread question when the sender supplies its message id', async () => {
    const { app, foreign, message } = await fixture();
    const before = repository.chatQueries.messageById(message.id);
    await app.send('threads', { type: 'INTERACTIVE_MSG_RESPONSE', threadId: foreign.id, messageId: message.id, response: 'Beta' });
    await app.settle();
    expect(repository.chatQueries.messageById(message.id)).toEqual(before);
    expect(app.emitted('threads').filter(event => event.type === 'UPDATE_MESSAGE_STATE' && event.messageId === message.id)).toHaveLength(0);
  });

  it.each([{ cancelled: true }, 'Alpha'])('preserves a retired question when a delayed answer arrives (%j)', async response => {
    const { app, owner, message } = await fixture();
    repository.chatCommands.updateMessageBlockResponse({ messageId: message.id, response });
    const before = repository.chatQueries.messageById(message.id);
    await app.send('threads', { type: 'INTERACTIVE_MSG_RESPONSE', threadId: owner.id, messageId: message.id, response: 'Alpha' });
    await app.settle();
    expect(repository.chatQueries.messageById(message.id)).toEqual(before);
    expect(app.emitted('threads').filter(event => event.type === 'UPDATE_MESSAGE_STATE' && event.messageId === message.id)).toHaveLength(0);
  });

  it('accepts the first response from the owning thread', async () => {
    const { app, owner, message } = await fixture();
    await app.send('threads', { type: 'INTERACTIVE_MSG_RESPONSE', threadId: owner.id, messageId: message.id, response: 'Alpha' });
    await app.settle();
    expect(repository.chatQueries.messageById(message.id)?.blockResponse).toBe('Alpha');
    expect(app.emitted('threads').filter(event => event.type === 'UPDATE_MESSAGE_STATE' && event.messageId === message.id)).toHaveLength(1);
  });
});


describe('one-shot approval response ownership', () => {
  it.each([{ cancelled: true }, { approved: true }, { approved: false }])('preserves a retired approval when a delayed approval arrives (%j)', async response => {
    const { app, owner, message } = await fixture('approval');
    repository.chatCommands.updateMessageBlockResponse({ messageId: message.id, response });
    const before = repository.chatQueries.messageById(message.id);
    await app.send('threads', { type: 'INTERACTIVE_MSG_RESPONSE', threadId: owner.id, messageId: message.id, response: { approved: true } });
    await app.settle();
    expect(repository.chatQueries.messageById(message.id)).toEqual(before);
    expect(app.emitted('threads').filter(event => event.type === 'UPDATE_MESSAGE_STATE' && event.messageId === message.id)).toHaveLength(0);
  });
  it('accepts the first approval from its owning thread', async () => {
    const { app, owner, message } = await fixture('approval');
    await app.send('threads', { type: 'INTERACTIVE_MSG_RESPONSE', threadId: owner.id, messageId: message.id, response: { approved: true } });
    await app.settle();
    expect(repository.chatQueries.messageById(message.id)?.blockResponse).toEqual({ approved: true });
    expect(app.emitted('threads').filter(event => event.type === 'UPDATE_MESSAGE_STATE' && event.messageId === message.id)).toHaveLength(1);
  });
});
