# apack-spec: one state primitive in place of XState

Status: proposed, 2026-11-21, in Claude Code session `c6ebd24e-7b7d-4f7d-b520-9232e3b95ea5`. Not approved. Nothing in
`packages/` is changed: what exists is a prototype under [`apack-spec/prototype/`](apack-spec/prototype/) and this
record of the design it reached and the work it implies.

Related: [answers-in-the-contract.md](answers-in-the-contract.md) and spankyed/apack#583 move the app toward asks while
staying on XState. This plan takes the same idea further and has not been reconciled with either.

## Why

The app builds every system and surface on XState and uses a small part of it. Measured on `7a09f823e8`, 2026-11-20, by
reading every package source file's AST (`prototype/xstate-survey.mts`):

| | |
|---|---|
| Machines | 49 |
| With one state or none | 33 |
| With nested states | 2 |
| Transitions that name a target | 113 |
| Transitions that only run a handler | 1,175 |
| Parallel or history states | 0 |
| `fromPromise` | 3 |
| `assign` / `useSelector` call sites | 605 / 439 |

Two more counts are from text search and so approximate: about 510 places where a handler narrows its own event by hand
(`typeOf(…)`, `event.type ===`), and about 70 where an answer is matched to its request by hand (`answersCall`,
`newCall`, …).

What the app needs most is not in XState, so each piece is built on top of it: request and answer (`reply`,
`answerWith`, result events), cancellation, live views, and owned resources. XState is also part of the pack contract:
it is a shared-instance package (`SHARED_INSTANCE_PACKAGES`) and is named in seven of the SDK's recorded API reports.

Specific costs recorded in the source today:

- **State and data are two things that can disagree.** `entity-opening.ts` holds `request: Request | null` beside its
  states and asserts `request!` 13 times.
- **A handler receives every event.** Each one starts by casting: `const ev = event as { type: …; id: string }`.
- **An action cannot await and its return value is ignored**, so an answer is a second event and a failed handler can
  leave its asker waiting.
- **No `exit` action runs on `actor.stop()`**, which is why a listener has to be a child actor
  (`code/fe/state.ts`).
- **An event no state takes is dropped silently.**

## The design

There is one primitive, a **state**. A state has its own data and, if it has states inside it, is at exactly one of
them. What XState calls the machine is the outermost state. Nothing is parallel: independent concerns are separate
states running side by side.

### Declared as a type

```ts
type SearchSurface = {
  data: { searchQuery: string; searchResults: SearchResult[]; searchError: string | null }
  states: {
    idle: {}
    searching: { data: { searchProgress: SearchProgress | null } }
  }
}
```

### Read as a value

Exactly one path is the case, so where a state is is one string, and its data is every field that exists on that path.

```ts
{ at: 'searching', data: { searchQuery: 'todo', searchResults: [], searchError: null, searchProgress: null } }
```

### Defined with the same keys at every depth

| Key | Meaning |
|---|---|
| `data` | Its own fields and their starting values. `given` marks a field whoever enters the state must supply |
| `start` | Which state inside it it is at when entered |
| `states` | Every state inside it. Leaving one out does not compile |
| `on` | The events it takes. Synchronous. A handler returns what happens next |
| `asks` | The asks it answers. May be async. A handler returns the answer |
| `run` | What it does while it is the case. May be async. What it returns happens only if the state still is the case |

A handler or `run` returns the same two fields the value has: `{ at, data }`. Giving only `data` changes fields and
stays. Giving `at` goes to that path.

### Rules

1. **An event or ask goes to the innermost state that takes it**, then outward.
2. **Going somewhere ends what is no longer on the path and enters what is new.** States shared by the old and new path
   are kept with their data. The target itself is always entered afresh, so going to where it already is restarts it.
3. **Whoever enters a state gives the data of every state the move enters.** The compiler works out which those are
   from where the handler sits.
4. **Async work belongs to a state.** An event handler cannot await. It goes to a state whose `run` does the work. Leaving
   that state aborts `signal` and discards a late result. This is what makes cancel and latest-wins need no code.
5. **Cleanup is registered where the resource is taken**: `use(release)` runs when the state ends, however it ends.
6. **An ask answers and does not change data.** To change data it sends its own state an event. See Decisions.
7. **Every ask ends exactly once**: with its answer, a refusal it declares, or `failed`, `abandoned`, `unavailable` or
   `disconnected`.

### Communication

| Verb | From | To | Waits |
|---|---|---|---|
| `send(event)` | A state | Itself | No |
| `tell(name, event)` | Anywhere | A backend system, by name | No |
| `ask(name, ask, args, heard?)` | Anywhere | A backend system, by name | One answer, refusal or failure |
| `progress(update)` | An ask's handler | Whoever asked, and only them | No |
| `broadcast(name, event)` | The backend | That surface in every window | No |

Names are typed by one declaration of what can be reached, which a pack's generated facade would supply. A state may
also `start` another that lives exactly as long as it does, and reach it through the handle it gets back.

### Systems and steps

States run in a system. The backend is one system and each window is another, joined by a link. Within a system, one
message from outside and everything it causes among the states is one **step**: nothing leaves the system (an answer,
progress, a broadcast, word to a subscriber) until the step commits. This is what lets separate states stand in for
parallel regions: an observer never sees them disagree. The same idea is SCXML's macrostep, a Redux dispatch, a signals
batch, and this repo's own `transact` followed by `watch`.

