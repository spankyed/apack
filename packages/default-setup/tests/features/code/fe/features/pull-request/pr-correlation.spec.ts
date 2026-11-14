// Which answer a PR view takes: the one in its own slot, keyed by what it asked for.
//
// A diff is a view fetching data, and the rule for that job (`packages/default-setup/CLAUDE.md`) is a slot
// keyed by what was asked: each ask records its comparison under its call, its answer writes that key, and the
// view reads the key it is showing. The branch-only asker compares against no head, so nothing read off an
// answer could tell its files from a PR's onto the same base; the recorded key does.
//
// The file-diff half settles its ask as well, because its answer **opens a tab**: a key decides which row to
// write, not whether there should be one. The two halves are tested separately because they are two
// different mechanisms.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';
import type { GhPullRequest } from '#generated/types.ts';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

// `addTabToParent` is how a file diff reaches the UI, and the only observable effect of that handler — it
// guards on `self._parent`, so a standalone actor would silently open nothing and prove nothing
const addTabToParent = vi.hoisted(() => vi.fn());
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent,
  updateParentState: vi.fn(),
  getParentContext: vi.fn(() => ({ baseDirectory: '/repo', selectedPanel: 'pr' })),
  sendEventToParent: vi.fn(),
}));

const { pullRequestState, refKey } = await import('#features/code/fe/features/pull-request/state.ts');

/** A PR as the correlation reads one; only the refs and the number are real */
const pr = (number: number, base: string, head: string) =>
  ({ number, baseRefName: base, headRefName: head }) as unknown as GhPullRequest;

const file = (path: string) => ({ path, status: 'modified', staged: false }) as GitStatusFile;

const started = () => createActor(pullRequestState).start();

const asked = () => sendToSystem.mock.calls.map(([, event]) => event as Record<string, unknown>);

/** The answer to the latest ask of `type`, as the backend's `reply` would deliver it */
const answerLatest = <E extends { type: string }>(actor: ReturnType<typeof started>, type: string, event: E) => {
  const sent = asked().filter((e) => e.type === type).length;
  actor.send(answerTo(sentCall(sendToSystem, type, sent - 1), event) as never);
};

/** The branch-only view: no PR for the branch, so it asks for the base to compare against, and gets `base` */
const onBranchWithoutPR = (actor: ReturnType<typeof started>, base: string) => {
  actor.send({ type: 'pr.REFRESH_STATUS' });
  answerLatest(actor, 'pr.CHECK_BRANCH_PR', { type: 'pr.BRANCH_PR_CHECKED', data: { pr: null } });
  answerLatest(actor, 'pr.GET_SMART_BASE_BRANCH', { type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch: base } });
};

/** The answer to the nth branch diff asked */
const diffAnswer = (actor: ReturnType<typeof started>, nth: number, files: GitStatusFile[], baseBranch: string, headBranch?: string) =>
  actor.send(answerTo(sentCall(sendToSystem, 'pr.GET_BRANCH_DIFF', nth), { type: 'pr.BRANCH_DIFF_RECEIVED' as const, data: { files, baseBranch, headBranch } }));

/** What the view shows: the slot for the comparison it is on */
const shown = (actor: ReturnType<typeof started>) => {
  const { diffsByRef, prBaseBranch, selectedPR } = actor.getSnapshot().context;
  return diffsByRef[refKey(prBaseBranch, selectedPR?.headRefName)];
};

/**
 * Selecting a PR, in two events because that is what the machine does: the click records which PR is
 * wanted, and the details arriving are what set it and ask for its diff.
 *
 * Sending only the details is a *background refresh*, which `loadDiffForSelectedPR` deliberately skips for
 * a PR other than the one wanted — learned by writing this helper the short way first and watching two
 * cases read the previous PR's files.
 */
const selectPR = (actor: ReturnType<typeof started>, which: GhPullRequest) => {
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  answerLatest(actor, 'pr.SELECT_PR', { type: 'pr.PR_DETAILS_RECEIVED', data: { pr: which, comments: [], fetchedAt: Date.now() } });
};

beforeEach(() => {
  sendToSystem.mockReset();
  addTabToParent.mockReset();
});

