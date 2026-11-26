// What the pull request panel does with what GitHub said.
import { afterEach, expect, it } from 'vitest';
import type { GhPullRequest } from '#generated/types.ts';
import { pullRequestState, branchDeletable } from '#features/code/fe/features/pull-request/state.ts';
import { startMachine } from '../../_support/asks.ts';

const PR_REPORTS = ['PR_OPEN_DIFF_TAB', 'PR_OPEN_FILE', 'PR_SELECT_PANEL'] as const;

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const started = () => {
  const h = startMachine(pullRequestState, { reports: PR_REPORTS });
  running.push(h);
  h.send({ type: 'SYNC_BASE_DIRECTORY', baseDirectory: '/repo' });
  h.send({ type: 'SYNC_PANEL_SHOWN', isPanelShown: true });
  return h;
};
type Harness = ReturnType<typeof started>;
const dataOf = (h: Harness) => h.read().data;

const pr = (number: number, extra: Partial<GhPullRequest> = {}) =>
  ({ number, baseRefName: 'main', headRefName: 'feature', headRefOid: `sha-${number}`, isCrossRepository: false, headInRemote: true, openFromSameHead: [], state: 'MERGED', isDraft: false, updatedAt: 't', body: 'shown', rawBody: 'written', ...extra }) as unknown as GhPullRequest;

const asked = (h: Harness, type: string) => h.asksOf(type).map((ask) => ask.event);
const answer = (h: Harness, type: string, value: unknown) => h.latestAsk(type).answer(value);
const refuse = (h: Harness, type: string, message: string, reason?: string) =>
  h.latestAsk(type).refuse(message, reason ? { kind: 'github', reason } : undefined);

const pick = async (h: Harness, which: GhPullRequest) => {
  h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  await answer(h, 'pr.SELECT_PR', { pr: which, comments: [], fetchedAt: Date.now() });
};

it('shows a refusal about the sign-in as the access, and any other as the error', async () => {
  const h = started();
  h.send({ type: 'pr.REFRESH_STATUS' });

  await refuse(h, 'pr.CHECK_BRANCH_PR', 'Sign in to GitHub.', 'signed-out');
  expect(dataOf(h)).toMatchObject({ githubAccess: 'signed-out', githubAccessMessage: 'Sign in to GitHub.', prError: null });

  h.send({ type: 'pr.REFRESH_STATUS' });
  await refuse(h, 'pr.CHECK_BRANCH_PR', 'GitHub takes more at 10:00.', 'rate-limited');
  expect(dataOf(h)).toMatchObject({ prError: 'GitHub takes more at 10:00.', branchPRCheckFailed: true, isCheckingBranchPR: false });
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
  const h = started();
  await pick(h, pr(7, { headInRemote: false }));
  h.send({ type: 'pr.DELETE_BRANCH' });
  expect(asked(h, 'pr.DELETE_BRANCH')).toEqual([]);

  await pick(h, pr(9));
  h.send({ type: 'pr.DELETE_BRANCH' });
  expect(asked(h, 'pr.DELETE_BRANCH')).toEqual([{ type: 'pr.DELETE_BRANCH', number: 9 }]);
});

it('starts the next edit from the description just saved', async () => {
  const h = started();
  await pick(h, pr(7, { state: 'OPEN' }));
  h.send({ type: 'pr.UPDATE_PR', number: 7, body: 'saved' });
  await answer(h, 'pr.UPDATE_PR', { number: 7, body: 'saved' });

  expect(dataOf(h).selectedPR).toMatchObject({ body: 'saved', rawBody: 'saved' });
});

const listed = (prs: GhPullRequest[], next: string | null) => ({ prs, next });

it('reads the list when it is opened, a page at a time, each pull request once', async () => {
  const h = started();
  h.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
  expect(asked(h, 'pr.LIST_PRS'), 'nobody sees the list while it is shut').toEqual([]);

  h.send({ type: 'pr.LIST_SHOWN' });
  expect(asked(h, 'pr.LIST_PRS')).toEqual([{ type: 'pr.LIST_PRS', state: 'open' }]);
  expect(h.read().pending.list).toBe(true);
  await answer(h, 'pr.LIST_PRS', listed([pr(9), pr(8)], 'C1'));
  expect(dataOf(h).prList).toMatchObject({ next: 'C1', read: true });
  expect(h.read().pending.list).toBe(false);

  h.send({ type: 'pr.LOAD_MORE_PRS' });
  h.send({ type: 'pr.LOAD_MORE_PRS' });
  expect(asked(h, 'pr.LIST_PRS'), 'one page at a time').toHaveLength(2);
  expect(asked(h, 'pr.LIST_PRS')[1]).toEqual({ type: 'pr.LIST_PRS', state: 'open', after: 'C1' });
  expect(h.read().pending.listMore).toBe(true);
  // One opened between the two pages moved #8 onto the second
  await answer(h, 'pr.LIST_PRS', listed([pr(8), pr(7)], null));
  expect(dataOf(h).prList.prs.map((p) => p.number)).toEqual([9, 8, 7]);

  h.send({ type: 'pr.LOAD_MORE_PRS' });
  expect(asked(h, 'pr.LIST_PRS'), 'none after the last').toHaveLength(2);
});

