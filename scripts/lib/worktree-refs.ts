// Which ref each worktree has checked out, and the one state that must never hold: two of them on the same
// one.
//
// **A branch is one ref, and a worktree's HEAD is a pointer to it.** So two worktrees on one branch do not
// have a copy each — they share it, and a `reset`, `rebase` or `commit` in either moves the other's HEAD
// without touching its index or working tree. What that checkout then reports is every file that differs
// between the old HEAD and the new one, rendered as staged changes nobody staged: a reversal of whatever
// landed in between, in a tree that is actually untouched.
//
// Git refuses this for `git checkout <branch>`, which is why it reads as impossible. It does not refuse
// `git checkout -B <branch> <start>`, which takes the ref and attaches to it. One such command cost a
// checkout its HEAD, knocked a commit off the branch, and made two merged PRs look reverted.
//
// `scripts/lib/worktrees.mjs` is the other half of this subject — `primaryWorktree`, for the scripts that
// run without a TypeScript loader. This is `.ts` because its consumer is a spec.
import { execFileSync } from 'node:child_process';

/** A worktree and the ref its HEAD points at; a detached worktree has none and cannot collide */
export interface WorktreeRef {
  /** Its path, which is what a diagnostic names */
  worktree: string;
  /** The full ref, `refs/heads/<branch>` */
  ref: string;
}

/** Every worktree holding a branch, from `git worktree list`. A detached one is left out: it owns no ref */
export function worktreeRefs(repoRoot: string): WorktreeRef[] {
  const listing = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const refs: WorktreeRef[] = [];
  let worktree: string | undefined;
  for (const line of listing.split('\n')) {
    if (line.startsWith('worktree ')) worktree = line.slice('worktree '.length);
    else if (line.startsWith('branch ') && worktree !== undefined) {
      refs.push({ worktree, ref: line.slice('branch '.length) });
    }
  }
  return refs;
}

/** A ref more than one worktree has checked out, with the worktrees holding it */
export interface SharedRef {
  ref: string;
  worktrees: string[];
}

/**
 * The refs claimed by more than one worktree, which is a state no checkout can be trusted in.
 *
 * Takes the entries rather than reading them, so the condition this refuses can be fed to it — the state
 * cannot be reproduced on a machine without doing the damage the check exists to prevent.
 */
export function refsClaimedTwice(entries: readonly WorktreeRef[]): SharedRef[] {
  const holders = new Map<string, string[]>();
  for (const entry of entries) {
    const held = holders.get(entry.ref);
    if (held) held.push(entry.worktree);
    else holders.set(entry.ref, [entry.worktree]);
  }
  return [...holders]
    .filter(([, worktrees]) => worktrees.length > 1)
    .map(([ref, worktrees]) => ({ ref, worktrees }));
}

/** What to tell whoever is holding one ref twice: which ref, which worktrees, and how to end it */
export function sharedRefProblem(shared: readonly SharedRef[]): string | undefined {
  if (shared.length === 0) return undefined;
  const lines = shared.map(({ ref, worktrees }) => `  ${ref} is checked out in ${worktrees.length}: ${worktrees.join(', ')}`);
  return [
    'Two worktrees share a ref, so a commit or reset in one moves the other\'s HEAD without touching its tree:',
    ...lines,
    'Detach all but one (`git checkout --detach` in it), or give it a branch of its own.',
  ].join('\n');
}
