import { describe, expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';
import { repository } from '#generated/repository.ts';

async function fixture() {
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  const owner = repository.threadCommands.create({ topic: 'Question owner', instructions: '' });
  const foreign = repository.threadCommands.create({ topic: 'Other thread', instructions: '' });
  const message = repository.chatCommands.addMessage({ threadId: owner.id, text: 'Fixture', sender: 'assistant',
    autoHide: true, blocks: [{ type: 'question', props: { questions: [{ question: 'Which fixture?', options: [{ id: 'Alpha', label: 'Alpha' }] }] } }] });
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
