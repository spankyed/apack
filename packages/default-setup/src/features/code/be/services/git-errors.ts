// What a failed git command means, read from what git printed, in one place. Git says why it failed in prose, and
// every caller that needs to know why reads the code this gives rather than the prose: a second place matching the
// text is a second list to keep in step with git, and the one that falls behind answers wrongly without failing.
//
// The prose is English because every git child is run in English (`gitEnvironment`, git.ts), whatever the user's
// locale is.

/** Why a git command failed, where what it printed says */
export const GIT_ERROR_CODES = [
  /** Another process holds a lock the command needs */
  'locked',
  /** The remote asked for a sign-in git does not have: no stored credentials, or a key it refused */
  'authentication',
  /** The remote knows who is asking and will not allow it */
  'permission',
  /** The remote could not be reached at all */
  'remote-unreachable',
  /** A push the remote refused because its branch has commits this one lacks */
  'non-fast-forward',
  /** A pull of a branch that both sides have added to, which git was not told how to bring together */
  'diverged',
  /** A merge, a rebase or a stash stopped on changes that conflict */
  'conflict',
  /** The command would overwrite changes in the working tree */
  'local-changes',
  /** A branch, a commit or a path that git does not know */
  'unknown-ref',
  /** The directory is in no git repository */
  'not-a-repository',
] as const

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number]

/** What git says when another process holds a lock it needs, with the lock's path */
export const LOCKED = /Unable to create '(.+\.lock)': File exists/

/**
 * What git prints for each, most telling first: a refused key prints "Permission denied (publickey)" and then
 * "Could not read from remote repository", and the first is why.
 */
const SIGNS: readonly (readonly [GitErrorCode, RegExp])[] = [
  ['locked', LOCKED],
  ['authentication', /Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Permission denied \(publickey|Invalid username or (password|token)/],
  ['permission', /Permission to \S+ denied|remote: Permission|The requested URL returned error: 403/],
  ['remote-unreachable', /Could not resolve host|Could not read from remote repository|unable to access|Connection refused|Connection timed out|Network is unreachable/],
  ['non-fast-forward', /non-fast-forward|\[rejected\]|\(fetch first\)/],
  ['diverged', /Not possible to fast-forward|Need to specify how to reconcile divergent branches/],
  ['conflict', /Automatic merge failed|CONFLICT|Merge conflict/],
  ['local-changes', /Your local changes|untracked working tree files would be overwritten/],
  ['unknown-ref', /pathspec .* did not match|cannot be resolved|unknown revision/],
  ['not-a-repository', /not a git repository/i],
]

/** Why git failed, from everything it printed; nothing when it does not say, or says something not known here */
export function classifyGitError(printed: string): GitErrorCode | undefined {
  return SIGNS.find(([, sign]) => sign.test(printed))?.[0]
}

/** A git command that failed, with why where git said */
export class GitError extends Error {
  constructor(message: string, readonly code?: GitErrorCode) {
    super(message)
    this.name = 'GitError'
  }
}
