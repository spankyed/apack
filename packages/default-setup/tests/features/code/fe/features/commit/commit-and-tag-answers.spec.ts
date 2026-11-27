// What the commit machine holds while a commit, an amend, a tag or a reset is asked for, and what each answer
// leaves: one commit at a time, a stopped push said as stopped, and the trailers the message ends with followed as it
// is written and taken out of it when asked.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
const open = () => {
  const h = startCommit();
  running.push(h);
  return h;
};
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const sent = (h: CommitHarness, type: string) => h.asksOf(type).map((ask) => ask.event);
const commitUnderWay = (h: CommitHarness) => Boolean(h.composer().pending.commit || h.composer().pending.amend);

it('says a push that was stopped was stopped, and a push run again starts over', async () => {
  const h = open();
  h.send({ type: 'commit.PUSH_BRANCH' });
  h.send({ type: 'commit.STOP_PUSH' });
  expect(h.latestAsk('commit.PUBLISH_BRANCH').stopped, 'which ends git on the backend').toBe(true);
  expect(h.remotes().pending.push).toBe(false);
  expect(h.remotes().data.pushStopped).toBe(true);

  h.send({ type: 'commit.PUSH_BRANCH' });
  expect(h.remotes().data.pushStopped).toBe(false);
  await h.latestAsk('commit.PUBLISH_BRANCH').answer({ branchName: 'main' });
  expect(h.remotes().pending.push).toBe(false);
  expect(h.remotes().data.pushStopped).toBe(false);
});

it('asks for one commit at a time, and for another once the first is answered', async () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix it' });

  h.send({ type: 'commit.COMMIT' });
  h.send({ type: 'commit.COMMIT' });
  h.send({ type: 'commit.AMEND', message: 'Fix it' });
  expect(sent(h, 'commit.COMMIT'), 'the second click, and an amend, wait for the first').toHaveLength(1);
  expect(sent(h, 'commit.AMEND')).toHaveLength(0);

  await h.latestAsk('commit.COMMIT').refuse('The hook refused it', { kind: 'git' });
  expect(commitUnderWay(h)).toBe(false);

  h.send({ type: 'commit.COMMIT' });
  expect(sent(h, 'commit.COMMIT')).toHaveLength(2);
  await h.latestAsk('commit.COMMIT').answer({ message: 'Fix it' });
  expect(commitUnderWay(h)).toBe(false);
  expect(h.root().data.commitMessage).toBe('');
});

it('holds an amend as a commit until it is answered, by its amend or by the question it needs', async () => {
  const h = open();
  h.send({ type: 'commit.AMEND' });
  expect(h.composer().pending.amend).toBe(true);
  await h.latestAsk('commit.AMEND').refuse('The last commit is already pushed.', { kind: 'published' });
  expect(commitUnderWay(h), 'the user is asked').toBe(false);
  expect(h.composer().data.rewriteConfirmation?.message).toBe('The last commit is already pushed.');

  h.send({ type: 'commit.CONFIRM_REWRITE' });
  expect(sent(h, 'commit.AMEND').at(-1)).toMatchObject({ evenIfPublished: true });
  expect(h.composer().pending.amend).toBe(true);
  await h.latestAsk('commit.AMEND').answer({});
  expect(commitUnderWay(h)).toBe(false);
});

it('asks for a commit of the message as written, its trailers included, which the system leaves out as the settings say', () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing\n\nCo-Authored-By: Someone <someone@example.com>\n' });

  h.send({ type: 'commit.COMMIT' });

  expect(sent(h, 'commit.COMMIT').map((event) => event.message)).toEqual(['feat: a thing\n\nCo-Authored-By: Someone <someone@example.com>']);
});

