# apack-spec: one state primitive in place of XState

Status: proposed, 2026-11-21, in Claude Code session `c6ebd24e-7b7d-4f7d-b520-9232e3b95ea5`. Not approved. Nothing in
`packages/` is changed: what exists is a prototype under [`apack-spec/prototype/`](apack-spec/prototype/) and this
record of the design it reached and the work it implies.

Related: [answers-in-the-contract.md](answers-in-the-contract.md) and spankyed/apack#583 move the app toward asks while
staying on XState. [Alongside results-are-asks](#alongside-results-are-asks) says what this design takes from that
work, what it leaves, and what the two should share so that one leads to the other.

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

`data` is the fields to replace, or, for a change to something nested, a function that edits a draft in place:

```ts
THREAD_ADDED: ({ threadId, title }) => ({
  data: (d) => { d.titles[threadId] = title; d.messages[threadId] = [] },
}),
```

Nothing is mutated: a new value is made from the edits, what was not edited is the same object as before, and the
kernel learns exactly which fields changed. A draft edits fields that exist and cannot add or remove one, since which
fields exist is the states' to say.

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
8. **A refusal is a kind, a message, and the data that kind declares.** `refuses` names kinds alone
   (`'not-found' | 'no-access'`) or each kind with what it carries (`{ 'name-taken': { existingId: string } }`). The
   handler has to give that data to `refuse`, and an asker reads it once it has checked the kind.

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

### Following a view

Data a window shows from the database stays a view. A component reads one with `useView`, unchanged: it has nothing to
do with states. A surface that has to follow one from its machine does it with `watch`, which is what `fromView`
becomes:

```ts
detail: {
  data: { id: given, detail: given },

  run({ data, watch, send }) {
    watch('detail', 'threads', 'detail', { id: data.id }, (update) =>
      send(update.ok ? { type: 'DETAIL.READ', detail: update.value } : { type: 'VIEW_FAILED', view: 'detail', error: update.error }))
  },
}
```

A watch belongs to the state that made it and ends when that state does, so nothing is spawned or stopped by hand. The
first argument is a key: a second watch under the same key replaces the first, and `unwatch(key)` ends one, which is
how a set is followed, one per open tab.

On `375e00a563`, 2026-11-21, by text search: `useView` has 26 call sites and `fromView` nine, eight of them in the
threads surface, which spawns and stops each view's actor itself in about a dozen places.

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
| A nested change is an edit to a draft, built here | Spreads at every level (`{ ...data.titles, [id]: title }`), which get worse with depth. Immer and Mutative were considered; a state's data is plain by rule, so most of what they handle cannot occur, the kernel wants the changed fields in its own shape, and the kernel is meant to have no dependencies. To revisit, in favour of Mutative, if the draft grows special cases |
| No tags; `within(value, 'thread')` reads the path | Tags, as XState has them. "Somewhere inside `thread`" is a fact about the structure, so a tag for it is a second copy that can go stale, and it narrows no data. Tags are for grouping states that share no parent, and the app has no such group: on `375e00a563`, 2026-11-21, by text search, all 16 tags it declares name one state each. To revisit if a port finds a real cross-cutting group |
| A refusal may carry data, declared per kind | A kind and a message only. spankyed/apack#583 declares data per kind, and its settings refusal, which carries the store's `problems`, is the case a message alone cannot serve |

## What the prototype proves

Everything below is in [`apack-spec/prototype/`](apack-spec/prototype/) and runs from the repo root; its README has the
commands. Types and kernel together are about 540 lines, and the draft 110.

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
- **A surface follows views** (`views.mts`), modelled on the threads surface: one for as long as the surface runs, one
  only while a thread is open, and one per open tab. Opening another thread stops the last one's view; closing a tab
  stops its view; stopping the surface stops the rest.
- **A draft** (`draft.mts`, 110 lines; `draft-check.mts`, 15 checks) for what a hand-built one gets wrong: the old
  value untouched, what was not edited kept as the same object, an edit that changes nothing returning the very same
  value, the same place read twice being the same draft, arrays through `push`, `splice`, `sort` and `length`, keys
  added and deleted, one part of the draft assigned to another, what is not plain handed over as it is, and a draft
  kept past its handler refusing to be used. The kernel tells subscribers which fields of each state changed in a
  step, and tells them nothing when a handler changed nothing.
- **`within` narrows by path** (`state.mts`, used in `threads.mts`): inside `thread` the thread's id can be read,
  inside `thread.sending` the streamed text can, and a state that does not exist does not compile.
- **Mistakes that do not compile** were checked at each stage with `@ts-expect-error`: a state missing from a
  definition, entering a state without its data, reading a field of a state it is not in, an answer of the wrong type,
  an undeclared refusal, telling a state an event it does not take. Three about a refusal's data are in `threads.mts`:
  refusing without the data a kind declares, giving data to a kind that declares none, and reading that data before
  the kind is checked.
- **Steps were measured against plain actor delivery** on an earlier version of the prototype: an observer saw states
  disagree twice without steps and never with them. That measurement is not in this folder.

## Alongside results-are-asks

[answers-in-the-contract.md](answers-in-the-contract.md) and spankyed/apack#583 make every result an ask while staying
on XState. Its answering side and this design are one idea: asks declared in the contract, a table with one handler
per ask, a handler that returns its answer and throws its refusal, and `failed` and `unavailable` as every ask's.

### Taken from it

| In #583 | Here |
|---|---|
| A refusal carries data declared per kind | Rule 8, and in the prototype |
| The bus answers an ask nothing took | `unavailable` |
| A handler's `signal` aborts when the asking window goes | The same, and also when the asker's own state is left |
| Tests ask through the harness (`app.ask`) | `system.ask`; a harness over this keeps that method |

### Left out, and why

| In #583 | Why not here |
|---|---|
| `ASK_ANSWERED` and `ASK_FAILED` as events, with `isAnswered`, `answerOf` and `AnswersOf` | A second way to receive an answer. Every transition then needs a guard naming its ask. An asker awaits `ask`, in a component or in a state's `run` |
| Answers wired through the machine (`answers.actions`, `answers.on`) | `asks` is a table of the state. A system with no states inside is that table and nothing else |
| `waiting`, read by a handler to learn whether anyone asked | A handler does not branch on transport. What every window should hear is a `broadcast`, whoever asked. A write nobody waits for is still open (Not built) |
| A feed beside the answer (`sendToWindow(client, …)`) | `progress`, declared on the ask and heard only by its asker |
| A cancelled ask whose handler keeps running, and a `superseded` refusal | Leaving the asker's state aborts the handler's `signal` |
| A disk error mapped to `not-found` or `no-access` where declared | A handler names its own refusals. A mapping the handler does not show is one a reader has to know about |

### What the two should share

Code written on XState now should read the same after a move to this design. That is a matter of names and of where
pack code touches XState.

**One vocabulary.** #583 says `ask` for an ask's fields, `fails` and `failure`. Renaming once, on XState, is cheaper
than renaming again here.

| Concept | Name in both |
|---|---|
| An ask's declaration | `{ args, answer, refuses, progress }` |
| Asking | `ask(name, ask, args)`, resolving to an `Outcome` |
| Refusing | `throw refuse(kind, message, data?)` |
| Telling the asker before the answer | `progress(update)` |
| Stopping work nobody waits for | the handler's `signal` |
| Telling a system | `tell` |
| Telling a surface in every window | `broadcast` |

**Seams the SDK owns.** Each of these is work on XState today, and each removes a line the move would otherwise touch.

- **Handlers are plain functions in tables beside the machine**: asks, and events keyed by name with each handler given
  its own event. A single-state system is then two tables and a trivial machine.
- **A component reads state through the SDK**, handed `{ at, data }` computed from the XState snapshot, and never
  calls `useSelector` on an actor. There are 439 such calls.
- **A machine is defined through the SDK**, which may only re-export XState's `setup` and `assign` at first. A pack rule
  then refuses a direct `xstate` import in pack sources.
- **A loading flag is a state that invokes the ask**, and an independent concern is an actor of its own, never a
  parallel state.
- **A spec drives a feature at its boundary**: events in, `ask`, state read through the SDK. 132 spec files import
  XState, and one that reads an actor's context is rewritten by the move.

What does not carry over is authoring in this design's syntax on XState's runtime. A handler here chooses where to go
when it runs, and XState's targets are fixed in the machine's config.

## What to build around it

The design is the smaller half of the value. In the order they would pay:

1. **The Vue binding.** The largest unknown, and what the 439 `useSelector` sites become. A component should read a
   state by name and re-render only for the fields it read:

   ```ts
   const thread = useState('threads')
   thread.at                                  // reactive
   if (within(thread, 'thread')) thread.data.threadId
   ```

   `within` exists, and the kernel tells a subscriber which fields of a state changed in a step, which is what
   per-field reactivity needs. `useState` and the reactivity itself do not exist.
2. **Tests that replay interleavings.** The risk in this design is ordering: a result that arrives after its state was
   left. A kernel with an injectable scheduler can run every ordering of a scenario, or a seeded one, and replay a
   failure exactly. This is the strongest reason to own the kernel.
3. **The graph as a recorded file.** `graph.mts` is a script. As a recorded file per feature, with `:check` and
   `:update` halves like the API reports, a change to a state's graph shows in the diff. The same data gives pack rules:
   a state never entered, an event nothing takes, an ask nobody asks.
4. **The step log.** A step is already one whole unit: its cause, the handlers that ran, the data that changed, and
   what left the system. Recorded, it gives a bug report that replays to the same state, a test made from a recording,
   and a timeline in the Logs surface that shows what one click caused across every state it reached.
5. **Affordances.** Every state declares what it takes, so the app can answer what can be done right now on any
   surface, with each event's name and the type of its fields. An agent driving the app asks that instead of reading
   the screen, and the answer is right by construction. For this product it is the capability most worth having, and
   no state library offers it.
6. **The rough edges the examples showed.** A state it started is reached with `child('draft', draft)` each time and
   should be declared once. The two under Not built about fields: a default that still has to be given, and names
   unique along a path.

Deliberately not built: parallel states, history states, a visual editor, and a general-purpose library for other
projects. Each would loosen the fit to this app.

## Not built

- **The Vue binding.** Nothing renders. 439 `useSelector` sites depend on it. Sketched under What to build around it.
- **Roles**: `tell({ role: 'brain' }, …)`.
- **A write nobody waits for**, which appliers and migrations make today.
- **Window-to-window sends**, the app's `sendToSurface`.
- **Keyed dynamic children**: a flow per run, a surface per pack, a system per registration. The brain, the bus and the
  shell need them. A keyed set of views is covered by `watch`; a keyed set of states is not.
- **A bound on a step, and what a thrown handler does.** Two states that tell each other forever never commit, and a
  handler that throws has no defined outcome beyond being reported.
- **Field names unique along a path** are assumed and not enforced.
- **A field with a default still has to be given** when entering its state, because the types cannot see the default.
- **Persistence, delayed transitions and history states** are absent. The app uses one delayed transition and no
  history states.
- **The kernel's own rough edges.** Reading a state that has ended throws, and a returned field that no active state
  owns is dropped without a word.
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

1. **Bring the XState code to the shared vocabulary and seams** ([Alongside results-are-asks](#alongside-results-are-asks)),
   stacked on spankyed/apack#583. It is worth doing whether or not anything after it is: it removes the event path
   for answers, and leaves pack code that does not name XState.
2. **Settle the open design** that the first real ports will hit: the Vue binding, and a write nobody waits for.
3. **Write the semantics down and test them**: ordering within a step, what ends when, errors, and the link. The kernel
   takes an injectable scheduler so interleavings can be replayed.
4. **Build the kernel in the tree**, with no dependencies, as its own workspace. Not a sibling repository: its API is
   the pack contract and moves with every feature ported.
5. **Prove the bridge**, so that states and XState machines run on one bus and features move one at a time. If it cannot
   be built, the plan needs a different migration and is reconsidered here.
6. **Port one feature end to end as the go or no-go**: the code search, both halves, with its specs. Judge it on line
   count, whether its specs pass unchanged in what they assert, and typecheck time.
7. **Port in order of risk**: the 20 single-state backend systems, the 13 single-state surfaces, surfaces with states,
   the brain, then the bus and the shell.
8. **Remove XState and the bridge**, and regenerate the recorded API reports.

## The name

`apack-spec` is a working name. "Spec" already means a test file here (`npm run spec`, `*.spec.ts`), so the name is
ambiguous in speech and should be settled before a package is created.
