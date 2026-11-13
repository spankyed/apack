# The git engine's version 1

> **Done 2026-11-12.** Items 3 to 25 of [the plan](../plans/git-engine-version-1.md) landed, each with an engine
> pull request green on macOS, Linux and Windows and the app's half merged on the chain; none was dropped.
> [`docs/references/git-engine.md`](../../references/git-engine.md) describes the result. The Outcome below says
> what each landed as and what was found on the way.

```text
# Goal: the git engine's version 1, item by item, each merged as it lands

Implement docs/goals/goal-git-engine-version-1.md. Follow CLAUDE.md and docs/AGENTS.md.
Read the plan it links (its Decided section first), then Current handoff and Working rules.
Surveyed at monorepo 53bfeea029, engine apack-git master f2f4074937 (pinned 67b9a35); inspect current code first.

Finished when:
- Every item 3 to 25 in the plan has landed, or is dropped there with its reason and the user's word.
- Each landed item: its Done when green in apack-git's CI on macOS, Linux and Windows,
  vendor/apack-git.rev at that commit, the app's half passing the chain, both pull requests merged.
- docs/references/git-engine.md describes the result, and the plan and this goal are archived with an Outcome.

Merge each item as soon as its checks pass; do not wait to be asked. Do not expand or reduce scope without the user.
```

## Scope

Items 3 to 25 of [the plan](../plans/git-engine-version-1.md), in its table's order, as amended by its
"Decided on 2026-11-12" section: trust stays on the git the engine runs; checkpoints in the app's data directory
at 14 days and 1 GB; an agent's turn taken back whole; several repositories as a picker; clone, init and remotes
with no panel; budgets read in CI at 1,000 and 100,000 files; a name that is not text refused by code; the door
reviewed, not frozen or tagged.

Out of scope: everything under the plan's "Left out of version 1", and another language for any part of it.

## Working rules

- **One item, two pull requests, merged in order**: the engine's (`spankyed/apack-git`), then the monorepo's,
  which moves `vendor/apack-git.rev` to the merged engine commit and lands the app's half. Each is opened
  ready for review as soon as its branch is pushed, and merged once its checks pass.
- **Items without dependents between them may run in parallel**, each in its own worktree and branch, never
  two on one file. The plan's Needs column is the order.
- **A firing case on a real git** for every Done when, run on all three platforms in the engine's CI. A case
  that needs a git newer than the floor (item 3 needs 2.45) runs where that git is and the older path is
  held on the floor job.
- **The app's half is driven once in the built app** (`npm run dev:drive`) where it shows something.
- **A defect found while working on an item** is fixed in that item's pull request if it is in the item's
  code, or in a pull request of its own, merged the same way, if not.
- **Process-ending code** is never mutation-tested on a developer machine, and ends only processes a case
  started, by their ids.

## Checkpoints

| Group | Items | Done when |
|---|---|---|
| Safe in any folder | 3 | merged |
| Nothing is lost | 4, 5, 6 | merged; the discard of item 2 runs on the store of 4 |
| The whole picture | 7 to 14 | merged |
| The whole set of writes | 15 to 19 | merged |
| Scale | 20 to 23 | merged; the readings of 20 recorded in the engine's README |
| The door | 24, 25 | merged; reference generated, example program in the engine's repository |

## Outcome

Landed 2026-11-12, every item 3 to 25, none dropped. The engine's halves are apack-git pull requests merged on its
CI (macOS, Linux, Windows, git 2.35.0, Debian 12's and Apple's); the app's halves are apack #449 to #467 and the
door's, each moving `vendor/apack-git.rev`. Items 18, 20 and 24 have no app half, by the plan; 23's plan named
none, and the app's bulk Stage, Unstage and Discard all leave a refused name out (#467), since one such path
failed the whole batch.

Two readings of the condition are the user's word, given on 2026-11-12. **The chain is master's**: the item
branches merged without a chain run of their own, and master at `5ea403a8ea`, holding all of them, passed the local
chain (`--no-native`) and strict run 43339669292, every job green; the user took that as each item's chain. **An
item the plan gives no app half has landed on its engine pull request alone** — 18, 20 and 24 (apack-git #15, #19,
#23), each green on all three platforms.

What the work found that the plan did not say:

- **History from several refs never worked.** `tipsOf` resolved them with `rev-parse --verify`, which takes one
  name; item 16's history over every local branch found it (apack-git #24).
- **A reword from the history would have dropped a commit's body**, since the history carries the subject alone;
  `commitMessage` reads the whole message (apack-git #25).
- **`startWatching` resolved before its watches were in place**, so an edit made just after was never reported;
  item 25's example program found it, and it resolves two turns later (apack-git #26).
- **Linux has no file monitor of git's own**, so a slow status there with the untracked cache on is the engine's
  fact and nothing for the app to offer; the app offers only what it can turn on (#465).
- **The door was reviewed by a generator, not by reading.** `REFERENCE.md` is written from the entries, and CI
  fails on an export or public member no spec uses; of 42 such values, those the app uses got cases, the rest left
  the door, and five dead `GitRepository` methods went. Reads named `get*` are `read*` or `find*`.

Found and fixed after the goal closed (apack-git #27, pinned by apack #472): the synthetic diff of an untracked
text file counted one line too many; `readDiffs` treated a file in an untracked folder as tracked and took an
absolute path inside the repository only with `/`; `StashConflictError` carried no code. Under three concurrent chains the external-pack fork spec's Electron sometimes did no work for
120 s after `will-quit`; it passed alone and as the chain runs it on a quieter machine.
