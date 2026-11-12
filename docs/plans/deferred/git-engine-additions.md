# Five additions to the git engine

Status: deferred by request, 2026-11-11. Starts after [the git engine has a repository of its
own](../../archive/plans/git-engine-own-repository.md), whose "Done when" holds: deferral is not permission to
start.

Compiled 2026-11-11. Each item is something another package does better than the engine did on that day. What
was read: `dugite` 3.3.3 (`lib/errors.ts`), VS Code's git extension at `main` (`extensions/git/src/git.ts`,
`main.ts`), `simple-git` 4.0.2 (its README), `git-tree-state` 0.1.1 (its source), and this repository's
`master` at `292ff4a3dd`. What was run is said under each item, with git 2.38.1 on macOS; the rest is from
reading and needs running before it is relied on.

## Why after the move

- **Each changes what the engine offers**, so each is drawn against the door the move settles. Done before,
  each would be drawn twice.
- **Three of the five are what the engine's own CI is for.** Finding git differs by platform, ending a process
  differs on Windows, and file names fold differently on macOS and Windows than on Linux. The monorepo checks
  one platform cheaply; the engine's repository checks three on every push.
- **None of them blocks the move.**

The first is the exception in kind: it is a wrong answer to the user today, not a missing ability. It is here
by request, and it is small enough to take ahead of the move if it starts to matter.

Every item has an engine half, in the engine's repository, and an app half, in the pack: a code or an answer
on one side, and what the panel says and offers on the other.

## 1. A repository git refuses to trust

**What happens today.** Git refuses to read a repository owned by another user:

```
fatal: detected dubious ownership in repository at '<path>'
To add an exception for this directory, call:

	git config --global --add safe.directory <path>
```

It exits 128. The engine's `isGitRepository()` answers with whether `git rev-parse --git-dir` succeeded, so
the commit feature answers `Not a git repository` and the panel shows a folder with no repository in it. Git's
refusal was reproduced in a throwaway repository with git's own test switch
(`GIT_TEST_ASSUME_DIFFERENT_OWNER=1`); the engine's path was read, and not run through the app.

It is met on shared and external drives, in containers, and in folders made under `sudo`.

**What others do.** VS Code matches that text and can add the folder to `safe.directory` for the user.
`dugite` names the failure `UnsafeDirectory`.

**The change.**

- Engine: opening a folder has three answers where it has two: a repository, no repository, and a repository
  git will not read because of who owns it, with the path git named.
- App: the panel says which, and offers to trust the folder. Trusting runs the command git printed, which
  writes the user's global git configuration, so it runs only on their click. The panel then opens the
  repository again.

**Its firing case** is a real git given `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` in the environment the engine is
handed.

**To settle.** How the path is spelled in `safe.directory` on Windows and for a network share, read on the
Windows run.

## 2. Finding git, and saying when it cannot be used

**What happens today.** The engine runs `git` from the path. It says git is not installed only when the file
is missing (`ENOENT`). It reads no version, and there is no setting for where git is. The code feature already
finds its other programs properly (`be/utils/resolve-cli.ts`: a path from settings, known install locations,
then the path), and git is not among them.

**What others do.** VS Code takes a configured path, then looks where git is usually installed on Windows
(`ProgramW6432`, `ProgramFiles(x86)`, `ProgramFiles`, `LocalAppData\Programs`), then the path. On macOS, before
it runs `/usr/bin/git`, it runs `xcode-select -p`: without the developer tools that file is a placeholder, and
running it makes the system offer to install them. It warns under git 2. `dugite` ships a git of its own, so
none of this arises.

On a Mac without the tools the engine would run the placeholder on every status. That follows from the code
and from VS Code's handling of it; it was not reproduced, the machine this was compiled on having git.

**The change**, split at the boundary:

- App: where to look. Git joins the programs `resolve-cli.ts` finds, with a path in the code feature's
  settings, and the engine is handed the result.
- Engine: whether what it was handed can be used. Once per path it checks for the macOS placeholder, reads
  `git --version`, and refuses with a code and the version it found when git is missing or older than the
  engine's floor.
- App: the panel says which, and what to do about it.

**The floor is found, not chosen.** The engine's commands use what recent gits added (machine-readable status
with the stash count, for one), and nothing says which version is the oldest that works. Its CI runs its
specs against the gits that supported operating system releases still ship, and the oldest that passes is the
floor.

**Its firing cases.** A stand-in `git` that prints an old version; a path with nothing at it. The macOS
placeholder cannot be produced on a machine that has the tools, so the check for it takes the answer of
`xcode-select` as something a case can stand in for, and its real behaviour is seen once on a Mac without
them.

## 3. More kinds of failure, named

**What happens today.** The engine reads what git printed into a small table of codes, nine on the day this
was compiled. `dugite` names 60, grown from GitHub Desktop's users.

**The change.** A code is added when the panel does something different for it: an action, or a sentence
clearer than git's. Everything else stays git's own words. `dugite`'s table is a checklist to read down, not
a dependency and not a list to copy whole. The ones a commit panel meets:

