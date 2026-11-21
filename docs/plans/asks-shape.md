# Asks, in the shape they are meant to keep

Status: in progress on `session/asks-shape`, which starts from spankyed/apack#583 (results are asks) and replaces it.
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
| 5 | **Asks are answered beside the machine** | An asks table is registered with the system, not spread into `setup` and `createMachine` as `answers.actions` and `answers.on`. Twelve systems. An ask that depends on the machine's state is handed its snapshot | 1 |
| 6 | **An asker awaits** | The event path goes: `isAnswered` (97), `answerOf` (101), `asked === '…'` (33), guarded `ASK_ANSWERED: [...]` arrays (27), `AnswersOf`. A component awaits `ask`; a machine state invokes `fromAsk`. By feature: code 151, database 29, threads 23, flows 20, library 17, notes 15, prompts 10, brain 10, actions 10, browser 4, logs 3, host 4, testing 4 | 2, 3 |
| 7 | **A loading flag is a state** | Where package 6 touches a flag set in one action and cleared in two, it becomes a state that invokes the ask | 6 |
| 8 | **Events are handled by a typed table** | `spec.handles({ EVENT: ({ event }) => … })`, each handler given its own event. Removes `event as { … }` (233) | - |
| 9 | **A code child answers its own asks** | The code system stops reaching into `children.search` and the rest to answer for them | 5 |
| 10 | **Close out** | The pack rule, public docs, API and facade reports, and this file | all |

Not in this branch, and next after it: a component reading state through the SDK in place of `useSelector`, machines
defined through the SDK, a pack rule against importing `xstate`, and renaming `sendToSystem` and `broadcastToSurface`
to `tell` and `broadcast`. They touch other files than asks do and would double this diff.

## How each package is checked

- `npm run typecheck` before each commit.
- `npm run spec` for what the package touched, then `npm run chain -- --no-native` once a package is complete.
- A public export of the SDK changed: `npm run api:update`. default-setup's facade changed: `npm run facade:update -w
  @app/default-setup`. An event added to a contract: `npm run generate:entries -w @app/default-setup`.
- A package is one commit, or one per feature for package 6.

## Done

| # | Package | State |
|---|---|---|
| 1 | One vocabulary | not started |
| 2 | Progress is part of an ask | not started |
| 3 | Cancelling reaches the handler | not started |
| 4 | No `waiting` | not started |
| 5 | Asks are answered beside the machine | not started |
| 6 | An asker awaits | not started |
| 7 | A loading flag is a state | not started |
| 8 | Events are handled by a typed table | not started |
| 9 | A code child answers its own asks | not started |
| 10 | Close out | not started |

## When it lands

`docs/plans/apack-spec.md` and its prototype (spankyed/apack#590) are brought in line: step 1 of its order of work is
marked done with what was and was not carried over, its "Alongside results-are-asks" section describes what exists
instead of what #583 had, and its description says where the next piece of work starts.