it("takes only the page asked for what the list shows: a filter or search changed drops the one before's", async () => {
  const h = started();
  h.send({ type: 'pr.LIST_SHOWN' });
  await answer(h, 'pr.LIST_PRS', listed([pr(9)], 'C1'));
  h.send({ type: 'pr.LOAD_MORE_PRS' });
  const more = h.latestAsk('pr.LIST_PRS');

  h.send({ type: 'pr.SET_LIST_STATE', state: 'merged' });
  expect(dataOf(h).prList).toMatchObject({ state: 'merged', prs: [], read: false });
  expect(more.stopped, "the open list's next page is no longer waited on").toBe(true);
  await more.answer(listed([pr(1)], null));
  expect(dataOf(h).prList.prs, "the open list's page is not the merged one's").toEqual([]);

  h.send({ type: 'pr.SET_LIST_QUERY', query: '  flaky ' });
  expect(asked(h, 'pr.LIST_PRS').at(-1)).toEqual({ type: 'pr.LIST_PRS', state: 'merged', query: 'flaky' });
  h.send({ type: 'pr.SET_LIST_QUERY', query: 'flaky' });
  expect(asked(h, 'pr.LIST_PRS'), 'the same search is not asked again').toHaveLength(4);
  await answer(h, 'pr.LIST_PRS', listed([pr(3)], null));
  expect(dataOf(h).prList).toMatchObject({ state: 'merged', query: '  flaky ', prs: [{ number: 3 }], read: true });

  h.send({ type: 'pr.SET_LIST_QUERY', query: 'other' });
  await refuse(h, 'pr.LIST_PRS', 'GitHub could not be reached');
  expect(h.read().pending.list, 'a refused page is no longer being asked for').toBe(false);
});

it('merges the head shown, by its commit', async () => {
  const h = started();
  await pick(h, pr(7, { state: 'OPEN' }));
  h.send({ type: 'pr.MERGE', method: 'squash' });
  expect(asked(h, 'pr.MERGE_PR')[0]).toEqual({ type: 'pr.MERGE_PR', number: 7, method: 'squash', sha: 'sha-7' });
});

it('says a merge was refused for a moved head until the merge is asked again', async () => {
  const h = started();
  await pick(h, pr(7, { state: 'OPEN' }));
  h.send({ type: 'pr.MERGE' });
  await refuse(h, 'pr.MERGE_PR', 'nothing was merged', 'head-moved');
  expect(dataOf(h).prError).toBe('nothing was merged');

  h.send({ type: 'pr.MERGE' });
  expect(dataOf(h).prError, 'not left beside the merge that follows it').toBeNull();
});

it('checks out an open pull request once at a time, and keeps what the checkout did', async () => {
  const h = started();
  await pick(h, pr(7));
  h.send({ type: 'pr.CHECKOUT' });
  expect(asked(h, 'pr.CHECKOUT_PR'), 'a merged one is not checked out').toEqual([]);

  await pick(h, pr(8, { state: 'OPEN' }));
  h.send({ type: 'pr.CHECKOUT' });
  h.send({ type: 'pr.CHECKOUT' });
  expect(asked(h, 'pr.CHECKOUT_PR')).toEqual([{ type: 'pr.CHECKOUT_PR', number: 8 }]);
  expect(dataOf(h).isCheckingOut).toBe(true);

  await answer(h, 'pr.CHECKOUT_PR', { number: 8, branch: 'pr/8', checkout: 'kept' });
  expect(dataOf(h)).toMatchObject({ isCheckingOut: false, lastCheckout: { number: 8, branch: 'pr/8', checkout: 'kept' }, selectedPR: { number: 8 } });

  h.send({ type: 'pr.CHECKOUT' });
  await refuse(h, 'pr.CHECKOUT_PR', 'Cannot switch branches');
  expect(dataOf(h)).toMatchObject({ isCheckingOut: false, lastCheckout: null, prError: 'Cannot switch branches' });
});
