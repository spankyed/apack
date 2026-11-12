# The git engine

The code that runs git for the code feature and keeps the picture of one working tree is a package of its own,
`apack-git`, in a repository of its own: [spankyed/apack-git](https://github.com/spankyed/apack-git). The
built-in pack depends on it at `file:../../vendor/apack-git`, a link to a checkout pinned by
`vendor/apack-git.rev`. Run `npm run link:apack-git` to make the link; the linker refuses a checkout that is
not one or that does not hold the pin, and builds the engine's `dist/` when it is older than its sources.

## Why it is not in this repository

Its suite runs a real git and the platform's own file watch, and how a tree is watched, how a path is spelled
and how a process is ended differ on Linux, macOS and Windows. In its own repository the whole suite installs
and runs in seconds, on all three on every push. Here it sat behind the workspace's install and build, checked
on one platform. The boundary is also a fact there: an import across it does not resolve.

## The boundary

**The engine owns one working tree's truth and every git process. The app owns who is looking, what to show and
what to say.**

| In the engine | Stays in the app |
|---|---|
| Running git: its environment, what may run beside what, waiting for a lock, when a command is done, what a failure means | The event bus, the contract, windows, who asked |
| The snapshot, change detection by part, path-scoped reads, an operation in progress | The words shown to the user |
| A watcher of its own over Node's `fs.watch`, which a host can replace | GitHub, `gh`, pull requests, the offer to sign in |
| Reads (a diff, a file at a revision, the log, branches, stashes, worktrees) and writes (stage, commit, check out, stash, fetch, pull, push) | Policy: when to fetch unasked, which branch a pull request is based on, settings |
| Where a staged file will be listed, as an entry with no Node imports (`apack-git/staging`) | What says "look again": window focus, a terminal command ending, an agent's turn ending |

The app's half is `packages/default-setup/src/features/code/be/services/app-git-repository.ts`: a class over the
engine's `GitRepository` that adds the policy, and what the engine is handed to run with (`APP_TIES`): the
app's own child environment, the SDK's `execFileWhileWorking`, which ends a git that has stopped working, and
the app's loggers.

Three things keep the two apart:

- **The pack's published types name no type of the engine's.** A pack's facade may import only `@apackdev/*`
  packages, the SDK's peers and Node's built-ins, so the contract declares what crosses its bus
  (`be/types.ts`), `be/git-shapes.ts` holds those shapes to the engine's at compile time, and the system's
  context holds the repository and its watcher as handles (`repositoryOf`, `watcherOf`).
- **The pack bundles it.** The engine has no dependencies and nothing native, so `apack pack build` puts it
  in the pack's backend runtime and its staging entry in the frontend, and leaves nothing for the host to
  resolve.
- **It is pinned by commit and both halves move together.** A change to the engine is a commit there and the
  pin moved in the change here that uses it. There is no version to bump and nothing kept for compatibility.

## Which git, and when it cannot be used

**The app decides where git is; the engine decides whether it can be used.** The app hands the engine a path
(`RepositoryTies.git`), found by `resolveGitPath` (`be/utils/resolve-cli.ts`): the path set under Settings, CLI
providers, then where git is usually installed (Git for Windows' locations; Homebrew's, then `/usr/bin/git` on
macOS), then `git` from the PATH. Nothing is run to find it.

Before a repository's first command the engine asks that git once (`src/git-check.ts`). A command is refused
with a `GitUnusableError`, and no git is run, when the git is not there (`git-not-found`), when it is macOS's
`/usr/bin/git` without the developer tools, which offers to install them when it is run, so `xcode-select -p` is
asked first (`developer-tools-missing`), or when it is older than `GIT_FLOOR` (`git-too-old`).

**The floor is found, not chosen.** The engine's CI runs its suite on the oldest git still-supported systems ship
(Debian 12's and Apple Git, 2.39.5) and on the floor built from its source. It is 2.35.0: Ubuntu 22.04's 2.34.1
fails the suite, its `status --porcelain=v2 --show-stash` giving no count of the stashes.

## Failures

A failed command carries a code (`GIT_ERROR_CODES`, `src/errors.ts`) where what git printed says why; anything
else is git's own words. A code exists where the app does something different for it: a sentence clearer than
git's, or an action. The app's sentences are in `app-git-repository.ts` (`saidOfRemote`, `saidOfLocal`) and the
commit feature (`failureOf`).

| Code | What the panel does |
|---|---|
| `unsafe-ownership` | Git will not read a repository another user owns. Says so with the path git named, and offers to trust it, which adds that path to the user's global `safe.directory` (`trustOwnership`), only on their click |
| `untrusted` | The repository's own settings or hooks would run programs. Lists them and offers to trust it |
| `git-not-found`, `developer-tools-missing`, `git-too-old` | Says why and what to do |
| `signing-failed`, `unrelated-histories`, `nothing-to-commit`, `branch-exists` | A sentence that says what to do |
| `host-refused` | A hosting service refused a push for a rule of its own (`GH001`, `GH006`, `GH007`, `GH013`); the host's own words are kept |
| `aborted` | The user stopped it: nothing failed, and nothing is shown as a failure |
| `content-missing` | A file diff needs a version a partial clone was not given. Says so and offers to download it |
| `published` | A commit to be undone is already on a remote branch. Says so, and undoes it only once the user says to |

## Stopping a command

**Only a fetch and a push can be stopped** (`fetch(signal)`, `pushBranch(onProgress, signal)`). Stopped midway,
each leaves the working tree and the index as they were; a commit, a checkout, a stash or a merge would leave
them half-written with a lock behind, and a pull is one `git pull` whose merge cannot be told apart from its
fetch. The panel offers it while a push runs (`commit.STOP_PUSH`, answered `commit.PUSH_STOPPED`).

Stopping asks git to end, so it lets go of its locks, along with the helpers it started (`ssh`, the HTTPS
helper), found from the process table by their parents, since git does not end them when it is signalled. Any
still there after a grace are ended outright. On Windows the git started and everything under it are ended
outright by its id. A command stopped before its turn starts no git.

## A read never reaches the network

A partial clone was given less than everything, and git fetches what it lacks when a command needs it. The
engine's reads wait behind nothing and cannot be stopped, so they fetch nothing: each runs with
`GIT_NO_LAZY_FETCH`, and what it lacks is answered with `content-missing`. Git honours the switch from the May 2024
security releases on each line it then maintained (2.39.4, 2.40.2, 2.41.1, 2.42.2, 2.43.4, 2.44.1, 2.45.1) and in
every release from 2.46.0; 2.45.0 does not (`refusesLazyFetch`). In a partial clone
a file at a revision is read with `git show`, because the git kept open for reading files answers "missing" alike
for a file that is not there and for one whose content was never fetched.

A read is let fetch only inside `fetchingMissing(read)`, where it waits in line with the fetches and pushes. On a
git that cannot be told not to fetch, every read in a partial clone waits in that line. Writes
(a checkout, a merge) fetch what they need, as git does.

## Every repository under a folder

`GitRepository.repositoriesUnder(folder)` finds the folder's repository and those nested in it, submodules and
linked worktrees, by what each one's `.git` is, without running git. The commit panel shows a picker when there is
more than one (`LIST_REPOSITORIES`, `commit.REPOSITORIES_RECEIVED`); choosing one makes it the base directory, as a
worktree switch does, and the picker goes on listing what is under the folder the user opened (`openedDirectory`).
A submodule's row in its parent's status says how it differs (`submodule`).

## A conflict's three sides

`conflictSides(path)` reads a conflicted file's base, ours and theirs from the index's stages, beside the working
file and where its conflicts are marked; `resolveConflict` takes a side, a side that deleted the file, or content
written in its place. The diff a window asks for of a conflicted file carries the three sides (`GitDiff.conflict`),
and the editor shows them in place of the markers, with the side to take.

## Copies of the working tree

**A copy is kept outside the repository, and nothing of the repository's is written to keep it.** Each repository
has a store of its own: a bare git directory that borrows the repository's objects. The app names its place
(`RepositoryTies.checkpointDirectory`): under the pack's own data (`getDataDirPath('checkpoints')`), one store per
repository by the real path of its common git directory. A checkpoint (`checkpoint(paths?)`) is a commit there.
Commands run against the repository's own git directory, so what the tree, `info/exclude` and the user's own
excludes ignore is left out as it is by the user's git, with an index of the store's and objects written into the
store. `changedSince` and `restoreCheckpoint` compare and put back.

**An agent's turn is a checkpoint.** The action that starts a turn (`Claude Code Chat`, `Codex Chat`) takes one, and
the one that ends it (`turn-completed.ts`) reads what changed since: every file the turn changed, whatever wrote
it. The turn's diff artifact lists them and offers to take the turn back whole (`user.turn.takeBack`, the
`Take Back Turn` action), which puts the files as they were when it started.

A file over `KEPT_FILE_LIMIT` (10 MB) is left out, named, and never put back or removed. Checkpoints are kept for
14 days, and the oldest are dropped first while a store is over 1 GB. A discard keeps what it removes as a
checkpoint of those files, so a prune of the repository does not lose it.

## Undo

**The engine writes down what its own writes did, and `undo` takes back the last of them.** A commit, a reset to a
commit (which takes a checkpoint of the tree first), deleting a branch, and dropping or clearing stashes each record,
in a journal in the repository's store, every ref they moved with where it was and where it was left, and what
they removed. `undo` takes back the last entry only while every ref it moved is still where it left it: one moved
since by anyone is refused rather than moved back over what moved it. A commit a remote branch already holds is
refused with `published` until whoever asked says to go on (`evenIfPublished`), since undoing it here leaves it
there. The commit panel offers Undo after each of those writes (`commit.UNDO_LAST`), and asks first for a pushed
commit (`commit.UNDO_NEEDS_CONFIRMATION`).

## How what the watcher names is held

A watched repository reads only the paths its watcher named. Beside the listed cases (`noted-paths.spec.ts`), the
engine's `sequences.spec.ts` runs seeded sequences of edits, git commands and ignore-file changes and holds the
repository to a whole status after every step, printing the seed and the fewest steps that still show a
difference. It hands the watcher what a platform would report rather than waiting on one; `npm run
soak:sequences` in the engine runs as many seeds as it is given through the platform's own watch, and reports
what was lost without failing.

## Working on both at once

The link points at a checkout, so an edit there is what a local build here uses once the engine is built
(`npm run build` in the checkout, or `npm run link:apack-git`, which builds when `dist/` is stale). A local
chain then runs against the checkout's working tree, where CI clones the pin: the linker says when the two
differ. Commit and push the engine, move `vendor/apack-git.rev` to that commit, and land both.

In the Linux test container the engine arrives as files, its manifest and its `dist/`, since what the Mac
built is what Linux runs (`scripts/linux-runner.ts`).
