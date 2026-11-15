// What the pull request panel does with what GitHub said: a refusal about the sign-in or the repository is shown as
// the access, not as an error banner; a branch is offered for deletion only where it is the checkout's remote's and
// no other open pull request is from it, and is deleted by its pull request's number; a saved description is what
// the next edit starts from; the list is read a page at a time for what it shows; a merge names the head shown; and
// a pull request is checked out once at a time.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';
import type { GhPullRequest } from '#generated/types.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
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

const asked = (type: string) => sendToSystem.mock.calls.filter(([, event]) => (event as { type: string }).type === type);
const answer = <E extends { type: string }>(actor: Actor, type: string, event: E) =>
  actor.send(answerTo(sentCall(sendToSystem, type, asked(type).length - 1), event) as never);

const pick = (actor: Actor, which: GhPullRequest) => {
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  answer(actor, 'pr.SELECT_PR', { type: 'pr.PR_DETAILS_RECEIVED', data: { pr: which, comments: [], fetchedAt: Date.now() } });
};

beforeEach(() => {
  sendToSystem.mockReset();
  parent.baseDirectory = '/repo';
  parent.selectedPanel = 'pr';
});

it('shows a refusal about the sign-in as the access, and any other as the error', () => {
  const actor = started();
  actor.send({ type: 'pr.REFRESH_STATUS' });

  answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.ERROR', message: 'Sign in to GitHub.', reason: 'signed-out' });
  expect(context(actor)).toMatchObject({ githubAccess: 'signed-out', githubAccessMessage: 'Sign in to GitHub.', prError: null });

  actor.send({ type: 'pr.REFRESH_STATUS' });
  answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.ERROR', message: 'GitHub takes more at 10:00.', reason: 'rate-limited' });
  expect(context(actor)).toMatchObject({ prError: 'GitHub takes more at 10:00.', branchPRCheckFailed: true, isCheckingBranchPR: false });
});

it("offers a branch for deletion only where it is the checkout's remote's and no other open pull request is from it", () => {
  expect(branchDeletable(pr(7))).toBe(true);
  expect(branchDeletable(pr(7, { headInRemote: false })), "another repository's").toBe(false);
  expect(branchDeletable(pr(7, { isCrossRepository: true })), "a fork's, the checkout being of that fork").toBe(true);
  expect(branchDeletable(pr(7, { openFromSameHead: [8] }))).toBe(false);
  expect(branchDeletable(pr(7, { state: 'OPEN' }))).toBe(false);
  expect(branchDeletable(pr(7, { openFromSameHead: undefined })), 'not read: the backend asks before it deletes').toBe(true);
});

it("deletes a branch by its pull request's number, and sends nothing for another repository's", () => {
  const actor = started();
  pick(actor, pr(7, { headInRemote: false }));
  actor.send({ type: 'pr.DELETE_BRANCH' });
  expect(asked('pr.DELETE_BRANCH')).toEqual([]);

  pick(actor, pr(9));
  actor.send({ type: 'pr.DELETE_BRANCH' });
  expect(asked('pr.DELETE_BRANCH').map(([, event]) => event)).toEqual([{ type: 'pr.DELETE_BRANCH', number: 9 }]);
});

it('starts the next edit from the description just saved', () => {
  const actor = started();
  pick(actor, pr(7, { state: 'OPEN' }));
  actor.send({ type: 'pr.UPDATE_PR', number: 7, body: 'saved' });
  answer(actor, 'pr.UPDATE_PR', { type: 'pr.PR_UPDATED', data: { number: 7, body: 'saved' } });

  expect(context(actor).selectedPR).toMatchObject({ body: 'saved', rawBody: 'saved' });
});

const listed = (prs: GhPullRequest[], next: string | null) => ({ type: 'pr.PRS_LISTED', data: { prs, next } });

