// Which answer a PR view takes: the one in its own slot, keyed by what it asked for.
//
// A diff is a view fetching data, and the rule for that job (`packages/default-setup/CLAUDE.md`) is a slot
// keyed by what was asked: a late or another window's answer writes its own key, the view reads the key it is
// showing, and there is no guard anyone can forget. **A guard cannot do this job here**, which is the reason
// to reach for the key and not merely a preference: the branch-only asker compares against no head, so any
// check on the answer's head must admit an answer carrying none — and two PRs onto one base, the ordinary
// case, then let a branch diff land as a PR's files.
//
// The file-diff half keeps an in-flight check as well, because its answer **opens a tab**: a key decides
// which row to write, not whether there should be one. That is the limit the guide names, and the two halves
// are tested separately because they are two different mechanisms.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
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
  getParentContext: vi.fn(() => ({})),
  sendEventToParent: vi.fn(),
}));

const { pullRequestState, refKey } = await import('#features/code/fe/features/pull-request/state.ts');

/** A PR as the correlation reads one; only the refs and the number are real */
const pr = (number: number, base: string, head: string) =>
  ({ number, baseRefName: base, headRefName: head }) as unknown as GhPullRequest;

const file = (path: string) => ({ path, status: 'modified', staged: false }) as GitStatusFile;

const started = () => createActor(pullRequestState).start();

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
  actor.send({ type: 'pr.PR_DETAILS_RECEIVED', data: { pr: which, comments: [], fetchedAt: Date.now() } });
};

const asked = () => sendToSystem.mock.calls.map(([, event]) => event as Record<string, unknown>);

beforeEach(() => {
  sendToSystem.mockReset();
  addTabToParent.mockReset();
});

describe('a branch diff', () => {
  /**
   * **The hole, as a case.** A branch with no PR compares against no head, so its answer carries none —
   * and the old guard skipped its head check for exactly that, accepting the branch's files as a PR's
   * whenever the bases coincided. Two PRs onto `main` is the ordinary case, so this was reachable.
   *
   * Nothing is dropped now: the headless answer lands in the headless key, where the view is not looking.
   */
  it('for a branch with no PR is never read as a selected PR\'s, even onto the same base', () => {
    const actor = started();
    // The branch-only view asks: base only, no head
    actor.send({ type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch: 'main' } });
    selectPR(actor, pr(7, 'main', 'feature-b'));

    // ...and the branch's answer turns up after the switch
    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('branch-only.ts')], baseBranch: 'main' } });

    expect(shown(actor), "the PR's comparison has no answer yet").toBeUndefined();
    expect(actor.getSnapshot().context.diffsByRef[refKey('main')], 'the branch comparison has its own')
      .toEqual([file('branch-only.ts')]);
  });

  // Two PRs onto one base is what a single slot could not hold: the base is equal, so only the head tells them apart
  it('lands in its own comparison when two PRs share a base', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('a.ts')], baseBranch: 'main', headBranch: 'feature-a' } });
    selectPR(actor, pr(2, 'main', 'feature-b'));
    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('b.ts')], baseBranch: 'main', headBranch: 'feature-b' } });

    expect(shown(actor), 'the PR it is on').toEqual([file('b.ts')]);
    expect(actor.getSnapshot().context.diffsByRef[refKey('main', 'feature-a')], 'and the other kept its own')
      .toEqual([file('a.ts')]);
  });

  /**
   * The race the guard was written for, in the direction it did handle — kept because the mechanism
   * changed underneath it. An answer for a PR since left writes its own key and the view never reads it.
   */
  it('for a PR since switched away from changes nothing the view reads', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    selectPR(actor, pr(2, 'main', 'feature-b'));
    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('b.ts')], baseBranch: 'main', headBranch: 'feature-b' } });
    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('a.ts')], baseBranch: 'main', headBranch: 'feature-a' } });

    expect(shown(actor), "the older answer did not overwrite the view's").toEqual([file('b.ts')]);
  });

  /**
   * **Why the answer must not write `prBaseBranch`.** That field is half the key the view reads under, so
   * an answer that set it from its own payload would point the view at its own slot — and be read after
   * all, having correlated on nothing.
   *
   * The base moves under a selected PR through `pr.BASE_BRANCH_RECEIVED`, which is this case. Restore
   * `prBaseBranch: ev.data.baseBranch` to `handleBranchDiffReceived` and this is the one that fails; it
   * was written because the obvious mutation — restoring that line — passed every other case here, every
   * stale answer in them sharing the view's base and differing only in the head.
   */
  it('does not let a late answer move the view onto its own comparison', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    // The base moves while that diff is in flight
    actor.send({ type: 'pr.BASE_BRANCH_RECEIVED', data: { branch: 'develop' } });

    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('old.ts')], baseBranch: 'main', headBranch: 'feature-a' } });

    expect(shown(actor), 'the view is on develop, and nothing has answered for it').toBeUndefined();
  });

  /**
   * The slot doubles as a cache, as `explorer`'s `dirContents` does — and this is the question a single
   * slot could not ask. `needsDiff` used to be "has the base changed, and do I have *any* files"; keyed, it
   * asks whether it holds *these* files.
   */
  it('is not asked for twice when the comparison is already held', () => {
    const actor = started();
    actor.send({ type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch: 'main' } });
    actor.send({ type: 'pr.BRANCH_DIFF_RECEIVED', data: { files: [file('x.ts')], baseBranch: 'main' } });
    sendToSystem.mockReset();

    actor.send({ type: 'pr.SMART_BASE_BRANCH_RECEIVED', data: { branch: 'main' } });

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

    actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' } });

    expect(addTabToParent).toHaveBeenCalledTimes(1);
    expect(addTabToParent.mock.calls[0]?.[1]).toMatchObject({ path: 'pr-diff:a.ts', isPrDiff: true });
  });

  /**
   * **Why a key alone is not enough for this one.** A second copy of the same answer would write the same
   * slot harmlessly, but it would open a second tab — a key says which row, not whether there should be
   * one. The in-flight key leaves the set as it is consumed, so the duplicate finds nothing.
   */
  it('opens no second tab for a duplicate answer', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');
    const answer = { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' };

    actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: answer });
    actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: answer });

    expect(addTabToParent).toHaveBeenCalledTimes(1);
  });

  // An answer for a comparison this machine never asked about — another window's, or a PR since left
  it('opens no tab for a diff it never asked for', () => {
    const actor = started();
    selectPR(actor, pr(1, 'main', 'feature-a'));
    ask(actor, 'a.ts');

    actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'someone-elses' } });

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

    actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: { path: 'a.ts', staged: false, baseBranch: 'main', headBranch: 'feature-a' } });

    expect(addTabToParent).not.toHaveBeenCalled();
  });
});
