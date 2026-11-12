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

## Working on both at once

The link points at a checkout, so an edit there is what a local build here uses once the engine is built
(`npm run build` in the checkout, or `npm run link:apack-git`, which builds when `dist/` is stale). A local
chain then runs against the checkout's working tree, where CI clones the pin: the linker says when the two
differ. Commit and push the engine, move `vendor/apack-git.rev` to that commit, and land both.

In the Linux test container the engine arrives as files, its manifest and its `dist/`, since what the Mac
built is what Linux runs (`scripts/linux-runner.ts`).
