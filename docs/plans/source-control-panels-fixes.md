# Fixing the source-control and pull request panels

Status: decided 2026-11-14 (its four decisions below). Phases 1 and 2 landed 2026-11-14; phases 3 and 4 next.

Surveyed at monorepo `origin/master` `eb567581ac` and apack-git `cf7be5d` (the pin), by four read-only reviews — the
commit panel and the pull request panel, frontend and backend each — and a check of the findings against the code.
Line numbers are at that commit; paths are under `packages/default-setup/src/features/code/` unless they name the
engine (`apack-git/src/…`).

**Known**, for each item:

- **V** — verified: read in the code at that commit, or written there this week and known.
- **D** — seen in the running app, on 2026-11-13, driving the panels against github.com.
- **R** — reported by a review and not yet checked line by line; the first step of its fix is confirming it.

## What done means

**The panels show what git and GitHub say, for the folder and the pull request on screen, and nothing they did not
ask for runs.**

- Every answer a panel takes is the answer to an ask it still holds (`answersCall`, `recordCall`, `settleCall`), and
  a busy flag clears on its own ask's answer and no other. No state survives a change of folder or of pull request.
- A pull request reads correctly whether its head is in the repository or a fork, its branch is deleted, its base
  exists only on the remote, the checkout is on a detached HEAD, or the pull request is closed or merged.
- No git command runs that the user did not ask for: no pull hidden in a checkout, no branch made up for a name
  that does not exist.
- Each fix lands with a spec that fails without it (mutation-checked), and its phase with the chain. A change in the
  engine lands first as an apack-git pull request, green on macOS, Linux and Windows, and the pin moves with the
  app's half.

## Decided on 2026-11-14

1. **Checkout's hidden pull (3.1) is removed.** A checkout checks out. "Checkout & Pull Base" in the pull request
   panel, which today pulls only because of it (`fe/features/pull-request/state.ts:558` sends a checkout and nothing
   else), becomes a checkout followed by an explicit pull, and says what the pull did.
2. **Checking out a name that is no branch (3.2) is refused**, naming the branch, with "Create branch" offered —
   rather than a local branch created silently, which turns a mistyped name into a new branch.
3. **Forks (2.2–2.4) are made safe, not supported as a workflow.** No fork's pull request is taken for the branch's
   own, and no branch is deleted in the wrong repository. Working *from* a fork (listing and opening pull requests
   against the parent repository, a head of `owner:branch`) is a feature, listed in phase 5.
4. **Deleting a pull request's branch (2.3) is confirmed first**, and offered only for a head in the same repository
   that no other open pull request uses.

## Phase 1 — answers and lifetimes, both panels' frontends

The root of most of what feels broken. The pull request panel's machine correlates no answer at all (no
`answersCall`, `recordCall` or `settleCall` in `fe/features/pull-request/state.ts`); the commit panel's correlates a
few and clears everything on any error. One pull request for this phase, frontend only, except 1.5.

