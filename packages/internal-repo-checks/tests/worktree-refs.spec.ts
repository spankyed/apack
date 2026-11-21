// No two worktrees may hold the same ref, and this checkout is one of the subjects.
//
// A branch is one ref and a worktree's HEAD points at it, so two worktrees on one branch share it rather
// than each holding a copy: a `reset`, `rebase` or `commit` in either moves the other's HEAD and leaves its
// index and working tree where they were. That checkout then reports every file differing between the old
// HEAD and the new one as a staged change — a reversal of whatever landed in between, staged by nobody, in
// a tree that was never edited.
//
// Git refuses `git checkout <branch>` for a branch another worktree holds, which is why the state reads as
// unreachable. It does not refuse `git checkout -B <branch> <start>`: that takes the ref. One such command
// moved another checkout's HEAD, dropped a commit from the branch, and made two merged PRs read as
// reverted — diagnosed only after several wrong answers, because the symptom names nothing about its cause.
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { refsClaimedTwice, sharedRefProblem, worktreeRefs, type WorktreeRef } from '../../../scripts/lib/worktree-refs.ts';

const at = (worktree: string, ref: string): WorktreeRef => ({ worktree, ref });

describe('a ref two worktrees hold', () => {
  /**
   * **The state itself, over this machine.**
   *
   * The population is asserted non-empty first: a parse that found no worktree at all would report no
   * duplicate for the same reason a correct checkout does, and pass while looking at nothing. Every
   * checkout has at least a primary worktree, and this suite runs in one.
   */
  it('is not what this checkout is in', () => {
    const refs = worktreeRefs(REPO_ROOT);

    expect(refs.length, 'no worktree holds a ref, so this looked at nothing').toBeGreaterThan(0);
    expect(sharedRefProblem(refsClaimedTwice(refs))).toBeUndefined();
  });

  /**
   * **Fed the condition rather than made to reproduce it**, because reproducing it means doing the damage:
   * attaching a second worktree to a live branch is the act this refuses, and a spec that performed it
   * would move the HEAD of whatever checkout is running the suite.
   */
  it('is found and named when two hold one', () => {
    const shared = refsClaimedTwice([
      at('/repo', 'refs/heads/master'),
      at('/repo/worktrees/b', 'refs/heads/master'),
    ]);

    expect(shared).toEqual([{ ref: 'refs/heads/master', worktrees: ['/repo', '/repo/worktrees/b'] }]);
    const problem = sharedRefProblem(shared);
    expect(problem, 'the refusal names the ref').toContain('refs/heads/master');
    expect(problem, 'and both worktrees, since either may be the one to detach').toContain('/repo/worktrees/b');
    expect(problem, 'and what ends it').toContain('--detach');
  });

  it('is not every worktree on a branch of its own', () => {
    // The guard against a check that calls every checkout broken: the ordinary case is many worktrees, each
    // on its own ref, which is the whole point of the parallel-session workflow
    const refs = [at('/repo', 'refs/heads/master'), at('/a', 'refs/heads/one'), at('/b', 'refs/heads/two')];

    expect(refsClaimedTwice(refs)).toEqual([]);
    expect(sharedRefProblem([])).toBeUndefined();
  });

  it('counts a third holder, since detaching one is not enough then', () => {
    const shared = refsClaimedTwice([at('/a', 'refs/heads/x'), at('/b', 'refs/heads/x'), at('/c', 'refs/heads/x')]);

    expect(shared[0]?.worktrees).toHaveLength(3);
    expect(sharedRefProblem(shared)).toContain('3');
  });

  it('leaves a detached worktree out, which owns no ref to collide over', () => {
    // `git worktree list --porcelain` prints `detached` where a branch line would be, so such an entry
    // never reaches the grouping — two detached worktrees at one commit are not sharing anything
    const refs = worktreeRefs(REPO_ROOT);

    expect(refs.every((entry) => entry.ref.startsWith('refs/'))).toBe(true);
  });
});
