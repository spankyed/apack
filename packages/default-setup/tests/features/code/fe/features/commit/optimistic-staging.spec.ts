// A file that is staged or unstaged moves in the commit panel on the click, before git has answered. What the
// panel then shows is a guess that git's answer replaces, so two things must not undo it meanwhile: a status that
// was read before the write landed, and the answer to a status asked before the latest one.
import { afterEach, expect, it } from 'vitest';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const edited: GitStatusFile = { path: 'a.ts', status: 'modified', staged: false };
const staged: GitStatusFile = { path: 'a.ts', status: 'modified', staged: true };
const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

const status = (h: CommitHarness, files: GitStatusFile[]) =>
  h.latestAsk('commit.GET_GIT_STATUS').answer({
    files, truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true,
  });

async function panelShowingAnEdit() {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.REFRESH_STATUS' });
  await status(h, [edited]);
  const listed = () => h.open().data.gitStatus;
  expect(listed()).toEqual([edited]);
  return { h, listed };
}

it('moves a staged file at once, holds a status read before the write landed, and then shows what git says', async () => {
  const { h, listed } = await panelShowingAnEdit();

  h.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });
  expect(listed(), 'before git has answered').toEqual([staged]);

  // Another window's news has the panel ask again, and the answer is of the repository before the write
  h.send({ type: 'commit.SHOWN' });
  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, status: true } });
  await status(h, [edited]);
  expect(listed(), 'the file is not put back').toEqual([staged]);

  const statusAsks = h.asksOf('commit.GET_GIT_STATUS').length;
  await h.latestAsk('commit.STAGE_FILES').answer({ paths: ['a.ts'] });
  expect(h.asksOf('commit.GET_GIT_STATUS'), 'git is asked once the write is answered').toHaveLength(statusAsks + 1);

  const fromGit: GitStatusFile[] = [staged, { path: 'b.ts', status: 'untracked', staged: false }];
  await status(h, fromGit);
  expect(listed()).toEqual(fromGit);
});

it('moves an unstaged file at once', async () => {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.REFRESH_STATUS' });
  await status(h, [staged]);

  h.send({ type: 'commit.UNSTAGE_FILES', paths: ['a.ts'] });

  expect(h.open().data.gitStatus).toEqual([{ ...edited, originalPath: undefined }]);
});

it('puts a file back, and says why, when staging it is refused', async () => {
  const { h, listed } = await panelShowingAnEdit();
  h.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });

  await h.latestAsk('commit.STAGE_FILES').refuse('the index is locked', { kind: 'git' });
  expect(h.open().data.gitError).toBe('the index is locked');
  await status(h, [edited]);

  expect(listed()).toEqual([edited]);
});

it('asks git for the list once, after the last of several writes is answered', async () => {
  const { h } = await panelShowingAnEdit();
  h.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });
  h.send({ type: 'commit.UNSTAGE_FILES', paths: ['a.ts'] });
  const statusAsks = h.asksOf('commit.GET_GIT_STATUS').length;

  await h.latestAsk('commit.STAGE_FILES').answer({ paths: ['a.ts'] });
  expect(h.asksOf('commit.GET_GIT_STATUS'), 'one write is still unanswered').toHaveLength(statusAsks);

  await h.latestAsk('commit.UNSTAGE_FILES').answer({ paths: ['a.ts'] });
  expect(h.asksOf('commit.GET_GIT_STATUS')).toHaveLength(statusAsks + 1);
});

it('shows the answer to the latest status it asked for, and stops waiting on an earlier one', async () => {
  const { h, listed } = await panelShowingAnEdit();
  h.send({ type: 'commit.REFRESH_STATUS' });
  h.send({ type: 'commit.REFRESH_STATUS' });
  const [earlier, latest] = h.asksOf('commit.GET_GIT_STATUS').slice(-2);

  expect(earlier!.stopped).toBe(true);
  await earlier!.answer({ files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });
  expect(listed(), 'the earlier answer is not shown').toEqual([edited]);

  await latest!.answer({ files: [staged], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });
  expect(listed()).toEqual([staged]);
});
