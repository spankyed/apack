// A file that is staged or unstaged moves in the commit panel on the click, before git has answered. What the
// panel then shows is a guess that git's answer replaces, so two things must not undo it meanwhile: a status that
// was read before the write landed, and the answer to a status asked before the latest one.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');
type GitStatusFile = import('#features/code/fe/features/commit/state.ts').GitStatusFile;

beforeEach(() => sendToSystem.mockReset());

const edited: GitStatusFile = { path: 'a.ts', status: 'modified', staged: false };
const staged: GitStatusFile = { path: 'a.ts', status: 'modified', staged: true };
const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

/** The asks of one kind the panel has made of the backend, by the call each was made under, oldest first */
const asked = (type: string): string[] => sendToSystem.mock.calls
  .filter(([, event]) => (event as { type: string }).type === type)
  .map(([, , options]) => (options as { call: string }).call);
const status = (files: GitStatusFile[]) =>
  ({ type: 'commit.STATUS_RECEIVED' as const, data: { files, truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true } });

/** A panel that has asked for the status and been told `a.ts` is edited and not staged */
function panelShowingAnEdit() {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  actor.send(answerTo(asked('commit.GET_GIT_STATUS').at(-1)!, status([edited])));
  const listed = () => actor.getSnapshot().context.gitStatus;
  expect(listed()).toEqual([edited]);
  return { actor, listed };
}

it('moves a staged file at once, holds a status read before the write landed, and then shows what git says', () => {
  const { actor, listed } = panelShowingAnEdit();

  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });
  expect(listed(), 'before git has answered').toEqual([staged]);

  // Another window's news has the panel ask again, and the answer is of the repository before the write
  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, status: true } });
  actor.send(answerTo(asked('commit.GET_GIT_STATUS').at(-1)!, status([edited])));
  expect(listed(), 'the file is not put back').toEqual([staged]);

  const statusAsks = asked('commit.GET_GIT_STATUS').length;
  actor.send(answerTo(asked('commit.STAGE_FILES').at(-1)!, { type: 'commit.FILES_STAGED' as const, paths: ['a.ts'] }));
  expect(asked('commit.GET_GIT_STATUS'), 'git is asked once the write is answered').toHaveLength(statusAsks + 1);

  const fromGit: GitStatusFile[] = [staged, { path: 'b.ts', status: 'untracked', staged: false }];
  actor.send(answerTo(asked('commit.GET_GIT_STATUS').at(-1)!, status(fromGit)));
  expect(listed()).toEqual(fromGit);
});

it('moves an unstaged file at once', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  actor.send(answerTo(asked('commit.GET_GIT_STATUS').at(-1)!, status([staged])));

  actor.send({ type: 'commit.UNSTAGE_FILES', paths: ['a.ts'] });

  expect(actor.getSnapshot().context.gitStatus).toEqual([{ ...edited, originalPath: undefined }]);
});

it('puts a file back, and says why, when staging it is refused', () => {
  const { actor, listed } = panelShowingAnEdit();
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });

  actor.send(answerTo(asked('commit.STAGE_FILES').at(-1)!, { type: 'commit.ERROR_RECEIVED' as const, data: { message: 'the index is locked' } }));
  expect(actor.getSnapshot().context.gitError).toBe('the index is locked');
  actor.send(answerTo(asked('commit.GET_GIT_STATUS').at(-1)!, status([edited])));

  expect(listed()).toEqual([edited]);
});

it('asks git for the list once, after the last of several writes is answered', () => {
  const { actor } = panelShowingAnEdit();
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.ts'] });
  actor.send({ type: 'commit.UNSTAGE_FILES', paths: ['a.ts'] });
  const statusAsks = asked('commit.GET_GIT_STATUS').length;

  actor.send(answerTo(asked('commit.STAGE_FILES').at(-1)!, { type: 'commit.FILES_STAGED' as const, paths: ['a.ts'] }));
  expect(asked('commit.GET_GIT_STATUS'), 'one write is still unanswered').toHaveLength(statusAsks);

  actor.send(answerTo(asked('commit.UNSTAGE_FILES').at(-1)!, { type: 'commit.FILES_UNSTAGED' as const, paths: ['a.ts'] }));
  expect(asked('commit.GET_GIT_STATUS')).toHaveLength(statusAsks + 1);
});

// Git reads take as long as the repository is large, so an answer can arrive after a later ask was made. It is of
// the repository as it was before that ask, and showing it would undo what the later answer shows
it('shows the answer to the latest status it asked for, and no earlier one', () => {
  const { actor, listed } = panelShowingAnEdit();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const [earlier, latest] = asked('commit.GET_GIT_STATUS').slice(-2);

  actor.send(answerTo(earlier!, status([])));
  expect(listed(), 'the earlier answer is not shown').toEqual([edited]);

  actor.send(answerTo(latest!, status([staged])));
  expect(listed()).toEqual([staged]);
});
