// Which answer a PR view takes: the one in its own slot, keyed by what it asked for.
import { afterEach, describe, expect, it } from 'vitest';
import type { GhPullRequest } from '#generated/types.ts';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';
import { pullRequestState, refKey } from '#features/code/fe/features/pull-request/state.ts';
import { startMachine } from '../../_support/asks.ts';

const PR_REPORTS = ['PR_OPEN_DIFF_TAB', 'PR_OPEN_FILE', 'PR_SELECT_PANEL'] as const;

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const pr = (number: number, base: string, head: string) =>
  ({ number, baseRefName: base, headRefName: head }) as unknown as GhPullRequest;

const file = (path: string) => ({ path, status: 'modified', staged: false }) as GitStatusFile;

const started = () => {
  const h = startMachine(pullRequestState, { reports: PR_REPORTS });
  running.push(h);
  h.send({ type: 'SYNC_BASE_DIRECTORY', baseDirectory: '/repo' });
  h.send({ type: 'SYNC_PANEL_SHOWN', isPanelShown: true });
  return h;
};
type Harness = ReturnType<typeof started>;

const answerLatest = (h: Harness, type: string, answer: unknown) => h.latestAsk(type).answer(answer);

const onBranchWithoutPR = async (h: Harness, base: string) => {
  h.send({ type: 'pr.REFRESH_STATUS' });
  await answerLatest(h, 'pr.CHECK_BRANCH_PR', { pr: null });
  await answerLatest(h, 'pr.GET_SMART_BASE_BRANCH', { branch: base });
};

const diffAnswer = (h: Harness, nth: number, files: GitStatusFile[], baseBranch: string, headBranch?: string) =>
  h.asksOf('pr.GET_BRANCH_DIFF')[nth]!.answer({ files, baseBranch, headBranch });

const shown = (h: Harness) => {
  const { diffsByRef, prBaseBranch, selectedPR } = h.read().data;
  return diffsByRef[refKey(prBaseBranch, selectedPR?.headRefName)];
};

const selectPR = async (h: Harness, which: GhPullRequest) => {
  h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  await answerLatest(h, 'pr.SELECT_PR', { pr: which, comments: [], fetchedAt: Date.now() });
};

describe('a branch diff', () => {
  it("for a branch with no PR is never read as a selected PR's, even onto the same base", async () => {
    const h = started();
    await onBranchWithoutPR(h, 'main');
    await selectPR(h, pr(7, 'main', 'feature-b'));

    await diffAnswer(h, 0, [file('branch-only.ts')], 'main');

    expect(shown(h), "the PR's comparison has no answer yet").toBeUndefined();
    expect(h.read().data.diffsByRef[refKey('main')], 'the branch comparison has its own')
      .toEqual([file('branch-only.ts')]);
  });

  it('lands in its own comparison when two PRs share a base', async () => {
    const h = started();
    await selectPR(h, pr(1, 'main', 'feature-a'));
    await diffAnswer(h, 0, [file('a.ts')], 'main', 'feature-a');
    await selectPR(h, pr(2, 'main', 'feature-b'));
    await diffAnswer(h, 1, [file('b.ts')], 'main', 'feature-b');

    expect(shown(h), 'the PR it is on').toEqual([file('b.ts')]);
    expect(h.read().data.diffsByRef[refKey('main', 'feature-a')], 'and the other kept its own')
      .toEqual([file('a.ts')]);
  });

  it('for a PR since switched away from changes nothing the view reads', async () => {
    const h = started();
    await selectPR(h, pr(1, 'main', 'feature-a'));
    await selectPR(h, pr(2, 'main', 'feature-b'));
    await diffAnswer(h, 1, [file('b.ts')], 'main', 'feature-b');
    await diffAnswer(h, 0, [file('a.ts')], 'main', 'feature-a');

    expect(shown(h), "the older answer did not overwrite the view's").toEqual([file('b.ts')]);
  });

  it('does not let a late answer move the view onto its own comparison', async () => {
    const h = started();
    await selectPR(h, pr(1, 'main', 'feature-a'));
    h.send({ type: 'pr.UPDATE_PR', number: 1, base: 'develop' });
    await answerLatest(h, 'pr.UPDATE_PR', {
      number: 1,
      base: 'develop',
      details: { pr: pr(1, 'develop', 'feature-a'), comments: [], fetchedAt: Date.now() + 1 },
    });

    await diffAnswer(h, 0, [file('old.ts')], 'main', 'feature-a');

    expect(h.read().data.prBaseBranch).toBe('develop');
    expect(shown(h), 'the view is on develop, and nothing has answered for it').toBeUndefined();
  });

  it('is not asked for twice when the comparison is already held', async () => {
    const h = started();
    await onBranchWithoutPR(h, 'main');
    await diffAnswer(h, 0, [file('x.ts')], 'main');
    h.reset();

    await onBranchWithoutPR(h, 'main');

    expect(h.asksOf('pr.GET_BRANCH_DIFF')).toEqual([]);
  });
});