| # | Defect | Where | Known | Fix |
|---|---|---|---|---|
| 1.1 | Any `commit.ERROR_RECEIVED` clears every busy flag: a failed blame or diff ends a running push's spinner, its toast says "Push failed", and Push can be pressed again | `fe/features/commit/state.ts:790-808`, `:1203` | V | Record each write's call; an error clears the flag of the ask it answers |
| 1.2 | Every status answer clears the current error: a refused stage, a failed push and its sign-in offer, a hook's refusal vanish within milliseconds | `fe/features/commit/state.ts:785-787` | V | A status answer clears only the failures a status read reports (trust, ownership, git not usable) |
| 1.3 | Busy flags no error clears: `isStashing`, `isWorktreeLoading`, `isSpeedingUpStatus`; a failed blame leaves an empty blame, a failed message read leaves "Reading its message…" | `fe/features/commit/state.ts:790-808`, `:1050`, `:1118`, `:1447` | V | Clear each on the error answering its ask (1.1's correlation) |
| 1.4 | The pull request panel takes every answer by type: review threads (`:872`), the smart base (`:300`), details, comments, errors (`assignPrError`, `:276-290`, which resets every flag, `inflightMutations` and both rollback snapshots) | `fe/features/pull-request/state.ts` | V | Correlate every ask; `pr.ERROR` settles only its own ask |
| 1.5 | A worktree switch is never answered, so the worktree list stays disabled until the window reloads | `be/system.ts:373-377`; `fe/features/commit/state.ts:1118`, `:1526` | V | The system answers the switch (switched, or why not); the frontend clears the flag on it |
| 1.6 | Opening another folder after picking a pull request spins forever: `CODE_STARTED` clears `selectedPR` but not `isManualPRSelection`, `viewMode`, `prError`, the create form, comments or threads; the commit panel's `ofNoFolder` leaves push, pull, stash and worktree flags | `fe/features/pull-request/state.ts:966-991`; `fe/features/commit/state.ts:413`, `:1033` | V | One reset of everything that belongs to a folder, in each machine |
| 1.7 | Changing pull request keeps the last one's comments, threads and edit form: Save can write #3's title, body and base onto #9 | `fe/features/pull-request/state.ts:443`, `:1046`; `PullRequestPanel.vue:414`; `PRInfo.vue:161`, `:190-235` | V | Clear comments, threads and the edit form when `selectedPR.number` changes; fetch on View when they are another's |
| 1.8 | One success drops the rollback copy other in-flight comment mutations rely on, and the refetch overwrites pending placeholders | `fe/features/pull-request/state.ts:774-775` | R | A snapshot per mutation, keyed by its call |
| 1.9 | A failed save or comment throws away what was typed | `PRInfo.vue:232`; `PRComments.vue:319`, `:342`, `:383` | R | Leave edit mode, or clear the box, on the matching success only |
| 1.10 | Merging or closing a pull request picked from the list jumps to the branch's own, so its Delete Branch is never reachable | `fe/features/pull-request/state.ts:498-515`, `:1005-1006` | V | Keep the pick until the user leaves the pull request |
| 1.11 | An error outlives its cause and some cannot be dismissed: "No directory selected" from startup stays after a folder opens | `fe/features/pull-request/state.ts:389`; `PullRequestPanel.vue:20-26`, `:126-132` | V, D | Clear `prError` on a folder change and on refresh |
| 1.12 | An older diff can replace a newer one in an open tab | `fe/features/commit/state.ts:497`, `:943` | R | Keep the latest call per tab and take only its answer |
| 1.13 | Staged hunks are one list for every file, cleared by any diff | `fe/features/commit/state.ts:945`, `:1219-1222` | R | Key them by `path:staged` |
| 1.14 | A stash's file list is keyed by index and attaches to another stash after a drop or pop | `fe/features/commit/state.ts:1058`, `:1303-1306` | R | Clear on a new stash list, or key by the stash's commit |
| 1.15 | A file's history is asked for again without its path, and the answer is dropped: it never refreshes, and its Refresh does nothing | `fe/features/commit/state.ts:463`, `:1124-1128`, `:1136` | V | Ask through `askLogPage` with `logPath` |

**Done when:** a spec for each scenario drives the machine with `answerTo` (late, early and failing answers), each
fails with its fix reverted; the existing panel specs pass; the chain passes. Driven once in the app: a failed
write's message stays until dismissed, and a folder switch mid-push leaves nothing busy.

**Landed 2026-11-14**, in apack #478. Two items changed in the doing:
- **1.8** keeps GitHub's last list with each unanswered write laid over it, rather than one snapshot per write:
  restoring one write's snapshot would also undo another's change made after it.
- **1.10** also clears the pick when the branch is deleted, so the panel cannot be left with nothing selected.

Also removed: `pr.STATUS_CHANGED`, `pr.GET_BASE_BRANCH` and `pr.BASE_BRANCH_RECEIVED`, which nothing sent, and
the check in `default-directory.spec.ts` that counted one of them and could never fail. 6.4 asks GitHub while the
pull request panel is the one selected; a hidden code surface with that panel selected still asks, which needs the
code surface to tell the panel it is hidden, as it tells the commit panel.

Driven in the app on the branch: a failed push's error stayed through the status refresh an edit caused, and a
worktree switch moved the surface and left the list usable. The chain's one failure was outside this change:
`repo-checks/tests/bounded-spawn.integration.spec.ts` fails under the machine's load (average 28–50 from other
sessions), on different cases each run.

