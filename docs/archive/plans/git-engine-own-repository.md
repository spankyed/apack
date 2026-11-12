# The git engine in a repository of its own

Status: done, 2026-11-11. The engine is [spankyed/apack-git](https://github.com/spankyed/apack-git), the pack
depends on it through `vendor/apack-git`, and no engine source remains here
([the git engine](../../references/git-engine.md)). The last "Done when", the sibling's CI on macOS, Linux and
Windows at the pinned commit, holds at `84d652c`.

What is added to the engine now that it has moved is
[five additions to the git engine](../../plans/deferred/git-engine-additions.md), and after it
[version 1](../../plans/deferred/git-engine-version-1.md).

Compiled 2026-11-11 from `master` at `292ff4a3dd`. File names, line counts and what other packages do are as
of that day: read them again before starting.

## What "the git engine" is

The code that runs git for the code feature and keeps a picture of one working tree. All of it is under
`packages/default-setup/src/features/code/`:

| File | Lines | What it holds |
|---|---|---|
| `be/services/git.ts` | 2,197 | Every git process, the snapshot and what changed in it, the reads and the writes: one class with about 60 public methods |
| `be/services/gitwatcher.ts` | 245 | File events turned into hints: which part of the repository may have changed, and which paths |
| `be/services/directory-watch.ts`, `parcel-watcher.ts` | 92, 11 | The platform's watch over a tree, behind one interface |
| `fe/features/commit/staging.ts` | 66 | Where a file will be listed once it is staged or unstaged, worked out before git answers |
| the git types in `be/types.ts` | | The shapes the engine answers in, declared beside the feature's contract types |

What uses it stays where it is: the commit and pull-request features, the watcher's actor
(`be/git-watcher-actor.ts`), the panel, and `services.cli`, through which actions reach a handful of its
methods.

**It is nearly self-contained already.** `git.ts` has three ties to the app: a logger (two uses), the SDK's
`execFileWhileWorking` (`@apackdev/sdk/progress`), which ends a process that has stopped working, and
`agentChildEnvironment` (`be/services/shell-environment.ts`, 22 lines), which takes what the app set on its own
process out of the environment a child is given. It reads no setting, sends nothing on the bus and knows
nothing of GitHub. Eight files in the code feature import it.

**Its specs are too.** The seven `tests/features/code/be/services/git-*.spec.ts` files (1,134 lines) run a real
git in a throwaway repository and import `git.ts` and that one SDK helper. The watcher's specs hand it events
directly and use a real git for what git decides.

**Its shape is still the app's.** It is one class. Its types live in the feature's `types.ts`, which imports
the class back. And decisions that belong to the app sit inside it: when to fetch without being asked
(`setFetchConfig`, `fetchIfDue`, `forceFetchOnce`), which branch a pull request is based on
(`getPRBaseBranch`), and files as data URLs for the panel (`getFileContentAsDataUrl`,
`getFileContentFromBranchAsDataUrl`, `isImageFile`).

## Why a repository of its own, and why not yet

Three reasons hold:

1. **Three platforms, checked on every push, at no cost.** The engine's later work has not been run on
   Windows, and on Linux it has been run by hand. The monorepo cannot check either cheaply: its automatic CI is
   off, Windows needs the development VM, and the engine's specs there sit behind the whole workspace's install
   and build. A package with no dependencies installs and runs its specs in a minute or two, and the sibling
   repositories are public, where GitHub's standard runners cost nothing. The same run answers which versions
   of git the engine works with, which nothing answers today.
2. **The boundary becomes a fact.** Inside the pack a boundary is a convention a rule has to hold. In another
   repository an import across it does not resolve.
3. **Nobody ships this.** Running git is a crowded field (`simple-git`, `dugite`, `isomorphic-git`, the libgit2
   bindings). A live picture of a repository is not: VS Code's can only be reached from inside a VS Code host,
   and the closest package, [`git-tree-state`](https://github.com/barelyhuman/git-tree-state) 0.1.1 (two
   releases, May 2026), has the same loop of hints and path-scoped status and stops there. It reads files only,
   with no branch, upstream, conflict or operation in progress; it ignores by a hard-coded list; its debounce
   has no upper bound; it runs status without telling git to leave its lock alone; and it writes nothing.
   Whether anyone outside apack wants such a package is unknown, so this reason alone would not justify the
   move.

And three reasons it waits:

- **The boundary is still moving.** Each piece of open engine work changes the engine and the panel in one
  change. Across two repositories each becomes two commits and a moved pin, which is the friction the terminal
  broker already costs.
- **It would be the first sibling a pack depends on.** `elmdb` and `apack-terminal` are both consumed by host
  packages.
- **Two platforms are unproven**, and on Linux the watcher is a native library that leaks watches
  ([what was measured](../../issues/ISSUE-dev-loop-file-watching.md)).

## The boundary

**The engine owns one working tree's truth and every git process. The app owns who is looking, what to show
and what to say.**

| In the engine | Stays in the app |
|---|---|
| Running git: its environment, what may run beside what, waiting for a lock, when a command is done, what a failure means | The event bus, the contract, windows, who asked |
| The snapshot, change detection by part, path-scoped reads, an operation in progress | The words shown to the user |
| A watcher of its own, which a host can replace or switch off | GitHub, `gh`, pull requests, the offer to sign in |
| Reads (a diff, a file at a revision, the log, branches, stashes, worktrees) and writes (stage, commit, check out, stash, fetch, pull, push) | Policy: when to fetch unasked, which branch a pull request is based on, settings |
| Where a staged file will be listed, as an entry with no Node imports | What says "look again": window focus, a terminal command ending, an agent's turn ending |

A sketch of the door, whose names are settled when the code is carved:

```ts
const repo = await openRepository(dir, { env, run, log })

repo.snapshot()                         // plain data
repo.onChange(({ parts, files }) => {}) // only when a part really differs
repo.noteChanged(paths)                 // a hint from the host's own watcher
await repo.check()                      // "something may have changed"

await repo.stage(paths)                 // a result, or an error with a code
await repo.close()
```

Three rules hold it together:

- **Plain data out.** A snapshot crosses the app's bus to its windows, so it is data and never an object with
  methods.
- **Codes, not prose.** A failure carries a code and what git printed. The app writes the sentence.
- **Hints in, news out.** The engine never assumes its watcher saw everything: a host can always say "look
  again", and the engine says only what really differs.

And four constraints the code imposes, each read on the day this was compiled:

1. **The engine's types stay out of the pack's contract.** A pack's published types may import only
   `@apackdev/*` packages, the SDK's peers and Node's built-ins (`packages/apack-cli/src/build/facade-gate.ts`),
   and a dependent pack has them inlined into its own tree. So the pack goes on declaring what crosses its bus
   (`be/types.ts`) and hands the engine's answers to its contract in one place, where a shape that drifted is a
   compile error.
2. **How a process is run is handed in.** The engine is given `run`, with the contract of
   `execFileWhileWorking`: `execFile`'s promise with the child beside it. The app passes that function, so the
   rule that a git is ended when it stops working stays in one place; without one the engine uses Node's
   `execFile`, unbounded. The environment arrives the same way, and the engine lays its own over it: no
   credential prompt, no editor, no optional locks, output in English.
3. **Nothing native.** A pack's build leaves a native binding for the host to resolve
   (`HOST_RESOLVED_BINARIES`, `packages/apack-host/src/build/shared-deps.ts`) and bundles everything else. A
   pure TypeScript engine is bundled into the pack's runtime like any other dependency, which is why the Linux
   watcher is replaced first.
4. **The engine names no window, user, host or setting.** Whatever needs one of those is the app's half.

## The work, in order

### 1. Carve it in place

In the monorepo, with no new repository. This step is worth having whether or not the rest follows, and it
turns the move into a move.

1. **One folder, one door.** `be/git/` holds the engine and `be/git/index.ts` is the only module anything else
   imports. The engine imports nothing outside its folder but Node's built-ins. A rule in `check:specifiers`
   holds both directions, with a firing case for each.
2. **Types of its own.** The engine declares the shapes it answers in; `be/types.ts` keeps the contract's, and
   stops importing the class.
3. **Its three ties, handed in**: the environment, `run` and a logger, given when a repository is opened.
4. **Policy out.** Fetching unasked, the pull request's base branch and data URLs move to the features that
   use them, over the engine's reads.
5. **One class becomes a few**: the runner, the model, the reads and the writes, behind the door. What the
   door exports is what the package will export.
6. **The specs go through the door**, and import nothing else of the feature.

Done when nothing but the door is imported from outside, the engine's folder imports nothing of the feature,
and the chain passes.

### 2. Stand the repository up

`apack-git` is a working name. Laid out as `apack-terminal-view` is: TypeScript, `src/` and `tests/`, a build
to `dist/` with declarations, no runtime dependencies, `"private": true`, the monorepo's Node floor.

1. Copy the engine's folder and its specs. From this moment until the switch, no engine change lands in the
   monorepo without being carried over: the window is kept to days.
2. Two entries: the engine, and the staging helper with no Node imports.
3. CI as `apack-terminal`'s is triggered (a push to `master`, a pull request, a dispatch), over macOS, Linux
   and Windows: typecheck, build, specs.
4. Fix what the three platforms find, there, before anything in the monorepo depends on it.

Done when the specs pass on all three at one commit.

### 3. Switch the pack over

One change in the monorepo, which adds the dependency and deletes the copy.

1. `vendor/apack-git` and `vendor/apack-git.rev`, with `scripts/link-apack-git.mjs` written after the two
   linkers there are: it refuses a checkout that is not one, one that does not hold the pin, and, as elmdb's
   does, one that has not been built, since the package resolves through `dist/`.
2. `.github/actions/apack-git`, which clones at the pin and builds. The build is seconds, so every job that
   installs takes it.
3. `packages/default-setup/package.json` depends on it at `file:../../vendor/apack-git`.
4. The engine's folder and the specs that moved are deleted. The pack keeps its contract types, the place
   that hands the engine's answers to them, the policies, the actor, the panel, and every spec that runs the
   engine through the system.
5. The guides say three siblings where they say two, and the engine gets a reference page as
   [the terminal broker](../../references/terminal-broker.md) has.

What the existing tooling already covers, so nothing is added for it: a link with no `Cargo.toml` is not a Rust
checkout to the janitor or the Linux container's toolchain (`scripts/lib/vendored-checkouts.ts`), and every
`vendor/*.rev` is an input of every chain step, so a moved pin re-runs them (`scripts/lib/chain-steps.ts`).

What has to be checked, because no pack has depended on a linked sibling before:

- `apack pack build` bundles the engine into the pack's runtime and the staging entry into its frontend, and
  leaves neither for the host to resolve.
- The pack build's record of its inputs covers the linked package's built files, so a moved pin or a rebuilt
  `dist/` reads as a changed input (`packages/apack-host/src/build/pack-build-inputs.ts`).
- A pack that depends on default-setup still builds and type-checks from packed tarballs
  (`npm run test:packaged-authoring`, `npm run test:external-pack`): it is given default-setup's built runtime,
  with the engine inside it, and a facade that names no engine type.

### After the switch

A change to the engine is a commit there, its CI passing, and the pin moved in the monorepo change that uses
it. It is pinned by commit and both halves move together, as the broker's are: no version to bump and nothing
kept for compatibility ([CLAUDE.md](../../../CLAUDE.md), "Backward compatibility"). The known hazard is the
broker's too: a local chain runs against the sibling's working tree and CI against the pin, which the linker
says when the two differ (`scripts/lib/vendor-pin.mjs`).

## Conditions for starting

1. **The engine work open on 2026-11-11 has landed on `master` or been dropped**, since each piece changes
   what the engine offers: error codes and the offer to sign in, refreshing the index at a chosen moment, one
   long-lived reader for file versions, staging a hunk, an untracked folder as one row, progress for fetch,
   push, pull and checkout, a remembered base branch, a log of commands, and checking nothing while nobody is
   looking.
2. **The Linux watcher is replaced**, so nothing native remains.
3. **The carve has held through one engine change** without its door having to widen.

One thing would bring it forward: a Windows or Linux defect in the engine that the monorepo cannot reproduce
cheaply. The three-platform run is then worth the two-repository friction on its own.

Step 1 can be started ahead of the rest, on its own go.

## Decisions to make at the start

- **The name.**
- **What bounds a spec there.** The progress guard and the check for processes a spec left running live in
  `@apackdev/testing`, which the engine cannot depend on. The choices are vitest's own timeout set long enough
  to be only a detector of a hang, or a small guard of its own. Either way a timing fix is still proven under
  the monorepo's `npm run stress`, which takes any command and can be pointed at the sibling's suite.
- **Whether the staging helper moves.** It restates how git lists a file, which is the engine's knowledge; it
  runs in a window, which is the app's place. The plan above moves it.
- **Where the carved code sits until the move.** Inside the pack, as above, or a workspace package of its own.
  A workspace package adds a build unit, a layer and a published tree to keep for a stop that lasts weeks.

## What this does not do

- **Publish anything.** The package is resolved through its link, as the other siblings are.
- **Change behaviour.** The move is a move; what the engine gains comes after it.
- **Become a general git library.** It covers what the panel uses.
- **Adopt `simple-git`.** It removes every `GIT_*` variable from git's environment unless each is allowed by
  name, where this app runs git in the user's own; and it reports four cases as success that the panel treats
  as failures (a commit with nothing to commit, and a merge, a stash apply and a stash pop that stop on a
  conflict).
- **Move the open-file watcher** (`be/services/open-file-watcher.ts`), which watches the files an editor has
  open and asks git nothing.

## Done when

- The pack depends on the engine and no engine source remains in the monorepo.
- The chain passes, and the strict chain passes on the change that switches over.
- The sibling's CI passes on macOS, Linux and Windows at the pinned commit.
- The engine has its reference page, the guides name it, and this plan is archived.