describe('a file diff, whose answer opens a tab', () => {
  const ask = (h: Harness, path: string) => {
    h.send({ type: 'pr.SELECT_FILE', file: file(path) });
    h.send({ type: 'pr.VIEW_DIFF', path });
  };

  it('opens one tab for the diff that was asked for', async () => {
    const h = started();
    await selectPR(h, pr(1, 'main', 'feature-a'));
    ask(h, 'a.ts');

    await answerLatest(h, 'pr.GET_BRANCH_FILE_DIFF', { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' });

    const opened = h.reportsOf('PR_OPEN_DIFF_TAB');
    expect(opened).toHaveLength(1);
    expect((opened[0] as unknown as { tab: unknown }).tab).toMatchObject({ path: 'pr-diff:a.ts', isPrDiff: true });
  });

  it('opens no tab for a diff asked of a pull request since left', async () => {
    const h = started();
    await selectPR(h, pr(1, 'main', 'feature-a'));
    ask(h, 'a.ts');
    const diff = h.latestAsk('pr.GET_BRANCH_FILE_DIFF');
    await selectPR(h, pr(2, 'main', 'feature-b'));

    await diff.answer({ path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' });

    expect(h.reportsOf('PR_OPEN_DIFF_TAB')).toEqual([]);
  });

  it('opens no tab for a file the user has moved off', async () => {
    const h = started();
    await selectPR(h, pr(1, 'main', 'feature-a'));
    ask(h, 'a.ts');
    h.send({ type: 'pr.SELECT_FILE', file: file('b.ts') });

    await answerLatest(h, 'pr.GET_BRANCH_FILE_DIFF', { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' });

    expect(h.reportsOf('PR_OPEN_DIFF_TAB')).toEqual([]);
  });
});

describe('write cancellation and stale error isolation across repo switches', () => {
  it('cancels all in-flight write calls on CODE_STARTED and never lets a repo-A write error clobber repo B', async () => {
    const h = started();
    await selectPR(h, pr(10, 'main', 'repo-a-branch'));

    // Launch multiple write calls against repo A (including merge and comment writes)
    h.send({ type: 'pr.MERGE', method: 'squash' });
    h.send({ type: 'pr.CREATE_COMMENT', number: 10, body: 'comment on repo A' });
    h.send({ type: 'pr.CLOSE' });
    const mergeAsk = h.latestAsk('pr.MERGE_PR');
    const commentAsk = h.latestAsk('pr.CREATE_COMMENT');
    const closeAsk = h.latestAsk('pr.CLOSE_PR');
    expect(mergeAsk.stopped).toBe(false);
    expect(commentAsk.stopped).toBe(false);
    expect(closeAsk.stopped).toBe(false);

    // Switch to repo B
    h.send({ type: 'CODE_STARTED', baseDirectory: '/repo-b' });
    expect(mergeAsk.stopped, 'merge call from repo A is cancelled on repo switch').toBe(true);
    expect(commentAsk.stopped, 'comment call from repo A is cancelled on repo switch').toBe(true);
    expect(closeAsk.stopped, 'close call from repo A is cancelled on repo switch').toBe(true);

    await selectPR(h, pr(20, 'main', 'repo-b-branch'));
    expect(h.read().data.prError).toBeNull();
    expect(h.read().data.selectedPR?.number).toBe(20);

    // Even if a repo-A failure somehow settled after switching PRs (e.g., comment write on PR 20 then switched to PR 21)
    h.send({ type: 'pr.CREATE_COMMENT', number: 20, body: 'comment on PR 20' });
    const pr20Comment = h.latestAsk('pr.CREATE_COMMENT');
    await selectPR(h, pr(21, 'main', 'repo-b-other'));
    await pr20Comment.refuse('repo/PR 20 write failed');

    expect(h.read().data.prError, 'unrecorded write error must not clobber current PR state').toBeNull();
    expect(h.read().data.selectedPR?.number).toBe(21);
  });
});