## Phase 2 — the pull request backend

| # | Defect | Where | Known | Fix |
|---|---|---|---|---|
| 2.1 | A file's diff reads its left side at the base branch's tip while the file list compares from the merge-base: what `main` changed since shows as reverted in the pull request | `be/features/pull-request.ts:187-190`; `apack-git/src/reads.ts:703` | V | Read the original side at the merge-base of base and head |
| 2.2 | The branch's pull request is found by head name alone, which matches a fork's pull request from a branch of the same name | `be/services/github-api.ts:229-234` | V | Keep only pull requests whose head repository is this one |
| 2.3 | Delete Branch runs `git push origin --delete <headRefName>`: for a fork's pull request it deletes this repository's branch of that name, without checking other open pull requests use it or asking; after GitHub deleted the branch on merge it fails | `be/features/pull-request.ts:473-479`; `apack-git/src/writes.ts:463-470`; `fe/features/pull-request/state.ts:552` | V | Confirm first, offer only for a same-repository head no other open pull request uses (decision 4); delete through the API, and take "already gone" as done |
| 2.4 | The repository comes from the branch's upstream remote (`ls-remote --get-url`), but fetching a pull request or branch and deleting a branch use `origin` | `be/features/github.ts` (`gitHubApiFor`); `apack-git/src/reads.ts:884`, `writes.ts:447-470` | V | Resolve the remote once per ask and hand it to every fetch and delete (engine: a remote argument where missing) |
| 2.5 | A base that exists only as `origin/<base>` gives `unknown-ref`, reported as the head being gone | `be/features/pull-request.ts:116-117` | V | Compare against the fetched remote base (or the pull request's base commit); blame the side that is missing |
| 2.6 | On a detached HEAD the current branch reads as `HEAD`, which creating a pull request sends as the head and the branch's lookup searches for | `be/features/pull-request.ts:236`, `:314`; `apack-git/src/reads.ts:220` | R | Refuse a detached HEAD in words; take the head from the upstream branch's name |
| 2.7 | GitHub's reasons for a 422 (`errors[].message`) are dropped: a pull request that already exists, or has no commits, says only "Validation Failed" | `be/services/github-api.ts:156`, `:167` | V | Put the reasons in the message |
| 2.8 | Comments and threads are read oldest first (`first: 100`, `first: 50`): on a busy pull request the newest — the one just posted — is missing | `be/services/github-api.ts:53`, `:277-279` | V | `last:` and paging |
| 2.9 | Failures read as "no pull requests": listing and the branch's lookup answer empty on any failure, signed out and single sign-on included | `be/features/pull-request.ts:211-218`, `:306-320` | V | Answer the reason, as `pr.GITHUB_ACCESS_CHECKED` does |
| 2.10 | After a merge, the branch list's refresh goes nowhere (an actor send with no reply) and nothing fetches | `be/features/pull-request.ts:251` | V | Fetch, then announce the repository changed |
| 2.11 | Editing a description or comment starts from the body with its images rewritten to signed addresses, and saving writes those, which expire | `PRInfo.vue:208`; `PRComments.vue` (`startEditComment`, `startEditReviewComment`) | R | Carry the raw body beside the shown one, and edit the raw |
| 2.12 | Selecting a closed or merged pull request waits about six seconds for a merge state GitHub never gives it | `be/services/github-api.ts:196-200` | R | Stop asking when the pull request is not open |
| 2.13 | Every file opened fetches from the network; a branch fetch that fails is ignored and a stale ref diffed | `be/features/pull-request.ts:108-113`; `apack-git/src/writes.ts:447-451` | V | Fetch once per comparison; a failed fetch is said |
| 2.14 | A rejection of the base lookup can go unhandled when the head's fetch throws first | `be/features/pull-request.ts:149-151` | R | Await both together |

**Done when:** each item has a case against the GitHub stand-ins
(`tests/features/code/be/_support/github-api-stand-in.ts`) or a real bare remote, failing without its fix; engine
changes green on apack-git CI and pinned; the chain passes. Driven against a scratch repository on github.com: a
pull request whose base moved on shows only its own changes; a fork's pull request is not the branch's; Delete
Branch confirms and deletes the right branch.

**Landed 2026-11-14**, in apack-git #30 (`readRemote`, `mergeBase`, `fetchRemoteBranch`, `deleteRemoteBranch`) and
apack #PR, with 6.1–6.3. Left over, each for a later phase:

- After Delete Branch, the local tracking ref (`origin/<branch>`) stays until the next fetch prunes it: pruning one
  ref needs an engine method, which goes with phase 3's engine changes.
- 2.8 pages a pull request's comments and its review threads, but not the comments inside one thread, which are read
  as its last 100.

Driven against a scratch repository on github.com, signed in through the app: a pull request whose base moved on
after the branch was cut showed only the branch's line, the diff's original side being the merge-base's; a comment
posted and showed; the merge went through; Delete Branch asked first and removed the branch on GitHub. A fork's pull
request was not driven, there being no second account; its cases are against the stand-ins.

Found while driving, and fixed here: a window starting over a folder it restored never asked whether GitHub answers
for it, nor listed the commit panel's repositories, stashes, worktrees and branches. The code surface handed
`CODE_STARTED` to its panels in the middle of the transition that stores the folder, so each panel read the folder
before it was there; it now hands it with `sendTo`, which XState delivers once the transition is done
(`fe/state.ts`, `broadcastToAllFeatures`; `tests/features/code/fe/state.spec.ts`).

Found under load, and fixed here: the fetch after a merge or a branch's deletion was announced as a hint
(`commit.REPOSITORY_MAY_HAVE_CHANGED`), which the commit system puts off while no window has asked for its status
since the last news — and the pull request panel, which is what a merge happens from, asks for none. The fetch is now
announced as this app's other writes are (`commit.GIT_STATUS_CHANGED`). `pull-request-merge-fetches.spec.ts` failed
six runs of six under `npm run stress` before it.

Seen while driving, outside this change:

- Once, after a pack reload that landed while a comment was being sent, the app read as signed out to GitHub until it
  was restarted, though the token was still stored; a second reload did not do it, and the cause is not known.
- Every pack reload logs `[shutdown] Error: Pack services are unavailable until the host accepts this runtime`, from
  default-setup's `onShutdown` (`features/hooks.ts`, `services.runHistory.stopActive()`), which the host runs for the
  replaced runtime after its services are gone (`apack-host/src/packs/runtime/lifecycle.ts`, `startAcceptedPack`).
  The rest of that hook does not run.
- A pull request's diff tab is labelled as an unstaged change (`README.md (unstaged)`).

The chain passed apart from three of `repo-checks`' tooling specs (`bounded-spawn`, `progress-guard`,
`spec-durations-reporter`), which fail under the machine's load and touch nothing here.

