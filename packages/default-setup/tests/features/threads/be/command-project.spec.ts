import { expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';
import { repository } from '#generated/repository.ts';

it('persists a new Claude command thread project before another window opens it', async () => {
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  await app.send('threads', { type: 'USER_COMMAND', command: 'cc-model', text: '', mode: 'Claude Code', phase: 'Plan', cwdOverride: '/selected-project' });
  await app.settle();
  const thread = repository.threadQueries.all().find(row => row.topic === '/cc-model');
  expect(thread?.context?.claudeCode).toEqual({ cwd: '/selected-project' });
  expect(repository.chatQueries.threadData(thread!.id)?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ isCommand: true })]));
  await app.send('threads', { type: 'OPEN_THREAD_CHAT', threadId: thread!.id }, { sender: 'default-setup/threads', client: 'other-window' });
  const loaded = await app.nextEmit('threads', 'LOAD_CHAT_THREAD');
  expect(loaded).toMatchObject({ data: { context: { claudeCode: { cwd: '/selected-project' } } } });
});

it('does not overwrite an existing native session directory with a command draft override', async () => {
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  const thread = repository.threadCommands.create({ topic: 'Existing native session', instructions: '' });
  repository.threadCommands.update(thread.id, { context: { claudeCode: { cwd: '/original', sessionId: 'original-session' } } });
  await app.send('threads', { type: 'USER_COMMAND', command: 'cc-model', text: '', mode: 'Claude Code', phase: 'Plan', threadId: thread.id, cwdOverride: '/other-project' });
  await app.settle();
  expect(repository.threadQueries.byId(thread.id)?.context?.claudeCode).toEqual({ cwd: '/original', sessionId: 'original-session' });
});
