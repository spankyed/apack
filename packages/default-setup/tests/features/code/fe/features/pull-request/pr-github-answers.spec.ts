// What the pull request panel does with what GitHub said: a refusal about the sign-in or the repository is shown as
// the access, not as an error banner; a branch is offered for deletion only where it is the checkout's remote's and
// no other open pull request is from it, and is deleted by its pull request's number; a saved description is what
// the next edit starts from; the list is read a page at a time for what it shows; a merge names the head shown; and
// a pull request is checked out once at a time.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';
import type { GhPullRequest } from '#generated/types.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
const parent = vi.hoisted(() => ({ baseDirectory: '/repo' as string | null, selectedPanel: 'pr' }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  getParentContext: vi.fn(() => parent),
  sendEventToParent: vi.fn(),
}));

const { pullRequestState, branchDeletable } = await import('#features/code/fe/features/pull-request/state.ts');

type Actor = ReturnType<typeof started>;
const started = () => createActor(pullRequestState).start();
const context = (actor: Actor) => actor.getSnapshot().context;

const pr = (number: number, extra: Partial<GhPullRequest> = {}) =>
  ({ number, baseRefName: 'main', headRefName: 'feature', headRefOid: `sha-${number}`, isCrossRepository: false, headInRemote: true, openFromSameHead: [], state: 'MERGED', isDraft: false, updatedAt: 't', body: 'shown', rawBody: 'written', ...extra }) as unknown as GhPullRequest;

const asked = (type: string) => asksOf(type).map(ask => ask.event);
/** The answer to the latest ask of `type`, as the code system's handler gives it */
const answer = (type: string, value: unknown) => latestAsk(type).answer(value);
/** The refusal of the latest ask of `type`: of GitHub's, with its reason, where a reason is given */
const refuse = (type: string, message: string, reason?: string) =>
  latestAsk(type).refuse(message, reason ? { kind: 'github', reason } : undefined);

const pick = async (actor: Actor, which: GhPullRequest) => {
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  await answer('pr.SELECT_PR', { pr: which, comments: [], fetchedAt: Date.now() });
};

beforeEach(() => {
  tell.mockReset();
  resetAsks();
  parent.baseDirectory = '/repo';
  parent.selectedPanel = 'pr';
});

it('shows a refusal about the sign-in as the access, and any other as the error', async () => {
  const actor = started();
  actor.send({ type: 'pr.REFRESH_STATUS' });

  await refuse('pr.CHECK_BRANCH_PR', 'Sign in to GitHub.', 'signed-out');
  expect(context(actor)).toMatchObject({ githubAccess: 'signed-out', githubAccessMessage: 'Sign in to GitHub.', prError: null });

  actor.send({ type: 'pr.REFRESH_STATUS' });
  await refuse('pr.CHECK_BRANCH_PR', 'GitHub takes more at 10:00.', 'rate-limited');
  expect(context(actor)).toMatchObject({ prError: 'GitHub takes more at 10:00.', branchPRCheckFailed: true, isCheckingBranchPR: false });
});

it("offers a branch for deletion only where it is the checkout's remote's and no other open pull request is from it", async () => {
  expect(branchDeletable(pr(7))).toBe(true);
  expect(branchDeletable(pr(7, { headInRemote: false })), "another repository's").toBe(false);
  expect(branchDeletable(pr(7, { isCrossRepository: true })), "a fork's, the checkout being of that fork").toBe(true);
  expect(branchDeletable(pr(7, { openFromSameHead: [8] }))).toBe(false);
  expect(branchDeletable(pr(7, { state: 'OPEN' }))).toBe(false);
  expect(branchDeletable(pr(7, { openFromSameHead: undefined })), 'not read: the backend asks before it deletes').toBe(true);
});

it("deletes a branch by its pull request's number, and sends nothing for another repository's", async () => {
  const actor = started();
  await pick(actor, pr(7, { headInRemote: false }));
  actor.send({ type: 'pr.DELETE_BRANCH' });
  expect(asked('pr.DELETE_BRANCH')).toEqual([]);

  await pick(actor, pr(9));
  actor.send({ type: 'pr.DELETE_BRANCH' });
  expect(asked('pr.DELETE_BRANCH')).toEqual([{ type: 'pr.DELETE_BRANCH', number: 9 }]);
});

it('starts the next edit from the description just saved', async () => {
  const actor = started();
  await pick(actor, pr(7, { state: 'OPEN' }));
  actor.send({ type: 'pr.UPDATE_PR', number: 7, body: 'saved' });
  await answer('pr.UPDATE_PR', { number: 7, body: 'saved' });

  expect(context(actor).selectedPR).toMatchObject({ body: 'saved', rawBody: 'saved' });
});

const listed = (prs: GhPullRequest[], next: string | null) => ({ prs, next });