it('reads the list when it is opened, a page at a time, each pull request once', () => {
  const actor = started();
  actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
  expect(asked('pr.LIST_PRS'), 'nobody sees the list while it is shut').toEqual([]);

  actor.send({ type: 'pr.LIST_SHOWN' });
  expect(asked('pr.LIST_PRS').map(([, event]) => event)).toEqual([{ type: 'pr.LIST_PRS', state: 'open' }]);
  answer(actor, 'pr.LIST_PRS', listed([pr(9), pr(8)], 'C1'));
  expect(context(actor).prList).toMatchObject({ next: 'C1', read: true, asked: null });

  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  expect(asked('pr.LIST_PRS'), 'one page at a time').toHaveLength(2);
  expect(asked('pr.LIST_PRS')[1]![1]).toEqual({ type: 'pr.LIST_PRS', state: 'open', after: 'C1' });
  // One opened between the two pages moved #8 onto the second
  answer(actor, 'pr.LIST_PRS', listed([pr(8), pr(7)], null));
  expect(context(actor).prList.prs.map(p => p.number)).toEqual([9, 8, 7]);

  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  expect(asked('pr.LIST_PRS'), 'none after the last').toHaveLength(2);
});

it("takes only the page asked for what the list shows: a filter or search changed drops the one before's", () => {
  const actor = started();
  actor.send({ type: 'pr.LIST_SHOWN' });
  answer(actor, 'pr.LIST_PRS', listed([pr(9)], 'C1'));
  actor.send({ type: 'pr.LOAD_MORE_PRS' });
  const more = sentCall(sendToSystem, 'pr.LIST_PRS', 1);

  actor.send({ type: 'pr.SET_LIST_STATE', state: 'merged' });
  expect(context(actor).prList).toMatchObject({ state: 'merged', prs: [], read: false });
  actor.send(answerTo(more, listed([pr(1)], null)) as never);
  expect(context(actor).prList.prs, "the open list's page is not the merged one's").toEqual([]);

  actor.send({ type: 'pr.SET_LIST_QUERY', query: '  flaky ' });
  expect(asked('pr.LIST_PRS').at(-1)![1]).toEqual({ type: 'pr.LIST_PRS', state: 'merged', query: 'flaky' });
  actor.send({ type: 'pr.SET_LIST_QUERY', query: 'flaky' });
  expect(asked('pr.LIST_PRS'), 'the same search is not asked again').toHaveLength(4);
  answer(actor, 'pr.LIST_PRS', listed([pr(3)], null));
  expect(context(actor).prList).toMatchObject({ state: 'merged', query: '  flaky ', prs: [{ number: 3 }], read: true });

  actor.send({ type: 'pr.SET_LIST_QUERY', query: 'other' });
  answer(actor, 'pr.LIST_PRS', { type: 'pr.ERROR', message: 'GitHub could not be reached' });
  expect(context(actor).prList.asked, 'a refused page is no longer being asked for').toBeNull();
});

it('merges the head shown, by its commit', () => {
  const actor = started();
  pick(actor, pr(7, { state: 'OPEN' }));
  actor.send({ type: 'pr.MERGE', method: 'squash' });
  expect(asked('pr.MERGE_PR')[0]![1]).toEqual({ type: 'pr.MERGE_PR', number: 7, method: 'squash', sha: 'sha-7' });
});

it('checks out an open pull request once at a time, and keeps what the checkout did', () => {
  const actor = started();
  pick(actor, pr(7));
  actor.send({ type: 'pr.CHECKOUT' });
  expect(asked('pr.CHECKOUT_PR'), 'a merged one is not checked out').toEqual([]);

  pick(actor, pr(8, { state: 'OPEN' }));
  actor.send({ type: 'pr.CHECKOUT' });
  actor.send({ type: 'pr.CHECKOUT' });
  expect(asked('pr.CHECKOUT_PR').map(([, event]) => event)).toEqual([{ type: 'pr.CHECKOUT_PR', number: 8 }]);
  expect(context(actor).isCheckingOut).toBe(true);

  answer(actor, 'pr.CHECKOUT_PR', { type: 'pr.PR_CHECKED_OUT', data: { number: 8, branch: 'pr/8', checkout: 'kept' } });
  expect(context(actor)).toMatchObject({ isCheckingOut: false, lastCheckout: { number: 8, branch: 'pr/8', checkout: 'kept' }, selectedPR: { number: 8 } });

  actor.send({ type: 'pr.CHECKOUT' });
  answer(actor, 'pr.CHECKOUT_PR', { type: 'pr.ERROR', message: 'Cannot switch branches' });
  expect(context(actor)).toMatchObject({ isCheckingOut: false, lastCheckout: null, prError: 'Cannot switch branches' });
});
