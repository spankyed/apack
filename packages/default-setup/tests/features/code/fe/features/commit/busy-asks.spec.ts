// Each ask that keeps the panel busy is answered by the backend under its own call, and only that answer ends it:
// a blame that fails says nothing about a push still running. An error shows its message whichever ask it answers,
// and one answering no ask the panel holds ends nothing. A status that is read clears only a failure of the kind a
// status read reports, never a write's.
import { afterEach, expect, it, vi } from 'vitest';
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

const STATUS = { files: [], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 1, commitsBehind: 0, watching: true };

it('ends a running push only on its own failure, not on a failed blame', async () => {
  const h = open();
  h.send({ type: 'commit.PUSH_BRANCH' });
  h.latestAsk('commit.PUBLISH_BRANCH').tell({ during: 'push', stage: 'Writing objects', percent: 42 });
  await vi.waitFor(() => expect(h.open().data.progress).toEqual({ during: 'push', stage: 'Writing objects', percent: 42 }));
  h.send({ type: 'commit.SHOW_BLAME', path: 'a.txt' });

  await h.latestAsk('commit.GET_BLAME').refuse('no such path in HEAD', { kind: 'git' });

  expect(h.remotes().pending.push, 'the push goes on').toBe(true);
  expect(h.open().data, 'the blame is let go of').toMatchObject({
    blame: null, progress: { during: 'push' }, gitError: 'no such path in HEAD',
  });

  await h.latestAsk('commit.PUBLISH_BRANCH').refuse('Failed to push', { kind: 'git' });
  expect(h.remotes().pending.push).toBe(false);
  expect(h.open().data).toMatchObject({ progress: null, gitError: 'Failed to push' });
});

it('shows a failure of another ask, and ends nothing else with it', async () => {
  const h = open();
  h.send({ type: 'commit.PUSH_BRANCH' });
  h.send({ type: 'commit.STASH_DROP', index: 0 });

  await h.latestAsk('commit.STASH_DROP').refuse('something else failed', { kind: 'git' });

  expect(h.remotes().pending.push).toBe(true);
  expect(h.open().data.gitError).toBe('something else failed');
});

it.each([
  ['a stash', { type: 'commit.STASH_PUSH' }, 'commit.STASH_PUSH', (h: CommitHarness) => h.stashes().pending.stash],
  ['a worktree added', { type: 'commit.WORKTREE_ADD', path: '/work/two', branch: 'two' }, 'commit.WORKTREE_ADD', (h: CommitHarness) => h.worktrees().pending.worktreeAdd],
  ['a worktree switch', { type: 'commit.WORKTREE_SWITCH', path: '/work/two' }, 'commit.WORKTREE_SWITCH', (h: CommitHarness) => h.worktrees().pending.worktreeSwitch],
  ['speeding the status up', { type: 'commit.SPEED_UP_STATUS' }, 'commit.SPEED_UP_STATUS', (h: CommitHarness) => h.open().pending.speedUp],
  ['a checkout', { type: 'commit.CHECKOUT_BRANCH' }, 'commit.CHECKOUT_BRANCH', (h: CommitHarness) => h.remotes().pending.checkout],
] as const)('is no longer busy with %s once it fails', async (_what, ask, sent, isBusy) => {
  const h = open();
  h.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: 'two' });
  h.send(ask as never);
  expect(isBusy(h)).toBe(true);

  await h.latestAsk(sent).refuse('git refused', { kind: 'git' });

  expect(isBusy(h)).toBe(false);
  expect(h.open().data.gitError).toBe('git refused');
});

it("stops reading a commit's message to reword it once the read fails", async () => {
  const h = open();
  h.send({ type: 'commit.START_REWORD', hash: 'abc123' });

  await h.latestAsk('commit.GET_COMMIT_MESSAGE').refuse('bad object abc123', { kind: 'git' });

  expect(h.history().data.rewording).toBeNull();
});

it('is no longer busy with a worktree switch once the backend says it switched', async () => {
  const h = open();
  h.send({ type: 'commit.WORKTREE_SWITCH', path: '/work/two' });

  await h.latestAsk('commit.WORKTREE_SWITCH').answer({ path: '/work/two' });

  const wt = h.worktrees().pending;
  expect(Boolean(wt.worktreeAdd || wt.worktreeRemove || wt.worktreeSwitch)).toBe(false);
});

function statusAsked(h: CommitHarness) {
  h.send({ type: 'commit.REFRESH_STATUS' });
  return h.latestAsk('commit.GET_GIT_STATUS');
}

it("keeps a failed push's error, and what can be done about it, through a status read", async () => {
  const h = open();
  h.send({ type: 'commit.PUSH_BRANCH' });
  const signIn = { host: 'github.com', kind: 'github' } as const;
  await h.latestAsk('commit.PUBLISH_BRANCH').refuse('the remote asked for a sign-in', { kind: 'git', code: 'authentication', during: 'push', signIn });

  await statusAsked(h).answer(STATUS);

  expect(h.open().data).toMatchObject({ gitError: 'the remote asked for a sign-in', gitFailure: { during: 'push', signIn } });
});

it("clears the status read's own failure once a status is read", async () => {
  const h = open();
  await statusAsked(h).refuse('Not a git repository', { kind: 'git' });
  expect(h.open().data.gitError).toBe('Not a git repository');
  expect(h.open().data.statusLoadingShown, 'no longer shown as loading').toBe(false);

  await statusAsked(h).answer(STATUS);

  expect(h.open().data).toMatchObject({ gitError: null, gitFailure: null });
});

it('clears a refusal of the kind a status read reports, whichever ask it answered, once a status is read', async () => {
  const h = open();
  h.send({ type: 'commit.STASH_PUSH' });
  await h.latestAsk('commit.STASH_PUSH').refuse('Not trusted.', { kind: 'git', code: 'untrusted' });

  await statusAsked(h).answer(STATUS);

  expect(h.open().data).toMatchObject({ gitError: null, gitFailure: null });
});

it('holds no ask once each has ended, whether it was done or refused', async () => {
  const h = open();
  h.send({ type: 'commit.STAGE_FILES', paths: ['a.txt'] });
  h.send({ type: 'commit.PREVIEW_DISCARD', paths: ['a.txt'] });
  h.send({ type: 'commit.GENERATE_MESSAGE' });

  await h.latestAsk('commit.PREVIEW_DISCARD').refuse('nothing to discard', { kind: 'git' });
  await h.latestAsk('commit.GENERATE_MESSAGE').answer({});
  await h.latestAsk('commit.STAGE_FILES').answer({ paths: ['a.txt'] });
  await h.latestAsk('commit.GET_GIT_STATUS').answer(STATUS);

  expect(h.open().pending.stage).toBe(0);
  expect(h.open().pending.unstage).toBe(0);
  expect(h.composer().pending.generateMessage).toBe(0);
});