it("asks for a message's trailers once its last paragraph changes, and never for a message of one paragraph", async () => {
  const h = open();
  const asked = () => sent(h, 'commit.READ_TRAILERS').map((event) => event.message);

  for (const message of ['f', 'fe', 'feat', 'feat\n', 'feat\n\n']) h.send({ type: 'commit.UPDATE_MESSAGE', message });
  expect(asked(), 'a subject has no trailers').toEqual([]);

  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing\n\nCo-authored-by: A' });
  expect(asked(), 'typing in the subject asks nothing again').toEqual(['feat\n\nCo-authored-by: A']);

  await h.latestAsk('commit.READ_TRAILERS').answer({ message: 'feat\n\nCo-authored-by: A', trailers: [{ key: 'Co-authored-by', value: 'A' }] });
  expect(h.composer().data.trailers).toEqual([{ key: 'Co-authored-by', value: 'A' }]);

  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: a thing' });
  expect(h.composer().data.trailers, 'one paragraph left has none').toEqual([]);
});

it('takes trailers read of a paragraph the message no longer ends with for none', async () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: AB' });

  await h.asksOf('commit.READ_TRAILERS')[0]!.answer({ message: 'feat\n\nCo-authored-by: A', trailers: [{ key: 'Co-authored-by', value: 'A' }] });

  expect(h.composer().data.trailers).toEqual([]);
});

it('takes a trailer out of the message as it still is, and asks again what it ends with', async () => {
  const h = open();
  const message = 'feat\n\nCo-authored-by: A\nSigned-off-by: B';
  h.send({ type: 'commit.UPDATE_MESSAGE', message });

  h.send({ type: 'commit.REMOVE_TRAILER', trailer: { key: 'Co-authored-by', value: 'A' } });
  expect(sent(h, 'commit.REMOVE_TRAILER')).toEqual([{ type: 'commit.REMOVE_TRAILER', message, trailer: { key: 'Co-authored-by', value: 'A' } }]);

  await h.latestAsk('commit.REMOVE_TRAILER').answer({ message, without: 'feat\n\nSigned-off-by: B' });
  expect(h.root().data.commitMessage).toBe('feat\n\nSigned-off-by: B');
  expect(sent(h, 'commit.READ_TRAILERS').map((event) => event.message).at(-1)).toBe('feat\n\nSigned-off-by: B');
});

it('leaves a message changed since a trailer was asked to be taken out of it as it was changed', async () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat\n\nCo-authored-by: A' });
  h.send({ type: 'commit.REMOVE_TRAILER', trailer: { key: 'Co-authored-by', value: 'A' } });
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: more\n\nCo-authored-by: A' });

  await h.latestAsk('commit.REMOVE_TRAILER').answer({ message: 'feat\n\nCo-authored-by: A', without: 'feat' });

  expect(h.root().data.commitMessage).toBe('feat: more\n\nCo-authored-by: A');
});

it('holds a tag pushed or deleted busy until its own answer, and keeps the tag last pushed', async () => {
  const h = open();
  h.send({ type: 'commit.PUSH_TAG', name: 'v1' });
  expect(h.remotes().data.tagBusy).toEqual({ name: 'v1', action: 'push' });

  await h.latestAsk('commit.PUSH_TAG').answer({ name: 'v1' });
  expect(h.remotes().data).toMatchObject({ tagBusy: null, tagPushed: { name: 'v1' } });

  h.send({ type: 'commit.DELETE_TAG', name: 'v1' });
  await h.latestAsk('commit.DELETE_TAG').refuse('no such tag', { kind: 'git' });
  expect(h.remotes().data.tagBusy, 'refused: no longer busy').toBeNull();
});

it('holds a reset busy until it is answered', async () => {
  const h = open();
  h.send({ type: 'commit.RESET_TO_COMMIT', hash: 'abc1234' });
  expect(h.history().data.resettingTo).toBe('abc1234');

  await h.latestAsk('commit.RESET_TO_COMMIT').answer({ hash: 'abc1234' });
  expect(h.history().data.resettingTo).toBeNull();
});