| Failure | What git or the host prints | Seen how |
|---|---|---|
| Signing failed | `error: gpg failed to sign the data` | Reproduced: a commit with `commit.gpgsign=true` and a signing program that fails |
| Histories share nothing | `fatal: refusing to merge unrelated histories` | Reproduced: a pull from a repository with its own first commit |
| Nothing to commit | `nothing to commit, working tree clean`, on stdout, exit 1 | Reproduced |
| The branch exists | `fatal: a branch named '<name>' already exists` | Reproduced |
| The host refused a push: a file too large, a protected branch, a private email address, a secret found | `GH001`, `GH006`, `GH007`, and GitHub's push protection | Read from `dugite`'s table |

**Its firing cases.** A real git for every row that can be produced on one machine. A host's refusal cannot
be, so those cases run on text recorded from the host, and say so, with the day it was recorded.

## 4. Stopping a command that is running

**What happens today.** Nothing can stop a git the engine started. A push or a fetch that hangs ends when its
process has done no work for `IDLE_MS`, two minutes (`@apackdev/sdk/progress`); until then the panel shows it
running and the user can only wait. The contract has no event for it.

**What others do.** `simple-git` takes an abort signal for a running command, and VS Code passes a
cancellation token through its git calls.

**The change.**

- Engine: fetch and push take an abort signal. Aborting ends git and what it started, by the process the
  engine itself started, and the answer is a code of its own, since the user asked for it and it is nothing to
  report as a failure.
- App: an event to cancel, and a Cancel beside the panel's spinner.

**What may be stopped is narrow on purpose.** A fetch or a push stopped midway leaves the working tree and the
index as they were. A commit, a checkout, a stash or a merge stopped midway leaves them half-written with a
lock behind, so those are not offered. Pull is run today as one `git pull`, in the lane of writes; it is
offered only if it is first run as its two steps, so that only the fetch can be stopped.

**To settle.**

- Git removes its own locks when it is ended by a signal it can catch, and not when it is killed: run here, a
  git holding `index.lock` removed it on `SIGTERM` and left it on `SIGKILL`. So ending is a request first and
  a kill only after a grace, and a snapshot is read in full afterwards.
- Windows has no such signal: a process there is ended outright. What a stopped fetch and a stopped push leave
  behind on Windows is read on the Windows run, and decides whether stopping is offered there.
- Git starts helpers of its own (`ssh`, the HTTPS helper). Ending them with it means the engine starts git in
  a process group of its own, which changes what happens to a git when the app itself dies.

**Its firing case.** A remote that never answers: an ssh command that waits, and that ends by itself when its
fixture is deleted. The case stops the fetch and finds it answered at once, with the process it started gone.
Code that ends processes is run only against processes a case started and named by their ids, and is left out
of any mutation run on a developer's machine.

## 5. Sequences, not cases, held to a full status

**What happens today.** The engine reads only the paths a watcher named and puts the answer into the snapshot
it holds. That is the truth only while each file's standing is its own, so it reads everything when it may
not be: the index or a ref moved, a rename is in play, an ignore file changed, a folder is a repository of its
own. `git-noted-paths.spec.ts` holds each of those cases to what a whole status says. A case nobody listed is
held to nothing.

**What others do.** `git-tree-state` scripts whole scenarios (write, rename, add, commit, reset) through a
real watcher over real files, and waits a fixed time after each step.

**The change** is a spec, and no code:

- A generator makes a sequence of steps from a seed: a file written, changed, deleted or renamed, a rename
  that changes only case, a folder made, paths added and reset, a commit, a switch of branch, a stash, an
  ignore file edited, a repository made inside the tree.
- Each step yields the paths a watcher would name, through the function the watcher itself uses, or says there
  were too many to name.
- After each step the engine is told those paths and reads; a second engine, opened fresh, reads everything.
  The two snapshots are compared.
- A difference prints the seed and the shortest run of steps that still shows it.
- A fixed list of seeds runs in CI on all three platforms, where names fold differently. A longer run is a
  command, as `npm run soak:watch` is here.

**What it does not do is wait on the platform's watcher.** This repository stands the platform in for that
reason (`tests/features/code/be/services/directory-watch.spec.ts`: whether a watcher delivers is the
platform's to answer, and a case waiting on it passes only on a quiet machine), and a fixed wait after each
step is that same case. Real edits through the real watch belong in the longer command, which reports what
was lost and gates nothing.

## Order

1. **The untrusted repository**: one answer and one offer.
2. **More kinds of failure**: a row at a time, each with its case.
3. **Finding git**: the app's resolver, the engine's check, and the floor from CI.
4. **Sequences**: a spec, which may find defects that then come first.
5. **Stopping a command**: the largest, since it ends processes and differs by platform.

Each is done when its firing case passes on macOS, Linux and Windows in the engine's CI, the pin has moved,
and the panel's half passes the chain.

## Looked at and not taken

- **Reading without starting a process** (`es-git` 0.7.0, `@napi-rs/simple-git` 1.2.0, `nodegit` 0.27.0, all
  over libgit2). Faster for each read than a git process: a file version cost 11 ms as its own process here on
  2026-11-10. One long-lived `git cat-file --batch` cost 0.3 ms, with nothing native, and a native library
  sharing a process with the database is what the watcher's move off its library was for.
- **Working with no git installed** (`isomorphic-git` 1.44.12). It does not run the user's git, and so not
  their hooks or their configuration, which the engine relies on.
- **Shipping a known git** (`dugite`). It ends the questions of item 2 at the cost of a git per platform in
  every install. It is what to reach for if finding git becomes a burden of its own.
