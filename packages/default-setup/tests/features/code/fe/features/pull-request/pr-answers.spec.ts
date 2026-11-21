// Which answers the pull request panel takes, and what each one ends: a read asked again stops waiting on the one
// before, an error ends only the ask or write it answers, and nothing of one folder or pull request is left on
// the next.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread } from '#generated/types.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
const parent = vi.hoisted(() => ({ baseDirectory: '/repo' as string | null, selectedPanel: 'pr' }));
const updateParentState = vi.hoisted(() => vi.fn());
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState,
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

const asked = (type: string) => asksOf(type).map(ask => ask.event);
const askOf = (type: string, nth?: number) => nth === undefined ? latestAsk(type) : asksOf(type)[nth]!;
/** The answer to the nth ask of `type` (the latest by default), as the code system's handler gives it */
const answer = (type: string, value: unknown, nth?: number) => askOf(type, nth).answer(value);
/** The refusal of the nth ask of `type` (the latest by default) */
const refuse = (type: string, message: string, nth?: number) => askOf(type, nth).refuse(message);
/** An error on the panel: a check of the GitHub access that could not be made */
const failing = async (actor: Actor, message: string) => {
  actor.send({ type: 'pr.CHECK_GITHUB_ACCESS' });
  await refuse('pr.CHECK_GITHUB_ACCESS', message);
};

const details = (which: GhPullRequest, comments: GhPRComment[] = [], fetchedAt = Date.now()) =>
  ({ pr: which, comments, fetchedAt });

/** The user picks `which` from the list, and its details arrive */
const pick = async (actor: Actor, which: GhPullRequest, comments: GhPRComment[] = []) => {
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  await answer('pr.SELECT_PR', details(which, comments));
};

/** The branch's own pull request, found by the status check */
const onBranchPR = async (actor: Actor, which: GhPullRequest | null) => {
  actor.send({ type: 'pr.REFRESH_STATUS' });
  await answer('pr.CHECK_BRANCH_PR', { pr: which });
};

beforeEach(() => {
  tell.mockReset();
  updateParentState.mockReset();
  resetAsks();
  parent.baseDirectory = '/repo';
  parent.selectedPanel = 'pr';
});

describe('a read asked again', () => {
  it('takes the details of the pull request picked last, not an earlier pick answered late', async () => {
    const actor = started();
    actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 3 });
    actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 9 });

    expect(asksOf('pr.SELECT_PR')[0]!.stopped, 'the first pick is no longer waited on').toBe(true);
    await answer('pr.SELECT_PR', details(pr(3)), 0);
    expect(context(actor).selectedPR).toBeNull();

    await answer('pr.SELECT_PR', details(pr(9)), 1);
    expect(context(actor).selectedPR?.number).toBe(9);
  });

  it('takes the review threads of the latest ask, not an earlier one answered late', async () => {
    const actor = started();
    await pick(actor, pr(1));
    actor.send({ type: 'pr.REFRESH_PR', number: 1 });
    await answer('pr.SELECT_PR', details(pr(1), [], Date.now() + 1));

    await answer('pr.GET_REVIEW_THREADS', { threads: [thread('new')] }, 1);
    await answer('pr.GET_REVIEW_THREADS', { threads: [thread('old')] }, 0);

    expect(context(actor).reviewThreads.map(t => t.id)).toEqual(['new']);
  });

  it('takes the base of the latest ask, not an earlier one answered late', async () => {
    const actor = started();
    await onBranchPR(actor, null);
    await onBranchPR(actor, null);

    await answer('pr.GET_SMART_BASE_BRANCH', { branch: 'develop' }, 1);
    await answer('pr.GET_SMART_BASE_BRANCH', { branch: 'main' }, 0);

    expect(context(actor).prBaseBranch).toBe('develop');
  });
});

describe('an error ends the ask or write it answers, and no other', () => {
  it('leaves a merge running when the review threads fail', async () => {
    const actor = started();
    await pick(actor, pr(1));
    actor.send({ type: 'pr.MERGE', method: 'squash' });

    await refuse('pr.GET_REVIEW_THREADS', 'threads failed');

    expect(context(actor).isMerging).toBe(true);
    expect(context(actor).prError).toBe('threads failed');
  });

  it('ends the merge it answers and leaves the details being read', async () => {
    const actor = started();
    await pick(actor, pr(1));
    actor.send({ type: 'pr.MERGE' });
    actor.send({ type: 'pr.REFRESH_PR', number: 1 });

    await refuse('pr.MERGE_PR', 'not mergeable');

    expect(context(actor).isMerging).toBe(false);
    expect(actor.getSnapshot().context.making.details).toBe(true);
  });
});

