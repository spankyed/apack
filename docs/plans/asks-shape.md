# Asks, in the shape they are meant to keep

Status: done, on `session/asks-shape` and `session/asks-left-open` stacked on it. The first starts from spankyed/apack#583 (results are asks) and replaces it.
This file is the work list: what each package changes, what it removes, how it is checked, and what is done.

## Why

#583 made every result an ask. Its answering side is right: asks declared in a contract, one handler per ask, a
handler that returns its answer and throws its refusal. Its asking side kept answers as events, and that is what this
branch changes:

- An asker receives `ASK_ANSWERED` or `ASK_FAILED` and works out which ask it is about with a guard. `ask` and
  `fromAsk`, which hand back a value, are almost unused.
- A stream (search results, a push's progress) goes beside the ask through `sendToWindow`, on a second channel.
- Cancelling an ask does not stop its handler, so a handler that can be superseded keeps an `AbortController` in its
  machine's context.
- A handler reads `waiting` to learn whether anyone asked.
- Every ask is wired through its system's machine, though most systems have one state.

The shape aimed at is the one `docs/plans/apack-spec.md` (spankyed/apack#590) describes under "Alongside results-are-asks": the same
names, handlers as plain functions in tables, an asker that awaits. Code in that shape reads the same on XState and
on what may replace it.

## The packages

Counts are text counts on #583's head, `913b15b092`, and size the work rather than describe the result.

| # | Package | Removes or changes | Depends on |
|---|---|---|---|
| 1 | **One vocabulary** | `ask` (an ask's fields) becomes `args`; `fails` becomes `refuses`; `failure(...)` becomes `refuse(...)`. In the SDK, every contract and every handler | - |
| 2 | **Progress is part of an ask** | An ask declares `progress`; its handler is handed `progress(update)`; `ask` takes a `heard` callback and a stream actor delivers updates to a machine. Replaces the `sendToWindow` feeds of search and push | 1 |
| 3 | **Cancelling reaches the handler** | An asker that aborts tells the backend, which aborts that handler's `signal`. Removes the search's controller, its two controller events, `CANCEL_SEARCH`, and the `superseded` refusal (21 mentions) | 1 |
| 4 | **No `waiting`** | A handler no longer learns whether anyone asked. What every window should hear is a broadcast. Terminal (19), threads (6), settings (6) | 1 |
| 5 | ~~Asks are answered beside the machine~~ | Dropped. An ask is taken by the state that lists it, which is what the design aimed at does (`asks` is a table of a state), and what lets a state that does not list one answer `unavailable` | - |
| 6 | **An asker awaits** | The event path goes: `isAnswered` (97), `answerOf` (101), `asked === '…'` (33), guarded `ASK_ANSWERED: [...]` arrays (27), `AnswersOf`. A component awaits `ask`; a machine state invokes `fromAsk`. By feature: code 151, database 29, threads 23, flows 20, library 17, notes 15, prompts 10, brain 10, actions 10, browser 4, logs 3, host 4, testing 4 | 2, 3 |
| 7 | **A loading flag is a state** | Where package 6 touches a flag set in one action and cleared in two, it becomes a state that invokes the ask | 6 |
| 8 | **An event is narrowed, not cast** | `event as { type: 'X'; … }` (233) becomes the typed narrowing the SDK has: `spec.typeOf('X', event)` or `safeEvents<Event>()` | - |
| 9 | **A code child answers its own asks** | The code system stops reaching into `children.search` and the rest to answer for them | 5 |
| 10 | **Close out** | The pack rule, public docs, API and facade reports, and this file | all |

Not in this branch, and next after it: a component reading state through the SDK in place of `useSelector`, machines
defined through the SDK, a pack rule against importing `xstate`, and renaming `sendToSystem` and `broadcastToSurface`
to `tell` and `broadcast`. They touch other files than asks do and would double this diff.

## The recipe, for one feature

The code search is the worked example: `git show dd857efef6` (the surface and the handler) and the commit after it (the
handler moved into the search child). Follow it.

**The surface (asker).** Nothing handles `ASK_ANSWERED` or `ASK_FAILED`, and nothing calls `isAnswered` or `answerOf`.

- An ask whose progress the UI shows, or that a newer one should replace, is a **state that invokes it**:
  `actors: { x: fromAsk('<system>', '<ASK>') }`, `invoke: { src: 'x', input, onDone }`. `event.output` is an `Outcome`:
  `ok` with `value`, or `failure` with `kind` and `message`. A flag that was set on send and cleared on the two answers
  goes; components read `snapshot.matches('<state>')`.
- An ask that is fire-and-forget from a click and only needs its failure shown is **awaited where it is made**: `ask`
  from `#generated/events` in a component, or `useAsk` (`@apackdev/sdk/fe`).
- Several of the same ask at once, each needing its own result (a diff per tab), are **spawned**: `spawnChild` the
  `fromAsk` logic with an id, and handle `xstate.done.actor.<id>`.
- What a handler tells its asker as it goes arrives at the invoking machine as `<ASK>.progress`
  (`ProgressEventOf<Contract, '<ASK>'>`).

**The system (answerer).**

- A handler does not read `waiting`. What every window should hear is a `broadcastToSurface`, whoever asked.
- A feed beside an answer (`sendToWindow(client, …)`) becomes the ask's declared `progress` and a call to `progress(…)`.
- A handler that can be stopped uses the `signal` it is handed. It keeps no `AbortController` of its own.
- In the code feature, a child's asks are answered by the child: `defineHandlers<Context, Event>()`, then
  `handlers.answers<ChildAsks>({ … })` with `...answers.actions` and `...answers.on` in the child's machine, its `Event`
  union including `AsksEvents<ChildAsks>`. The code system's table names them as answered elsewhere
  (`codeSpec.answers<keyof SearchAsks | keyof …>`), and its wildcard forwards them.
- `const ev = event as { type: 'X'; … }` becomes the file's typed narrowing: `spec.typeOf('X', event)`, or
  `safeEvents<Event>()` from `@apackdev/sdk/helpers` for a machine with no spec.

**Specs** assert the same behaviour through the new path. A spec that built an answer event by hand asks instead, or
resolves the invoked ask. A spec's mock of `#generated/events` that a machine's `fromAsk` now needs gains one.

## How each package is checked

- `npm run typecheck` before each commit.
- `npm run spec` for what the package touched, then `npm run chain -- --no-native` once a package is complete.
- A public export of the SDK changed: `npm run api:update`. default-setup's facade changed: `npm run facade:update -w
  @app/default-setup`. An event added to a contract: `npm run generate:entries -w @app/default-setup`.
- A package is one commit, or one per feature for package 6.

## Done

| # | Package | State |
|---|---|---|
| 1 | One vocabulary | done |
| 2 | Progress is part of an ask | done: the search, and push, pull, checkout and submodule updates, whose `commit.PROGRESS` feed is gone |
| 3 | Cancelling reaches the handler | done: the search, a push (leaving `pushing` stops it) and the GitHub sign-in |
| 4 | No `waiting` | done: a handler is not handed it. Threads broadcasts `SHOW_THREAD` only where no window asked, which it reads from `client` |
| 5 | Asks are answered beside the machine | dropped, see above |
| 6 | An asker awaits | done in every feature. `isAnswered`, `answerOf` and `AnswersOf` are gone from the SDK, and no surface handles `ASK_ANSWERED` or `ASK_FAILED` |
| 7 | A loading flag is a state | done where package 6 touched one |
| 8 | An event is narrowed, not cast | done |
| 9 | A code child answers its own asks | done: the code system answers only what is its own |
| 10 | Close out | docs, API and facade reports done |

## Left open

Nothing from this list of packages. No machine in the pack is `type: 'parallel'`: an ask that can be under way beside
others is spawned under an id and handled where it ends, and whether it is under way is read off the snapshot with
`askUnderWay` (`@apackdev/sdk/fe`).

- Not checked by hand in the running app: verified by the type check, the unit pools and `npm run chain -- --no-native`,
  which runs the e2e suites.
- A guard that reads `askUnderWay(self.getSnapshot(), …)` sees the children from before the event being handled. No
  event today is raised in the step that spawns or stops the ask it asks about.

## When it lands

`docs/plans/apack-spec.md` and its prototype (spankyed/apack#590) are brought in line: step 1 of its order of work is
marked done with what was and was not carried over, its "Alongside results-are-asks" section describes what exists
instead of what #583 had, and its description says where the next piece of work starts.
