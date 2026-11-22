// A file diff that needs content the partial clone was not given: the panel offers to download it, and the offer
// asks for the same diff again, allowed to fetch. The answer it gets is the one that opens the tab.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';
import type { GhPullRequest } from '#generated/types.ts';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
const addTabToParent = vi.hoisted(() => vi.fn());
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent,
  updateParentState: vi.fn(),
  getParentContext: vi.fn(() => ({})),
  sendEventToParent: vi.fn(),
}));

const { pullRequestState } = await import('#features/code/fe/features/pull-request/state.ts');

const pr = { number: 1, baseRefName: 'main', headRefName: 'feature-a' } as unknown as GhPullRequest;
const file = (path: string) => ({ path, status: 'modified', staged: false }) as GitStatusFile;
const missing = { path: 'a.ts', baseBranch: 'main', headBranch: 'feature-a' };
/** The refusal of a file diff that needs content the clone was not given */
const refuseAsMissing = (nth = 0) =>
  asksOf('pr.GET_BRANCH_FILE_DIFF')[nth]!.refuse('a.ts needs content this clone was not given', { kind: 'content-missing', ...missing });

/** A panel showing a PR, which has asked for one file's diff */
const asking = async () => {
  const actor = createActor(pullRequestState).start();
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 1 });
  await latestAsk('pr.SELECT_PR').answer({ pr, comments: [], fetchedAt: Date.now() });
  actor.send({ type: 'pr.SELECT_FILE', file: file('a.ts') });
  actor.send({ type: 'pr.VIEW_DIFF', path: 'a.ts' });
  return actor;
};

beforeEach(() => {
  tell.mockReset();
  resetAsks();
  addTabToParent.mockReset();
});

it('offers to download what the diff lacks, and asks for it again, allowed to fetch, when taken up', async () => {
  const actor = await asking();

  await refuseAsMissing();
  expect(actor.getSnapshot().context.missingFileDiff).toEqual(missing);

  actor.send({ type: 'pr.FETCH_MISSING_DIFF' });
  expect(latestAsk('pr.GET_BRANCH_FILE_DIFF').event).toEqual({ type: 'pr.GET_BRANCH_FILE_DIFF', ...missing, fetchMissing: true });
  expect(actor.getSnapshot().context.missingFileDiff, 'and the offer is gone').toBeNull();

  await asksOf('pr.GET_BRANCH_FILE_DIFF')[1]!.answer({ ...missing, staged: false });
  expect(addTabToParent, 'the answer to the second ask opens the tab').toHaveBeenCalledTimes(1);
});

it('offers nothing for a diff of a pull request since left', async () => {
  const actor = await asking();
  actor.send({ type: 'pr.BACK_TO_BRANCH' });

  await refuseAsMissing();

  expect(actor.getSnapshot().context.missingFileDiff).toBeNull();
});

it('drops the offer when the user moves to another file', async () => {
  const actor = await asking();
  await refuseAsMissing();

  actor.send({ type: 'pr.SELECT_FILE', file: file('b.ts') });

  expect(actor.getSnapshot().context.missingFileDiff).toBeNull();
});
