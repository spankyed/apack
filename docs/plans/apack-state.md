# apack-state: moving the app off XState

Status: accepted as the direction, 2026-11-22. Nothing in `packages/` runs on it. The primitive is built in a
repository of its own, [spankyed/apack-state](https://github.com/spankyed/apack-state) (`@apackdev/state`), with its
design, its proof and its own plan. This file is the part that is this repository's: why the app moves, what is
already done here, and what the move changes in this tree.

The design on one page is apack-state's `docs/design.md`, and the full record its `docs/plan.md`. Neither is
repeated here.

## Why

The app builds every system and surface on XState and uses a small part of it. Read from every package source
file's syntax tree on `7a09f823e8`, 2026-11-20 (apack-state's `surveys/xstate-survey.mts`, which takes a checkout):

| | |
|---|---|
| Machines | 49 |
| With one state or none | 33 |
| With nested states | 2 |
| Transitions that name a target | 113 |
| Transitions that only run a handler | 1,175 |
| Parallel or history states | 0 |

Most machines are a bag of handlers over a context, and what the app needs that XState does not give is checked
here by pack rules and conventions: an ask that is answered once, a step that is kept whole with the rows it wrote,
a window that is never told of something its views do not show, and every ordering of what arrives checked, not a
likely one. apack-state makes those the kernel's.

## What is already done here

The app's code was brought to the design's vocabulary on XState first, so that the move rewrites the files that
define a machine and their specs, and no component. All of it is merged.

| What | Where |
|---|---|
| An ask is declared `{ args, answer, refuses, progress }`, refused with `throw refuse(...)`, and its handler's `signal` aborts when whoever asked goes | spankyed/apack#591, #593 |
| An asker awaits: no surface handles an answer as an event | #591 |
| A component reads its machine with `useState`, as `{ at, data }`, and names no actor; `@xstate/vue` is refused in a pack | #596 |
| What `useState` hands a component is typed read-only | #606 |
| An ask that is not a state's own work is declared under `makes` and made by name | #597, #599 |
| A send is `tell` or `broadcast` | #600 |

Not to be built on: XState's `makes` keeps which asks are under way in the machine's context and hears how one
ended as `xstate.done.actor.made.*`. In the kernel that record is the kernel's and there is no such event. It goes
with each surface as it is ported.

## What the move changes in this tree

**There is no bridge.** The two kernels never run on one bus. The app does not start on the branch until every
machine is across, and a feature is known to be across when its specs pass, unchanged in what they assert.

1. **Install the packages.** `@apackdev/state`, and `@apackdev/link`
   ([spankyed/apack-link](https://github.com/spankyed/apack-link)), which carries what states say between the
   backend and a window on one ordered stream. Each joins `scripts/lib/external-packages.mjs` and is installed from
   a release's tarballs pinned by commit, as elmdb's are, so `npm run deps:pin` and `deps:local` cover them. They
   join `SHARED_INSTANCE_PACKAGES` where a pack and the host must share one copy.
2. **The host's bus and shell** (`packages/apack-host/src/bus`, `src/fe`). The host gives the kernel the app
   engine's `transact`, and the engine a pack is handed refuses a write outside a unit. Roles and restoring a state
   are settled here, against the real ones.
3. **The transport.** `@apackdev/link` replaces tRPC at the host port: `bus.send`, the bus subscription and
   `views.watch` become frames on one link, so a view's update and an answer keep the order they were sent in. The
   view host (`@apackdev/host/views`) holds each view's `Watching` and waits on `caughtUp({ soon: true })` before a
   step's sends to that window are released. What a window reaches its backend over is its own plan
   ([deferred](deferred/what-a-window-reaches-its-backend-over.md)).
   **The backend has to be told when a window is gone.** A link outlives its connection, so a socket closing no
   longer says so, and today the backend knows a window only as a socket: main starts it with `spawn` and tells
   it nothing of windows after. Main makes a credential for each window, the backend takes that window's
   connections as its, and main tells the backend when the window closes. Without this a backend keeps a link's
   bound for every window that ever closed or reloaded. The link's half is proposed in apack-link's
   `docs/proposed/sessions-have-owners.md`.
4. **The pack contract.** `defineSystem`, the generated `#generated/events` and `#generated/fe`, `apack.json`'s
   `system.contract` and `surface.contract`, and the SDK's `ask`/`fromAsk`, `useState` and `fromView` are restated
   over states. The recorded API reports and the facade report move with them.
5. **The test harness** (`@apackdev/testing`, `@apackdev/sdk/testing`), so that a feature's specs run against the
   kernel, and a pack's spec can run a scenario under every ordering. See
   [singleton-free-test-harness.md](singleton-free-test-harness.md) for the singleton-free `using` design that
   also unlocks Vitest `isolate: false`.
6. **The features, hardest first.** The commit surface and the code system it asks, then the brain, the surfaces
   with states, then the single-state surfaces and backend systems. The commit and pull-request surfaces are taken
   apart by concern as they are ported.
7. **Pack rules.** A write to what was read; a promise nobody awaits; a `catch` that swallows the kernel's `Left`;
   a cycle of asks, once a state's graph is a recorded file. `machine-selectors` and the rule against XState's
   wildcard go.
8. **What teaches XState.** `docs/public-facing/`, the CLI's templates and `apack pack init`, every package's
   `CLAUDE.md`, and the architecture sections of the root one.
9. **Remove XState**, `@xstate/vue` and tRPC, start the app, run the chain, and regenerate the recorded files.
   The third-party notices and the SBOM follow from what the app then carries.

While the branch is open, a change to a file that defines a machine on `master` is made again on the branch, so such
changes are kept few and the branch is brought up to `master` often.

## What it costs here

- **Size.** Files that define a machine total about 27,500 lines, and 132 spec files import XState.
- **One piece.** Nothing lands until all of it does, and a design fault found part-way is paid for in everything
  ported by then, which is why the hardest surface goes first.
- **Three repositories move together.** elmdb, apack-link and apack-state are each pinned by commit, and a change
  that crosses two of them is two releases and a pin.
- **A transaction ends at the database.** A step is whole over data, rows and what is sent. Git, files, models and
  the run history keep their own time, and a flow's run is recorded while it runs: what a step's unit means for
  the brain and run history is not yet checked against a real flow.
- **Compile errors are deep**, and how long the compiler takes over 49 machines' worth of these types is not
  measured.

## Before the cutover is sized

Two things are not written down anywhere and should be before the branch is opened: one real feature ported end
to end against the packages as released, which is the cheapest way to find what the prototype missed, and the
cutover's own order and size, feature by feature.
