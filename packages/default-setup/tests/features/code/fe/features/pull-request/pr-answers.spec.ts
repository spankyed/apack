// Which answers the pull request panel takes, and what each one ends: an answer is taken only for the ask it
// answers, an error ends only the ask or write it answers, and nothing of one folder or pull request is left on
// the next.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread } from '#generated/types.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
const parent = vi.hoisted(() => ({ baseDirectory: '/repo' as string | null, selectedPanel: 'pr' }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  getParentContext: vi.fn(() => parent),
  sendEventToParent: vi.fn(),
}));

const { pullRequestState } = await import('#features/code/fe/features/pull-request/state.ts');

type Actor = ReturnType<typeof started>;
const started = () => createActor(pullRequestState).start();
const context = (actor: Actor) => actor.getSnapshot().context;

const pr = (number: number, extra: Partial<GhPullRequest> = {}) =>
  ({ number, baseRefName: 'main', headRefName: `feature-${number}`, state: 'OPEN', isDraft: false, updatedAt: 't', ...extra }) as unknown as GhPullRequest;
const comment = (id: number, body = `comment ${id}`) =>
  ({ id: `IC_${id}`, url: `https://github.com/o/r/pull/1#issuecomment-${id}`, body, author: { login: 'me' }, createdAt: '', viewerDidAuthor: true }) as GhPRComment;
const thread = (id: string, resolved = false) =>
  ({ id, isResolved: resolved, isOutdated: false, path: 'a.ts', line: 1, comments: [{ id: `RC_${id}`, databaseId: 100, body: 'x', author: { login: 'me' }, createdAt: '', viewerDidAuthor: true }] }) as GhReviewThread;

const asked = (type: string) => sendToSystem.mock.calls.filter(([, event]) => (event as { type: string }).type === type);
const callOf = (type: string, nth = asked(type).length - 1) => sentCall(sendToSystem, type, nth);
/** The answer to the nth ask of `type` (the latest by default), as the backend's `reply` delivers it */
const answer = <E extends { type: string }>(actor: Actor, type: string, event: E, nth?: number) =>
  actor.send(answerTo(callOf(type, nth), event) as never);

const details = (which: GhPullRequest, comments: GhPRComment[] = [], fetchedAt = Date.now()) =>
  ({ type: 'pr.PR_DETAILS_RECEIVED' as const, data: { pr: which, comments, fetchedAt } });

/** The user picks `which` from the list, and its details arrive */
const pick = (actor: Actor, which: GhPullRequest, comments: GhPRComment[] = []) => {
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  answer(actor, 'pr.SELECT_PR', details(which, comments));
};

/** The branch's own pull request, found by the status check */
const onBranchPR = (actor: Actor, which: GhPullRequest | null) => {
  actor.send({ type: 'pr.REFRESH_STATUS' });
  answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.BRANCH_PR_CHECKED', data: { pr: which } });
};

beforeEach(() => {
  sendToSystem.mockReset();
  parent.baseDirectory = '/repo';
  parent.selectedPanel = 'pr';
});

describe('an answer is taken for the ask it answers', () => {
  it('takes the details of the pull request picked last, not an earlier pick answered late', () => {
    const actor = started();
    actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 3 });
    actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 9 });

    answer(actor, 'pr.SELECT_PR', details(pr(3)), 0);
    expect(context(actor).selectedPR).toBeNull();

    answer(actor, 'pr.SELECT_PR', details(pr(9)), 1);
    expect(context(actor).selectedPR?.number).toBe(9);
  });

  it('takes the review threads of the latest ask, not an earlier one answered late', () => {
    const actor = started();
    pick(actor, pr(1));
    actor.send({ type: 'pr.REFRESH_PR', number: 1 });
    answer(actor, 'pr.SELECT_PR', details(pr(1), [], Date.now() + 1));

    answer(actor, 'pr.GET_REVIEW_THREADS', { type: 'pr.REVIEW_THREADS_RECEIVED', data: { threads: [thread('new')] } }, 1);
    answer(actor, 'pr.GET_REVIEW_THREADS', { type: 'pr.REVIEW_THREADS_RECEIVED', data: { threads: [thread('old')] } }, 0);

    expect(context(actor).reviewThreads.map(t => t.id)).toEqual(['new']);
  });

  it('takes the base of the latest ask, not an earlier one answered late', () => {
    const actor = started();
    onBranchPR(actor, null);
    onBranchPR(actor, null);

    answer(actor, 'pr.GET_SMART_BASE_BRANCH', { type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch: 'develop' } }, 1);
    answer(actor, 'pr.GET_SMART_BASE_BRANCH', { type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch: 'main' } }, 0);

    expect(context(actor).prBaseBranch).toBe('develop');
  });
});

