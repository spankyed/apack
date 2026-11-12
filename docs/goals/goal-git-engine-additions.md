# Five additions to the git engine

Status: ready, 2026-11-12. The design is [the plan](../plans/deferred/git-engine-additions.md); this owns order,
acceptance and the handoff.

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

## Current handoff

- Engine `master` at `0a33475`, CI green on all three platforms; monorepo pin matches.
- Next: phase 1. Nothing started.

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