describe('a comment write', () => {
  /**
   * Each write keeps what it changed under the id its ask runs as, and the list shown is GitHub's with every unanswered
   * change laid over it: one write answered, or failed, leaves every other one shown.
   */
  it('rolls back only itself, after another write was answered and the list read again', async () => {
    const actor = started();
    await pick(actor, pr(1), [comment(1), comment(2)]);
    actor.send({ type: 'pr.CREATE_COMMENT', number: 1, body: 'new one' });
    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    await answer('pr.EDIT_COMMENT', { commentId: 2 });
    await answer('pr.GET_COMMENTS', { number: 1, comments: [comment(1), comment(2, 'edited')] });
    expect(context(actor).prComments.map(c => c.body), 'the unanswered comment is still shown')
      .toEqual(['comment 1', 'edited', 'new one']);

    await refuse('pr.CREATE_COMMENT', 'refused');
    expect(context(actor).prComments.map(c => c.body)).toEqual(['comment 1', 'edited']);
    expect(context(actor).inflightMutations).toBe(0);
  });

  it('keeps an earlier change shown when a later one fails', async () => {
    const actor = started();
    await pick(actor, pr(1), [comment(1), comment(2)]);
    actor.send({ type: 'pr.DELETE_COMMENT', commentId: 1 });
    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    await refuse('pr.EDIT_COMMENT', 'refused');

    expect(context(actor).prComments.map(c => c.body)).toEqual(['comment 2']);
  });

  it('says how it was answered, so the form that sent it keeps what was typed until it is taken', async () => {
    const actor = started();
    await pick(actor, pr(1), [comment(2)]);
    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    await refuse('pr.EDIT_COMMENT', 'refused');
    expect(context(actor).lastWriteAnswer).toEqual({ write: 'edit-comment', target: 2, ok: false });

    actor.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });
    await answer('pr.EDIT_COMMENT', { commentId: 2 });
    expect(context(actor).lastWriteAnswer).toEqual({ write: 'edit-comment', target: 2, ok: true });
  });
});

describe('changing pull request', () => {
  it("drops the last one's discussion and threads", async () => {
    const actor = started();
    await onBranchPR(actor, pr(3));
    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });
    await answer('pr.SELECT_PR', details(pr(3), [comment(1)]));
    await answer('pr.GET_REVIEW_THREADS', { threads: [thread('t3')] });

    // The branch moved to another pull request
    actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
    await answer('pr.CHECK_BRANCH_PR', { pr: pr(9) });

    expect(context(actor).prComments).toEqual([]);
    expect(context(actor).reviewThreads).toEqual([]);
  });

  it("reads the discussion on View when the one held is another pull request's", async () => {
    const actor = started();
    await pick(actor, pr(3), [comment(1)]);
    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'files' });
    await onBranchPR(actor, null);
    actor.send({ type: 'pr.BACK_TO_BRANCH' });
    await answer('pr.CHECK_BRANCH_PR', { pr: pr(9) });
    resetAsks();

    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });

    expect(asked('pr.SELECT_PR')).toEqual([{ type: 'pr.SELECT_PR', number: 9 }]);
  });

  it('does not read the discussion again on View when it is held', async () => {
    const actor = started();
    await pick(actor, pr(3));
    resetAsks();

    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });

    expect(asked('pr.SELECT_PR')).toEqual([]);
  });
});

describe('merging or closing a pull request picked from the list', () => {
  it.each([
    ['pr.MERGE', 'pr.MERGE_PR', 'MERGED'],
    ['pr.CLOSE', 'pr.CLOSE_PR', 'CLOSED'],
  ] as const)('keeps it shown after %s, rather than the branch\'s own', async (send, ask, state) => {
    const actor = started();
    await onBranchPR(actor, pr(5));
    await pick(actor, pr(7));

    actor.send({ type: send });
    await answer(ask, { number: 7 });
    await answer('pr.CHECK_BRANCH_PR', { pr: pr(5) });

    expect(context(actor).selectedPR).toMatchObject({ number: 7, state });
  });
});