describe('an error ends the ask or write it answers, and no other', () => {
  it('leaves a merge running when the review threads fail', () => {
    const actor = started();
    pick(actor, pr(1));
    actor.send({ type: 'pr.MERGE', method: 'squash' });

    answer(actor, 'pr.GET_REVIEW_THREADS', { type: 'pr.ERROR', message: 'threads failed' });

    expect(context(actor).isMerging).toBe(true);
    expect(context(actor).prError).toBe('threads failed');
  });

  it('ends the merge it answers and leaves the details being read', () => {
    const actor = started();
    pick(actor, pr(1));
    actor.send({ type: 'pr.MERGE' });
    actor.send({ type: 'pr.REFRESH_PR', number: 1 });

    answer(actor, 'pr.MERGE_PR', { type: 'pr.ERROR', message: 'not mergeable' });

    expect(context(actor).isMerging).toBe(false);
    expect(context(actor).isLoadingDetails).toBe(true);
  });

  it('shows an error that answers nothing outstanding', () => {
    const actor = started();
    actor.send({ type: 'pr.ERROR', message: 'late' });
    expect(context(actor).prError).toBe('late');
  });
});

describe('a comment write', () => {
  /**
   * Each write keeps what it changed under its call, and the list shown is GitHub's with every unanswered
   * change laid over it: one write answered, or failed, leaves every other one shown.
   */
  it('rolls back only itself, after another write was answered and the list read again', () => {
    const actor = started();
    pick(actor, pr(1), [comment(1), comment(2)]);
    actor.send({ type: 'pr.CREATE_COMMENT', number: 1, body: 'new one' });
    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    answer(actor, 'pr.EDIT_COMMENT', { type: 'pr.COMMENT_EDITED', data: { commentId: 2 } });
    answer(actor, 'pr.GET_COMMENTS', { type: 'pr.COMMENTS_RECEIVED', data: { number: 1, comments: [comment(1), comment(2, 'edited')] } });
    expect(context(actor).prComments.map(c => c.body), 'the unanswered comment is still shown')
      .toEqual(['comment 1', 'edited', 'new one']);

    answer(actor, 'pr.CREATE_COMMENT', { type: 'pr.ERROR', message: 'refused' });
    expect(context(actor).prComments.map(c => c.body)).toEqual(['comment 1', 'edited']);
    expect(context(actor).inflightMutations).toBe(0);
  });

  it('keeps an earlier change shown when a later one fails', () => {
    const actor = started();
    pick(actor, pr(1), [comment(1), comment(2)]);
    actor.send({ type: 'pr.DELETE_COMMENT', commentId: 1 });
    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    answer(actor, 'pr.EDIT_COMMENT', { type: 'pr.ERROR', message: 'refused' });

    expect(context(actor).prComments.map(c => c.body)).toEqual(['comment 2']);
  });

  it('says how it was answered, so the form that sent it keeps what was typed until it is taken', () => {
    const actor = started();
    pick(actor, pr(1), [comment(2)]);
    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    answer(actor, 'pr.EDIT_COMMENT', { type: 'pr.ERROR', message: 'refused' });
    expect(context(actor).lastWriteAnswer).toEqual({ write: 'edit-comment', target: 2, ok: false });

    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });
    answer(actor, 'pr.EDIT_COMMENT', { type: 'pr.COMMENT_EDITED', data: { commentId: 2 } });
    expect(context(actor).lastWriteAnswer).toEqual({ write: 'edit-comment', target: 2, ok: true });
  });
});

describe('changing pull request', () => {
  it("drops the last one's discussion and threads", () => {
    const actor = started();
    onBranchPR(actor, pr(3));
    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });
    answer(actor, 'pr.SELECT_PR', details(pr(3), [comment(1)]));
    answer(actor, 'pr.GET_REVIEW_THREADS', { type: 'pr.REVIEW_THREADS_RECEIVED', data: { threads: [thread('t3')] } });

    // The branch moved to another pull request
    actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
    answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.BRANCH_PR_CHECKED', data: { pr: pr(9) } });

    expect(context(actor).prComments).toEqual([]);
    expect(context(actor).reviewThreads).toEqual([]);
  });

  it("reads the discussion on View when the one held is another pull request's", () => {
    const actor = started();
    pick(actor, pr(3), [comment(1)]);
    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'files' });
    onBranchPR(actor, null);
    actor.send({ type: 'pr.BACK_TO_BRANCH' });
    answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.BRANCH_PR_CHECKED', data: { pr: pr(9) } });
    sendToSystem.mockReset();

    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });

    expect(asked('pr.SELECT_PR').map(([, event]) => event)).toEqual([{ type: 'pr.SELECT_PR', number: 9 }]);
  });

  it('does not read the discussion again on View when it is held', () => {
    const actor = started();
    pick(actor, pr(3));
    sendToSystem.mockReset();

    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });

    expect(asked('pr.SELECT_PR')).toEqual([]);
  });
});

