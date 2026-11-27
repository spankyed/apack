// Which answers the pull request panel takes, and what each one ends: a read asked again stops waiting on the one
// before, an error ends only the ask or write it answers, and nothing of one folder or pull request is left on
// the next.
import { afterEach, describe, expect, it } from 'vitest';
import type { GhPullRequest, GhPRComment, GhReviewThread } from '#generated/types.ts';
import { pullRequestState } from '#features/code/fe/features/pull-request/state.ts';
import { startMachine } from '../../_support/asks.ts';

const PR_REPORTS = ['PR_OPEN_DIFF_TAB', 'PR_OPEN_FILE', 'PR_SELECT_PANEL'] as const;

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const started = (isPanelShown = true) => {
  const h = startMachine(pullRequestState, { reports: PR_REPORTS });
  running.push(h);
  h.send({ type: 'SYNC_BASE_DIRECTORY', baseDirectory: '/repo' });
  h.send({ type: 'SYNC_PANEL_SHOWN', isPanelShown });
  return h;
};
type Harness = ReturnType<typeof started>;
const dataOf = (h: Harness) => h.read().data;

const pr = (number: number, extra: Partial<GhPullRequest> = {}) =>
  ({ number, baseRefName: 'main', headRefName: `feature-${number}`, state: 'OPEN', isDraft: false, updatedAt: 't', ...extra }) as unknown as GhPullRequest;
const comment = (id: number, body = `comment ${id}`) =>
  ({ id: `IC_${id}`, url: `https://github.com/o/r/pull/1#issuecomment-${id}`, body, author: { login: 'me' }, createdAt: '', viewerDidAuthor: true }) as GhPRComment;
const thread = (id: string, resolved = false) =>
  ({ id, isResolved: resolved, isOutdated: false, path: 'a.ts', line: 1, comments: [{ id: `RC_${id}`, databaseId: 100, body: 'x', author: { login: 'me' }, createdAt: '', viewerDidAuthor: true }] }) as GhReviewThread;

const asked = (h: Harness, type: string) => h.asksOf(type).map((ask) => ask.event);
const askOf = (h: Harness, type: string, nth?: number) => (nth === undefined ? h.latestAsk(type) : h.asksOf(type)[nth]!);
const answer = (h: Harness, type: string, value: unknown, nth?: number) => askOf(h, type, nth).answer(value);
const refuse = (h: Harness, type: string, message: string, nth?: number) => askOf(h, type, nth).refuse(message);

const failing = async (h: Harness, message: string) => {
  h.send({ type: 'pr.CHECK_GITHUB_ACCESS' });
  await refuse(h, 'pr.CHECK_GITHUB_ACCESS', message);
};

const details = (which: GhPullRequest, comments: GhPRComment[] = [], fetchedAt = Date.now()) =>
  ({ pr: which, comments, fetchedAt });

const pick = async (h: Harness, which: GhPullRequest, comments: GhPRComment[] = []) => {
  h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  await answer(h, 'pr.SELECT_PR', details(which, comments));
};

const onBranchPR = async (h: Harness, which: GhPullRequest | null) => {
  h.send({ type: 'pr.REFRESH_STATUS' });
  await answer(h, 'pr.CHECK_BRANCH_PR', { pr: which });
};

describe('a read asked again', () => {
  it('takes the details of the pull request picked last, not an earlier pick answered late', async () => {
    const h = started();
    h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 3 });
    h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 9 });

    expect(h.asksOf('pr.SELECT_PR')[0]!.stopped, 'the first pick is no longer waited on').toBe(true);
    await answer(h, 'pr.SELECT_PR', details(pr(3)), 0);
    expect(dataOf(h).selectedPR).toBeNull();

    await answer(h, 'pr.SELECT_PR', details(pr(9)), 1);
    expect(dataOf(h).selectedPR?.number).toBe(9);
  });

  it('takes the review threads of the latest ask, not an earlier one answered late', async () => {
    const h = started();
    await pick(h, pr(1));
    h.send({ type: 'pr.REFRESH_PR', number: 1 });
    await answer(h, 'pr.SELECT_PR', details(pr(1), [], Date.now() + 1));

    await answer(h, 'pr.GET_REVIEW_THREADS', { threads: [thread('new')] }, 1);
    await answer(h, 'pr.GET_REVIEW_THREADS', { threads: [thread('old')] }, 0);

    expect(dataOf(h).reviewThreads.map((t) => t.id)).toEqual(['new']);
  });

  it('takes the base of the latest ask, not an earlier one answered late', async () => {
    const h = started();
    await onBranchPR(h, null);
    await onBranchPR(h, null);

    await answer(h, 'pr.GET_SMART_BASE_BRANCH', { branch: 'develop' }, 1);
    await answer(h, 'pr.GET_SMART_BASE_BRANCH', { branch: 'main' }, 0);

    expect(dataOf(h).prBaseBranch).toBe('develop');
  });
});

