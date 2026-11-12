# The git engine's version 1, one pull request at a time

Status: active, run by [its goal](../goals/goal-git-engine-version-1.md). As of 2026-11-12 pull requests 1 and 2
have landed (apack #429 and #428), after [the engine's move to a repository of its own](../archive/plans/git-engine-own-repository.md),
and so have the [five additions](../archive/plans/git-engine-additions.md) the rest waited on. The next is 3.

Compiled 2026-11-11 against the code feature as it stood in the working tree that day, with git 2.38.1 on
macOS. Each pull request says under **Known** what was run, what was only read, and what is neither.

## What version 1 means

**An app can build its whole source control on the engine — see, change, sync, recover — for any folder a
developer or an agent opens, and the engine is never what breaks their git or loses their work.**

Version 1 is a reviewed door, not a frozen one. The engine has one consumer, pinned by commit and changed
with it ([CLAUDE.md](../../CLAUDE.md), "Backward compatibility"), and a freeze would protect nobody. It is
frozen and tagged when a second consumer exists that cannot move with it.

## Decided on 2026-11-12

The questions the items left open, settled before the work rather than in it:

- **Trust (1) stays where it landed**: it gates the git the engine runs and nothing else. A terminal and an
  agent run what the user or the agent chose to run; gating them would be a second notion of trust for the
  app to keep, for no case the engine's gate misses.
- **The checkpoint store (4)** lives under the app's data directory, one store per repository, named by the
  real path of the repository's common git directory, as trust is. A checkpoint expires after 14 days, and a
  store over 1 GB drops its oldest first. A file over `KEPT_FILE_LIMIT` (10 MB) is not kept, and the answer
  names it, as a discard does today. What is ignored is what the user's git ignores: the store is given the
  repository's `info/exclude` and the user's `core.excludesFile`.
- **An agent's turn (6)** is a checkpoint and nothing more. Taking a turn back is whole, not file by file, and
  the engine gets no call of its own for it: `checkpoint` and `changedSince` from 4 are the whole of it.
- **Every repository under a folder (7)** is a choice, not a merged view: the panel lists the repositories
  found, the folder's own first, and shows one at a time.
- **Clone, init and remotes (18)** are engine calls with no panel of their own yet.
- **Budgets (20)** are read in CI at 1,000 and 100,000 files. A million is the command, run by hand.
- **A name that is not text (23)** is refused by name, with a code, rather than carried as bytes.
- **The door (25)** is reviewed, referenced and given its example program, and is not tagged or frozen.

This plan holds what is beyond the work listed before it: the engine work that precedes the move, and the
five additions that follow it.

## How the order was chosen

1. **What is wrong today comes first.**
2. **A store before what uses it, and the event stream before what reads it.**
3. **Seeing before doing.** The panel's writes need the picture: the sides of a conflict and what a merge
   would do come before starting one.
4. **Scale and the review come last**, since they measure and describe what exists by then.

Each numbered item is a change in the engine's repository and the monorepo pull request that moves the pin and
lands the app's half, opened as soon as its branch is pushed.

| # | Pull request | Needs |
|---|---|---|
| 1 | A repository cannot make the engine run a program before it is trusted | the move |
| 2 | A discard keeps what it removes | the move |
| 3 | A read never reaches the network | the move, the five additions |
| 4 | A store outside the repository for copies of the working tree | 2 |
| 5 | A write that destroys something checkpoints first, and the last one can be undone | 4 |
| 6 | An agent's turn is a checkpoint | 4 |
| 7 | Every repository under a folder | 1 |
| 8 | The three sides of a conflict | |
| 9 | Diffs as data | |
| 10 | History that can be drawn | |
| 11 | Blame | 1 |
| 12 | Branches, remotes and tags as one model | |
| 13 | What can be done now, and why not | 12 |
| 14 | What a merge or a pull would do, before it is done | 12 |
| 15 | Git's own event stream, read | |
| 16 | Starting a merge, a rebase and a cherry-pick | 5, 8, 14, 15 |
| 17 | Rewriting the last commits | 5, 15 |
| 18 | Clone, init and remotes | 1, 15 |
| 19 | Tags, renaming a branch, stashing part of the changes | |
| 20 | Budgets, as readings | |
| 21 | A slow status says how to make it fast | 20 |
| 22 | A watch that is not delivering is said | |
| 23 | Names that are not text | |
| 24 | Parsers that survive anything | |
| 25 | The door, reviewed | all of them |

## The two that come first

### 1. A repository cannot make the engine run a program before it is trusted

**Today.** A plain `git status` runs the program a repository's own config names as its file monitor
(`core.fsmonitor`), and a diff runs a conversion or an external diff program named the same way. The engine
runs a status as soon as a folder is opened. One of its diff calls passes `--no-ext-diff --no-textconv`; its
status calls pass nothing. So opening a folder runs whatever that folder's `.git/config` says to.

- **Engine.** `trusted` is given when a repository is opened. Untrusted, the engine first reads what the
  repository itself says should run, without running it: its config at local and worktree scope, following
  includes, and the hook files that are executable. If that names nothing, the engine behaves as it does
  today. If it names something, opening answers that the repository asks for trust, with the list, and the
  engine runs no git that would run any of it: no status, no fetch in the background, no write.
- **App.** The panel shows the list and offers to trust the repository. Trust is remembered for it.
- **The rule is a list of settings known to run nothing** — what `git init` and `git clone` write, identity,
  the bookkeeping of branches and remotes — and everything else asks. The other way round, a list of the
  settings that run programs, asks less often and makes a hole of every setting it forgets;
  `be/services/shell-environment.ts` records what a hand-written list of that kind cost here. Which of the
  two is decided when this starts.
- **Done when** a repository with a monitor program in its config, one with a conversion program in a file its
  config includes, and one with an executable `reference-transaction` hook each leave that program unrun when
  opened untrusted, and run it as git does once trusted. Every case is a real git and a program that writes a
  marker file.
- **Known.** Run: a status ran the monitor program, with optional locks off; a diff ran the conversion
  program; `-c core.fsmonitor=false` and `--no-textconv --no-ext-diff` stopped them;
  `git config --local --includes --show-scope --show-origin` lists both settings, and without `--includes`
  misses the one in the included file. Read: VS Code's git extension does not run in a folder the user has not
  trusted (`untrustedWorkspaces: { supported: false }`); git's manual lists switches for the system's and the
  user's config files (`GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL`) and none for a
  repository's own.
- **To settle.** Where trust is kept and what names a repository there. Whether trust belongs to the folder
  and not to git: an agent and a terminal run in it too, and the app has no notion of a trusted folder.
- **Landed** in apack #429 (engine `src/trust.ts`). The rule is the list of settings known to run nothing.
  Trust is kept in the code feature's settings (`trustedRepositories`), by the real path of the repository's
  common git directory. It covers the git the engine runs and nothing else: a terminal, an agent and `gh` in an
  untrusted repository are not gated, which stands (Decided, above). A repository with Git LFS configured in
  its own config asks.

### 2. A discard keeps what it removes

**Today.** Discarding a changed file checks it out again. Discarding an untracked file deletes it, and an
untracked folder is removed with `git clean --force`. Nothing keeps a copy.

- **Engine.** Before a discard removes anything, it writes what is about to go into git's object store as a
  tree, built with an index of its own, and answers with an id. `restore(id)` puts those paths back. The
  user's index, refs and stash are not touched. Content over a size bound is not kept, and the answer says
  which paths.
- **App.** Undo after a discard, and a confirmation that names what cannot be brought back.
- **Its limit, said in the panel.** Nothing refers to that tree, so git keeps it for as long as it keeps
  objects nothing refers to: two weeks, unless the user's settings or a prune say otherwise. Pull request 4
  replaces it.
- **Done when** a changed file, an untracked file and an untracked folder are discarded and restored, and the
  status reads as it did before.
- **Known.** Run: all of that in a throwaway repository, where taking the copy left the index's bytes and the
  status unchanged and made no ref. Read: git prunes objects nothing refers to after two weeks unless told
  otherwise (`gc.pruneExpire`).
- **Landed** in apack #428 (engine `src/discards.ts`), with the bound at 10 MB a file (`KEPT_FILE_LIMIT`). Pull
  request 4 still replaces the two-week limit.

## Safe in any folder

### 3. A read never reaches the network

In a partial clone, reading content that was never fetched fetches it. The engine's reads wait behind nothing
and cannot be stopped, on the understanding that a read is local.

- **Engine.** Reads run with lazy fetching switched off (`GIT_NO_LAZY_FETCH`, git 2.45 and later) and answer
  with a code when content is missing. On an older git, a read that may fetch runs with the network commands.
- **App.** Offers to fetch what is missing.
- **Done when** in a clone made with `--filter=blob:none` from a local remote, reading an old version of a
  file leaves the remote untouched and answers the code.
- **Known.** Read: git's 2.45.0 release notes, where the switch arrives, and its manual. Not run: this
  machine's git is older than the switch, and no partial clone was made.

## Nothing is lost

### 4. A store outside the repository for copies of the working tree

- **Engine.** A second git directory for each repository, in a place the host names, which borrows the
  repository's objects. `checkpoint(paths?)` answers an id, `changedSince(id)` what differs now, and
  `restore(id, paths?)` puts files back. Checkpoints expire by age and by total size. The repository's index,
  refs and objects are never written. The discard of pull request 2 moves onto it under the same two calls.
- **Done when** a checkpoint, a change and a restore leave the repository's index bytes, status and refs as
  they were, and an ignored file is left out of the checkpoint.
- **Known.** Run: a checkpoint of 302 files wrote 5 objects outside and none inside; the repository's index
  bytes, status and refs were unchanged; a changed file, a deleted untracked file and a new file were found
  and put back; a file ignored by the tree's `.gitignore` was left out. Not run: its cost on a large tree, and
  seeding its index from the repository's so that unchanged files are not read again.
- **Settled** (Decided, above): where it lives, what expires it, and what it ignores.

### 5. A write that destroys something checkpoints first, and the last one can be undone

- **Engine.** A reset to a commit, a checkout that overwrites, a clean, and dropping or clearing stashes take
  a checkpoint first. A journal of what the engine itself did — the operation, each ref before and after, the
  checkpoint — lets `undo()` reverse the last entry.
- **App.** Undo for a commit, an amend, a deleted branch and a reset.
- **Done when** each of those writes is followed by an undo that puts refs and files back, and an undo of a
  commit that is already on its remote says so before it runs.

### 6. An agent's turn is a checkpoint

- **App.** The action that starts a turn takes a checkpoint, and the ones that end it
  (`claude-code/turn-completed.ts`, `codex/turn-completed.ts`) read what changed since. The thread shows what
  the turn changed and offers to take it back, whole.
- **Engine.** Nothing beyond 4.
- **Done when** a harness spec runs a turn that writes files, the thread's list equals what changed, and
  taking it back leaves the tree as it was before the turn.

## The whole picture

### 7. Every repository under a folder

- **Engine.** Finding the repositories under a folder: nested ones, submodules, linked worktrees. Each opens
  as a repository of its own, with its own trust and its own watcher. A submodule's row in its parent's
  status says how it differs: another commit, changed content, untracked content, which the machine-readable
  status already reports.
- **App.** A choice at the top of the panel, listing the repositories found with the folder's own first; the
  panel shows the one chosen.
- **Done when** a folder holding a repository, a submodule and a nested repository lists three, and a change
  inside the submodule is news for the submodule and one row in the parent.

### 8. The three sides of a conflict

- **Engine.** For a conflicted file: the common base, this side and the other side, read from the index, and
  where the markers are in the working file. `resolve(path, side | content)` writes the answer and marks it
  resolved.
- **App.** A view of the three, in place of markers in one file.
- **Done when** a real merge that conflicts yields three contents that match what each commit holds.
- **Known.** Run: after a conflicting merge the three were listed and read as `:1:`, `:2:` and `:3:` of the
  path.

### 9. Diffs as data

- **Engine.** Added and removed counts for every file in the list, from one command over the paths that
  changed; a stash's and a commit's contents as the same file list and hunks a working diff has.
- **App.** Counts beside each file, and a stash that can be looked into before it is applied.
- **Done when** the counts equal git's own for a tree with a text change, a binary change and a rename.

### 10. History that can be drawn

- **Engine.** The log with each commit's parents, in pages, for a chosen set of refs; one file's history
  across its renames.
- **App.** A graph, and a file's history from the editor.
- **Done when** a history with a merge and a renamed file pages without repeating or dropping a commit.

### 11. Blame

- **Engine.** Who last changed each line of a file at a revision, streamed as git finds it, leaving out the
  commits a repository lists to be ignored. Blame runs conversion programs as a diff does, so it runs under
  the trust of pull request 1.
- **App.** A gutter in the editor.
- **Done when** each line of a file with three authors and one ignored commit is answered as `git blame`
  answers it.

### 12. Branches, remotes and tags as one model

- **Engine.** Every branch with its upstream and how far ahead and behind it is, from one command; the
  remotes and their addresses; the tags. The snapshot gains a part for them, so the news can say they changed.
- **App.** The branch picker shows each branch's standing.
- **Done when** a fetch that moves a remote branch is news of that part and of nothing else.

### 13. What can be done now, and why not

- **Engine**, as a window-safe entry with no Node imports: from a snapshot, whether a commit, a push, a pull
  and a sync are possible, and the reason when one is not — nothing staged, no upstream, diverged, an
  operation in progress, conflicts unresolved, no identity.
- **App.** A disabled button says why.
- **Done when** each reason has a snapshot that produces it and one that does not.

### 14. What a merge or a pull would do, before it is done

- **Engine.** `preview(target)` answers fast-forward, a clean merge, or the files that would conflict, without
  moving anything, with `git merge-tree --write-tree`. Below the git that has it, the answer is "not known".
- **App.** The panel says what a pull will do before the click.
- **Done when** a preview of a conflicting merge names the files a real merge then conflicts in, and leaves
  HEAD, the index and the tree as they were.
- **Known.** Run: on git 2.38.1 it named the conflicting file, exited 1, and moved neither HEAD nor the
  working tree.

## The whole set of writes

### 15. Git's own event stream, read

Git writes what it does as events when asked (`GIT_TRACE2_EVENT`): the hooks it runs and how each ended, the
processes it starts with their ids, and the time each phase took.

- **Engine.** Every git it starts is asked for the stream. A commit a hook refused answers with a code, the
  hook's name and its exit code, and the hook's output as the hook's. The ids are what stopping a command
  ends; the phases are the detail in the log of commands.
- **App.** The panel shows a hook's refusal as the hook's, with its output.
- **Done when** a commit refused by a `pre-commit` hook that exits 3 answers that hook and that code.
- **Known.** Run: the stream named the hook (`"child_class":"hook","hook_name":"pre-commit"`) and its exit
  code 3, where git itself printed only what the hook printed.

### 16. Starting a merge, a rebase and a cherry-pick

**Today** the engine carries on or abandons one of these when something else began it, and begins none.

- **Engine.** `merge(ref)`, `rebaseOnto(ref)` and `cherryPick(commits)`, each after a checkpoint. One that
  stops on a conflict is the operation in progress the snapshot already describes.
- **App.** The panel offers them from a branch and from a commit, with the preview of pull request 14.
- **Done when** each runs clean, stops on a conflict that can be carried on or abandoned, and can be undone.

### 17. Rewriting the last commits

- **Engine.** Amend the last commit's message or content; undo it; and squash, reorder, reword or drop
  commits in a range, by a rebase whose list the engine writes. It refuses a range that reaches commits
  already on the upstream unless told to go on.
- **App.** Those, from the history.
- **Done when** each leaves the tree's content as it was and can be undone.

### 18. Clone, init and remotes

- **Engine.** `clone(url, directory)` with progress and a way to stop it; `init`; adding, renaming and
  removing a remote and changing its address. A clone's result is a repository the user asked for, whose
  config is what git wrote.
- **App.** Nothing yet: the calls exist for completeness, and a panel for them is later work.
- **Done when** a clone of a local remote reports progress, can be stopped leaving no directory behind, and
  opens trusted.

### 19. Tags, renaming a branch, stashing part of the changes

- **Engine.** Making, deleting and pushing a tag; renaming a branch; stashing chosen paths, or only what is
  staged.
- **App.** Those, where the branch and stash lists are.
- **Done when** each is held to what git reports afterwards.

## Scale, promised

### 20. Budgets, as readings

- **Engine's repository.** A generator of repositories of 1,000, 100,000 and 1,000,000 files, and a command
  that prints what opening, a whole status, a path-scoped read and a checkpoint cost on each, with the
  machine's conditions beside them. The README states a budget for each size. CI prints the readings for
  1,000 and 100,000 files and fails on none of them; a million is run by hand.
- **Done when** the readings exist for all three sizes on all three platforms, the million read by hand.

### 21. A slow status says how to make it fast

- **Engine.** When a whole status costs more than its budget, the snapshot says so, and whether git's own file
  monitor and untracked cache are on for the repository.
- **App.** Offers to turn them on, which writes the user's git config and so happens on their click.
- **Done when** a repository over the budget with both off says so, and with both on does not.
- **Known.** Read: git's manual says its built-in file monitor is available on Windows and macOS only. Not
  run.
- **A spike beside it, which may end in "no".** The engine already knows which paths changed, and git asks a
  monitor exactly that. Whether the engine can answer for its own reads depends on git recording what it was
  told in the index, which the engine's reads do not write.

### 22. A watch that is not delivering is said

- **Engine.** A change that a check finds and no event announced is evidence that the watch is not
  delivering. The engine counts them, and past a bound the snapshot says live updates are not arriving here,
  with the reason where it has one (a network drive, a limit on watches reached). No timer decides it.
- **App.** The notice that exists for a failed watch says this too.
- **Done when** a watcher that is stood in for and reports nothing leads, after checks that find changes, to
  that state, and one that reports them does not.

### 23. Names that are not text

Linux allows a file name that is not valid UTF-8. The engine decodes git's output as UTF-8, so such a name
arrives changed, and a later command names a path that does not exist.

- **Engine.** Such a file is refused by name with a code, and every other file reads as before.
- **Done when** on Linux a file with such a name is listed as refused, and the rest of the tree is listed,
  staged and discarded as it would be without it. macOS does not allow the
  name, so the case runs where it can.
- **Known.** Read from how the output is decoded. Not run.

## A promise

### 24. Parsers that survive anything

- **Engine's repository.** Every reader of git's output — the status, the log, refs, stashes, worktrees,
  blame, counts, the event stream — is run over generated bytes and over the output of generated
  repositories. None throws, none loops, and each gives back what git printed.
- **Done when** a fixed set of seeds runs in CI on three platforms.

### 25. The door, reviewed

- **Engine's repository.** Every export is read against the monorepo's naming rules and has a firing case. The
  reference is generated from the source. An example program prints the news for a folder, and is the
  diagnostic for a watch as well. The README states what is supported — three platforms, and git from the
  floor the five additions found to the newest — and CI runs exactly that.
- **Done when** all of it holds at one commit. It is not tagged or frozen (Decided, above).

## Left out of version 1

- **Pull requests and GitHub.** The app's half of the boundary.
- **The credential prompt.** The app's half; the engine names the failure.
- **Managing LFS.** The engine says when it is missing and nothing more.
- **A visual interactive rebase.** Pull request 17 is what it would stand on; the view is the app's, later.
- **Bare repositories, and the engine as a service another machine reaches.**
- **Computing a status itself.** The engine's promise is the user's own git.

## No other language for version 1

The engine's own code is not where the time goes. Read on 2026-11-11 with git 2.38.1, on a machine whose load
average was 21.8:

| What | Cost |
|---|---|
| The engine's parser over a status of 10,000 entries, its cap | 4.8 ms |
| Starting git at all | 11.6 ms on the clock, 5.6 ms of CPU |
| A whole status of this repository, 3,515 tracked files | 40.8 ms |
| A whole status of 100,000 files, read on 2026-11-10 | 294 to 341 ms |

The slow part is git walking a large tree, and the watcher already waits 200 ms of quiet before a read, so
the cost of starting git is not seen.

| Candidate | Verdict |
|---|---|
| A status computed in the engine's process by a library that reimplements git | Not for version 1: it is a second truth beside the user's git. Later only as an accelerator held to git by the sequence spec. |
| The watcher | No: it would wrap the interfaces Node already uses. |
| Ending a whole tree of processes on Windows | Only if the Windows run shows the system's own tools are not enough, and then as a small program of its own. |
| Heavy pure functions, such as a diff by word | WebAssembly if it comes to it, which keeps the package free of native binaries. |

Two rules, whatever is decided later:

- **Native code runs as a process of its own, never loaded into the app's.** The terminal broker works that
  way, and a native watcher loaded into the database's process is what the code feature stopped using.
- **Rust before Go.** Two siblings already carry its toolchain and its CI.

What removes process starts without either is git's own modes that answer many questions on standard input:
file contents, what is ignored, a path's attributes.

## Done when

- Every pull request above has landed, or has been dropped here with its reason.
- The engine's CI passes on macOS, Linux and Windows over the gits it supports.
- The door is reviewed and documented.
- The engine's reference page describes the result, and this plan is archived.
