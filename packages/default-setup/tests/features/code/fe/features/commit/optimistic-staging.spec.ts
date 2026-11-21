// A file that is staged or unstaged moves in the commit panel on the click, before git has answered. What the
// panel then shows is a guess that git's answer replaces, so two things must not undo it meanwhile: a status that
// was read before the write landed, and the answer to a status asked before the latest one.
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

const { commitState } = await import('#features/code/fe/features/commit/state.ts');
type GitStatusFile = import('#features/code/fe/features/commit/state.ts').GitStatusFile;

beforeEach(resetAsks);

const edited: GitStatusFile = { path: 'a.ts', status: 'modified', staged: false };
const staged: GitStatusFile = { path: 'a.ts', status: 'modified', staged: true };
const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

/** Answers the latest ask for the status with these files */
const status = (files: GitStatusFile[]) =>
  latestAsk('commit.GET_GIT_STATUS').answer({ files, truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });

/** A panel that has asked for the status and been told `a.ts` is edited and not staged */
async function panelShowingAnEdit() {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  await status([edited]);
  const listed = () => actor.getSnapshot().context.gitStatus;
  expect(listed()).toEqual([edited]);
  return { actor, listed };
}

it('moves a staged file at once, holds a status read before the write landed, and then shows what git says', async () => {
  const { actor, listed } = await panelShowingAnEdit();

  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });
  expect(listed(), 'before git has answered').toEqual([staged]);

  // Another window's news has the panel ask again, and the answer is of the repository before the write
  actor.send({ type: 'commit.SHOWN' });
  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, status: true } });
  await status([edited]);
  expect(listed(), 'the file is not put back').toEqual([staged]);

  const statusAsks = asksOf('commit.GET_GIT_STATUS').length;
  await latestAsk('commit.STAGE_FILES').answer({ paths: ['a.ts'] });
  expect(asksOf('commit.GET_GIT_STATUS'), 'git is asked once the write is answered').toHaveLength(statusAsks + 1);

  const fromGit: GitStatusFile[] = [staged, { path: 'b.ts', status: 'untracked', staged: false }];
  await status(fromGit);
  expect(listed()).toEqual(fromGit);
});

it('moves an unstaged file at once', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  await status([staged]);

  actor.send({ type: 'commit.UNSTAGE_FILES', paths: ['a.ts'] });

  expect(actor.getSnapshot().context.gitStatus).toEqual([{ ...edited, originalPath: undefined }]);
});

it('puts a file back, and says why, when staging it is refused', async () => {
  const { actor, listed } = await panelShowingAnEdit();
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });

  await latestAsk('commit.STAGE_FILES').refuse('the index is locked', { kind: 'git' });
  expect(actor.getSnapshot().context.gitError).toBe('the index is locked');
  await status([edited]);

  expect(listed()).toEqual([edited]);
});

it('asks git for the list once, after the last of several writes is answered', async () => {
  const { actor } = await panelShowingAnEdit();
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });
  actor.send({ type: 'commit.UNSTAGE_FILES', paths: ['a.ts'] });
  const statusAsks = asksOf('commit.GET_GIT_STATUS').length;

  await latestAsk('commit.STAGE_FILES').answer({ paths: ['a.ts'] });
  expect(asksOf('commit.GET_GIT_STATUS'), 'one write is still unanswered').toHaveLength(statusAsks);

  await latestAsk('commit.UNSTAGE_FILES').answer({ paths: ['a.ts'] });
  expect(asksOf('commit.GET_GIT_STATUS')).toHaveLength(statusAsks + 1);
});

// Git reads take as long as the repository is large, so a read can still be under way when a later one is asked
// for. It is of the repository as it was before that ask, and showing it would undo what the later answer shows
it('shows the answer to the latest status it asked for, and stops waiting on an earlier one', async () => {
  const { actor, listed } = await panelShowingAnEdit();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const [earlier, latest] = asksOf('commit.GET_GIT_STATUS').slice(-2);

  expect(earlier!.stopped).toBe(true);
  await earlier!.answer({ files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });
  expect(listed(), 'the earlier answer is not shown').toEqual([edited]);

  await latest!.answer({ files: [staged], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });
  expect(listed()).toEqual([staged]);
});
