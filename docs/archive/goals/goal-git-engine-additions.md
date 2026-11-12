# Five additions to the git engine

Status: done, 2026-11-12. The design is [the plan](../plans/git-engine-additions.md); the result is described in
[the git engine](../../references/git-engine.md).

```text
# Goal: the git engine's five additions, landed on three platforms

Implement docs/goals/goal-git-engine-additions.md. Follow CLAUDE.md and docs/AGENTS.md.
Read the plan it links, then Current handoff and Phases before continuing.
Surveyed at monorepo 645a5c4546, engine apack-git 0a33475; inspect current code first.

Finished when:
- Each phase's Done when holds: its firing case green on macOS, Linux and Windows in apack-git's CI,
  vendor/apack-git.rev moved to that commit, and the panel's half passing the chain.
- docs/references/git-engine.md describes the new codes, the abort and the git resolution.
- The plan and this goal are archived with an Outcome.

Commit each phase as its own checkpoint. Do not expand or reduce scope without the user.
```

## Scope

Five items, each an engine half (in `apack-git`) and a panel half (in `packages/default-setup`, code feature):

1. A repository git refuses to read for its owner (`safe.directory`): its own answer, and an offer to trust it.
2. Named failures: a code only where the panel acts differently (signing, unrelated histories, nothing to
   commit, branch exists, host push refusals).
3. Finding git: the app resolves the path (`resolve-cli.ts`, a setting); the engine checks it once (macOS
   placeholder, `git --version` against a floor found in CI) and refuses with a code.
4. Sequences held to a full status: a seeded spec, no product code.
5. Stopping a fetch or a push: an abort signal in the engine, Cancel in the panel. Nothing else is stoppable.

Out of scope: libgit2 readers, `isomorphic-git`, shipping a git (the plan's "Looked at and not taken").

## Outcome

All five landed, each an engine commit on [spankyed/apack-git#1](https://github.com/spankyed/apack-git/pull/1) and a
monorepo commit moving the pin with the panel's half. The engine's CI passed every job at each phase's commit
(runs 43183805982, 43183810779, 43183814677, 43183818480, 43183822284): Linux, macOS and Windows, and from phase
3, where they were added, Apple Git, Debian 12's git and the floor built from source.

| # | Engine | What the panel does |
|---|---|---|
| 1 | `881ef1f`: `unsafe-ownership`, `UnsafeOwnershipError` with the path git named, `trustOwnership` | Says git will not read it and offers to trust it; the backend asks git for the path again, so no path a window sends reaches the user's global configuration |
| 2 | `f83d530`: `signing-failed`, `unrelated-histories`, `nothing-to-commit`, `branch-exists`, `host-refused` | A sentence for each; a host's refusal keeps the host's words |
| 3 | `ed12139`: `ties.git`, a once-per-repository check, `git-not-found`, `developer-tools-missing`, `git-too-old` | Runs the git set under Settings, CLI providers, or the first found; says why one cannot be used and what to do |
| 4 | `7704aa1`: seeded sequences held to a whole status, and `npm run soak:sequences` | Nothing to show: a spec and a command |
| 5 | `67b9a35`: `fetch(signal)`, `pushBranch(onProgress, signal)`, `aborted` | Stop pushing, while a push runs |

What it settled:

- **The floor is 2.35.0.** Ubuntu 22.04's 2.34.1 fails the suite: its status gives no count of the stashes. Apple
  Git and Debian 12's 2.39.5 pass, and 2.35.0 built from source passes. 2.34 also words the branch-exists failure
  with a capital, now matched either way.
- **`safe.directory` takes the path as git prints it**, on Windows as well: the ownership cases pass there with no
  conversion. A network share was not tried; nothing here runs on one.
- **Stopping is offered on Windows too.** The git started and everything under it are ended by its id, and the
  stop cases pass there.
- **Git is not started in a process group of its own.** Node's `execFile` drops `detached`, and git does not end
  the `ssh` it started when it is signalled, so the engine finds git's descendants from the process table and ends
  them itself. A git that dies with the app is unchanged.
- **The ownership check needs git 2.35.2.** On an older git there is no refusal for the engine to name, and those
  cases run only where git refuses.
- **What CI's containers lacked, not the engine:** `ps`, and a first process that reaps orphans.

## Decisions

- Each item lands engine first, then one monorepo change moving the pin with the panel half.
- Trusting a folder writes the user's global git config, so it runs only on their click.
- The git floor is the oldest version the engine's CI passes on, not a chosen number.
- Only fetch and push are abortable; pull becomes fetch-then-merge before it is.

Open, settled in its phase: `safe.directory` spelling on Windows and network shares (1); whether stopping is
offered on Windows, and starting git in its own process group (5).

## Phases

| # | Deliverable | Done when |
|---|---|---|
| 1 | Untrusted owner: third answer from opening a folder, with git's path; panel says so and offers Trust | A real git with `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` yields the code on three platforms; Trust reopens it |
| 2 | Named failures, one row at a time | Each producible row has a real-git case; host refusals run on recorded text, dated |
| 3 | Git resolution and check | Cases for an old-version stand-in and a missing path; `xcode-select` answer stood in; floor recorded from CI |
| 4 | Sequence spec | Fixed seeds pass on three platforms; a failure prints seed and shortest steps; long run is a command, not a gate. Defects it finds are fixed before phase 5 |
| 5 | Abort fetch and push | A never-answering ssh remote is stopped: answer at once, process gone, no lock left; SIGTERM then grace then kill; Windows behaviour read and decided |

Process-ending code (phase 5) is never mutation-tested on a developer machine, and only ends processes a
case started by their ids.