## Phase 3 — the commit backend and the engine

| # | Defect | Where | Known | Fix |
|---|---|---|---|---|
| 3.1 | A successful checkout runs `git pull`, ignoring its result: it can merge, or stop in conflicts, while the panel reports a clean checkout | `apack-git/src/writes.ts:509-517` | V | Remove it (decision 1); "Checkout & Pull Base" pulls explicitly |
| 3.2 | Checking out a name that is no branch creates a local branch of that name | `apack-git/src/writes.ts:491-500` | V | Refuse with the branch named; offer "Create branch" (decision 2) |
| 3.3 | Commit failures skip `failureOf`: an untrusted repository, a signing failure or an unusable git arrives without its code, trust or ownership, so no action is offered; a rejection that is not an `Error` throws inside the catch and answers nothing | `be/features/commit.ts:703-719` | V | Answer `failureOf(error)` with the friendlier message laid over it |
| 3.4 | Applying or popping a stash answers `STASH_SUCCESS`, whose handler clears the typed commit message; a stash that conflicts is never shown as one | `be/features/commit.ts:1121-1133`, `:1148-1160`; `fe/features/commit/state.ts:1065-1068` | V | Their own answers; a conflict as an error after the status; clear the message only for a stash push that used it |
| 3.5 | Any settings write resumes a fetch paused for a sign-in, the app's own writes included (every navigation writes the base directory) | `be/services/app-git-repository.ts:193-198`; `be/system.ts:258-268`, `:146` | V | Resume only when the fetch settings themselves changed |
| 3.6 | Changing folder never closes the old repository: its readers and an in-flight fetch outlive it, and on Windows hold its directory | `be/system.ts:173` | V | Close it when it is replaced |
| 3.7 | Unstaging a file renamed in the index and edited since can leave the old path's deletion staged | `be/features/commit.ts:469` | V | Find the staged row |
| 3.8 | A pull is followed by a second fetch, though the pull just fetched | `be/features/commit.ts:855`; `be/services/app-git-repository.ts:304-306` | V | Drop `forceFetchOnce` there |
| 3.9 | Publishing pushes to `origin`, whatever the remote is called; on a detached HEAD git's own error is shown | `apack-git/src/writes.ts:541-542` | V | The branch's remote, or the only one; a detached HEAD said in words |
| 3.10 | A worktree switch narrows the repository picker to the worktree | `be/system.ts:165`, `:373-377` | R | Switch as the picker does (`fromPicker`) |
| 3.11 | Listing repositories returns without answering when there is no folder (latent: the window asks only with one) | `be/system.ts:153` | V | Answer an empty list |

