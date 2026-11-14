// What the pull request panel does with what GitHub said: a refusal about the sign-in or the repository is shown as
// the access, not as an error banner; a branch is offered for deletion only where it is this repository's and no
// other open pull request is from it, and is deleted by its pull request's number; and a saved description is
// what the next edit starts from.
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
  ({ number, baseRefName: 'main', headRefName: 'feature', isCrossRepository: false, state: 'MERGED', isDraft: false, updatedAt: 't', body: 'shown', rawBody: 'written', ...extra }) as unknown as GhPullRequest;

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

  answer(actor, 'pr.LIST_OPEN_PRS', { type: 'pr.ERROR', message: 'Sign in to GitHub.', reason: 'signed-out' });
  expect(context(actor)).toMatchObject({ githubAccess: 'signed-out', githubAccessMessage: 'Sign in to GitHub.', prError: null });

  answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.ERROR', message: 'GitHub takes more at 10:00.', reason: 'rate-limited' });
  expect(context(actor)).toMatchObject({ prError: 'GitHub takes more at 10:00.', branchPRCheckFailed: true, isCheckingBranchPR: false });
});

it("offers a branch for deletion only where it is this repository's and no other open pull request is from it", () => {
  expect(branchDeletable(pr(7), [])).toBe(true);
  expect(branchDeletable(pr(7, { isCrossRepository: true }), [])).toBe(false);
  expect(branchDeletable(pr(7), [pr(8, { state: 'OPEN' })])).toBe(false);
  expect(branchDeletable(pr(7), [pr(8, { state: 'OPEN', isCrossRepository: true })]), "a fork's branch of the same name is another branch").toBe(true);
});

it("deletes a branch by its pull request's number, and sends nothing for a fork's", () => {
  const actor = started();
  pick(actor, pr(7, { isCrossRepository: true }));
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