describe('merging or closing a pull request picked from the list', () => {
  it.each([
    ['pr.MERGE', 'pr.MERGE_PR', 'pr.PR_MERGED', 'MERGED'],
    ['pr.CLOSE', 'pr.CLOSE_PR', 'pr.PR_CLOSED', 'CLOSED'],
  ] as const)('keeps it shown after %s, rather than the branch\'s own', (send, ask, answered, state) => {
    const actor = started();
    onBranchPR(actor, pr(5));
    pick(actor, pr(7));

    actor.send({ type: send });
    answer(actor, ask, { type: answered, data: { number: 7 } });
    answer(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.BRANCH_PR_CHECKED', data: { pr: pr(5) } });

    expect(context(actor).selectedPR).toMatchObject({ number: 7, state });
  });
});

describe('another folder', () => {
  it('keeps nothing of the last one, so its branch pull request is shown once checked', () => {
    const actor = started();
    pick(actor, pr(7), [comment(1)]);
    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });
    actor.send({ type: 'pr.UPDATE_CREATE_FIELD', field: 'title', value: 'half typed' });
    actor.send({ type: 'pr.CREATE_COMMENT', number: 7, body: 'pending' });
    actor.send({ type: 'pr.ERROR', message: 'boom' });

    actor.send({ type: 'CODE_STARTED' });

    expect(context(actor)).toMatchObject({
      selectedPR: null,
      isManualPRSelection: false,
      viewMode: 'files',
      prError: null,
      createTitle: '',
      prComments: [],
      reviewThreads: [],
      openPRs: [],
      inflightMutations: 0,
      writes: {},
    });
    expect(context(actor).asks.details).toBeNull();

    onBranchPR(actor, pr(11));
    expect(context(actor).selectedPR?.number).toBe(11);
  });

  it('takes no answer to an ask made for the last one', () => {
    const actor = started();
    actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 7 });
    actor.send({ type: 'CODE_STARTED' });

    answer(actor, 'pr.SELECT_PR', details(pr(7)), 0);

    expect(context(actor).selectedPR).toBeNull();
  });
});

describe('an error message', () => {
  it('is cleared when another folder opens', () => {
    const actor = started();
    // Hidden, so no refresh follows the folder to clear it instead
    parent.selectedPanel = 'explorer';
    actor.send({ type: 'pr.ERROR', message: 'No directory selected.' });
    actor.send({ type: 'CODE_STARTED' });
    expect(context(actor).prError).toBeNull();
  });

  it('is cleared on refresh', () => {
    const actor = started();
    actor.send({ type: 'pr.ERROR', message: 'failed' });
    actor.send({ type: 'pr.REFRESH_STATUS' });
    expect(context(actor).prError).toBeNull();
  });
});

describe('the repository moving', () => {
  it('asks GitHub nothing while the panel is hidden, and asks when it is shown', () => {
    const actor = started();
    parent.selectedPanel = 'commit';

    actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });

    expect(asked('pr.LIST_OPEN_PRS')).toEqual([]);
    expect(asked('pr.CHECK_BRANCH_PR')).toEqual([]);
    expect(context(actor).isCheckingBranchPR).toBe(false);

    // Selecting the panel is what sends this
    parent.selectedPanel = 'pr';
    actor.send({ type: 'pr.REFRESH_STATUS' });
    expect(asked('pr.CHECK_BRANCH_PR')).toHaveLength(1);
    expect(context(actor).isCheckingBranchPR, 'what was checked is stale').toBe(true);
  });

  it('asks GitHub again while the panel is shown', () => {
    const actor = started();
    actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
    expect(asked('pr.LIST_OPEN_PRS')).toHaveLength(1);
    expect(asked('pr.CHECK_BRANCH_PR')).toHaveLength(1);
  });

  it('asks nothing of a folder opened while the panel is hidden', () => {
    const actor = started();
    parent.selectedPanel = 'explorer';
    actor.send({ type: 'CODE_STARTED' });
    expect(asked('pr.CHECK_BRANCH_PR')).toEqual([]);
  });
});

describe('"Checkout & Pull Base"', () => {
  it('asks for the pull, since a checkout pulls nothing by itself', () => {
    const actor = started();
    pick(actor, pr(7, { baseRefName: 'develop' }));

    actor.send({ type: 'pr.CHECKOUT_BASE' });

    expect(asked('commit.CHECKOUT_BRANCH').at(-1)?.[1]).toEqual({ type: 'commit.CHECKOUT_BRANCH', branchName: 'develop', pull: true });
  });
});
