# apack-spec: one state primitive in place of XState

Status: proposed, 2026-11-21, in Claude Code session `c6ebd24e-7b7d-4f7d-b520-9232e3b95ea5`. Not approved. Nothing in
`packages/` is changed: what exists is a prototype under [`apack-spec/prototype/`](apack-spec/prototype/) and this
record of the design it reached and the work it implies.

Related: [answers-in-the-contract.md](answers-in-the-contract.md) and spankyed/apack#583 moved the app toward asks
while staying on XState, and spankyed/apack#591 replaced #583 with the asking side this design wants.
[Alongside results-are-asks](#alongside-results-are-asks) says what this design takes from that work, what it leaves,
what the two share, and [what #591 delivered](#what-591-delivered), which is where the next work starts.

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
| `failed` | Where it goes when `run` throws, given what was thrown. Synchronous. Required when `run` is async |

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

A move may edit a draft too, when it has nothing to give the states it enters: the draft is the data where the handler
sits, edited before the move. A move that enters a state needing data gives it as fields.

Three mistakes that would otherwise do nothing and say nothing are refused, reported, and change nothing: an edit that
returns a value, an edit that is async, and an edit to a value that is not plain data. Such a value (a class instance,
a `Date`) reads as itself and can be replaced whole; editing it would change the one object every earlier value still
points at.

### Rules

1. **An event or ask goes to the innermost state that takes it**, then outward.
2. **Going somewhere ends what is no longer on the path and enters what is new.** States shared by the old and new path
   are kept with their data. The target itself is always entered afresh, so going to where it already is restarts it.
3. **Whoever enters a state gives the data of every state the move enters.** The compiler works out which those are
   from where the handler sits.
4. **Async work belongs to a state.** An event handler cannot await, and is not given `ask`: it goes to a state whose
   `run` does the work. Leaving that state aborts `signal` and discards a late result. This is what makes cancel and
   latest-wins need no code.

   **Work that awaits says where the state goes if it fails.** A `run` that returns a promise does not compile without
   `failed`, which is given what was thrown and returns what happens next, as an event's handler does. Without it a
   state whose work threw would stay where it was with nothing running, which on a surface is a screen that never
   leaves "searching". `failed` is not given a `Left`: being left is not failing. So it is also where to handle a
   failure without writing a `catch`, which could take a `Left`. A `run` that only sets things up need not say; what it
   throws is reported and the state stays as entered.

   **Nothing a pack's code throws stops the kernel.** A handler that throws changes nothing and is reported, and the
   state takes the next event as before; what it had already sent is sent, as a process that crashes has sent what it
   sent. A release, a subscriber, or what hears progress or a view that throws is reported and the rest still run.

   **A move that also changes data changes the data first**, so the work of the state it enters reads the data as the
   handler left it.
5. **Cleanup is registered where the resource is taken**: `use(release)` runs when the state ends, however it ends.
6. **An ask answers and does not change data.** To change data it sends its own state an event. See Decisions.
7. **Every ask ends exactly once**: with its answer, a refusal it declares, or `failed`, `abandoned`, `unavailable` or
   `disconnected`. An ask whose asker has gone, because the state that asked was left or its system stopped, ends
   where it is awaited by throwing `Left`. The code that asked unwinds as cancelled code does everywhere: its `finally`
   runs, what it held is let go, and nothing after the ask runs. The kernel takes the `Left` at the top of `run` and
   says in the trace that an ask was left; it is not a failure. The answerer's `signal` aborts, and a handler that was
   itself asking unwinds the same way and answers `abandoned`.
8. **A refusal is a kind, a message, and the data that kind declares.** `refuses` names kinds alone
   (`'not-found' | 'no-access'`) or each kind with what it carries (`{ 'name-taken': { existingId: string } }`). The
   handler has to give that data to `refuse`, and an asker reads it once it has checked the kind.

### Communication

| Verb | From | To | Waits |
|---|---|---|---|
| `send(event)` | A state | Itself | No |
| `tell(name, event)` | Anywhere | A backend system, by name | No |
| `ask(name, ask, args, heard?)` | A state's `run`, or an ask's handler | A backend system, by name | One answer, refusal or failure |
| `progress(update)` | An ask's handler | Whoever asked, and only them, as a list at most once a frame | No |
| `broadcast(name, event)` | The backend | That surface in every window | No |

Names are typed by one declaration of what can be reached, which a pack's generated facade would supply. A state may
also `start` another that lives exactly as long as it does, and reach it through the handle it gets back.

### Collections that grow

A value is replaced and never mutated, so appending to a list copies it. One change per item is then quadratic, and
streamed search results and streamed message text are where the app does exactly that. Three rules settle it:

1. **Progress arrives as a list, at most once a frame.** However fast a handler calls `progress`, whoever asked hears
   what was made since it last heard, in one call. A window's frame is `requestAnimationFrame`; elsewhere it is a turn
   of the event loop. What was gathered is handed over before the answer, so the answer is never ahead of its progress.
   **A hidden window's frame is a turn too.** A browser gives a hidden window no frames, so progress gathered for the
   next one would wait, and grow, until the window was shown. A hidden window paints nothing and has no reason to wait
   for a paint; and what was already waiting for one when the window was hidden is handed over then
   (`window-frame.mts`).
   **The sender gathers as well, one hop earlier.** What a backend sends a window within one turn should cross the
   socket as one frame, not one per item. In the app that is spankyed/apack#592, made at the socket under tRPC so it
   holds for every message whatever sent it; the kernel's link sits on it and has nothing of its own to add. Its one rule is that whatever reads that socket splits
   frames; the renderer and the testing client do, and a third reader would fail whenever two messages shared a turn.
   **Only progress waits, and it never waits behind anything.** Events, tells, asks and answers are handled as they
   arrive, as they always were. Whatever else arrives for a system hands over the progress gathered there first: a
   broadcast, an answer, something the user does. So progress is merged only with progress that came straight after
   it, and what a state hears, it hears in the order it was sent, whatever kind of message each was. Without this a
   broadcast sent after a piece of text was heard before it, by up to a frame.
   **What it costs.** Progress is heard up to one frame late, about 17 ms in a showing window. That is nothing for
   text and results, and wrong for something that must be acted on at once and one at a time: that is an event, not
   progress. There is no switch to turn gathering off; one would bring the quadratic cost back wherever it was used.
   A check that sends progress has to let a frame come, or send something after it, before it reads the result.
2. **One change per batch.** `(d) => { d.searchResults.push(...results) }` copies the list once for the whole batch.
   Nothing reads a state faster than a frame, so nothing is lost.
3. **A large collection belongs in a view.** State data is what a surface is working with, not a store. The kernel
   reports a field that passes 10,000 items, by name, so that it shows up as a finding and not as slowness.

Text needs nothing: the engine joins strings without copying them, and 100,000 appended pieces cost a quarter of a second.

`append-cost.mts`, 2026-11-21, Node 24.16.0 through `tsx`, on a machine that was not held quiet, so the ratios are the
finding and the figures are not: appending 100,000 results one change each took 21.6 s, and 0.26 s at 100 per change.
Streamed through an ask from a backend to a window, 100,000 results arrived as 199 changes in 0.12 s, with the size
report raised once.

### What a component reads

The kernel tells a subscriber, for each step, the exact places in a state's data that changed, as paths:
`['messages', 'THR-1', '3']` is the fourth message of one thread and nothing else. `mirror` writes just those places
into a reactive copy of the state, and Vue's own dependency tracking does the rest: whatever read a place that changed
runs again, and nothing else does. A component showing one thread does not re-render when another thread gets a
message.

```ts
const threads = mirror(system, handle)
threads.value.at                              // reactive
threads.value.data.messages[threadId]         // read again only when that thread's messages change
```

There is no selector to write and nothing to compare, which is what the 439 `useSelector` sites do today. The copy is
the mirror's own: a reactive object is written to in place, and the kernel's values are shared and never mutated.

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
| What was gathered is handed over before anything else arrives | Progress waiting for its frame while other messages went straight through. A broadcast sent after a piece of text was then heard before it, a reordering that shows only under timing |
| An ask whose asker has gone throws `Left` where it is awaited | Never settling it, which was tried first. A promise that never settles skips every `finally` after it, so a lock or a handle taken before the ask is held for good, and `Promise.all` over it hangs. Rejection is what `AbortSignal`, `fetch` and structured concurrency do, and code written for them is already correct here |
| `Left` is an exception, raised again by every later ask from the state that was left | The other designs that exist. A third outcome that runs `finally` and skips `catch` (Bluebird 3, the withdrawn TC39 cancelable promises) is the cleanest and cannot be expressed through native `await`. A separate interruption channel (Effect, ZIO) means writing in an effect system. Dropping the computation (Rust) needs destructors. A value to check (Go's `context`) lets code run on after it should have stopped. Killing with no unwinding (Erlang) is what never settling was, and `use(release)` already gives its cleanup. What every exception design has had to repair is cancellation swallowed by a `catch` meant for failures (Python moved `CancelledError` out from under `Exception`; Kotlin's `runCatching`), and raising once only (asyncio, which Trio corrected). Raising again is in the kernel; the swallowing is a pack rule, under What to build around it |
| A `run` that awaits must declare `failed` | Leaving it optional, as XState's `onError` is: a forgotten one is the stuck state every XState codebase has met. And requiring it of every `run`, which would ask a line of the many that only start a child or follow a view and cannot fail later. And restarting the state as Erlang's supervisors do, which loses what a surface holds and needs a limit on restarts to not loop |
| An event handler is not given `ask` | `ask` everywhere. An event handler cannot await, so it could only start an ask and drop the promise, with nothing around it to take a `Left`. That floating promise is what took a process down when a check stopped a window mid-ask. Without `ask` the mistake does not compile, and the kernel still catches an ask started in `run` and never awaited |
| A component reads a reactive copy that is written to only where the state changed | A selector and a comparison per reader, as `useSelector` has: every reader runs its selector on every change to decide whether it cares. And replacing the copy whole per step, which re-renders everything that read anything |
| A hidden window's frame is the next turn | `requestAnimationFrame` always. A hidden window gets none, so what was gathered for it grew without bound until it was shown |
| Progress is heard as a list, once a frame | One call per update. It made a change, a notice and a copy of the growing list per item: fine at 10,000, unusable at 100,000. A persistent vector would make appends cheap, but its values are not plain arrays, which the snapshot, the wire and the templates all assume. Chunked lists stay plain but push the chunking onto every reader |
| A nested change is an edit to a draft, built here | Spreads at every level (`{ ...data.titles, [id]: title }`), which get worse with depth. Immer and Mutative were considered; a state's data is plain by rule, so most of what they handle cannot occur, the kernel wants the changed fields in its own shape, and the kernel is meant to have no dependencies. To revisit, in favour of Mutative, if the draft grows special cases |
| No tags; `within(value, 'thread')` reads the path | Tags, as XState has them. "Somewhere inside `thread`" is a fact about the structure, so a tag for it is a second copy that can go stale, and it narrows no data. Tags are for grouping states that share no parent, and the app has no such group: on `375e00a563`, 2026-11-21, by text search, all 16 tags it declares name one state each. To revisit if a port finds a real cross-cutting group |
| A refusal may carry data, declared per kind | A kind and a message only. spankyed/apack#583 declares data per kind, and its settings refusal, which carries the store's `problems`, is the case a message alone cannot serve |

## What the prototype proves

Everything below is in [`apack-spec/prototype/`](apack-spec/prototype/) and runs from the repo root; its README has the
commands. Types and kernel together are about 600 lines, and the draft 139.

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
- **Every ordering, not the one that happened** (`schedule.mts`, `interleaving-check.mts`, 8 checks). The kernel puts
  off everything through lanes: what crosses a link one way is a lane, and so are a system's frames. A lane keeps its
  order, as a socket does, and a schedule chooses between lanes. `explore` runs a scenario under every such choice,
  `sample` under a seed's worth, and a failure comes back with the choices that `replay` runs again. Run under every
  ordering there is: a second search started over a first shows only the second (6,836 orderings); a search cancelled
  at any moment has nothing arrive afterwards and lets go of what it held (60); progress, broadcasts and the answer are
  heard in the order sent wherever a click lands (23,259); work that finishes after its state was left changes
  nothing (3). Two windows on one backend, one closing at any moment, has too many to run and is sampled (5,000 from
  one seed), which the result line says. And the check that the tool finds anything: the same search with its results
  taken from a broadcast passes under the first ordering, fails at the fifth, and fails the same way on replay.
  Mutating a copy of the kernel confirms the checks: no hand-over before an arrival, a late result applied, and an ask
  that never settles each fail one.

  It found a defect on its first run that no ordering was needed for: a move that also changed outer data started the
  entered state's `run` before the data was applied, so `run` read the old value. `search.mts` had it and its output
  did not show it.
- **The three examples check what they leave behind.** `search.mts`, `threads.mts` and `views.mts` print what happened
  for reading, and after each step compare where every state is and what it holds against what it should (5, 10 and
  13 comparisons). Before this they printed and exited 0 whatever happened, which is how the defect above ran
  unseen. A search result carries the text it matched, so the comparison says which search found it; putting the
  defect back in a copy of the kernel fails `search.mts` at "it searched for the second query".
- **Failing goes somewhere, and breaks nothing** (`failure-check.mts`, 12 checks): work that fails later, or at once,
  goes where `failed` says with what it threw; a state left while asking has not failed and nothing is reported; work
  that fails after its state was left changes nothing and is reported; a handler that throws changes nothing and the
  next event is handled; a `failed` that throws is reported; a release that throws does not stop the others; an ask
  whose handler throws is answered `failed` and reported where it threw, which may be another process from the asker;
  a state that tells itself without end is cut short after ten thousand things, reported, and takes events
  afterwards; and an async `run` without `failed` does not compile. Before this a `run` or a handler that threw at once escaped the step
  and left the kernel refusing everything after it.
- **Leaving mid-ask unwinds, and nothing hangs or crashes** (`leaving-check.mts`, 7 checks): a `run` awaiting an ask
  when its state is left has its `finally` run and its lock released, and nothing after the ask runs; the trace says an
  ask was left and reports no failure; an ask inside `Promise.all` ends too; the answerer's `signal` aborts, and a
  handler that was itself asking unwinds; an ask started and never awaited leaves no unhandled rejection; an answer
  that arrives in time is unaffected; and an event handler asking for `ask` does not compile.
- **Progress keeps its place** (`progress-check.mts`, 6 checks, a backend and a window with the window's frame held
  by the check): two hundred pieces arrive as one list; a broadcast sent between two pieces is heard between them;
  something the user does while progress waits is handled after it; another ask's answer is not ahead of progress
  sent before it; a frame hands over what waits when nothing else arrives first; and stopping a window mid-ask leaves
  nothing unhandled.
- **A reader runs again only for the place it read** (`mirror.mts`, `binding-check.mts`, 9 checks, with
  `@vue/reactivity`'s `effect` standing for a component's render): a message in one thread runs only that thread's
  reader, a rename only that title's, a move only the reader of where the state is; removing from a list and deleting
  a key reach their readers; and the state's own value is never written to. The same file checks a window's frame:
  the next paint while it shows, the next turn while it is hidden, and what was waiting handed over once when it hides.
- **Progress gathered into batches** (`append-cost.mts`): the measurement above, and the search and threads examples,
  which now make one change per batch.
- **A draft** (`draft.mts`, 139 lines; `draft-check.mts`, 18 checks) for what a hand-built one gets wrong: the old
  value untouched, what was not edited kept as the same object, an edit that changes nothing returning the very same
  value, the same place read twice being the same draft, arrays through `push`, `splice`, `sort` and `length`, keys
  added and deleted, one part of the draft assigned to another, what is not plain handed over as it is, and a draft
  kept past its handler refusing to be used, and the three refused mistakes. `kernel-check.mts` holds eight more on
  what the kernel does with a change: subscribers told which fields of a state changed in a step and told nothing when
  a handler changed nothing, a move that edits a draft, and each refused edit reported with the data left as it was.
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

### What #591 delivered

spankyed/apack#591 is step 1 of the [order of work](#order-of-work), on XState. Its work list and the recipe it
followed are `docs/plans/asks-shape.md` on that branch. Read against the tables above:

| Shared item | State after #591 |
|---|---|
| `{ args, answer, refuses, progress }`, `refuse(...)`, `progress(...)`, the handler's `signal` | Done, in the SDK and every contract |
| An asker awaits: no `ASK_ANSWERED` or `ASK_FAILED` handled by a surface | Done. A state invokes `fromAsk`, an ask is spawned and handled where it ends, or a component awaits `ask`/`useAsk` |
| A feed beside the answer | Gone: the search and the git transfers say `progress` |
| Leaving the asker's state aborts the handler | Done: the asker's abort reaches the handler's `signal`, and a stopped ask is not answered |
| `waiting` | Gone from a handler's arguments |
| A loading flag is a state that invokes the ask | Done where an ask was touched |
| `tell` and `broadcast` | Not done: still `sendToSystem` and `broadcastToSurface` |
| Handlers as tables beside the machine | Not done, on purpose: an ask is taken by the state that lists it (`answers.on`), which is this design's `asks` per state. A child machine answers its own asks |
| A component reads state through the SDK | Not done: `useSelector` on an actor stands |
| A machine is defined through the SDK; no `xstate` import in a pack | Not done |
| A spec drives a feature at its boundary | Partly: specs of asks ask, and many still read an actor's context |

spankyed/apack#593, stacked on #591, finished what #591 listed as open: no surface machine is `type: 'parallel'`, and
an ask that can be under way beside others is spawned under an id, with `askUnderWay(snapshot, id)` reading whether it
is. That is XState's shape for "several asks at once"; here each is an awaited `ask` in a handler, and
[collections that grow](#collections-that-grow) replaces finding an ask again by its id.

**Where the next work starts.** The remaining seams of step 1, each its own PR on `master` once #591 and #593 are merged: rename to `tell` and `broadcast`; state read through the SDK in
components; machines defined through the SDK with a pack rule against `xstate`. Then step 2.

## What to build around it

The design is the smaller half of the value. In the order they would pay:

1. **The Vue binding.** The largest unknown, and what the 439 `useSelector` sites become. A component should read a
   state by name and re-render only for the fields it read:

   ```ts
   const thread = useState('threads')
   thread.at                                  // reactive
   if (within(thread, 'thread')) thread.data.threadId
   ```

   `within` exists, and so does what the reading rests on: `mirror`, under What a component reads. What is left is
   `useState` itself, a composable that finds the state by name, mirrors it for the component's lifetime and stops with
   it, and the port of real components onto it.
2. **Tests that replay interleavings.** The risk in this design is ordering: a result that arrives after its state was
   left. The prototype has this: `schedule.mts`, under What the prototype proves. What is left is its place in the
   harness, so that a pack's spec runs a scenario under every ordering the way it runs a case today, and a reduction
   that skips orderings differing only in two things that cannot affect each other, which is what would let two
   windows be run in full. This is the strongest reason to own the kernel.
3. **The graph as a recorded file.** `graph.mts` is a script. As a recorded file per feature, with `:check` and
   `:update` halves like the API reports, a change to a state's graph shows in the diff. The same data gives pack rules:
   a state never entered, an event nothing takes, an ask nobody asks, and **a cycle of asks**. A answering an ask by
   asking B, while B answers by asking A, is the oldest fault of request and answer between actors: in Erlang it is the
   `gen_server` deadlock, and Orleans checks its call chains for it. Here nothing blocks, and both asks wait for good,
   since by design no ask times out. The graph already holds who each state's ask handlers ask, so a cycle is found
   without running anything. That is the whole of the checking worth having.
   Exploring the graph for a state with no way out, or an event a state does not take, was considered and left out:
   the first reports every state that is meant to be an end, and the second every event handled further up, which is
   where most handlers sit.
4. **The step log.** A step is already one whole unit: its cause, the handlers that ran, the data that changed, and
   what left the system. Recorded, it gives a bug report that replays to the same state, a test made from a recording,
   and a timeline in the Logs surface that shows what one click caused across every state it reached.
5. **A pack rule against a promise nobody awaits.** The kernel keeps a dropped ask from taking the process down, but
   the code that dropped it also never sees its answer or its refusal. `no-floating-promises` over pack sources, as a
   pack rule beside the others, refuses it for every pack.
6. **A pack rule against a swallowed `Left`.** A `catch` in `run` or in an ask's handler that can take a `Left` has to
   rethrow it. One that does not lets the code carry on after its state was left. The kernel already drops what that
   code returns and raises `Left` again at its next ask, so what the rule protects is a side effect outside the state,
   a file written or a process started, made by code that should have stopped. Refusals come back as values, so
   ordinary code has no reason to catch around an ask and the rule should fire rarely.
7. **The rough edges the examples showed.** A state it started is reached with `child('draft', draft)` each time and
   should be declared once. The two under Not built about fields: a default that still has to be given, and names
   unique along a path.
8. **Affordances, once the graph is a recorded file.** Every state declares what it takes, so the app can answer what
   can be done right now on any surface, with each event's name and the type of its fields. An agent driving the app
   asks that instead of reading the screen, and the answer is right by construction. For this product it is the
   capability most worth having, and no state library offers it. It is last because it reads the same data the recorded
   graph holds, so it is small after item 3 and a second extractor before it.

Deliberately not built: parallel states, history states, a visual editor, and a general-purpose library for other
projects. Each would loosen the fit to this app.

## Not built

- **The Vue binding's last step.** `mirror` and `within` exist; `useState`, the composable a component calls, does not,
  and nothing renders. 439 `useSelector` sites depend on it.
- **Roles**: `tell({ role: 'brain' }, …)`.
- **A write nobody waits for**, which appliers and migrations make today.
- **Window-to-window sends**, the app's `sendToSurface`.
- **Keyed dynamic children**: a flow per run, a surface per pack, a system per registration. The brain, the bus and the
  shell need them. A keyed set of views is covered by `watch`; a keyed set of states is not.
- **A check for a cycle of asks.** Two systems that each answer by asking the other wait on each other without end,
  and nothing reports it. It is a pack rule over the recorded graph, under What to build around it.
- **A bound across steps.** A step is cut short after ten thousand things. Two systems that tell each other across a
  link without end are a step each, and nothing bounds that; a schedule stops a run that has not come to rest.
- **Undoing what a handler sent before it threw.** Its change is not made, and what it told others is still told.
- **Field names unique along a path** are assumed and not enforced.
- **A field with a default still has to be given** when entering its state, because the types cannot see the default.
- **Restoring a state after a reconnect or a code reload.** A state is plain data, `{ at, data }`, so it can be handed
  back to a fresh copy of itself, which is what `useSurfaceDraft` does by hand today for what a component holds. Wanted,
  and waits for the first port to say what it must carry.
- **Saving a state to disk** is not wanted. Its running work cannot be saved, so a restored state would be at
  `searching` with nothing searching, and a saved state is a stored format that would then have to be kept stable.
- **Delayed transitions and history states** are absent. The app uses one delayed transition and no history states.
- **The kernel's own rough edges.** Reading a state that has ended throws, and a returned field that no active state
  owns is dropped without a word.
- **The bridge**: running a state inside XState's actor system during a migration. Unproven, and the migration order
  below depends on it.

## Costs

- **Size.** Files that define a machine total about 27,500 lines, and 132 spec files import XState. A half-finished
  migration is worse than either end.
- **No ecosystem.** No visualizer and no community knowledge; models and people know XState.
- **Edge cases.** XState has years of fixes that a new kernel would rediscover.
- **Compile errors are deep.** A missing `failed` is reported as the whole state not being assignable, with the line
  that says so, "Property 'failed' is missing", third after two of printed types. Every rule the types hold is reported
  this way. Nobody has yet met these errors while writing a feature, and the first port is where their cost shows. How
  long the compiler takes over 49 machines' worth of these types is not measured either.
- **Static analysis needs the compiler**, and is as precise as the helper types: a loosely typed helper blurs the graph.
- **A discipline XState avoids by forbidding it.** After an `await` in `run` or an ask, code should only return. The
  kernel drops what a stale task sends through it, and cannot stop a side effect that bypasses it.

## Order of work

Step 1 is under way; no later step is started. Each is a decision point.

1. **Bring the XState code to the shared vocabulary and seams** ([Alongside results-are-asks](#alongside-results-are-asks)).
   spankyed/apack#591 did the vocabulary and the asking side, which removes the event path for answers.
   [What #591 delivered](#what-591-delivered) lists the seams still to do, which are what leave pack code that does not
   name XState.
2. **Settle the open design** that the first real ports will hit: the Vue binding, and a write nobody waits for.
3. **Write the semantics down and test them**: ordering within a step, what ends when, errors, and the link. The
   prototype's kernel takes a schedule and its checks run every ordering; the kernel in the tree keeps both.
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