describe('an error ends the ask or write it answers, and no other', () => {
  it('leaves a merge running when the review threads fail', async () => {
    const h = started();
    await pick(h, pr(1));
    h.send({ type: 'pr.MERGE', method: 'squash' });

    await refuse(h, 'pr.GET_REVIEW_THREADS', 'threads failed');

    expect(dataOf(h).isMerging).toBe(true);
    expect(dataOf(h).prError).toBe('threads failed');
  });

  it('ends the merge it answers and leaves the details being read', async () => {
    const h = started();
    await pick(h, pr(1));
    h.send({ type: 'pr.MERGE' });
    h.send({ type: 'pr.REFRESH_PR', number: 1 });

    await refuse(h, 'pr.MERGE_PR', 'not mergeable');

    expect(dataOf(h).isMerging).toBe(false);
    expect(h.read().pending.details).toBe(true);
  });
});

describe('a comment write', () => {
  it('rolls back only itself, after another write was answered and the list read again', async () => {
    const h = started();
    await pick(h, pr(1), [comment(1), comment(2)]);
    h.send({ type: 'pr.CREATE_COMMENT', number: 1, body: 'new one' });
    h.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    await answer(h, 'pr.EDIT_COMMENT', { commentId: 2 });
    await answer(h, 'pr.GET_COMMENTS', { number: 1, comments: [comment(1), comment(2, 'edited')] });
    expect(dataOf(h).prComments.map((c) => c.body), 'the unanswered comment is still shown')
      .toEqual(['comment 1', 'edited', 'new one']);

    await refuse(h, 'pr.CREATE_COMMENT', 'refused');
    expect(dataOf(h).prComments.map((c) => c.body)).toEqual(['comment 1', 'edited']);
    expect(dataOf(h).inflightMutations).toBe(0);
  });

  it('keeps an earlier change shown when a later one fails', async () => {
    const h = started();
    await pick(h, pr(1), [comment(1), comment(2)]);
    h.send({ type: 'pr.DELETE_COMMENT', commentId: 1 });
    h.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    await refuse(h, 'pr.EDIT_COMMENT', 'refused');

    expect(dataOf(h).prComments.map((c) => c.body)).toEqual(['comment 2']);
  });

  it('says how it was answered, so the form that sent it keeps what was typed until it is taken', async () => {
    const h = started();
    await pick(h, pr(1), [comment(2)]);
    h.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });

    await refuse(h, 'pr.EDIT_COMMENT', 'refused');
    expect(dataOf(h).lastWriteAnswer).toEqual({ write: 'edit-comment', target: 2, ok: false });

    h.send({ type: 'pr.EDIT_COMMENT', commentId: 2, body: 'edited' });
    await answer(h, 'pr.EDIT_COMMENT', { commentId: 2 });
    expect(dataOf(h).lastWriteAnswer).toEqual({ write: 'edit-comment', target: 2, ok: true });
  });
});

describe('changing pull request', () => {
  it("drops the last one's discussion and threads", async () => {
    const h = started();
    await onBranchPR(h, pr(3));
    h.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });
    await answer(h, 'pr.SELECT_PR', details(pr(3), [comment(1)]));
    await answer(h, 'pr.GET_REVIEW_THREADS', { threads: [thread('t3')] });

    // The branch moved to another pull request
    h.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
    await answer(h, 'pr.CHECK_BRANCH_PR', { pr: pr(9) });

    expect(dataOf(h).prComments).toEqual([]);
    expect(dataOf(h).reviewThreads).toEqual([]);
  });

  it("reads the discussion on View when the one held is another pull request's", async () => {
    const h = started();
    await pick(h, pr(3), [comment(1)]);
    h.send({ type: 'pr.SET_VIEW_MODE', mode: 'files' });
    await onBranchPR(h, null);
    h.send({ type: 'pr.BACK_TO_BRANCH' });
    await answer(h, 'pr.CHECK_BRANCH_PR', { pr: pr(9) });
    h.reset();

    h.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });

    expect(asked(h, 'pr.SELECT_PR')).toEqual([{ type: 'pr.SELECT_PR', number: 9 }]);
  });

  it('does not read the discussion again on View when it is held', async () => {
    const h = started();
    await pick(h, pr(3));
    h.reset();

    h.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });

    expect(asked(h, 'pr.SELECT_PR')).toEqual([]);
  });
});

