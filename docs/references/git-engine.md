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

## The door

The engine's entries are `apack-git`, `apack-git/staging` and `apack-git/availability`; the last two import nothing
of Node's, so a window can use them. Its `REFERENCE.md` is every export with its comment and signature, generated
from the source, and its CI fails on a difference or on an export or public member no spec uses. Reads are named
`read*` (`readStatus`, `readDiff`, `readBranches`, `readStashChanges`) and searches `find*` (`findBaseBranch`), by
this repository's naming rules. `examples/news.mjs` there is a host in thirty lines, printing a folder's news as it
happens, and the diagnostic for a watch. What is supported is Linux, macOS and Windows, Node 24.12 or later and git
from 2.35.0 to the newest, which is what its CI runs.

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

## Diffs as data

`lineCounts()` is git's own count of the lines each changed file adds and removes (`--numstat`), staged and not, one
command a side; the commit panel's status answer carries it (`counts`, for up to 500 changed files) and each row
shows it. `changesIn(commit)` and `readStashChanges(index)` list what a commit or a stash changed with the same counts; a
stash in the panel's list opens to show its files before it is applied (`commit.GET_STASH_CHANGES`).

## History that can be drawn

`history({ refs, cursor, path, limit })` pages the log in topological order, each commit with its parents and the
refs at it; the cursor walks from where the first page stood, so a ref moving between pages neither repeats nor drops
a commit, and `path` follows a file across its renames. The commit panel's log reads it a hundred commits a page
(`commit.LOG_LIST` with `cursor` for Load more), draws lanes beside the commits (`laneRows`), and shows one file's
history when an editor tab asks for it (`commit.SHOW_FILE_HISTORY`). The panel's whole history is of every local branch
with what is checked out, so another branch's commits are there to pick; a file's is of what is checked out.

## Merging, rebasing and picking

`merge(target)`, `rebaseOnto(target)` and `cherryPick(commits)` each take a checkpoint first and are written in the
journal, so undo takes one back; one that stops on a conflict throws, and is the operation in progress the snapshot
describes, carried on or given up with `moveOperation`. The branch picker offers a merge and a rebase on each other
branch, the merge's button titled with what it would do (`commit.PREVIEW_MERGE`), and the history offers a pick on
each commit that what is checked out does not hold (`commit.START_OPERATION`, answered `commit.OPERATION_STARTED` with
whether it stopped). None is begun while another is in progress.

## Rewriting the last commits

`amend({ message })` amends the last commit with what is staged, and `rewrite(base, steps)` rewords, folds, reorders or
drops the commits after `base` by a rebase whose list the engine writes; each is refused with `published` for a commit
a remote branch holds unless `evenIfPublished`, and each is written in the journal, so undo takes it back.
`commitMessage(commit)` reads a commit's whole message. The commit panel amends from under its Commit button, and its
history rewords (over the whole message), folds into the commit before or drops a commit of what is checked out
(`commit.REWRITE_COMMIT`), refusing a fold of the first commit and a range with a merge in it; a refusal for a commit a
remote branch holds is asked about (`commit.REWRITE_NEEDS_CONFIRMATION`) and done once the user says to go on.

## Branches, remotes and tags

`refsModel()` reads every branch with its upstream and how far ahead and behind it is in one command, beside the
remotes with their addresses and the tags. The snapshot's `refs` part says when any of them moved; `history` is what
is checked out and the local branches, so a fetch that moves a remote's branch is news of the refs alone. The branch
picker shows each local branch's standing (`commit.BRANCHES_RECEIVED` `standing`).

The commit panel lists the tags in its branch picker, each pushed (`pushTag`) or deleted there, and makes one at a
commit of its history (`createTag`); a local branch is renamed from its row in the picker (`renameBranch`), and a
changed file's menu stashes that file alone (`stashPush` with its path).

## Blame

`blame(path, { revision, onLines })` reads `git blame --incremental`, handing each group of lines on as git finds it,
and leaves out the commits a repository lists in `.git-blame-ignore-revs` (or the file `blame.ignoreRevsFile` names).
An editor tab's menu asks for it (`commit.GET_BLAME`), and the editor draws each line's author and date before it
until blame is hidden.

## What can be done now, and why not

`whatCanBeDone(snapshot)`, from the window-safe entry `apack-git/availability`, says whether a commit, a push, a pull
and a sync can be done now and the first reason when not; the snapshot says whether git has a name and an email to
commit with (`hasIdentity`). The commit panel decides with it from what it holds, and titles the Commit and sync
buttons with the reason in its own words.

## What a merge or a pull would do

`previewMerge(target)` answers up to date, a fast-forward, a clean merge or the files a merge would stop on, from
`git merge-tree --write-tree`, which moves nothing; before git 2.38 it is `unknown`. The status of a branch behind its
upstream carries a pull's preview (`pullPreview`), and the sync button says it before the click.

## A hook's refusal

Every git the engine starts writes git's own event stream (`GIT_TRACE2_EVENT`) beside it, which names each hook git
ran and the code it exited with. A command a hook refused throws `HookRefusedError` (code `hook-refused`) with the
hook's name, its exit code and what it printed; the commit panel says which hook refused and shows its output under
that, rather than git's words around it.

## A slow status

A whole status that took longer than its budget, with git's own file monitor or its untracked cache off, says so in
the snapshot (`slowStatus`). The commit panel offers to turn them on while one it can turn on is off — the file
monitor only on macOS and Windows, where git has one — and `speedUpStatus` writes them to the repository's own
settings on the user's click (`commit.SPEED_UP_STATUS`).

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

A watch that is open and not delivering is evidence, not a timer: checks keep finding changes no event announced,
and past a bound the snapshot says so (`watchSilent`). The commit panel's notice for a watch that could not be
opened says this as well, for as long as the statuses it is sent say it.

A watch that has just opened is not yet delivering either, and the platform says nothing when it starts to:
`startWatching` resolves once the watches are open, and two seconds later the watcher reports the checkout once
as one in which anything may have changed, which is what covers an edit made in between (`catchUpAfterMs`).

## Working on both at once

The link points at a checkout, so an edit there is what a local build here uses once the engine is built
(`npm run build` in the checkout, or `npm run link:apack-git`, which builds when `dist/` is stale). A local
chain then runs against the checkout's working tree, where CI clones the pin: the linker says when the two
differ. Commit and push the engine, move `vendor/apack-git.rev` to that commit, and land both.

In the Linux test container the engine arrives as files, its manifest and its `dist/`, since what the Mac
built is what Linux runs (`scripts/linux-runner.ts`).
