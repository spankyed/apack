// Which answer a PR view takes: the one in its own slot, keyed by what it asked for.
//
// A diff is a view fetching data, and the rule for that job (`packages/default-setup/CLAUDE.md`) is a slot
// keyed by what was asked: each ask is made under its comparison, its answer writes that key, and the view reads
// the key it is showing. The branch-only asker compares against no head, so nothing read off an answer could
// tell its files from a PR's onto the same base; the key its ask was made under does.
//
// The file-diff half is its own because its answer **opens a tab**: a key decides which row to write, not
// whether there should be one, so the tab is opened for the file still selected. The two halves are tested
// separately because they are two different mechanisms.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';
import type { GhPullRequest } from '#generated/types.ts';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));

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

/** The answer to the latest ask of `type`, as the code system's handler gives it */
const answerLatest = (type: string, answer: unknown) => latestAsk(type).answer(answer);

/** The branch-only view: no PR for the branch, so it asks for the base to compare against, and gets `base` */
const onBranchWithoutPR = async (actor: ReturnType<typeof started>, base: string) => {
  actor.send({ type: 'pr.REFRESH_STATUS' });
  await answerLatest('pr.CHECK_BRANCH_PR', { pr: null });
  await answerLatest('pr.GET_SMART_BASE_BRANCH', { branch: base });
};

/** The answer to the nth branch diff asked */
const diffAnswer = (nth: number, files: GitStatusFile[], baseBranch: string, headBranch?: string) =>
  asksOf('pr.GET_BRANCH_DIFF')[nth]!.answer({ files, baseBranch, headBranch });

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
const selectPR = async (actor: ReturnType<typeof started>, which: GhPullRequest) => {
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: which.number });
  await answerLatest('pr.SELECT_PR', { pr: which, comments: [], fetchedAt: Date.now() });
};

beforeEach(() => {
  tell.mockReset();
  resetAsks();
  addTabToParent.mockReset();
});

describe('a branch diff', () => {
  /**
   * A branch with no PR compares against no head, so its answer carries none. It lands in the headless
   * key its ask recorded, where a selected PR's view onto the same base is not looking.
   */
  it('for a branch with no PR is never read as a selected PR\'s, even onto the same base', async () => {
    const actor = started();
    // The branch-only view asks: base only, no head
    await onBranchWithoutPR(actor, 'main');
    await selectPR(actor, pr(7, 'main', 'feature-b'));

    // ...and the branch's answer turns up after the switch
    await diffAnswer(0, [file('branch-only.ts')], 'main');

    expect(shown(actor), "the PR's comparison has no answer yet").toBeUndefined();
    expect(actor.getSnapshot().context.diffsByRef[refKey('main')], 'the branch comparison has its own')
      .toEqual([file('branch-only.ts')]);
  });

  // Two PRs onto one base is what a single slot could not hold: the base is equal, so only the head tells them apart
  it('lands in its own comparison when two PRs share a base', async () => {
    const actor = started();
    await selectPR(actor, pr(1, 'main', 'feature-a'));
    await diffAnswer(0, [file('a.ts')], 'main', 'feature-a');
    await selectPR(actor, pr(2, 'main', 'feature-b'));
    await diffAnswer(1, [file('b.ts')], 'main', 'feature-b');

    expect(shown(actor), 'the PR it is on').toEqual([file('b.ts')]);
    expect(actor.getSnapshot().context.diffsByRef[refKey('main', 'feature-a')], 'and the other kept its own')
      .toEqual([file('a.ts')]);
  });

  // An answer for a PR since left writes the key its ask recorded, and the view never reads it
  it('for a PR since switched away from changes nothing the view reads', async () => {
    const actor = started();
    await selectPR(actor, pr(1, 'main', 'feature-a'));
    await selectPR(actor, pr(2, 'main', 'feature-b'));
    await diffAnswer(1, [file('b.ts')], 'main', 'feature-b');
    await diffAnswer(0, [file('a.ts')], 'main', 'feature-a');

    expect(shown(actor), "the older answer did not overwrite the view's").toEqual([file('b.ts')]);
  });

  /**
   * **Why the answer must not write `prBaseBranch`.** That field is half the key the view reads under, so
   * an answer that set it would point the view at its own slot — and be read after all.
   *
   * The base moves under a selected PR when it is edited: the edit is answered with the PR's details read
   * again, which ask for the new comparison while the old one is still in flight.
   */
  it('does not let a late answer move the view onto its own comparison', async () => {
    const actor = started();
    await selectPR(actor, pr(1, 'main', 'feature-a'));
    actor.send({ type: 'pr.UPDATE_PR', number: 1, base: 'develop' });
    await answerLatest('pr.UPDATE_PR', { number: 1, base: 'develop', details: { pr: pr(1, 'develop', 'feature-a'), comments: [], fetchedAt: Date.now() + 1 } });

    await diffAnswer(0, [file('old.ts')], 'main', 'feature-a');

    expect(actor.getSnapshot().context.prBaseBranch).toBe('develop');
    expect(shown(actor), 'the view is on develop, and nothing has answered for it').toBeUndefined();
  });

  // The slot doubles as a cache: `needsDiff` asks whether it holds *these* files
  it('is not asked for twice when the comparison is already held', async () => {
    const actor = started();
    await onBranchWithoutPR(actor, 'main');
    await diffAnswer(0, [file('x.ts')], 'main');
    resetAsks();

    await onBranchWithoutPR(actor, 'main');

    expect(asksOf('pr.GET_BRANCH_DIFF')).toEqual([]);
  });
});

describe('a file diff, whose answer opens a tab', () => {
  /** The user opens a file's diff */
  const ask = (actor: ReturnType<typeof started>, path: string) => {
    actor.send({ type: 'pr.SELECT_FILE', file: file(path) });
    actor.send({ type: 'pr.VIEW_DIFF', path });
  };

  it('opens one tab for the diff that was asked for', async () => {
    const actor = started();
    await selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');

    await answerLatest('pr.GET_BRANCH_FILE_DIFF', { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' });

    expect(addTabToParent).toHaveBeenCalledTimes(1);
    expect(addTabToParent.mock.calls[0]?.[1]).toMatchObject({ path: 'pr-diff:a.ts', isPrDiff: true });
  });

  // A pull request's file diffs are its own: one answered after the user left it is no longer wanted
  it('opens no tab for a diff asked of a pull request since left', async () => {
    const actor = started();
    await selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');
    const diff = latestAsk('pr.GET_BRANCH_FILE_DIFF');
    await selectPR(actor, pr(2, 'main', 'feature-b'));

    await diff.answer({ path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' });

    expect(addTabToParent).not.toHaveBeenCalled();
  });

  /**
   * And the file has to still be the one open, which the key cannot say: the tab is built from
   * `selectedPrFile`, so an answer arriving after the user moved on would put one file's diff in a tab
   * named for another.
   */
  it('opens no tab for a file the user has moved off', async () => {
    const actor = started();
    await selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');
    actor.send({ type: 'pr.SELECT_FILE', file: file('b.ts') });

    await answerLatest('pr.GET_BRANCH_FILE_DIFF', { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' });

    expect(addTabToParent).not.toHaveBeenCalled();
  });
});