describe('merging or closing a pull request picked from the list', () => {
  it.each([
    ['pr.MERGE', 'pr.MERGE_PR', 'MERGED'],
    ['pr.CLOSE', 'pr.CLOSE_PR', 'CLOSED'],
  ] as const)("keeps it shown after %s, rather than the branch's own", async (send, ask, status) => {
    const h = started();
    await onBranchPR(h, pr(5));
    await pick(h, pr(7));

    h.send({ type: send });
    await answer(h, ask, { number: 7 });
    await answer(h, 'pr.CHECK_BRANCH_PR', { pr: pr(5) });

    expect(dataOf(h).selectedPR).toMatchObject({ number: 7, state: status });
  });
});

describe('another folder', () => {
  it('keeps nothing of the last one, so its branch pull request is shown once checked', async () => {
    const h = started();
    await pick(h, pr(7), [comment(1)]);
    h.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' });
    h.send({ type: 'pr.UPDATE_CREATE_FIELD', field: 'title', value: 'half typed' });
    h.send({ type: 'pr.CREATE_COMMENT', number: 7, body: 'pending' });
    await failing(h, 'boom');

    h.send({ type: 'CODE_STARTED' });

    expect(dataOf(h)).toMatchObject({
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
    expect(h.read().pending.details, 'and its details are no longer waited on').toBe(false);

    await onBranchPR(h, pr(11));
    expect(dataOf(h).selectedPR?.number).toBe(11);
  });

  it('takes no answer to an ask made for the last one', async () => {
    const h = started();
    h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 7 });
    h.send({ type: 'CODE_STARTED' });

    await answer(h, 'pr.SELECT_PR', details(pr(7)), 0);

    expect(dataOf(h).selectedPR).toBeNull();
  });
});

describe('an error message', () => {
  it('is cleared when another folder opens', async () => {
    const h = started(false);
    await failing(h, 'No directory selected.');
    h.send({ type: 'CODE_STARTED' });
    expect(dataOf(h).prError).toBeNull();
  });

  it('is cleared on refresh', async () => {
    const h = started();
    await failing(h, 'failed');
    h.send({ type: 'pr.REFRESH_STATUS' });
    expect(dataOf(h).prError).toBeNull();
  });
});

describe('the repository moving', () => {
  it('asks GitHub nothing while the panel is hidden, and asks when it is shown', async () => {
    const h = started(false);

    h.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });

    expect(asked(h, 'pr.CHECK_BRANCH_PR')).toEqual([]);
    expect(dataOf(h).isCheckingBranchPR).toBe(false);

    // Selecting the panel is what sends this
    h.send({ type: 'SYNC_PANEL_SHOWN', isPanelShown: true });
    h.send({ type: 'pr.REFRESH_STATUS' });
    expect(asked(h, 'pr.CHECK_BRANCH_PR')).toHaveLength(1);
    expect(dataOf(h).isCheckingBranchPR, 'what was checked is stale').toBe(true);
  });

  it('asks GitHub again while the panel is shown', async () => {
    const h = started(true);
    h.send({ type: 'pr.GIT_STATUS_REFRESHED', data: { timestamp: new Date() } });
    expect(asked(h, 'pr.CHECK_BRANCH_PR')).toHaveLength(1);
  });

  it('asks nothing of a folder opened while the panel is hidden', async () => {
    const h = started(false);
    h.send({ type: 'CODE_STARTED' });
    expect(asked(h, 'pr.CHECK_BRANCH_PR')).toEqual([]);
  });
});

describe('"Checkout & Pull Base"', () => {
  it('asks for the pull, since a checkout pulls nothing by itself', async () => {
    const h = started();
    await pick(h, pr(7, { baseRefName: 'develop' }));

    h.send({ type: 'pr.CHECKOUT_BASE' });

    expect(asked(h, 'commit.CHECKOUT_BRANCH')).toEqual([{ type: 'commit.CHECKOUT_BRANCH', branchName: 'develop', pull: true }]);
  });

  it('shows why the base was not checked out, on the panel that asked', async () => {
    const h = started();
    await pick(h, pr(7, { baseRefName: 'develop' }));
    h.send({ type: 'pr.CHECKOUT_BASE' });

    await refuse(h, 'commit.CHECKOUT_BRANCH', 'Your local changes would be overwritten by checkout');

    expect(dataOf(h).prError).toBe('Your local changes would be overwritten by checkout');
    expect(h.reportsOf('PR_SELECT_PANEL'), 'the commit panel is not shown for a checkout that did not happen').toEqual([]);
  });
});