**Done when:** a case for each on a real git (the engine's own specs for 3.1, 3.2 and 3.9, through its CI on three
platforms); the app's half on the harness; the chain passes.

## Phase 4 — the commit panel's smaller defects

| # | Defect | Where | Known | Fix |
|---|---|---|---|---|
| 4.1 | Stopping a push is reported as "Pushed" | `fe/features/commit/state.ts:1470-1471` | V | Its own handler and message |
| 4.2 | With nothing staged and commits to push, "Push" and a dead "Commit" show together: the Commit button's `v-else` pairs with "Stop pushing" | `CommitPanel.vue:508-518` | V | Pair it with the action button |
| 4.3 | An untrusted repository shows the trust request and a duplicate error: the error's `v-else-if` chains to the ownership request | `CommitPanel.vue:406-410` | V | Chain the three |
| 4.4 | Commit and Amend can be submitted twice (no busy state; `canCommit` stays true) | `CommitPanel.vue:1182`, `:532-541` | V | A committing flag, cleared by its answer |
| 4.5 | A generated commit message replaces whatever was typed meanwhile | `fe/features/commit/state.ts:925-931`; `CommitPanel.vue:482-493` | R | Disable the box while generating, or keep text typed since the ask |
| 4.6 | Discard All may not warn about files too large to keep when a row's name is not text | `CommitPanel.vue:36`, `:1307` | R | Ask and read the warning with the same `byName` list |
| 4.7 | Pushing a tag gives no feedback (`TAG_PUSHED` has no transition); pushing or deleting a tag and resetting to a commit have no confirmation or busy state; the revert dialog says it cannot be undone | `fe/features/commit/state.ts:288` | V (tag), R (rest) | Handle the answer; confirm and show busy; correct the dialog |
| 4.8 | Commit stays enabled during a conflict or an operation in progress, though its title says why it cannot be done | `CommitPanel.vue:1182` | R | Include `canBeDone.commit` |
| 4.9 | A message of only `Co-Authored-By:` lines sends nothing, silently | `fe/features/commit/state.ts:613-618` | R | Say why |
| 4.10 | A click anywhere on a stash row applies it | `CommitPanel.vue:761` | R | Select on click; apply from its action |
| 4.11 | The sign-in's Copy button says "Copied" for every later code | `fe/features/github/GitHubAccount.vue` | V | Reset it with each code |

