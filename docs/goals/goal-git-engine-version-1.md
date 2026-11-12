# The git engine's version 1

Status: active, 2026-11-12. Items 1 and 2 landed before this goal; item 3 is next. The design and every item's
Done when are in [the plan](../plans/git-engine-version-1.md); this goal owns the order, the checkpoints and
when it is finished.

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

## Current handoff

Nothing started. Next: item 3, a read never reaches the network, from apack-git master `f2f4074937` and monorepo
`53bfeea029`.