it('reads the list when it is opened, a page at a time, each pull request once', async () => {
  const actor = started();
  actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
  expect(asked('pr.LIST_PRS'), 'nobody sees the list while it is shut').toEqual([]);

  actor.send({ type: 'pr.LIST_SHOWN' });
  expect(asked('pr.LIST_PRS')).toEqual([{ type: 'pr.LIST_PRS', state: 'open' }]);
  expect(actor.getSnapshot().context.making.list).toBe(true);
  await answer('pr.LIST_PRS', listed([pr(9), pr(8)], 'C1'));
  expect(context(actor).prList).toMatchObject({ next: 'C1', read: true });
  expect(actor.getSnapshot().context.making.list).toBe(false);

  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  expect(asked('pr.LIST_PRS'), 'one page at a time').toHaveLength(2);
  expect(asked('pr.LIST_PRS')[1]).toEqual({ type: 'pr.LIST_PRS', state: 'open', after: 'C1' });
  expect(actor.getSnapshot().context.making.listMore).toBe(true);
  // One opened between the two pages moved #8 onto the second
  await answer('pr.LIST_PRS', listed([pr(8), pr(7)], null));
  expect(context(actor).prList.prs.map(p => p.number)).toEqual([9, 8, 7]);

  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  expect(asked('pr.LIST_PRS'), 'none after the last').toHaveLength(2);
});

it("takes only the page asked for what the list shows: a filter or search changed drops the one before's", async () => {
  const actor = started();
  actor.send({ type: 'pr.LIST_SHOWN' });
  await answer('pr.LIST_PRS', listed([pr(9)], 'C1'));
  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  const more = latestAsk('pr.LIST_PRS');

  actor.send({ type: 'pr.SET_LIST_STATE', state: 'merged' });
  expect(context(actor).prList).toMatchObject({ state: 'merged', prs: [], read: false });
  expect(more.stopped, "the open list's next page is no longer waited on").toBe(true);
  await more.answer(listed([pr(1)], null));
  expect(context(actor).prList.prs, "the open list's page is not the merged one's").toEqual([]);

  actor.send({ type: 'pr.SET_LIST_QUERY', query: '  flaky ' });
  expect(asked('pr.LIST_PRS').at(-1)).toEqual({ type: 'pr.LIST_PRS', state: 'merged', query: 'flaky' });
  actor.send({ type: 'pr.SET_LIST_QUERY', query: 'flaky' });
  expect(asked('pr.LIST_PRS'), 'the same search is not asked again').toHaveLength(4);
  await answer('pr.LIST_PRS', listed([pr(3)], null));
  expect(context(actor).prList).toMatchObject({ state: 'merged', query: '  flaky ', prs: [{ number: 3 }], read: true });

  actor.send({ type: 'pr.SET_LIST_QUERY', query: 'other' });
  await refuse('pr.LIST_PRS', 'GitHub could not be reached');
  expect(actor.getSnapshot().context.making.list, 'a refused page is no longer being asked for').toBe(false);
});

it('merges the head shown, by its commit', async () => {
  const actor = started();
  await pick(actor, pr(7, { state: 'OPEN' }));
  actor.send({ type: 'pr.MERGE', method: 'squash' });
  expect(asked('pr.MERGE_PR')[0]).toEqual({ type: 'pr.MERGE_PR', number: 7, method: 'squash', sha: 'sha-7' });
});

it('says a merge was refused for a moved head until the merge is asked again', async () => {
  const actor = started();
  await pick(actor, pr(7, { state: 'OPEN' }));
  actor.send({ type: 'pr.MERGE' });
  await refuse('pr.MERGE_PR', 'nothing was merged', 'head-moved');
  expect(context(actor).prError).toBe('nothing was merged');

  actor.send({ type: 'pr.MERGE' });
  expect(context(actor).prError, 'not left beside the merge that follows it').toBeNull();
});

it('checks out an open pull request once at a time, and keeps what the checkout did', async () => {
  const actor = started();
  await pick(actor, pr(7));
  actor.send({ type: 'pr.CHECKOUT' });
  expect(asked('pr.CHECKOUT_PR'), 'a merged one is not checked out').toEqual([]);

  await pick(actor, pr(8, { state: 'OPEN' }));
  actor.send({ type: 'pr.CHECKOUT' });
  actor.send({ type: 'pr.CHECKOUT' });
  expect(asked('pr.CHECKOUT_PR')).toEqual([{ type: 'pr.CHECKOUT_PR', number: 8 }]);
  expect(context(actor).isCheckingOut).toBe(true);

  await answer('pr.CHECKOUT_PR', { number: 8, branch: 'pr/8', checkout: 'kept' });
  expect(context(actor)).toMatchObject({ isCheckingOut: false, lastCheckout: { number: 8, branch: 'pr/8', checkout: 'kept' }, selectedPR: { number: 8 } });

  actor.send({ type: 'pr.CHECKOUT' });
  await refuse('pr.CHECKOUT_PR', 'Cannot switch branches');
  expect(context(actor)).toMatchObject({ isCheckingOut: false, lastCheckout: null, prError: 'Cannot switch branches' });
});
