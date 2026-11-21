// What the commit machine holds while a commit, an amend, a tag or a reset is asked for, and what each answer
// leaves: one commit at a time, a stopped push said as stopped, and the trailers the message ends with followed as it
// is written and taken out of it when asked.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState, commitUnderWay } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);
const sent = (type: string) => asksOf(type).map(ask => ask.event);

it('says a push that was stopped was stopped, and a push run again starts over', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.STOP_PUSH' });
  expect(latestAsk('commit.PUBLISH_BRANCH').stopped, 'which ends git on the backend').toBe(true);
  expect(actor.getSnapshot().context.making.push).toBe(false);
  expect(actor.getSnapshot().context.pushStopped).toBe(true);

  actor.send({ type: 'commit.PUSH_BRANCH' });
  expect(actor.getSnapshot().context.pushStopped).toBe(false);
  await latestAsk('commit.PUBLISH_BRANCH').answer({ branchName: 'main' });
  expect(actor.getSnapshot().context.making.push).toBe(false);
  expect(actor.getSnapshot().context.pushStopped).toBe(false);
});

it('asks for one commit at a time, and for another once the first is answered', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix it' });

  actor.send({ type: 'commit.COMMIT' });
  actor.send({ type: 'commit.COMMIT' });
  actor.send({ type: 'commit.AMEND', message: 'Fix it' });
  expect(sent('commit.COMMIT'), 'the second click, and an amend, wait for the first').toHaveLength(1);
  expect(sent('commit.AMEND')).toHaveLength(0);

  await latestAsk('commit.COMMIT').refuse('The hook refused it', { kind: 'git' });
  expect(commitUnderWay(actor.getSnapshot().context.making)).toBe(false);

  actor.send({ type: 'commit.COMMIT' });
  expect(sent('commit.COMMIT')).toHaveLength(2);
  await latestAsk('commit.COMMIT').answer({ message: 'Fix it' });
  expect(commitUnderWay(actor.getSnapshot().context.making)).toBe(false);
  expect(actor.getSnapshot().context.commitMessage).toBe('');
});

it('holds an amend as a commit until it is answered, by its amend or by the question it needs', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.AMEND' });
  expect(actor.getSnapshot().context.making.amend).toBe(true);
  await latestAsk('commit.AMEND').refuse('The last commit is already pushed.', { kind: 'published' });
  expect(commitUnderWay(actor.getSnapshot().context.making), 'the user is asked').toBe(false);
  expect(actor.getSnapshot().context.rewriteConfirmation?.message).toBe('The last commit is already pushed.');

  actor.send({ type: 'commit.CONFIRM_REWRITE' });
  expect(sent('commit.AMEND').at(-1)).toMatchObject({ evenIfPublished: true });
  expect(actor.getSnapshot().context.making.amend).toBe(true);
  await latestAsk('commit.AMEND').answer({});
  expect(commitUnderWay(actor.getSnapshot().context.making)).toBe(false);
});

it('asks for a commit of the message as written, its trailers included, which the system leaves out as the settings say', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing\n\nCo-Authored-By: Someone <someone@example.com>\n' });

  actor.send({ type: 'commit.COMMIT' });

  expect(sent('commit.COMMIT').map(event => event.message)).toEqual(['feat: a thing\n\nCo-Authored-By: Someone <someone@example.com>']);
});

it("asks for a message's trailers once its last paragraph changes, and never for a message of one paragraph", async () => {
  const actor = createActor(commitState).start();
  const asked = () => sent('commit.READ_TRAILERS').map(event => event.message);

  for (const message of ['f', 'fe', 'feat', 'feat\n', 'feat\n\n']) actor.send({ type: 'commit.UPDATE_MESSAGE', message });
  expect(asked(), 'a subject has no trailers').toEqual([]);

  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing\n\nCo-authored-by: A' });
  expect(asked(), 'typing in the subject asks nothing again').toEqual(['feat\n\nCo-authored-by: A']);

  await latestAsk('commit.READ_TRAILERS').answer({ message: 'feat\n\nCo-authored-by: A', trailers: [{ key: 'Co-authored-by', value: 'A' }] });
  expect(actor.getSnapshot().context.trailers).toEqual([{ key: 'Co-authored-by', value: 'A' }]);

  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing' });
  expect(actor.getSnapshot().context.trailers, 'one paragraph left has none').toEqual([]);
});

it('takes trailers read of a paragraph the message no longer ends with for none', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: AB' });

  await asksOf('commit.READ_TRAILERS')[0]!.answer({ message: 'feat\n\nCo-authored-by: A', trailers: [{ key: 'Co-authored-by', value: 'A' }] });

  expect(actor.getSnapshot().context.trailers).toEqual([]);
});

it('takes a trailer out of the message as it still is, and asks again what it ends with', async () => {
  const actor = createActor(commitState).start();
  const message = 'feat\n\nCo-authored-by: A\nSigned-off-by: B';
  actor.send({ type: 'commit.UPDATE_MESSAGE', message });

  actor.send({ type: 'commit.REMOVE_TRAILER', trailer: { key: 'Co-authored-by', value: 'A' } });
  expect(sent('commit.REMOVE_TRAILER')).toEqual([{ type: 'commit.REMOVE_TRAILER', message, trailer: { key: 'Co-authored-by', value: 'A' } }]);

  await latestAsk('commit.REMOVE_TRAILER').answer({ message, without: 'feat\n\nSigned-off-by: B' });
  expect(actor.getSnapshot().context.commitMessage).toBe('feat\n\nSigned-off-by: B');
  expect(sent('commit.READ_TRAILERS').map(event => event.message).at(-1)).toBe('feat\n\nSigned-off-by: B');
});

it('leaves a message changed since a trailer was asked to be taken out of it as it was changed', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  actor.send({ type: 'commit.REMOVE_TRAILER', trailer: { key: 'Co-authored-by', value: 'A' } });
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: more\n\nCo-authored-by: A' });

  await latestAsk('commit.REMOVE_TRAILER').answer({ message: 'feat\n\nCo-authored-by: A', without: 'feat' });

  expect(actor.getSnapshot().context.commitMessage).toBe('feat: more\n\nCo-authored-by: A');
});

it('holds a tag pushed or deleted busy until its own answer, and keeps the tag last pushed', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_TAG', name: 'v1' });
  expect(actor.getSnapshot().context.tagBusy).toEqual({ name: 'v1', action: 'push' });

  await latestAsk('commit.PUSH_TAG').answer({ name: 'v1' });
  expect(actor.getSnapshot().context).toMatchObject({ tagBusy: null, tagPushed: { name: 'v1' } });

  actor.send({ type: 'commit.DELETE_TAG', name: 'v1' });
  await latestAsk('commit.DELETE_TAG').refuse('no such tag', { kind: 'git' });
  expect(actor.getSnapshot().context.tagBusy, 'refused: no longer busy').toBeNull();
});

it('holds a reset busy until it is answered', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.RESET_TO_COMMIT', hash: 'abc1234' });
  expect(actor.getSnapshot().context.resettingTo).toBe('abc1234');

  await latestAsk('commit.RESET_TO_COMMIT').answer({ hash: 'abc1234' });
  expect(actor.getSnapshot().context.resettingTo).toBeNull();
});