## Decisions, and what each replaced

| Decision | What was tried first, and why it was dropped |
|---|---|
| State is a plain value type | A spec type listing each state's events and targets. Every new need added a keyword to it |
| No parallel states; separate states plus steps | Child charts with prefixed events, then several independent choices in one chart. Both were parallel regions under another name |
| A value is a path and the data there | A nested `{ data, at, state: { … } }`. Reads were three hops and the nested key was confusing |
| Data is under `data`, apart from `at` | Fields beside `at`. Framework words could not be told from the user's |
| Every state inside must be defined | Optional entries. An example that left one out was unreadable |
| A handler names the path to go to | `leave`, by which a state changed the state around it |
| `asks` is a table of its own | One `on` table. An ask and an event follow different rules, and nothing marked which was which |
| An ask does not change data by returning | Considered and declined: every change then has one shape, the extractor stays complete, and no real port needed it. To revisit if ports show many ask-plus-event pairs; the form would be an explicit `change((data) => …)` |
| Event handlers are synchronous | Async handlers. They bring back work nobody can see or cancel |

## What the prototype proves

Everything below is in [`apack-spec/prototype/`](apack-spec/prototype/) and runs from the repo root; its README has the
commands. Types and kernel together are about 450 lines.

- **Two real features are ported.** The code search, backend and surface (`search.mts`), runs: results stream, a second
  search aborts the first on the backend, and cancel works. About 167 and 192 non-blank lines become about 39 and 77.
  The library system (`library.mts`) is ported handler for handler and typechecks against stand-ins for its imports; it
  is not run. Its machine goes from 271 lines to 120, and four answer helpers and every result event go away.
- **A backend with three systems and two windows runs** (`threads.mts`): an ask that streams to its asker only, a
  broadcast both windows hear, a typed refusal that came from a second system, and a window that disconnects
  mid-stream, which ends its ask as `disconnected` and aborts the work on the backend.
- **The graph can be derived without running anything** (`graph.mts`): states, moves, what each state answers, and
  which other states it reaches, read from handler return types by the TypeScript checker. An earlier version of it
  caught a handler dropped during a port.
- **Mistakes that do not compile** were checked at each stage with `@ts-expect-error`: a state missing from a
  definition, entering a state without its data, reading a field of a state it is not in, an answer of the wrong type,
  an undeclared refusal, telling a state an event it does not take.
- **Steps were measured against plain actor delivery** on an earlier version of the prototype: an observer saw states
  disagree twice without steps and never with them. That measurement is not in this folder.

## Not built

- **The Vue binding.** Nothing renders. 439 `useSelector` sites depend on it.
- **Views.** Data a window shows from the database stays with `useView`; how a state follows one is undecided.
- **Roles**: `tell({ role: 'brain' }, …)`.
- **A write nobody waits for**, which appliers and migrations make today.
- **Window-to-window sends**, the app's `sendToSurface`.
- **Keyed dynamic children**: a flow per run, a surface per pack, a system per registration. The brain, the bus and the
  shell need them.
- **A bound on a step.** Two states that tell each other forever never commit.
- **Field names unique along a path** are assumed and not enforced.
- **A field with a default still has to be given** when entering its state, because the types cannot see the default.
- **Persistence, delayed transitions and history states** are absent. The app uses one delayed transition and no
  history states.
- **The bridge**: running a state inside XState's actor system during a migration. Unproven, and the migration order
  below depends on it.

## Costs

- **Size.** Files that define a machine total about 27,500 lines, and 132 spec files import XState. A half-finished
  migration is worse than either end.
- **No ecosystem.** No visualizer and no community knowledge; models and people know XState.
- **Edge cases.** XState has years of fixes that a new kernel would rediscover.
- **Static analysis needs the compiler**, and is as precise as the helper types: a loosely typed helper blurs the graph.
- **A discipline XState avoids by forbidding it.** After an `await` in `run` or an ask, code should only return. The
  kernel drops what a stale task sends through it, and cannot stop a side effect that bypasses it.

## Order of work

No step is started. Each is a decision point.

1. **Settle the open design** that the first real ports will hit: the Vue binding, how a state follows a view, and a
   write nobody waits for.
2. **Write the semantics down and test them**: ordering within a step, what ends when, errors, and the link. The kernel
   takes an injectable scheduler so interleavings can be replayed.
3. **Build the kernel in the tree**, with no dependencies, as its own workspace. Not a sibling repository: its API is
   the pack contract and moves with every feature ported.
4. **Prove the bridge**, so that states and XState machines run on one bus and features move one at a time. If it cannot
   be built, the plan needs a different migration and is reconsidered here.
5. **Port one feature end to end as the go or no-go**: the code search, both halves, with its specs. Judge it on line
   count, whether its specs pass unchanged in what they assert, and typecheck time.
6. **Port in order of risk**: the 20 single-state backend systems, the 13 single-state surfaces, surfaces with states,
   the brain, then the bus and the shell.
7. **Remove XState and the bridge**, and regenerate the recorded API reports.

## The name

`apack-spec` is a working name. "Spec" already means a test file here (`npm run spec`, `*.spec.ts`), so the name is
ambiguous in speech and should be settled before a package is created.