**Done when:** a component or machine spec for each; driven once in the app.

## Found while writing this plan

| # | Defect | Where | Known | Fix |
|---|---|---|---|---|
| 6.1 | Every git run reads and decrypts the secrets file for the GitHub sign-in, and logs a warning each time when it cannot be read | `be/services/app-git-repository.ts` (`appGitHubSignIn`); `be/features/github.ts` (`storedSignIn`) | V | Hold the sign-in in memory, refreshed when the pack's secret changes |
| 6.2 | The sign-out spec runs a real `git credential reject` with the developer's own environment, which asks their credential helpers to erase an entry | `tests/features/code/be/github-sign-in.spec.ts`; `be/features/github.ts` (`forgetInGit`) | V | Give `forgetInGit` the environment to run in; the spec hands it a home of its own |
| 6.3 | GitHub's rate limit (a 403 or 429 naming it) reads as `failed` | `be/services/github-api.ts` (`refusal`) | V | A `rate-limited` reason, with when it resets |
| 6.4 | Every `pr.GIT_STATUS_REFRESHED` makes every window ask GitHub twice, the pull request panel hidden or not, and flips its top row to "Checking…" on each commit | `fe/features/pull-request/state.ts:967`, `:1005` | R | Ask while the panel is shown, as the commit panel does (`commit.SHOWN`) |
| 6.5 | Events no one sends, or handlers nothing calls: `pr.STATUS_CHANGED`, `pr.SWITCH_TO_PR_BRANCH`, `pr.LIST_PRS` (and `isLoadingPRs`), `pr.BASE_BRANCH_RECEIVED` | `fe/features/pull-request/state.ts:965`; `be/contract.ts:252` | R | Wire each or delete it |

These land with the phase whose files they touch: 6.1–6.3 with phase 2, 6.4–6.5 with phase 1.

## Phase 5 — missing, for the user to choose

Not defects: things a user would expect that are absent. None is in scope until chosen.

- Cmd/Ctrl+Enter to commit from the message box.
- Checking out a pull request's branch from the panel (its handler exists, with no button).
- The pull request list: paging past 50, closed and merged pull requests, search.
- Merging pinned to the commit reviewed (the head's sha), so a push after review is refused rather than merged.
- More GitHub remotes recognised: SSH host aliases (`git@github-work:…`), `ssh.github.com:443`, usernames with `_`.
  GitHub Enterprise hosts remain out of scope.
- Working from a fork: listing and opening pull requests against the parent repository (decision 3).
- Fetching on a timer while every window is idle (`autoFetchIntervalSeconds` fetches only when a window asks).

## Refuted

- **"`commits(first: 250)` makes every pull request's details fail."** A pull request's `commits` connection takes up
  to 250; on 2026-11-13 the app read pull request #1's details, its commit included, through that query on github.com.
- **"Checkout & Pull Base does not pull."** It pulls today, through the checkout's hidden pull (3.1); it is in
  decision 1 because removing that pull would make the report true.

## Order and size

One pull request per phase, 1 to 4, each with its specs and the chain, merged as it passes; a phase that changes the
engine (2.3–2.4, 2.13, 3.1, 3.2, 3.9) lands its apack-git pull request first and moves the pin with the app's half.
Phase 1 first: it is the largest share of what users see, touches only the frontends and worktree switching, and
the later phases' frontend fixes rely on its correlation. Phase 5 waits for the user's choice.
