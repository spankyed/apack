// What the commit machine holds while a commit, an amend, a tag or a reset is asked for, and what each answer
// leaves: one commit at a time, a stopped push said as stopped, and the trailers the message ends with followed as it
// is written and taken out of it when asked.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { askAnswered, askFailed } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => sendToSystem.mockReset());
const sent = (type: string) => sendToSystem.mock.calls.filter(([, event]) => event.type === type);

it('says a push that was stopped was stopped, and a push run again starts over', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send(askAnswered(sentCall(sendToSystem, 'commit.PUBLISH_BRANCH'), 'commit.PUBLISH_BRANCH', { branchName: 'main', stopped: true }));
  expect(actor.getSnapshot().context).toMatchObject({ isPushing: false, pushStopped: true });

  actor.send({ type: 'commit.PUSH_BRANCH' });
  expect(actor.getSnapshot().context.pushStopped).toBe(false);
  actor.send(askAnswered(sentCall(sendToSystem, 'commit.PUBLISH_BRANCH', 1), 'commit.PUBLISH_BRANCH', { branchName: 'main', stopped: false }));
  expect(actor.getSnapshot().context).toMatchObject({ isPushing: false, pushStopped: false });
});

it('asks for one commit at a time, and for another once the first is answered', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix it' });

  actor.send({ type: 'commit.COMMIT' });
  actor.send({ type: 'commit.COMMIT' });
  actor.send({ type: 'commit.AMEND', message: 'Fix it' });
  expect(sent('commit.COMMIT'), 'the second click, and an amend, wait for the first').toHaveLength(1);
  expect(sent('commit.AMEND')).toHaveLength(0);

  actor.send(askFailed(sentCall(sendToSystem, 'commit.COMMIT'), 'commit.COMMIT', { kind: 'git', message: 'The hook refused it' }));
  expect(actor.getSnapshot().context.isCommitting).toBe(false);

  actor.send({ type: 'commit.COMMIT' });
  expect(sent('commit.COMMIT')).toHaveLength(2);
  actor.send(askAnswered(sentCall(sendToSystem, 'commit.COMMIT', 1), 'commit.COMMIT', { message: 'Fix it' }));
  expect(actor.getSnapshot().context).toMatchObject({ isCommitting: false, commitMessage: '' });
});

it('holds an amend as a commit until it is answered, by its amend or by the question it needs', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.AMEND' });
  expect(actor.getSnapshot().context.isCommitting).toBe(true);
  actor.send(askFailed(sentCall(sendToSystem, 'commit.AMEND'), 'commit.AMEND', { kind: 'published', message: 'The last commit is already pushed.' }));
  expect(actor.getSnapshot().context.isCommitting, 'the user is asked').toBe(false);

  actor.send({ type: 'commit.CONFIRM_REWRITE' });
  expect(sent('commit.AMEND').at(-1)?.[1]).toMatchObject({ evenIfPublished: true });
  expect(actor.getSnapshot().context.isCommitting).toBe(true);
  actor.send(askAnswered(sentCall(sendToSystem, 'commit.AMEND', 1), 'commit.AMEND', {}));
  expect(actor.getSnapshot().context.isCommitting).toBe(false);
});

it('asks for a commit of the message as written, its trailers included, which the system leaves out as the settings say', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing\n\nCo-Authored-By: Someone <someone@example.com>\n' });

  actor.send({ type: 'commit.COMMIT' });

  expect(sent('commit.COMMIT').map(([, event]) => event.message)).toEqual(['feat: a thing\n\nCo-Authored-By: Someone <someone@example.com>']);
});

it("asks for a message's trailers once its last paragraph changes, and never for a message of one paragraph", () => {
  const actor = createActor(commitState).start();
  const asked = () => sent('commit.READ_TRAILERS').map(([, event]) => event.message);

  for (const message of ['f', 'fe', 'feat', 'feat\n', 'feat\n\n']) actor.send({ type: 'commit.UPDATE_MESSAGE', message });
  expect(asked(), 'a subject has no trailers').toEqual([]);

  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing\n\nCo-authored-by: A' });
  expect(asked(), 'typing in the subject asks nothing again').toEqual(['feat\n\nCo-authored-by: A']);

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.READ_TRAILERS' as const, answer: { message: 'feat\n\nCo-authored-by: A', trailers: [{ key: 'Co-authored-by', value: 'A' }] } });
  expect(actor.getSnapshot().context.trailers).toEqual([{ key: 'Co-authored-by', value: 'A' }]);

  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing' });
  expect(actor.getSnapshot().context.trailers, 'one paragraph left has none').toEqual([]);
});

it('takes trailers read of a paragraph the message no longer ends with for none', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: AB' });

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.READ_TRAILERS' as const, answer: { message: 'feat\n\nCo-authored-by: A', trailers: [{ key: 'Co-authored-by', value: 'A' }] } });

  expect(actor.getSnapshot().context.trailers).toEqual([]);
});

it('takes a trailer out of the message as it still is, and asks again what it ends with', () => {
  const actor = createActor(commitState).start();
  const message = 'feat\n\nCo-authored-by: A\nSigned-off-by: B';
  actor.send({ type: 'commit.UPDATE_MESSAGE', message });

  actor.send({ type: 'commit.REMOVE_TRAILER', trailer: { key: 'Co-authored-by', value: 'A' } });
  expect(sent('commit.REMOVE_TRAILER').map(([, event]) => event)).toEqual([{ type: 'commit.REMOVE_TRAILER', message, trailer: { key: 'Co-authored-by', value: 'A' } }]);

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.REMOVE_TRAILER' as const, answer: { message, without: 'feat\n\nSigned-off-by: B' } });
  expect(actor.getSnapshot().context.commitMessage).toBe('feat\n\nSigned-off-by: B');
  expect(sent('commit.READ_TRAILERS').map(([, event]) => event.message).at(-1)).toBe('feat\n\nSigned-off-by: B');
});

it('leaves a message changed since a trailer was asked to be taken out of it as it was changed', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  actor.send({ type: 'commit.REMOVE_TRAILER', trailer: { key: 'Co-authored-by', value: 'A' } });
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: more\n\nCo-authored-by: A' });

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.REMOVE_TRAILER' as const, answer: { message: 'feat\n\nCo-authored-by: A', without: 'feat' } });

  expect(actor.getSnapshot().context.commitMessage).toBe('feat: more\n\nCo-authored-by: A');
});

it('holds a tag pushed or deleted busy until its own answer, and keeps the tag last pushed', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_TAG', name: 'v1' });
  expect(actor.getSnapshot().context.tagBusy).toEqual({ name: 'v1', action: 'push' });

  actor.send(askAnswered(sentCall(sendToSystem, 'commit.PUSH_TAG'), 'commit.PUSH_TAG', { name: 'v1' }));
  expect(actor.getSnapshot().context).toMatchObject({ tagBusy: null, tagPushed: { name: 'v1' } });

  actor.send({ type: 'commit.DELETE_TAG', name: 'v1' });
  actor.send(askFailed(sentCall(sendToSystem, 'commit.DELETE_TAG'), 'commit.DELETE_TAG', { kind: 'git', message: 'no such tag' }));
  expect(actor.getSnapshot().context.tagBusy, 'refused: no longer busy').toBeNull();
});

it('holds a reset busy until it is answered', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.RESET_TO_COMMIT', hash: 'abc1234' });
  expect(actor.getSnapshot().context.resettingTo).toBe('abc1234');

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.RESET_TO_COMMIT' as const, answer: { hash: 'abc1234' } });
  expect(actor.getSnapshot().context.resettingTo).toBeNull();
});