describe('a branch diff', () => {
  /**
   * A branch with no PR compares against no head, so its answer carries none. It lands in the headless
   * key its ask recorded, where a selected PR's view onto the same base is not looking.
   */
  it('for a branch with no PR is never read as a selected PR\'s, even onto the same base', () => {
    const actor = started();
    // The branch-only view asks: base only, no head
    onBranchWithoutPR(actor, 'main');
    selectPR(actor, pr(7, 'main', 'feature-b'));

    // ...and the branch's answer turns up after the switch
    diffAnswer(actor, 0, [file('branch-only.ts')], 'main');

    expect(shown(actor), "the PR's comparison has no answer yet").toBeUndefined();
    expect(actor.getSnapshot().context.diffsByRef[refKey('main')], 'the branch comparison has its own')
      .toEqual([file('branch-only.ts')]);
  });

  // Two PRs onto one base is what a single slot could not hold: the base is equal, so only the head tells them apart
  it('lands in its own comparison when two PRs share a base', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    diffAnswer(actor, 0, [file('a.ts')], 'main', 'feature-a');
    selectPR(actor, pr(2, 'main', 'feature-b'));
    diffAnswer(actor, 1, [file('b.ts')], 'main', 'feature-b');

    expect(shown(actor), 'the PR it is on').toEqual([file('b.ts')]);
    expect(actor.getSnapshot().context.diffsByRef[refKey('main', 'feature-a')], 'and the other kept its own')
      .toEqual([file('a.ts')]);
  });

  // An answer for a PR since left writes the key its ask recorded, and the view never reads it
  it('for a PR since switched away from changes nothing the view reads', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    selectPR(actor, pr(2, 'main', 'feature-b'));
    diffAnswer(actor, 1, [file('b.ts')], 'main', 'feature-b');
    diffAnswer(actor, 0, [file('a.ts')], 'main', 'feature-a');

    expect(shown(actor), "the older answer did not overwrite the view's").toEqual([file('b.ts')]);
  });

  /**
   * **Why the answer must not write `prBaseBranch`.** That field is half the key the view reads under, so
   * an answer that set it would point the view at its own slot — and be read after all.
   *
   * The base moves under a selected PR when it is edited: the edit is answered, then the PR's details
   * read again, which ask for the new comparison while the old one is still in flight.
   */
  it('does not let a late answer move the view onto its own comparison', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    actor.send({ type: 'pr.UPDATE_PR', number: 1, base: 'develop' });
    answerLatest(actor, 'pr.UPDATE_PR', { type: 'pr.PR_UPDATED', data: { number: 1, base: 'develop' } });
    answerLatest(actor, 'pr.UPDATE_PR', { type: 'pr.PR_DETAILS_RECEIVED', data: { pr: pr(1, 'develop', 'feature-a'), comments: [], fetchedAt: Date.now() + 1 } });

    diffAnswer(actor, 0, [file('old.ts')], 'main', 'feature-a');

    expect(actor.getSnapshot().context.prBaseBranch).toBe('develop');
    expect(shown(actor), 'the view is on develop, and nothing has answered for it').toBeUndefined();
  });

  it('writes nothing for an answer to no ask it holds', () => {
    const actor = started();
    onBranchWithoutPR(actor, 'main');

    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('someone-elses.ts')], baseBranch: 'main' } });

    expect(actor.getSnapshot().context.diffsByRef).toEqual({});
  });

  // The slot doubles as a cache: `needsDiff` asks whether it holds *these* files
  it('is not asked for twice when the comparison is already held', () => {
    const actor = started();
    onBranchWithoutPR(actor, 'main');
    diffAnswer(actor, 0, [file('x.ts')], 'main');
    sendToSystem.mockReset();

    onBranchWithoutPR(actor, 'main');

    expect(asked().filter((event) => event.type === 'pr.GET_BRANCH_DIFF')).toEqual([]);
  });
});

describe('a file diff, whose answer opens a tab', () => {
  /** Asking is what arms the key, so an answer nobody asked for opens nothing */
  const ask = (actor: ReturnType<typeof started>, path: string) => {
    actor.send({ type: 'pr.SELECT_FILE', file: file(path) });
    actor.send({ type: 'pr.VIEW_DIFF', path });
  };

  it('opens one tab for the diff that was asked for', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');

    answerLatest(actor, 'pr.GET_BRANCH_FILE_DIFF', { type: 'pr.FILE_DIFF_RECEIVED', data: { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' } });

    expect(addTabToParent).toHaveBeenCalledTimes(1);
    expect(addTabToParent.mock.calls[0]?.[1]).toMatchObject({ path: 'pr-diff:a.ts', isPrDiff: true });
  });

  /**
   * **Why a key alone is not enough for this one.** A second copy of the same answer would write the same
   * slot harmlessly, but it would open a second tab — a key says which row, not whether there should be
   * one. The ask is settled as it is answered, so the duplicate finds nothing.
   */
  it('opens no second tab for a duplicate answer', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');
    const answer = { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' };

    answerLatest(actor, 'pr.GET_BRANCH_FILE_DIFF', { type: 'pr.FILE_DIFF_RECEIVED', data: answer });
    answerLatest(actor, 'pr.GET_BRANCH_FILE_DIFF', { type: 'pr.FILE_DIFF_RECEIVED', data: answer });

    expect(addTabToParent).toHaveBeenCalledTimes(1);
  });

  // An answer to no ask this machine holds
  it('opens no tab for a diff it never asked for', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');

    actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' } });

    expect(addTabToParent).not.toHaveBeenCalled();
  });

  /**
   * And the file has to still be the one open, which the key cannot say: the tab is built from
   * `selectedPrFile`, so an answer arriving after the user moved on would put one file's diff in a tab
   * named for another.
   */
  it('opens no tab for a file the user has moved off', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');
    actor.send({ type: 'pr.SELECT_FILE', file: file('b.ts') });

    answerLatest(actor, 'pr.GET_BRANCH_FILE_DIFF', { type: 'pr.FILE_DIFF_RECEIVED', data: { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' } });

    expect(addTabToParent).not.toHaveBeenCalled();
  });
});