describe('another folder', () => {
  it('keeps nothing of the last one, so its branch pull request is shown once checked', async () => {
    const actor = started();
    await pick(actor, pr(7), [comment(1)]);
    actor.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });
    actor.send({ type: 'pr.UPDATE_CREATE_FIELD', field: 'title', value: 'half typed' });
    actor.send({ type: 'pr.CREATE_COMMENT', number: 7, body: 'pending' });
    await failing(actor, 'boom');

    actor.send({ type: 'CODE_STARTED' });

    expect(context(actor)).toMatchObject({
      selectedPR: null,
      isManualPRSelection: false,
      viewMode: 'files',
      prError: null,
      createTitle: '',
      prComments: [],
      reviewThreads: [],
      prList: expect.objectContaining({ prs: [], read: false }),
      inflightMutations: 0,
      writes: {},
    });
    expect(actor.getSnapshot().context.making.details, 'and its details are no longer waited on').toBe(false);

    await onBranchPR(actor, pr(11));
    expect(context(actor).selectedPR?.number).toBe(11);
  });

  it('takes no answer to an ask made for the last one', async () => {
    const actor = started();
    actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 7 });
    actor.send({ type: 'CODE_STARTED' });

    await answer('pr.SELECT_PR', details(pr(7)), 0);

    expect(context(actor).selectedPR).toBeNull();
  });
});

describe('an error message', () => {
  it('is cleared when another folder opens', async () => {
    const actor = started();
    // Hidden, so no refresh follows the folder to clear it instead
    parent.selectedPanel = 'explorer';
    await failing(actor, 'No directory selected.');
    actor.send({ type: 'CODE_STARTED' });
    expect(context(actor).prError).toBeNull();
  });

  it('is cleared on refresh', async () => {
    const actor = started();
    await failing(actor, 'failed');
    actor.send({ type: 'pr.REFRESH_STATUS' });
    expect(context(actor).prError).toBeNull();
  });
});

describe('the repository moving', () => {
  it('asks GitHub nothing while the panel is hidden, and asks when it is shown', async () => {
    const actor = started();
    parent.selectedPanel = 'commit';

    actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });

    expect(asked('pr.CHECK_BRANCH_PR')).toEqual([]);
    expect(context(actor).isCheckingBranchPR).toBe(false);

    // Selecting the panel is what sends this
    parent.selectedPanel = 'pr';
    actor.send({ type: 'pr.REFRESH_STATUS' });
    expect(asked('pr.CHECK_BRANCH_PR')).toHaveLength(1);
    expect(context(actor).isCheckingBranchPR, 'what was checked is stale').toBe(true);
  });

  it('asks GitHub again while the panel is shown', async () => {
    const actor = started();
    actor.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
    expect(asked('pr.CHECK_BRANCH_PR')).toHaveLength(1);
  });

  it('asks nothing of a folder opened while the panel is hidden', async () => {
    const actor = started();
    parent.selectedPanel = 'explorer';
    actor.send({ type: 'CODE_STARTED' });
    expect(asked('pr.CHECK_BRANCH_PR')).toEqual([]);
  });
});

describe('"Checkout & Pull Base"', () => {
  it('asks for the pull, since a checkout pulls nothing by itself', async () => {
    const actor = started();
    await pick(actor, pr(7, { baseRefName: 'develop' }));

    actor.send({ type: 'pr.CHECKOUT_BASE' });

    expect(asked('commit.CHECKOUT_BRANCH')).toEqual([{ type: 'commit.CHECKOUT_BRANCH', branchName: 'develop', pull: true }]);
  });

  it('shows why the base was not checked out, on the panel that asked', async () => {
    const actor = started();
    await pick(actor, pr(7, { baseRefName: 'develop' }));
    actor.send({ type: 'pr.CHECKOUT_BASE' });

    await refuse('commit.CHECKOUT_BRANCH', 'Your local changes would be overwritten by checkout');

    expect(context(actor).prError).toBe('Your local changes would be overwritten by checkout');
    expect(updateParentState, 'the commit panel is not shown for a checkout that did not happen').not.toHaveBeenCalled();
  });
});
