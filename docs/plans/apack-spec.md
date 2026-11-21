# apack-spec: one state primitive in place of XState

Status: proposed, 2026-11-21, in Claude Code session `c6ebd24e-7b7d-4f7d-b520-9232e3b95ea5`. Not approved. Nothing in
`packages/` is changed: what exists is a prototype under [`apack-spec/prototype/`](apack-spec/prototype/) and this
record of the design it reached and the work it implies.

Related: [answers-in-the-contract.md](answers-in-the-contract.md) and spankyed/apack#583 moved the app toward asks
while staying on XState, and spankyed/apack#591 replaced #583 with the asking side this design wants.
[Alongside results-are-asks](#alongside-results-are-asks) says what this design takes from that work, what it leaves,
what the two share, and [what #591 delivered](#what-591-delivered), which is where the next work starts.

**The design as it stands, on one page, with a complete example: [apack-spec/design.md](apack-spec/design.md).** This
file is the longer record: why, every decision with what it replaced, what the prototype proves, and what is not
built.

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

**What is left for the kernel, now that the app's vocabulary is this design's.** On `97ee092630`, 2026-11-22, the
app's components read through `useState`, its machines make their asks by name, and a send is `tell` or
`broadcast`, all on XState ([What #591 delivered](#what-591-delivered)). That took the daily cost out: the selectors,
the ids of asks, the events an answer arrived as. What XState with those helpers still cannot do is what the kernel
is for:

- data that exists only in the state that declares it, checked by the compiler. This is the smallest of them: 33 of
  the 49 machines have one state or none;
- a step: one message and everything it causes committed together, so nothing is seen half-made;
- work that has one owner and stops when its owner does, and an ask that ends where it is awaited;
- reads, views and started states that follow from the data, where a machine starts and stops each by hand;
- every ordering of a scenario run, where a spec runs the one that happened;
- the graph read off the types, with nothing run.

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

A state that starts others says so here too, under `starts`: a state, or `Each<…>` of one where there is one for each
key.

```ts
type Threads = {
  data: { titles: Record<string, string> }
  starts: { thread: Each<ThreadState> }
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
| `on` | The events others may send it. Synchronous. A handler returns what happens next |
| `internal` | The events it sends itself, which nothing else may send it. The same handlers |
| `asks` | The asks it answers. May be async. A handler returns the answer, or `answered(answer, next)` to change something as it answers |
| `run` | What it does while it is the case. May be async. What it returns happens only if the state still is the case |
| `starts` | The states it starts, which run while it is the case |
| `follows` | The views it follows while it is the case, each with a handler for what it delivers |
| `awaits` | The reads it is waiting on while it is the case, each with a handler for how it ended |
| `makes` | The writes it makes when a handler says `make`, each with a handler for how it ended |
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

   **What a state holds is a value, and it is frozen.** Every plain object and list a state holds is frozen, all
   the way down, when it becomes the state's. A handler changes data by returning a change, never by writing to what
   it was handed, and one that writes throws on that line, changes nothing and is reported. A component is handed
   these same objects ([What a component reads](#what-a-component-reads)) and cannot write to them either. It costs
   little: a step makes new objects only for what it changed, and freezing stops at what is frozen already. What
   it costs a reader is three ways of copying a list and nothing else that matters. V8 copies a frozen list by
   `slice`, `toSpliced` or `with` an element at a time: on 5,000 rows about 0.12 ms where an unfrozen list takes under
   a microsecond, and `filter` and `find` cost four and two times what they did. A spread, `map`, a loop, a read by
   index and a sort of a spread copy cost the same frozen or not, and a spread is how the draft copies
   (`frozen-cost.mts`, 2026-11-21, Node 24.16.0, each figure the least of nine rounds on a machine under load). So a
   copy of what was read is written `[...list]`. What is
   not plain data is left as it is. And **what goes into a state is the state's from then on**: an object a handler
   stores is frozen where it stands, so whoever else kept it and writes to it later is the one that fails. A state
   that held something another could still change would change with no step, which is the fault; freezing puts the
   error at the write, in the other's code, with a message that names neither.

   **The types say a field at every depth, and a list where a field holds it.** What a handler is handed and what
   is read from a state are typed so that no field can be assigned, however far in, and a list a field holds cannot
   be changed in place: `data.count = 1`, `data.titles[id] = title`, `data.open.title = title`, `data.items.push(x)`
   and `data.items.sort()` do not compile. What the types leave is a list further in changed in place:
   `data.byId.a.push(x)` compiles and throws on the line that ran it. Each half goes as far as it costs nothing, and
   the two are different because TypeScript treats them differently. A read-only object is taken wherever a writable
   one is expected, so saying it at every depth asks nothing of a helper that takes the object as its type declares
   it: measured on the app, it adds no error at all (Not built). The same fact means the word does not carry across a
   call, so it refuses the write made where the value was read, which is where a handler writes. A read-only list is
   not taken where a list that may be written is expected. Said of a field's own list, that is the word carrying
   across a call. Said of every list inside an entity, it refuses the entity wherever its declared type is asked for,
   which is what a type read-only at every depth cost. The flag that would have made an object's word carry too,
   `--enforceReadonly`, was closed unmerged on 2026-03-24 (TypeScript PR 58296), and nothing here waits on it.
   Solid took the type that is read-only at every depth off its stores for what it cost (PR 3261, 2026-09-04), Redux Toolkit declined to add it,
   and Valtio ships it with a way out; Vue's `readonly()` and Effect type it deep. What is read can be handed on as
   it is, since handing on is not writing: given back as a change, sent, told, broadcast, reported, said as progress,
   given as an answer or as an ask's arguments. None asks for a copy or a cast. A draft is the one place a write is
   written, and it is typed as what may be written to, apart from what is read. That leaves one place a read value is
   not taken as it is: a list assigned to a field of a draft, `d.items = data.items`. It would be safe, and TypeScript
   cannot give a field one type to read and another to assign, so there it is copied, or given as a field of the
   change. **Freezing is the guarantee and the types are the early word.** What the types leave is a list further in
   changed in place, and a write made through a helper typed as writable. Both throw where they are tried, and what
   the engine says then is about a property and an object: `Cannot add property 1, object is not extensible`. So
   wherever the kernel reports what a handler threw, such an error is followed by what happened and what to write:
   that data is not written where it is read, and is changed by returning a change. That is the one word a write
   through a helper can be given, since nothing that reads the code sees inside the helper. The kernel knows the
   error by the engine's wording, which only adds to what is reported, and a check makes every kind of write and
   fails when one is no longer worded so. Redux Toolkit and MobX do the same: the guarantee is at run time, and its
   message is where the rule is learnt. A write made where the value was read is for a pack rule to refuse before it
   runs (Not built).

   **A change is all of it or none, and what the compiler refuses the kernel refuses too.** The types already rule out
   adding or removing a field, giving a field no state has, moving to a state that does not exist, and entering a
   state without what it marks `given`. Code that gets past them with a cast meets the same rule when it runs, and
   the whole change is refused: nothing is changed and no state is left or entered. An edit to a draft is refused at
   the write that tried, so the report names the handler's own line. Fields that are given, and a move, are looked
   at before anything is done: the fields there will be after a move are the data of the states on the path it
   leaves the state at, which the definition says without running anything. This costs nothing where it does not
   fire, because a draft builds a new value beside the old one and never changes it: refusing is keeping the old
   one.
5. **Cleanup is registered where the resource is taken**: `use(release)` runs when the state ends, however it ends.
6. **An ask's answer and the change it makes are one thing.** A handler that only answers returns the answer. One
   that also changes something returns `answered(answer, next)`, where `next` is what every other handler returns:
   where to be, and what data changes. The change is made in the step the answer leaves in, so whoever asked sees
   the change when they have the answer, and is never told of a change that was not made: a change that is refused
   answers the ask `failed` and changes nothing. After an `await` the data is changed by editing a draft and not by
   giving fields, which the compiler holds: fields would be worked out from the data as it was before the wait, and a
   draft is edited against the data as it is when the change is made. If the state that was answering was left
   meanwhile, the ask is `abandoned` and nothing is changed.

   **What has to hold when the change is made is checked in the change.** A handler that waits lets other events and
   asks through while it does, so what it checked before the wait may not be so after. The change is made against the
   data as it is then, in one step, and it may refuse: an edit that throws one of the ask's refusals answers with that
   refusal and changes nothing. So the work is done holding nothing, and the check and the write are one step at the
   end.
7. **Every ask ends exactly once**: with its answer, a refusal it declares, or `failed`, `abandoned`, `unavailable` or
   `disconnected`. An ask whose asker has gone, because the state that asked was left or its system stopped, ends
   where it is awaited by throwing `Left`. The code that asked unwinds as cancelled code does everywhere: its `finally`
   runs, what it held is let go, and nothing after the ask runs. The kernel takes the `Left` at the top of `run` and
   says in the trace that an ask was left; it is not a failure. The answerer's `signal` aborts, and a handler that was
   itself asking unwinds the same way and answers `abandoned`.
8. **A refusal is a kind, a message, and the data that kind declares.** `refuses` names kinds alone
   (`'not-found' | 'no-access'`) or each kind with what it carries (`{ 'name-taken': { existingId: string } }`). The
   handler has to give that data to `refuse`, and an asker reads it once it has checked the kind.
9. **Work has one owner, and stops when its owner does.** A state's `run` is the state's, and stops when the state is
   left. An ask's handler is the ask's, and stops when whoever asked has gone, or when the state answering is left.
   So where work is put says how long it lasts. What is done for whoever asked, a search or checking what they sent,
   goes in the ask's handler: nobody wants it once they have gone. What has to be finished whoever is still there, a
   reply to a message that was accepted, is not the ask's: the ask starts it in a state on the answering side, and
   answers at once. There is no way to shield a handler from stopping, since that would be a second answer to the same
   question.

   **Stopping is asked for, not done.** JavaScript cannot interrupt running code. When the owner goes, the work's
   `signal` aborts, its next `ask` throws `Left`, and what it sends through the kernel goes nowhere. Code that awaits
   no ask and passes `signal` to nothing runs to its end. Data is changed only by what a handler returns, at its end,
   so work that stopped part-way has changed nothing; and a handler that does reach its end has its change made even
   if whoever asked has gone, because the work was done and the data should say so. A handler that throws because its
   `signal` aborted has stopped, and is reported as that and not as a failure.
10. **What a state starts, follows and awaits is declared, and which of them are live follows from its data.**
    These three are standing: each goes on for as long as the data says so. Nothing is started, followed or read
    by hand. A state declares each, and each says which fields of the data it
    depends on, in one of two ways. With `from`, there is one, and it reads the fields named: it is asked again when
    one of them changes. With `each`, there is one for each key of the field named, or each item where the field is
    a list: a key that appears starts one, and a key that goes stops it.

    ```ts
    starts:  (start)  => ({ thread: start(thread(inference), { each: 'titles', given: (threadId) => ({ threadId }) }) }),
    follows: (follow) => ({ detail: follow('threads', 'detail', { from: ['id'], args: ({ id }) => ({ id }), heard: (update) => … }) }),
    awaits:  (asking) => ({ diff:   asking('code', 'commit.GET_GIT_DIFF', { from: ['selectedGitFile'], args: ({ selectedGitFile }) => selectedGitFile, ended: (outcome) => … }) }),
    ```

    Once a step has handled everything sent in it, the kernel makes what is live match. **So changing data is how
    these start and stop**, and there is nothing to forget: opening a thread is adding its title, following another
    thread's detail is setting `id`, and reading the diff of another file is selecting it. A change that starts something has what every change has: it is one step with the answer it
    came with, it can be checked and refused where it is made, and after an `await` it is made against the data as it
    is then. What is live cannot disagree with the data, because it follows from it.

    **A field is named, not worked out.** What an entry depends on is looked at again only when a field it names
    changes, which the kernel already knows, so it costs nothing while anything else changes. A single one is given
    only the fields it named, so reading one it did not name does not compile. Nothing is run to find out, so nothing
    can throw. And the graph says what depends on what: a thread for each key of `titles`, the status from `revision`.
    A set that is part of another is a field of its own.

    Each of the three is written as a function of the helper its entries are made with. That is what gives a handler
    inside an entry the types of the state it is declared in.

    A handler reaches a state that was started with `child('draft')` or `child('thread', threadId)`, typed from the
    declaration, and only from where the state that starts it is the case.

    **Which states run depends on the data a step leaves, not on the way it got there.** The match is made once, when
    the step has handled everything, and not in between. A key taken out and put back within a step is a key that
    stayed, whether one handler did both or two did one each, and its state is untouched. A key put in and taken out
    starts nothing. What is sent within the step to a state that is not running waits for the match: if the step
    starts that state, it is delivered then, so a handler can add an item and tell it something in one breath; if it
    does not, it reached nothing, as it would have at any other time.

    **From outside a handler** a started state is reached the same way, `system.child(handle, 'thread', threadId)`,
    typed from what its starter declares. That is what a component uses. Such a handle is a name: its state runs
    only while its starter is the case and its key is there, so what is read through it is nothing until then.

    **A field is named, not worked out.** Which there are is looked at again only when that field changes, which the
    kernel already knows, so it costs nothing while anything else changes. There is no function to throw. And the
    graph can say a thread runs for each key of `titles`. A set that is part of another is a field of its own.

    **A started state is given its data once, as it starts.** The fields it marks `given` in its own data are what
    its starter has to give, from the key and the starter's data, and leaving one out does not compile. It is not
    given again when the starter's data changes: a fact is kept by one state, and whatever needs it there asks.

    **A started state tells only its starter**, with `report(event)`, as only whoever asked hears an ask's progress.
    It arrives as an event like any other, with `from` saying which one told it.

    **A view delivers to a handler**, `heard`, which returns what happens next as every handler does, so data still
    changes only by what a handler returns.

    **An ask that is awaited is a read.** With `from`, it is asked for what `args` makes of the fields it names, and
    asked again when one of them changes, the one before given up. Where `args` gives nothing, nothing is asked. A
    field that only counts has it asked again. With `each`, one is asked for each key of a field, and what it found
    stays. How one ended goes to `ended`, and what it says before that to `heard`, as a list at most once a frame.

    **A write is not standing, and is not declared as if it were.** The three above go on for as long as the data
    says so. A write is made once, because a handler said so, and nothing in the data stands for it. So it is
    declared apart, under `makes`, and made with a verb, as a state tells or broadcasts:

    ```ts
    makes: ({ one, each }) => ({
      stage: each('code', 'commit.STAGE_FILES', { args: (path) => ({ paths: [path] }), ended: (outcome, { key }) => … }),
      push:  one('code', 'commit.PUBLISH_BRANCH', { args: () => ({}), heard: (updates) => …, ended: (outcome) => … }),
    }),
    on: {
      'commit.STAGE_FILE':  ({ path }, { make }) => { make('stage', path) },
      'commit.STOP_PUSH':   (_, { drop }) => { drop('push') },
    },
    ```

    It is made when the step commits, with the data as the handler left it. One that is under way, or under way for
    that key, is the same one and is not made twice. `drop` gives one up: the one answering is told, and how it
    ended is not heard. Leaving the state that declares it gives up all of its.

    **Which writes are under way is the kernel's to keep**, and is read beside `at` and `data`, as `making`:
    `making.stage[path]` for one of many, `making.push` for one at a time. Nothing else writes it. So the kernel
    never changes a state's data, the record has one writer, and a state that is restored reads again and does not
    write again, since what was being made is not data. There is no id for an ask, no list of what is under way kept
    by hand, and no event for how one ended.

    Both are beside a state that asks from its `run`, not in place of it. A state is for something the surface is
    *in*, where what it takes changes, as `searching` is.

    **Nothing depends on itself in a circle.** This holds for a view and for an ask alike: what one delivers, or how
    one ended, may not change a field it is itself asked from. Between views, one view may lead another: a list delivers, an
    item is chosen, and a detail is asked for that item. What may not happen is that the detail's delivery changes
    what the list is asked for. It would be followed again, deliver again and lead back, each round a read of the
    database, and nothing bounds that across steps. Each followed view remembers which deliveries led to it being
    asked what it is, and where a delivery would change what one of those is asked for, or the view itself, the
    kernel refuses the following again and reports it. The handler's change to data is made; the view goes on being
    asked what it was. A circle that would have settled after a round is refused as well: that it happens to settle
    is not something to rest on.

### Communication

| Verb | From | To | Waits |
|---|---|---|---|
| `send(event)` | A state | Itself: an event only it sends, or one others may send it too | No |
| `tell(name, event)` | Anywhere | A backend system, by name | No |
| `tell({ surface }, event)` | A state in a window | Another surface in that window | No |
| `ask(name, ask, args, heard?)` | A state's `run`, or an ask's handler | A backend system, by name | One answer, refusal or failure |
| `progress(update)` | An ask's handler | Whoever asked, and only them, as a list at most once a frame | No |
| `broadcast(name, event)` | The backend | That surface in every window | No |
| `report(event)` | A state that was started | The state that started it, and only that one | No |

Names are typed by one declaration of what can be reached, which a pack's generated facade would supply. A state also declares the
states it starts, and reaches each through `child`: rule 10.

**Who may send a state what.** A state is declared with the events others may send it, and takes them under `on`.
The events it sends itself as its own work goes on, a result found or a piece arrived, are declared apart, in its
shape as `internal`, and taken under `internal`. Nothing outside a state reaches those: what is told, broadcast or
sent to it from outside is looked for under `on` alone, and one that only the state sends itself is ignored and
said to be. `send` takes both, so a state may send itself what others may send it. This is the app's own split of a
contract into `incoming` and `internal`.

**A write is told when losing it does not matter, and asked when it does.** There is no third way to make one. A
`tell` is heard by whatever is running to hear it, and what goes wrong in handling it is reported there and nowhere
else: that is right for word that something happened, which whoever missed it will find out another way. A write
that has to be made is asked, by something that owns the asking and awaits it, so that one made of nothing running
comes back `unavailable` and one that fails comes back saying so. "A write that matters, which nobody waits for" is
not a kind of write to provide for. It is a write whose failure goes nowhere.

On `97ee092630`, 2026-11-22, by text search outside specs, the app tells a system from code that is not a machine in
these places, and each is to be said to be one or the other as its feature is ported:

| Where | Tells | What it is |
|---|---|---|
| Flow actions that read a model's stream (`claude-code`, `codex`) | 9, each `TRIGGER_BRAIN_EVENT` to the brain | A flow's event. Losing one is a flow that does not run, so these are asks |
| Flow actions when a turn ends or is taken back | 3, each `CHECK_FOR_EXTERNAL_CHANGES` to the code system | Word that something may have changed. A tell |
| Step runtimes (`schedule`, `fire`) | 2 | To be read |
| Components (`.vue`) | 12, in 8 files | A component sends to its own state and to nothing else ([What a component reads](#what-a-component-reads)), so each goes through the surface |
| The code system's helpers (`terminal.ts`, `commit.ts`, `terminal-pool.ts`) | 6 | Part of their feature's port |

A surface is told by another surface in its window with `tell({ surface: 'detail' }, event)`, typed by the events
that surface is declared with. It is named as a surface because a feature's backend system and its surface are
called the same: a name alone is the backend system. From the backend a surface is not told but broadcast to, since
there is one of it in every window, and telling one from there is reported.

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

A component is handed **the state's own values, a field at a time**. `mirror` holds each field of a state's data as
the very object the state holds, never a copy and never made reactive, and writes a field when the state replaces
it. Whatever read that field runs again.

```ts
const threads = mirror(system, handle)
threads.value.at                              // read again when it moves
threads.value.data.messages                   // read again when the state replaces `messages`
```

That is safe to hand out because the kernel freezes what a state holds, all the way down (rule 4). An object a
component reads is found by `includes`, can be cloned, is the same one when it is sent back, and throws if it is
written to. What is not plain data, a class instance or a component, is handed over as it is.

**What a reader is promised is that it runs at least when what it read changed.** It also runs for any other change
inside a field it read: two components that read different keys of one record both render when one key changes. A
render that finds nothing different costs the render and not the page. Where that is too much there are two ways to
be exact, and neither wraps a value:

- **One of many is a state of its own** (`starts`, rule 10), with a mirror of its own. A change in one card renders
  that card, however many there are.
- **`computed(() => threads.data.messages[id])`** gives the same object for as long as that list is not replaced,
  since the kernel makes a new object only for what a change touched, and a computed does not pass on a value that
  came out the same.

What a state is making (`making`) is the kernel's own record and holds only whether each is under way, so it is kept
to the key: a spinner on one file renders again for that file.

One of many is read through the handle of a state the first one starts. It reads as nothing while it is not
running, and whatever read it runs again when it starts and when it stops. Which there are is the starter's field,
read like any other:

```ts
const thread = mirror(system, system.child(handle, 'thread', threadId))
thread.value?.data.messages                   // nothing until that thread runs
```

A component does not call `mirror`. It calls `useState`:

```vue
<script setup lang="ts">
const { state: threads, send, child } = useState('threads')                  // a state the window runs, by name
const { state: thread } = useState(() => child('thread', props.threadId))   // one of many, following the prop
</script>

<template>
  <h1>{{ threads.data.titles[id] }}</h1>                    <!-- renders again when a title changes -->
  <p v-if="within(threads, 'thread')">{{ threads.data.threadId }}</p>
  <p v-if="thread">{{ thread.data.messages.length }}</p>   <!-- nothing while that thread is not running -->
  <button @click="send({ type: 'OPEN_THREAD', threadId })">Open</button>
</template>
```

`useState` gives a ref and what to send with, as an object to take apart by name. That is how Vue's own guidance
has a composable return, and how VueUse, TanStack Query and XState's binding do: a ref that a component's setup holds
by name is read in its template without `.value`. In the script it is `threads.value`, and leaving that out does not
compile.

What it is built to get right is where bindings to a renderer usually go wrong:

- **A state is mirrored once, however many components read it**, from the first reader to the last, and a state
  nobody reads is not mirrored at all. The system is listened to once. So a step costs a lookup for each state it
  changed and a write for each field it replaced, and nothing for each component. Nothing is copied, when the first
  reader arrives or after.
- **No component sees one state ahead of another.** A step tells its subscribers once, when it has committed, and
  every mirror is written then, before Vue renders anything. A component reading two states renders once for a step
  that changed both, with both as that step left them.
- **A component whose state has gone does not render with nothing.** A list renders from its starter's field, and
  Vue renders a parent before its children, so a card that was removed is taken off the page by the list and its own
  component is not run again. One that can be shown alone has to say what it shows when its state is not running:
  the type of what it reads includes nothing.
- **A handle may follow a prop.** Given as a function, it is read again when what it reads changes, and the mirror
  is swapped before anything reads through it, the new one taken before the old one is let go.
- **Nothing is left behind.** A component that goes takes its reading with it, and the last reader of a state takes
  the mirror.
- **A component reads and sends, and does not ask.** An ask is work, and work has an owner (rule 9), which a
  component is not. What a component needs done it sends to a state, whose `run` does it.

This is the binding the app has on XState (`@apackdev/sdk`'s `useState`), with the same things promised, so a
component written against it today is not written again when the kernel under it changes.

Two things it costs, neither of which anything catches:

- **It is coarse unless asked.** What is easy to write in a template, `threads.data.titles[id]`, renders for a change
  to any title. Being exact takes knowing to reach for a computed.
- **A value kept is a value as it was.** `const items = threads.value.data.items` in a component's setup is that
  list as it stood, for good: a field is replaced, never written into. It is whole and never half-changed, and it
  does not follow.

### Following a view

Data a window shows from the database stays a view. A component reads one with `useView`, unchanged: it has nothing to
do with states. A surface that has to follow one from its machine declares it under `follows` (rule 10), which is what
`fromView` becomes:

```ts
detail: {
  data: { id: given, detail: given },

  follows: (follow) => ({
    detail: follow('threads', 'detail', {
      from: ['id'],
      args: ({ id }) => ({ id }),
      heard: (update) => (update.ok ? { data: { detail: update.value } } : { data: { problem: update.error } }),
    }),
  }),
}
```

A view belongs to the state that declares it and ends when that state does. One per open tab is one for each item of
the list of open tabs: opening or closing a tab is a change to that list, and nothing else.

On `375e00a563`, 2026-11-21, by text search: `useView` has 26 call sites and `fromView` nine, eight of them in the
threads surface, which spawns and stops each view's actor itself in about a dozen places.

### Systems and steps

States run in a system. The backend is one system and each window is another, joined by a link. Within a system, one
message from outside and everything it causes among the states is one **step**: nothing leaves the system (an answer,
progress, a broadcast, word to a subscriber) until the step commits. This is what lets separate states stand in for
parallel regions: an observer never sees them disagree. The same idea is SCXML's macrostep, a Redux dispatch, a signals
batch, and this repo's own `transact` followed by `watch`.

### Rows

**A step covers what a state holds. On the backend that is the small part.** What the backend holds for good is rows
in the database, and a handler writes them as it runs, through its repository, outside anything the kernel sees. So
every rule above about a change being whole holds for a state's data and for none of its rows: a handler that writes
two rows and throws on the third leaves two, an ask refused after a write has written, and a window can be told of a
change before the row it is about exists.

Where the app writes, read from each file's syntax tree on `97ee092630`, 2026-11-21, by `prototype/writes-survey.mts`
and, for the second table, `prototype/writes-shape.mts`. A call counts when it names a write the file imported from
EARS, or a method of a repository's `…Commands`:

| Where | Write calls | Files |
|---|---|---|
| A pack's repository, where its commands are defined | 136 | 8 |
| A backend system and its helpers | 155 | 20 |
| The SDK's repositories | 41 | 2 |
| A flow action | 31 | 15 |
| The SDK's content appliers and writers | 12 | 3 |
| Everything else: content writers, two step runtimes, the host's app state, the database console | 11 | 6 |

No surface writes. The host's stores (settings, secrets, the run history) write through an engine they are handed
and are not counted. Outside the repositories,
136 functions in the built-in pack write, in 192 calls:

| | Backend systems | Flow actions | Other |
|---|---|---|---|
| Functions that write | 111 | 19 | 6 |
| Of those, one write | 93 | 13 | 5 |
| Several writes | 18 | 6 | 1 |
| Several writes, all in one `transact` | 1 | 0 | 0 |
| Functions that write after an `await` | 12, in 14 writes | 7, in 13 writes | 0 |
| Functions that send a message and then write | 1 | 0 | 0 |

Three things follow.

- **Most of it is already the shape a step wants.** 165 of the 192 writes are made before the function has waited
  for anything, in the same run of code that decides the answer. One command is one unit already: a repository
  wraps its own in `transact`.
- **What is torn is the handler, not the command.** 25 functions make several writes and one of them makes them as
  a unit (`CREATE_THREAD`, whose comment says why). `FORK_THREAD` makes five, `UPDATE_NOTE` four, `USER_MSG` three.
  Each is right on the path that works and leaves part of itself on one that throws.
- **Only 27 writes sit next to something outside**, a file, a session, a model, since those are what a function
  waits for. That is the part no database transaction can cover, and it is a seventh of the writes.

**So a step is a transaction.** The kernel is given a store and opens one unit of it for each step: everything the
step writes is kept when the step commits, at once, or none of it is. The store takes its writer at the step's first
write and not before. elmdb has what this needs. A step runs to its end without waiting, which is what its unit
takes, and inside a unit it has savepoints (`savepoint`, `rollbackTo`, `release`), which the second rule below uses.

- **A handler writes as it does now**, with its repository's commands, and reads its own writes back. The 184
  calls to a command stay as they are.
- **A handler that changes nothing has written nothing.** A step is not refused whole and never was: one handler
  in it can throw while the others stand, and each already leaves its state's data as it was. Rows now go the same
  way. The kernel marks the store before each thing it handles and goes back to the mark when the handler threw,
  refused, or returned a change that could not be made, so that handler's rows are taken back and the rows of
  everything else in the step are kept. The 24 torn handlers are whole without being touched.
- **Nothing leaves before the rows are in.** An answer, a broadcast, progress and word to a subscriber are released
  after the transaction commits, which is the order they already keep with a state's data. A view runs again after
  the same commit, so a window is never told of a row it cannot yet read. This is a Durable Object's output gate
  and the transactional outbox, with the outbox in memory.
- **A write outside a step is refused**, by the engine a pack is handed, on the line that made it. After an
  `await` a handler is outside one, and the rule it already has covers this: it only returns. What it returns is a
  change, a change is made in a step, and a change's function may write as well as edit the draft:

  ```ts
  run: async ({ data }) => {
    const session = await readSession(data.path)            // outside: a file
    return {
      data: (draft) => {                                    // a step: rows and data together
        const { id } = repository.threadCommands.create({ topic: session.topic })
        draft.imported = id
      },
    }
  }
  ```

  The 27 writes after an `await` move into what is returned, and are the only ones that move. An answer is worked
  out before its change is made, so an answer that names a row its change creates takes the id first (`newId`) and
  creates the row with it.
- **What a handler wrote before it waited is kept.** An ask that writes a row, waits, and is then refused has
  kept the row: the write was in the step that took the ask, which committed. This is what progress it sent does
  too. A row that should not outlive a refusal is written in the change that comes with the answer.
- **Rows that cannot be kept stop the system.** If the commit fails (a full disk), nothing has left yet: whoever
  asked in that step is told it failed, nobody is told of a change, and the system takes no more steps, since its
  states are then ahead of its rows. The app restarts from the rows.

**What it does not cover, said so that nobody takes it for more:**

- **Anything outside the database.** A commit made in git, a file written, a model called, a terminal started: none
  can be undone by a transaction, and no design makes two stores change as one. The order is the one the outbox
  pattern gives: do the outside thing first, in work the state owns, and write the row that says it happened in the
  step its result arrives in. A crash between the two leaves the outside thing done and unrecorded, so what is
  recorded has to be something a later look can find again: the commit by its hash, the file by its path.
- **The run history**, which is a second database with its own engine. A run node is written beside a step and
  not in it.
- **A flow action.** An action is not a state: it is work the brain runs, and its 31 writes are each their own
  unit as now, with `transact` when several belong together. Whether an action's result should carry its writes back
  to the brain's step is settled when the brain is ported, against the actions.
- **Durable is later than committed.** A commit is on disk within a second (group commit). An answer released after
  a commit and before that can outlive its row through a power cut. A handler whose answer must not says
  `durable: true`, as `transact` takes today, and its step waits.
- **What a state holds is lost when the process ends; its rows are not.** After a restart a state is rebuilt from
  rows and what it was given, so anything a backend state must not lose is a row, and its data is working memory.
  Restoring a state ([Not built](#not-built)) is for a window, which has no rows.
- **One writer.** LMDB takes one write transaction at a time, across processes. A step holds it from its first
  write to its end, which is one run of code with no wait in it, and a step that writes nothing never takes it.

**What it is modelled on.** Convex splits a mutation, which is a transaction and may not reach outside, from an
action, which may and is not one: that is a step and a state's work. A Durable Object holds its replies until its
writes are stored. Akka Persistence and Orleans make the stored thing the truth and the actor's memory a cache of
it. Haskell's STM and Mnesia forbid waiting inside a transaction, which the rule about `await` is. What each of them
declines is the same thing declined here: one transaction over two stores.

**Left for after, and narrower than it first reads: one store for either kind of data.** A state's `data` could be
kept in memory or in the database behind one interface, so that a backend state's data were rows and a window
followed them by view. It is worth having for exactly that, a backend state with data several windows show, where
today the state broadcasts and each window keeps a copy. It is not a way to make everything a row: a window has no
database, a row is typed by a pack's manifest where data is typed by the state, and a write a second is what a
draft of text costs in memory and far more in a log. It comes second because it needs the step to be a transaction
first, and nothing above needs it.

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
| What a state sends itself is a table of its own, `internal` | One union of events and one `on` table, which is what there was. Anything that could reach a state could then tell it `FOUND` or `PIECES`, which only its own work should. And a list of which events are internal beside the one table, which says it twice and can disagree. Two tables need no list: what comes from outside is looked for in one of them, so the rule holds by where a handler is written. Effect's `Machine` has the split as public and private requests, and the app's contracts as `incoming` and `internal` |
| A surface is told as `{ surface }`, with the verb a system is told with | A verb of its own, as the app's `sendToSurface` is beside `tell`. A feature's system and its surface share a name, so the name alone cannot say which. Naming the kind of thing in the address keeps one verb for telling, and is how a role is to be named too: `tell({ role: 'brain' }, …)` |
| An ask changes data only together with its answer, as `answered(answer, next)` | An ask that could not change data at all, which was the first decision: to change data it sent its own state an event and returned the answer separately. The answer could then say "created" before the event that did the creating was handled, and still say it if that event's handler threw. The handler could not see the result of its own change. And each such ask needed an event that existed only for it, which anything could tell the state. Every system this was checked against joins the two: Erlang's `gen_statem` replies and moves in one handler, Effect's `Machine` handlers return `[reply, newState]`, and Temporal added Updates beside its read-only queries. They are safe because their handlers do not interleave; these do, at each `await`, which is why a change after one must be a draft edit. The graph stays complete: the extractor reads `next` as it reads any handler's return |
| Handlers that wait let others through, and the change checks what must hold | One handler at a time, as Effect's `Machine` and Erlang's `gen_server` run them. A handler then sees the same data throughout, and a reply that streams for half a minute keeps every other window out of that system until it ends. Each of those systems has a way round it (`fork` and reply later; a worker that replies), which is interleaving again with less around it; a caller that leaves cannot stop a handler already running; and a cycle of asks is a deadlock. Here every write was already one step. What could go wrong was a decision: check, wait, then act on a check no longer true. That is a long transaction, and the answer where work is long and conflicts are rare is to hold nothing and validate at the write. Locks, which Temporal suggests for this, bring the blocking back. A declared policy per ask, one at a time under a key, is left until a port needs it |
| Where work is put says who owns it, and so when it stops | One rule for every handler. Stopping an ask's work when its asker goes is right for a search and wrong for a message being answered, and never stopping it, as Effect's `Machine` does once a handler is running, wastes the search. A flag on the ask saying it survives its asker, or a shield around part of a handler as Trio and Kotlin have, would each be a second way to say what a state's `run` already says: this work is the answerer's. The threads example had it wrong: a window that closed mid-reply aborted the reply, and the message it had sent was never stored |
| What a state starts is declared and follows from its data | `start(name, state)` called from a handler, which the prototype had. A start was then something a handler did and not part of what it returned, so after an `await`, checking and starting could not be one step; nothing stopped a started state short of its starter ending; a handle was rebuilt from the definition at every use; and a state that was restored would have had nothing it started. And naming the starts in what a handler returns, beside `at` and `data`, which makes them one step and leaves them to be remembered: a start with no stop is a leak, and what runs is kept in two places. Working it out from data is what a view layer does with a keyed list, and what Effect's `forkOne` and `forkReplace` do by hand under a key: a key that stays is theirs "only if missing", and replacing is a key that changes |
| What says which there are is a field, by name | A function from the data to the keys, which was built first: `each((data) => Object.keys(data.titles), …)`. It could throw, so there had to be a rule for what ran when it did. It had to be run again after every change, since nothing said what it read. And the graph could not say where the keys came from. Tracking what the function reads, as a signals library does, would fix the second and not the others |
| One grammar for what a state starts, follows and awaits: `each` a field, or `from` fields | Three spellings of one idea, which is what there was: a helper for states, an object written out for views, and for a view followed alone a function of the data that was run again after every change and its result compared. That last was the function that naming a field had replaced for states, kept by oversight for views. Elm's `subscriptions` is this idea: what is listened to is a function of the model, and the runtime starts and stops to match |
| Each of the three is a function of the helper its entries are made with | The helpers as imports, `follow(…)` called in an object. TypeScript then has to work out the state's types backwards from where the call's result is put, and while it is doing that it cannot type a draft edit nested in a handler: `(d) => { d.tabs[key] = … }` came out untyped. Handing the helper in already typed leaves nothing to work out |
| A read that is not a state's work is awaited, declared from the data | Spawning it and keeping the ids of what is under way, as the app does now. The commit surface declares 54 asks and invokes none from a state: 14 are reads and 40 are writes, and by how its machine spawns them 28 can be under way many at once and 26 one at a time. TanStack Query, SWR and RTK Query treat a read as a query keyed by its arguments for this reason |
| A write is said, with `make`, and the kernel keeps which are under way | Declaring it from the data as a read is, with one for each key of a field, which was built first. The kernel then had to take the key out when the write ended, the one place it changed a state's data; the field had two writers, the handler that put a key in and the kernel that took it out; and a state restored with a key in the field would have made the write again. A write is not something that holds for as long as the data says: it is made once. Elm keeps the two apart as subscriptions and commands, and TanStack Query as queries and mutations |
| `make` is a verb a handler calls, not a part of what it returns | Returning it beside `at` and `data`. `tell`, `send` and `broadcast` are already one-off things a handler says, carried out when the step commits, and a write is one more. A verb that gives nothing back leaves no promise to drop, which is why an event's handler has `make` and not `ask` |
| What runs is matched once, when a step has handled everything | Matching after each thing handled, which was built first so that a state started part-way through a step would be there for what came next. It made what ran depend on the route: a key taken out and put back by one handler kept its state, and by two events in one step lost it. Holding what is sent to a state that is not running, until the match, keeps the one thing the first way was for |
| A started state is given its data once | Data that follows the starter's as it changes. That keeps one fact in two states and needs a rule for which of them may write it |
| A started state reports to its starter with one verb, into the starter's own events | A table of handlers per started state, which would have been a fourth beside `on`, `asks` and `follows` |
| What a view delivers goes to a handler | Writing it straight into a field. Data would then change by something other than what a handler returns, and the graph would not show it |
| Views may not depend on each other in a circle, refused where the circle closes | Finding it in the graph beforehand, which needs to know which fields a function reads. Refusing it when it happens stops it, where a finding only warns. Refusing only a view that changes what it is itself asked for, which was built first and left the same fault one view longer. And refusing whatever a delivery leads to being asked, which forbids a list leading a detail |
| Event handlers are synchronous | Async handlers. They bring back work nobody can see or cancel |
| What was gathered is handed over before anything else arrives | Progress waiting for its frame while other messages went straight through. A broadcast sent after a piece of text was then heard before it, a reordering that shows only under timing |
| An ask whose asker has gone throws `Left` where it is awaited | Never settling it, which was tried first. A promise that never settles skips every `finally` after it, so a lock or a handle taken before the ask is held for good, and `Promise.all` over it hangs. Rejection is what `AbortSignal`, `fetch` and structured concurrency do, and code written for them is already correct here |
| `Left` is an exception, raised again by every later ask from the state that was left | The other designs that exist. A third outcome that runs `finally` and skips `catch` (Bluebird 3, the withdrawn TC39 cancelable promises) is the cleanest and cannot be expressed through native `await`. A separate interruption channel (Effect, ZIO) means writing in an effect system. Dropping the computation (Rust) needs destructors. A value to check (Go's `context`) lets code run on after it should have stopped. Killing with no unwinding (Erlang) is what never settling was, and `use(release)` already gives its cleanup. What every exception design has had to repair is cancellation swallowed by a `catch` meant for failures (Python moved `CancelledError` out from under `Exception`; Kotlin's `runCatching`), and raising once only (asyncio, which Trio corrected). Raising again is in the kernel; the swallowing is a pack rule, under What to build around it |
| A `run` that awaits must declare `failed` | Leaving it optional, as XState's `onError` is: a forgotten one is the stuck state every XState codebase has met. And requiring it of every `run`, which would ask a line of the many that only start a child or follow a view and cannot fail later. And restarting the state as Erlang's supervisors do, which loses what a surface holds and needs a limit on restarts to not loop |
| An event handler is not given `ask` | `ask` everywhere. An event handler cannot await, so it could only start an ask and drop the promise, with nothing around it to take a `Left`. That floating promise is what took a process down when a check stopped a window mid-ask. Without `ask` the mistake does not compile, and the kernel still catches an ask started in `run` and never awaited |
| A component is handed the state's own values, a field at a time | A reactive copy of the state, written to only at the places a step changed, which was built first and rendered to the key. Moving the app's components onto `useState` showed what a copy costs: a machine that drops what it is told by `includes` never matched the copies sent back, `structuredClone` refused a proxy, a component definition held in data was copied, a watch did not run when a result was replaced by an equal one, and a mirrored object sent in an event put the mirror's storage into the machine. Every one is the copy not being the state's object. And tracking the path a reader took through proxies that hand over the state's own value at the end, which only saves a value that is not an object: a list passed to a child is a proxy again. MobX, Solid's stores, Pinia and Vue's `reactive` all track that way, and each ships a way to unwrap and a list of what to watch for. Valtio hands a component a frozen snapshot with what it read tracked, which is that done soundly and is more to build; the promise above leaves room to go there, since a reader that runs less often is still one that runs when what it read changed. This is what Vue's own guide shows for an outside store, Immer or XState held in a `shallowRef`, and what the app ships |
| What a state holds is frozen | Leaving it as it is and trusting that nothing writes to it. With a copy, a component that wrote to what it read damaged the copy. With the state's own objects it damages the state: no handler ran, nobody is told, and every earlier value that shares the object changes with it. Two of the prototype's own checks were sorting a state's list in place. Immer freezes what it makes for the same reason, and Vue leaves a frozen object unwrapped |
| The types say a field read-only at every depth, and a list where a field holds it | Read-only at every depth for lists too, which is what Vue's `readonly()` and Effect type. TypeScript holds a caller to a read-only list and not to a read-only object, so a list typed read-only inside an entity refuses the entity at every helper that takes it as its type declares it: measured on the app, 125 errors in the built-in pack against 54, with no write among either (Not built). And read-only one level in only, a field and a list a field holds, which leaves `data.titles[id] = title` compiling: the commonest write there is to a record kept by id, and refusing it costs nothing, since a read-only object passes wherever a writable one is asked for. Measured, the pack and the renderer report the same errors with it as without. Solid removed the deep type from its stores, Redux Toolkit declined it, and Immer's is left off by most who use it. And no types at all, as Redux Toolkit, NgRx and Apollo have it, which gives up the one check that does carry: a list sorted or pushed to in place, the commonest write there is. Freezing is the guarantee under either |
| A field replaced by an equal value is a change | Keeping the old object where the new one is equal to it, as TanStack Query does to render less. The app shows a toast when a result is replaced, whatever it holds, so replaced has to mean changed |
| A hidden window's frame is the next turn | `requestAnimationFrame` always. A hidden window gets none, so what was gathered for it grew without bound until it was shown |
| Progress is heard as a list, once a frame | One call per update. It made a change, a notice and a copy of the growing list per item: fine at 10,000, unusable at 100,000. A persistent vector would make appends cheap, but its values are not plain arrays, which the snapshot, the wire and the templates all assume. Chunked lists stay plain but push the chunking onto every reader |
| A nested change is an edit to a draft, built here | Spreads at every level (`{ ...data.titles, [id]: title }`), which get worse with depth. Immer and Mutative were considered; a state's data is plain by rule, so most of what they handle cannot occur, the kernel wants the changed fields in its own shape, and the kernel is meant to have no dependencies. To revisit, in favour of Mutative, if the draft grows special cases |
| A change that cannot be made is refused whole, by one rule, where it is tried | Three rules, which is what there was. A stray field in an edit was found after the edit had run, and reported without the line that wrote it. The same stray field given as a field was dropped without a word and the rest taken. And a move to a state that does not exist, or without what the state needs, was made anyway and reported after. Each was a half-made change, and two of the three said nothing |
| A state is mirrored once for all its readers, and the system is listened to once | A mirror for each component, which is what `mirror` was: each made its own copy of the state and listened to every step to see whether it was its own. A hundred components reading one state copied it a hundred times, and every step asked all of them. And nothing ended a subscription, so each one stayed for good |
| `useState` gives a ref, taken apart by name | A reactive object read with no `.value` anywhere, as Pinia's stores are. A started state may not be running, and nothing is not an object; a handle that follows a prop changes which object it is. Vue's way of saying either is a ref, so refs are one shape for every case where objects would be two. And taking a store apart loses its reactivity without a word, which is what Pinia's `storeToRefs` is for; a ref read without `.value` in a script is a type error |
| A component reads and sends, and cannot ask | Giving `useState` an `ask`. An ask made from a component has no owner to stop it or to say where the state goes if it fails, which is what `run` and `failed` are for |
| No tags; `within(value, 'thread')` reads the path | Tags, as XState has them. "Somewhere inside `thread`" is a fact about the structure, so a tag for it is a second copy that can go stale, and it narrows no data. Tags are for grouping states that share no parent, and the app has no such group: on `375e00a563`, 2026-11-21, by text search, all 16 tags it declares name one state each. To revisit if a port finds a real cross-cutting group |
| A refusal may carry data, declared per kind | A kind and a message only. spankyed/apack#583 declares data per kind, and its settings refusal, which carries the store's `problems`, is the case a message alone cannot serve |
| A step is one unit of the store: rows, data and what is sent are kept together, and a handler that changes nothing has written nothing. A handler writes with its repository as now; after an `await` it returns the writes. | Writes made as the handler runs, outside the step: a refused ask had written, and 24 of 25 handlers with several writes could leave part of them. A handler returning every write as a description, dropped: a command's result (a new id) is read by the next line in most of them, and 165 of 192 writes already sit where a step is open. |

## What the prototype proves

Everything below is in [`apack-spec/prototype/`](apack-spec/prototype/) and runs from the repo root; its README has the
commands. Types and kernel together are about 600 lines, and the draft 139.

- **Two real features are ported.** The code search, backend and surface (`search.mts`), runs: results stream, a second
  search aborts the first on the backend, and cancel works. About 167 and 192 non-blank lines become about 39 and 77.
  The library system (`library.mts`) is ported handler for handler and typechecks against stand-ins for its imports; it
  is not run. Its machine goes from 271 lines to 120, and four answer helpers and every result event go away.
- **A backend with three systems and two windows runs, and work stops with its owner** (`threads.mts`, 16
  comparisons). Each thread is a state of its own that the threads system starts, at `idle` or `writing`. Checking a
  message, which asks the library for an attachment, is the ask's work: a window whose connection closes while the
  library is looking is told `disconnected`, the check stops, and nothing is written. Writing the reply is the
  thread's work: the ask is answered when the thread accepts the message, the reply is broadcast as it is written to
  every window showing that thread, and a window that sends and goes back to its list still has its message answered
  and stored. No reply is cut short by a window going. A second message while one is being answered is refused as
  busy by the thread itself, whose `writing` state answers the same ask its `idle` state accepts; accepting and
  starting to write are one step. The threads system takes no events: the two it had existed so that two asks could
  change data, and went when those asks returned `answered`.
- **Only a state sends itself what is its own** (`internal-check.mts`, 7 checks). What a state sends itself is taken
  by its internal handler; the same event from outside is not taken, and that is said; what others may send a state
  it may send itself too; one surface tells another in its own window with no backend there to go through; a surface
  and a backend system called the same are told apart by how each is named; and the backend telling a surface is
  reported and sends nothing. Six mistakes do not compile: sending a state from outside what only it sends itself,
  taking an internal event under `on` or an incoming one under `internal`, telling a surface an event it does not
  take, telling a surface there is not, and a state sending itself an event it does not declare. `search.mts` runs
  on it: what its search found is the search's own to say.
- **What runs follows the data** (`starts-check.mts`, 15 checks): a state started alone runs while its starter is
  the case, stops when it is left and starts anew when it is entered again; it is given its data once, as it starts;
  a key the field gains starts its state in that step, given what the data holds for it; one started part-way
  through a step is there for what comes next in that step; a key the field loses stops its state, lets go of what it
  held and abandons what it was answering; a key that stays leaves its state as it is whatever else changes; a key taken out and put back within a step is a key that
  stayed, by one handler or by two events; a key put in and taken out within a step starts nothing, and what was
  sent to it reaches nothing; which
  there are is looked at again only when that field changes; a started state reports to its starter, which hears
  which one it was; a state that is not running answers `unavailable`; a key holding a slash is reported and starts
  nothing; and stopping stops everything, the last started first. Under both orderings of two asks that add the same
  item after a wait, one is added, one is refused, and one state starts. Eight mistakes do not compile: reaching one
  of many without its key, one that is not declared, or one from outside the state that starts it; reporting what
  is not declared; leaving the starts out; naming a field that is neither keyed nor a list; giving a started state
  less than it marks `given`; and naming bare a state that has to be given something. `threads.mts` runs on it: a
  thread for each title, told which it is, and the composer's draft for as long as a thread is open.
- **Reads and writes, with no ids** (`awaits-check.mts`, 12 checks; `makes-check.mts`, 15 checks; `commit.mts`, 12
  comparisons). `commit.mts` is a slice of the app's commit surface: its status and the diff of the selected file as
  reads, and staging, unstaging and a push as writes. Two files staged at once are both under way and both gone when
  they end; the status is read again when the repository changes; selecting another file gives up the read of the
  first, and the backend is told; a refusal names its file; a push says how far it is, a second one while it is made
  is the same push, and a stopped one reports no failure.

  A read: asked when a field it names changes and not when another does; a field that only counts; nothing asked
  where there is nothing to ask for; only the last of two taken, the first given up; progress heard as a list; one
  for each item of a list, asked once, with what it found staying; an item taken out giving its read up; leaving the
  state giving up what it waited on, and entering it again asking afresh; how one ended not changing a field it is
  asked from. Under every ordering (553), the diff shown is of the file selected last.

  A write: one made for each key it is told to, and under way until it ends; making one changes no data; one under
  way not made twice, and made again once it has ended; giving one up telling the one answering; how one ended having
  it made again; progress heard as a list; made when the step commits, with the data as the handler left it; one at
  a time under way or not; leaving the state giving up what it was making and telling whoever reads that, and
  entering it again making nothing, where a read would be asked afresh; and a handler that throws having still said
  what it said. Under a seed's worth (3,000 each, of more than can all be run), two files staged at once are both
  staged with the status shown the last one read, and a push stopped at any moment leaves none under way and no
  failure.

  Thirteen mistakes do not compile across the two. The graph lists each read with what it depends on, each write,
  and which handler says to make which.
- **A step is one unit of the store** (`store.mts`, `rows-check.mts`, 16 checks, against rows in memory). A row and
  the data that counts it are kept together, and a subscriber told of the step can read the row. A step that writes
  nothing never takes the writer. A handler that throws after two writes leaves neither, and in the same step the
  handler beside it keeps its own, in one commit. An ask refused after it wrote has written nothing. A change that
  refuses, and a change the kernel will not make, take back their own rows and the handler's. Work that throws at
  once has written nothing. A write after an `await` throws on its line, saying what to do, and the same write
  returned in the change is kept with the data. Work left before it returned writes nothing. What an ask wrote
  before it waited is kept when it is refused after. Rows that cannot be kept: the asker is told it failed, no
  subscriber hears, and no more steps are taken. And under all 420 orderings of two imports, a create, a note and a
  handler that throws, the count a state holds is the number of rows kept. Eleven changes to a copy of the kernel,
  each taking out one part of this, each fail a check.
- **A check that fails says so, and does not hang** (`checks.mts`). All fifteen check files run their checks
  through one runner. Every system a check makes is stopped when the check ends, however it ends, so one that fails
  part-way leaves nothing running to keep the process alive. A system in a check is given a limit on how many steps
  it will take, and says so when it reaches it; the app gives none, since an agent's loop is one thing leading to the
  next for as long as it runs.

  A check waits with `rest()`, until everything it started has come to rest, where it used to wait a number of turns
  someone had guessed was enough. The kernel says whether anything is under way in it (`idle`): work a state is
  doing, an ask being answered or waited on, something put off, something gathered. Thirty-six waits are now
  that. The counted turns that remain are of two kinds and neither is a guess at how long something takes: a check
  letting something begin before it acts, as in "search again before the first finishes", and the work a stand-in
  backend pretends to do. A kernel changed so that a read asks itself round without end used to keep the checks
  from ever finishing. It now fails one of them in a second, with "Still not at rest after 5000 turns".
- **Which views are followed follows the data** (`follows-check.mts`, 16 checks; `views.mts`, 13 comparisons): a view
  is followed from the moment its state is the case; what it delivers goes to its handler; a change to what it asks
  for follows it again and stops the one before, whose later deliveries are not heard; a change to anything else
  leaves it as it is; one is followed for each item of a list and stops when its item goes, each hearing with its own
  key; the list is looked at again only when it changes; a handler that throws changes nothing and is reported; a
  view declared by a state inside is followed only while that state is the case; a view whose delivery changes what
  it asks for is refused and reported; one view may lead another, two that lead each other are refused where the
  circle closes, and a change from anywhere else follows a view again as before; and stopping stops all of it. Six mistakes do not compile. `views.mts`, the
  threads surface's three kinds of view, has no call that follows or stops following one.
- **An answer and its change cannot disagree** (`answer-check.mts`, 13 checks): an ask that only answers changes
  nothing; one that answers with a change has made it by the time the answer is had, and subscribers hear of it in
  that step, once; an answer can come with a move that gives the entered state its data; a change that is refused
  fails the ask and changes nothing; two asks that each add one after a wait both count; and an ask whose answering
  state was left is abandoned with nothing changed. Under every ordering of three such asks and a close (24), the
  count is exactly the number of answers that said they added. Giving fields after an `await`, a move that leaves out
  what the entered state needs, and an answer of the wrong type do not compile.

  **A change may refuse** (3 more checks in the same file). A put that waits and a remove of the same id, under both
  orderings there are: a put that is answered was stored, and one that was not is told the id had gone, with the id.
  Both outcomes were run. The same put checking only before its work passes under the first ordering and is answered
  for nothing stored under the second, which exploring finds. `threads.mts` had that fault: it checked the thread
  existed, wrote the reply for a while, then stored with `messages[threadId]?.push`, so a thread removed meanwhile
  lost the message and the asker was told it was sent. It refused `no-such-thread` where it stored, until
  the reply became the thread's own work: a thread now stores what it wrote in its own data.
- **The graph can be derived without running anything** (`graph.mts`): states, moves, what each state answers, and
  which other states it reaches, read from handler return types by the TypeScript checker. An earlier version of it
  caught a handler dropped during a port.
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
- **Failing goes somewhere, and breaks nothing** (`failure-check.mts`, 13 checks): work that fails later, or at once,
  goes where `failed` says with what it threw; a state left while asking has not failed and nothing is reported; work
  that fails after its state was left changes nothing and is reported; a handler that throws changes nothing and the
  next event is handled; a `failed` that throws is reported; a release that throws does not stop the others; an ask
  whose handler throws is answered `failed` and reported where it threw, which may be another process from the asker;
  a state that tells itself without end is cut short after ten thousand things, reported, and takes events
  afterwards; and an async `run` without `failed` does not compile. Before this a `run` or a handler that threw at once escaped the step
  and left the kernel refusing everything after it.
- **Leaving mid-ask unwinds, and nothing hangs or crashes** (`leaving-check.mts`, 8 checks): a `run` awaiting an ask
  when its state is left has its `finally` run and its lock released, and nothing after the ask runs; the trace says an
  ask was left and reports no failure; an ask inside `Promise.all` ends too; the answerer's `signal` aborts, and a
  handler that was itself asking unwinds; a handler that throws because its `signal` aborted is reported as having
  stopped, not failed; an ask started and never awaited leaves no unhandled rejection; an answer
  that arrives in time is unaffected; and an event handler asking for `ask` does not compile.
- **Progress keeps its place** (`progress-check.mts`, 6 checks, a backend and a window with the window's frame held
  by the check): two hundred pieces arrive as one list; a broadcast sent between two pieces is heard between them;
  something the user does while progress waits is handled after it; another ask's answer is not ahead of progress
  sent before it; a frame hands over what waits when nothing else arrives first; and stopping a window mid-ask leaves
  nothing unhandled.
- **Components render only for what they read** (`vue.mts`, `vue-check.mts`, 24 checks). These are Vue components
  mounted with Vue's own runtime, into a tree of plain objects in place of a page, and what is counted is how often
  each rendered. Every check runs twice: with the components written as render functions, and with the same
  components written as templates and compiled by Vue's compiler, reading the state with no `.value`. One more, for
  templates: what a template sends on a click reaches the state. A change renders only the components that read that field; a change in one of many renders that
  one and neither the others nor the list, since each of many is a state of its own; one added renders the list and the new one; one removed is gone without
  its component rendering with nothing to show; fifty changes before Vue renders are one render; a component reading
  two states never sees one ahead of the other, and renders once for a step that changed both; a handle that follows
  a prop reads the other state when the prop changes, and the one it left is no longer mirrored; one that is not
  running renders as nothing and renders again when it starts. With three hundred cards a change in one still
  renders one, and there is one mirror for each state however many components read it, and none once nothing does.
  Five mistakes do not compile: a state the window does not run, an event it does not take, one of many without its
  key, reading one that may not be running without saying what if it is not, and asking.
- **A template is held to the same types** (`vue-fixture/Board.vue`, checked by `vue-tsc`). A component file written
  as the app writes one. Inside `v-if="within(board, 'open')"`, or `v-if="board.at === 'open'"`, the data of that
  state can be read; inside `v-if="card"`, or with `?.`, what a card holds can be; a `v-for` over a field and a
  `send` from a click are typed. Six lines are marked as having to be errors and are: reading the data of a state
  the board may not be at, reading a card that may not be running, a field there is not, an event the board does not
  take, an event without what it declares, and a state there is not to be inside. With the marks taken out the
  compiler names each, on its line, in a sentence: `Type '"SHUFFLE"' is not assignable to type '"ADD" | "RETITLE" |
  "OPEN" | "CLOSE"'`.
- **A reader is handed the state's own values** (`mirror.mts`, `binding-check.mts`, 18 checks, with
  `@vue/reactivity`'s `effect` standing for a component's render). A change inside a field runs every reader of that
  field and no reader of another; a reader of one part through a computed runs only when that part was replaced; a
  move runs the reader of where the state is, and the mirror gains and loses the fields the states do. What a reader
  is handed is the state's own object, and what a change did not touch is the same object after it; an object read
  from a state is the one the state finds when it is sent back; what is read can be cloned; a value that is not plain
  data is handed over as it is and is not frozen; a field replaced by an equal value runs its reader; and nothing a
  reader is handed can be written. One of many, reached from outside by name and key: a change in one runs only that
  one's reader; one that is not running reads as nothing, and its reader runs when it starts and when it stops. A
  reader of whether one write is under way runs for that one and not for another (`makes-check.mts`). The same file
  checks a window's frame: the next paint while it shows, the next turn while it is hidden, and what was waiting
  handed over once when it hides. Six changes to a copy of the kernel and the mirror each fail a check: nothing
  frozen, everything frozen, a copy handed out, an equal value not written, a field the state no longer has kept, and
  what is under way written whole.
- **Progress gathered into batches** (`append-cost.mts`): the measurement above, and the search and threads examples,
  which now make one change per batch.
- **A draft** (`draft.mts`, 139 lines; `draft-check.mts`, 19 checks) for what a hand-built one gets wrong: the old
  value untouched, what was not edited kept as the same object, an edit that changes nothing returning the very same
  value, the same place read twice being the same draft, arrays through `push`, `splice`, `sort` and `length`, keys
  added and deleted, one part of the draft assigned to another, what is not plain handed over as it is, and a draft
  kept past its handler refusing to be used, and the three refused mistakes. `kernel-check.mts` holds eighteen on
  what the kernel does with a change: subscribers told which fields of a state changed in a step and told nothing when
  a handler changed nothing, a move that edits a draft, and each refused edit reported with the data left as it was.
  A change that cannot be made is refused whole: an edit that adds or removes a field, reported with the line that
  tried; a good write before a bad one, not made; fields with a stray one among them, none taken; and a move with a
  stray field, to a state that is not there, or without what the state needs, refused before anything is left or
  entered. The three examples and the interleaving, progress and leaving checks run without one being reported.
  What a state holds is frozen all the way down, and what is not plain data is not; a handler that writes to what the
  state holds changes nothing and is reported; and an object a state is handed can no longer be written to by
  whoever kept it. A field assigned to, what a field holds assigned to, a list changed in place, and either done
  to what is read from a state do not compile; a write through a helper that takes what it is given as writable
  does compile, and still changes nothing and is reported.
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
| `ASK_ANSWERED` and `ASK_FAILED` as events, with `isAnswered`, `answerOf` and `AnswersOf` | A second way to receive an answer. Every transition then needs a guard naming its ask. An asker awaits `ask` in a state's `run`, or in the handler of an ask it is answering |
| Answers wired through the machine (`answers.actions`, `answers.on`) | `asks` is a table of the state. A system with no states inside is that table and nothing else |
| `waiting`, read by a handler to learn whether anyone asked | A handler does not branch on transport. What every window should hear is a `broadcast`, whoever asked. A write nobody waits for is told or asked, by whether losing it matters ([Communication](#communication)) |
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
- **A component reads state with `useState`, in the shape it is to keep** ([What a component reads](#what-a-component-reads)):
  `const { state, send } = useState(…)`, with `state` holding `{ at, data }`. On XState it is computed from the
  actor's snapshot. It does not depend on which kernel runs underneath, so a component moves to it once, and the
  move to this design does not touch the component again. A component never calls `useSelector` on an actor, and
  never names the actor.
- **A component reads and sends, and does not ask.** What it needs done it sends to a state, whose work asks. An ask
  made from a component has no owner to stop it or to say where the state goes if it fails.
- **A loading flag is a state that invokes the ask**, and an independent concern is an actor of its own, never a
  parallel state. Whether something is under way is where a state is. It is not an id in a list the machine keeps,
  and a component does not import the id of an ask to find out.

One seam that was here is taken out: **a machine defined through the SDK**, re-exporting XState's `setup` and
`assign` at first, with a pack rule against importing `xstate`. It would put XState's way of writing a machine, a
config of fixed targets and named actions, under this design's name, and every machine written through it would be
written in the shape the move is away from. A machine stays XState's, named as XState's, until its feature is ported
whole.
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
| An asker awaits: no `ASK_ANSWERED` or `ASK_FAILED` handled by a surface | Done, in three forms. A state invokes `fromAsk`, which is this design's `run` and is the one to keep. An ask is spawned under an id and handled where it ends, and a component awaits `ask`/`useAsk`: neither carries over (below) |
| A feed beside the answer | Gone: the search and the git transfers say `progress` |
| Leaving the asker's state aborts the handler | Done: the asker's abort reaches the handler's `signal`, and a stopped ask is not answered |
| `waiting` | Gone from a handler's arguments |
| A loading flag is a state that invokes the ask | Done where an ask was touched |
| `tell` and `broadcast` | Done after it, in spankyed/apack#600 |
| Handlers as tables beside the machine | Not done, on purpose: an ask is taken by the state that lists it (`answers.on`), which is this design's `asks` per state. A child machine answers its own asks |
| A component reads state with `useState` | Done after it, in spankyed/apack#596 |
| A component does not ask | Done after it, in spankyed/apack#599: `useAsk` is gone |
| A machine is defined through the SDK; no `xstate` import in a pack | Taken out of the seams (above) |
| A spec drives a feature at its boundary | Partly: specs of asks ask, and many still read an actor's context |

spankyed/apack#593, stacked on #591, finished what #591 listed as open: no surface machine is `type: 'parallel'`, and
an ask that can be under way beside others is spawned under an id, with the ids under way kept in the machine's
context.

**What of this is not to be built on.** A flat XState machine has nowhere to say that a push is under way while a
file is being staged, so #593 gave it a list: `asking` in the context, written by `enqueueAsks` in place of XState's
`enqueueActions`, an id for each ask from `askId`, how one ended arriving as `xstate.done.actor.<id>` and matched by
its prefix, and `endedAsk` to find which. It works, and it is the part of the asks work this design replaces. On
`1226110b42`, 2026-11-21, by text search outside specs: 154 calls of `askId`, 161 of `enqueueAsks`, 180 transitions
on `xstate.done.actor`, 407 of `useSelector`, and 8 of `useAsk`. The commit surface's machine is 1,778 lines with 183
uses of the three; its panel has 63 `useSelector` lines and imports the ids of asks to show a spinner.

Here an ask that is not a state's own work is declared ([rule 10](#rules)): a read under `awaits`, with the fields
it depends on, and a write under `makes`, made with `make`. Which writes are under way is the kernel's to keep, and
a component reads it. There is no id, no list kept by hand, and no event for how an ask ended, and `commit.mts` is a
slice of that surface written this way. So this record is not extended to new code, and nothing new is built on `asking`, `askId` or `endedAsk`. It
goes when its surface is ported.

**The cleanup of `master`, on XState, is four PRs.** The aim was that code written now reads as it will after the
move, and that what #593 added is replaced and not only left alone.

1. **spankyed/apack#596: every component reads its machine with `useState`**, in the shape it is to keep:
   `const { state, send } = useState(…)`, with `state` holding `{ at, data }`. About 350 `useSelector` calls in 75
   files moved, and the `machine-selectors` pack rule refuses `@xstate/vue` in a pack. One `useSelector` is left, in
   the renderer: a surface's `fallbackPanel.isShown` is handed a whole snapshot, as that contract takes it.
2. **spankyed/apack#597: `makes`, proven on the commit surface.** Its 54 asks are declared once and made by name;
   which are under way is `making`, read through `useState`, and the panel imports no id. The spike held: one
   transition on `xstate.done.actor.made.*` takes how every made ask ended, clears it from `making`, and raises
   `made.<name>`, which a guard and a target are written for like any event. The machine went from 1,778 lines to
   about 1,620, and lost three fields that tracked asks by id.
3. **spankyed/apack#599: `makes` through the other twelve machines**, and the four settings forms, whose import and
   export are asks their surface makes. `useAsk` and `asks-under-way.ts` left the SDK, and two pack rules hold it:
   `ask-ends` refuses a transition on `xstate.done.actor`, and `swallowed-ask-ends` a `'*'` transition written
   without the one that settles asks beside it. A contract names the asks it publishes with their kinds
   (`MakingOf<{ export: 'one'; nodeDetails: 'each' }>`), which is this design's `makes` in the shape.
4. **spankyed/apack#600: `sendToSystem` is `tell` and `broadcastToSurface` is `broadcast`.**

What that taught, which changes this plan:

- **A mirror hands out the state's own values, or it breaks identity.** The first `useState` copied the context
  into a deep reactive mirror written in place, as `mirror.mts` does, to render per nested key. Moving real
  components onto it showed what a copy costs. A machine that drops told failures with `includes` never matched the
  copies sent back. `structuredClone` refused a proxy. The shell's `Surface` holds component definitions, which were
  copied. A toast watching a result did not run when the result was replaced by an equal one. A mirrored object sent
  in an event put the mirror's own storage into the machine's context. What shipped holds each field as the
  machine's own value, neither copied nor made reactive, and writes a field when the machine replaced it, which is
  what a `useSelector` over the field did. The cost is that two components reading different keys inside one field
  both render when it is replaced. **[What a component reads](#what-a-component-reads) is now written for that**, and the
  prototype's mirror is built that way.
- **A read made on an event is a `makes`.** The helper does not tell a read from a write, so the reads moved with
  the writes and `asks-under-way.ts` could go without `awaits`. What was not built on XState is a read that asks
  again when a field changes.
- **A read asked again replaces the one before, by construction.** Where a machine kept a map from an ask's id to
  what it was about, the ask is keyed by that and the map is gone. Several reads whose answers used to race are now
  one at a time.
- **XState's wildcard is the one thing that can break it silently.** A state's `'*'` is tried before its parent's
  transitions, so it takes an ask's end and the ask stays under way for good. A rule holds it. This design has no
  such fall-through to guard.

`makes` and `useState` are helpers a machine and a component use. They are not a way of defining a machine, which
stays XState's ([the seam that was taken out](#what-the-two-should-share)).

Not done: taking apart the commit and pull-request machines by concern. That carries over one for one, a state for
each concern, and done on XState first it is done twice. They are split as they are ported.

Then step 2 of the order of work.

## What to build around it

The design is the smaller half of the value. In the order they would pay:

1. **The Vue binding, in a window.** `useState` is the app's own, with the same things promised over either kernel
   ([What a component reads](#what-a-component-reads)), and it is checked by rendering, by a compiled template and
   by `vue-tsc`. What a check cannot say is what the step log would give Vue's devtools, as Pinia gives them its
   stores, and what the read-only types cost the app's components (Not built).
2. **Tests that replay interleavings.** The risk in this design is ordering: a result that arrives after its state was
   left. The prototype has this: `schedule.mts`, under What the prototype proves. What is left is its place in the
   harness, so that a pack's spec runs a scenario under every ordering the way it runs a case today, and a reduction
   that skips orderings differing only in two things that cannot affect each other, which is what would let two
   windows be run in full. This is the strongest reason to own the kernel.

   Two things to take from fast-check's scheduler, which is the nearest tool in JavaScript. **Scenarios that are
   generated.** It runs model-based tests through its scheduler: a random sequence of commands, under a random
   interleaving. A state here declares every event it takes, so what a user does can be generated from the
   declaration, where the prototype's five scenarios are written by hand. **Time as something the schedule picks.**
   When a timer is pending, "go to the next timer" is one more thing that can run next. That is how a delay enters a
   schedule, when delays exist. What the prototype already does that fast-check does not: it runs every ordering
   where fast-check samples, and it waits a turn of the event loop to know that everything has settled where
   fast-check waits fifty microtask ticks and takes the quiet for it.
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
   and a timeline in the Logs surface that shows what one click caused across every state it reached. What crosses a
   link carries the step that sent it, so that a step on the backend names the step in the window that caused it, as
   Effect's `Machine` parents the span that handles a request to the span that sent it. The log holds which event and
   which fields changed, never what an event or an ask carried: Effect copies a request's fields into its span, and a
   payload is where a key or a document's text would be.
5. **A pack rule against a promise nobody awaits.** The kernel keeps a dropped ask from taking the process down, but
   the code that dropped it also never sees its answer or its refusal. `no-floating-promises` over pack sources, as a
   pack rule beside the others, refuses it for every pack.
6. **A pack rule against a swallowed `Left`.** A `catch` in `run` or in an ask's handler that can take a `Left` has to
   rethrow it. One that does not lets the code carry on after its state was left. The kernel already drops what that
   code returns and raises `Left` again at its next ask, so what the rule protects is a side effect outside the state,
   a file written or a process started, made by code that should have stopped. Refusals come back as values, so
   ordinary code has no reason to catch around an ask and the rule should fire rarely.
7. **The rough edges the examples showed.** The two under Not built about fields: a default that still has to be
   given, and names unique along a path.
8. **Affordances, once the graph is a recorded file.** Every state declares what it takes, so the app can answer what
   can be done right now on any surface, with each event's name and the type of its fields. An agent driving the app
   asks that instead of reading the screen, and the answer is right by construction. For this product it is the
   capability most worth having, and no state library offers it. It is last because it reads the same data the recorded
   graph holds, so it is small after item 3 and a second extractor before it.

Deliberately not built: parallel states, history states, a visual editor, and a general-purpose library for other
projects. Each would loosen the fit to this app.

## Not built

- **What the second step of the cutover waits on.** The host's bus and shell are ported before any feature
  ([Order of work](#order-of-work)). Four things they need were not designed. Two are now, and two are left for
  that step, by one test: **does it change what a state's definition looks like?** One that does is cheap to settle
  before anything is ported and has to be redone in every machine after. One that does not is something added
  beside the definitions, and is better settled against the real bus and shell than guessed at here.
  - *Settled, since each changes a definition:* events only the state itself may send, and one surface telling
    another in its window ([Communication](#communication)).
  - **Roles**: `tell({ role: 'brain' }, …)`, a name the host resolves to whichever system plays it. The app writes
    it this way already, and the address is the shape `{ surface }` has. Which system plays a role is the host's to
    say, from a pack's manifest. Three rules are settled, and what is left is the host's side of them:
    - a role is resolved when what was sent is delivered, and not when it is sent, so the pack that plays it can be
      replaced between the two;
    - a `tell` to a role nobody plays is ignored, and that is said;
    - an `ask` of a role nobody plays is answered `unavailable`.
  - **Restoring a state after a reconnect or a code reload.** A state is plain data, `{ at, data }`, so it can be
    handed back to a fresh copy of itself, which is what `useSurfaceDraft` does by hand today for what a component
    holds. Restoring is entering: the state is entered at `at` with `data` given, so its `run` starts again, and a
    state restored at `searching` searches. Effect's `Machine` restores the same way, by starting afresh with the
    previous state handed in, and saves nothing that was in flight. What a state started is started again, since
    it follows from the data, but with nothing of its own: a restored threads system has every thread running and
    none of their messages. What is saved to restore from has to hold what each started state held as well. What
    it must carry is what the shell does on a reconnect today, which is why it waits for the shell. Three rules are
    settled:
    - **what is restored is looked at before anything is entered**, as a move is (rule 4): a state there is not, a
      field missing or a field no state has, and it is refused whole, the state starts afresh, and that is said. A
      definition that changed since the value was saved is the ordinary case of this, and is what React's fast
      refresh does with a component whose shape changed;
    - **what is saved is a state and every state it started**, each with what it held;
    - **reads are asked again and writes are not made again**, which is what `awaits` and `makes` already are.
- **The app's components against read-only data.** A component reads through `useState` and is not rewritten in
  the move, so it has to compile against what this kernel hands it. Measured twice on `908a41d41b`, 2026-11-21,
  with only the type of the `data` that `useState` gives changed. The typecheck of the SDK and of the host passes
  either way. Typed read-only at every depth (Vue's `DeepReadonly`), the built-in pack reports 125 errors in 26 files
  and the renderer's 44 lines in 4 files. Typed one level in, a field and a list a field holds, the pack reports 54 in
  21 files and the renderer's 4 lines in 2 files, which are 2 errors each reported twice. Typed as the kernel types
  it, every field at every depth as well, both report those same errors and no other: a read-only object is taken
  wherever a writable one is asked for. **None is a write, under any of the three.** There is no assignment to a read-only field
  and no list changed in place among them. Every one is a value read from a machine handed to something that says it
  may write to it: a prop, a helper's parameter, a `Ref<string[]>`. Of the 58 lines that remain, most are a read-only list
  handed where a writable one is asked for, which is the one thing TypeScript holds a caller to and the thing worth
  saying: a prop or a parameter that only reads a list says `readonly string[]`. What the deep type added to that was
  mostly a `Thread` handed on as its entity type declares it, whose lists are writable and whose type is not to be
  widened to make a caller compile (`packages/apack-sdk/TYPED-EARS.md`). That no write was found is not that there
  is none: a list further in changed in place, or a write through a helper typed as writable, is what the compiler
  cannot see. A type that takes an object apart has to ask first whether it is a string: one marked as a kind of id
  (`FeatureRef`) is a string and an object at once, and taken apart it is refused everywhere a string is asked for,
  which the first measurement of this showed as 28 lines in the renderer. What remains is
  to be put right as each feature is ported.
- **A pack rule for a write to what was read.** The types refuse a field assigned at any depth and a field's list
  changed in place, and a write that runs is reported with what to write. Between them is a list further in changed
  in place, which compiles and is found only when its line runs. A rule closes the form of it that is written where
  the value was read, and needs no types to: it refuses an assignment, a `delete` or a method that changes a list in
  place (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`) whose target begins at the `data` a
  handler is handed or at the `state.data` a component reads. `data.open.tags.push(x)` is refused; the same list
  taken into a `const` first, or handed to a helper, is not seen, and is what the report at run time is for. It
  belongs with the pack rules, so that `apack pack validate` and `check:specifiers` both run it, and it is written
  when the first feature is ported (Order of work, step 5), since until then there is no handler in the tree for it
  to read. `eslint-plugin-functional`'s `immutable-data` and unicorn's `no-array-sort`, `no-array-reverse` and
  `no-array-splice` are the kind. Seeing through the `const` or the helper would take the types or the whole
  program, and is not to be built: a check that runs the handler finds it, and says what to write.
- **The Vue binding in a window.** One thing about it is not known, and cannot be found out here:
  - **Devtools.** Pinia shows its stores in Vue's devtools, with what changed them and when. A step is already that
    record here: its cause, the handlers that ran, the fields that changed. Giving it to the devtools belongs with
    the step log (What to build around it), and is worth doing only against the components people will inspect.
- **A machine's context is not frozen on XState**, so a component that writes to what `useState` handed it changes
  the machine's own object, with no event. `useSelector` handed out the same objects before. It is left as it is:
  freezing what a component is handed freezes the machine's context, and a machine that writes to its context in
  place, or keeps an actor there, would throw. It goes when a surface is ported, since this kernel freezes.
- **The rest of the commit surface.** Reads and writes are built and checked on a slice of it: five of its 54 asks,
  two reads and three writes. What the slice does not show is the other 49, and whether "a state when what the surface takes
  changes, an awaited ask otherwise" stays a clear rule across them. The asks the panel reads as under way by id
  today (a commit, a checkout, a worktree change, signing in) are the ones to try it on.
- **What is left of what a state starts and follows.** Rule 10 is built and checked on two examples. Not built: the
  brain, the bus and the shell on it, which are the app's own cases: a flow per run, a surface per pack, a system per
  registration.
- **A check for a cycle of asks.** Two systems that each answer by asking the other wait on each other without end,
  and nothing reports it. It is a pack rule over the recorded graph, under What to build around it.
- **A bound across steps.** A step is cut short after ten thousand things. Two systems that tell each other across a
  link without end are a step each, and nothing bounds that; a schedule stops a run that has not come to rest. This
  one is left as it is on purpose. A count of how many things led to this one, cut off at a limit, was considered:
  an agent's loop is one thing leading to the next for as long as it runs, and so is reading results a page at a
  time, so a limit would stop what the app is for. A circle of views is different, and is refused (rule 10), because
  what a view is asked for is declared and a circle among declarations is a mistake whatever its length.
- **Undoing what a handler sent before it threw.** Its change is not made, and what it told others is still told.
- **Field names unique along a path** are assumed and not enforced.
- **A field with a default still has to be given** when entering its state, because the types cannot see the default.
- **Saving a state to disk** is not wanted. A saved state is a stored format that would then have to be kept stable.
  And restoring starts a state's work again, which is right for a search a moment after a reload and wrong for a
  message that was being sent a day ago.
- **The app's engine as the store** ([Rows](#rows)). The rule is proven against rows in memory. Three things are
  left for the store that goes over elmdb, built with the kernel:
  - a savepoint opened only when something is written after a mark, so that marking each thing handled costs
    nothing in a step that writes nothing;
  - the engine a pack is handed refusing a write outside a step, where the prototype's store does it;
  - elmdb's checks at commit. A row that fails one fails the whole step and stops the system, where it should fail
    the handler that wrote it. Which checks elmdb leaves until commit, and whether they can be run when a savepoint
    is released, is to read in elmdb.
- **Delayed transitions and history states** are absent. The app uses one delayed transition and no history states.
  A delay, when there is one, goes through the kernel's `later` so that a schedule can choose when it fires.
- **The kernel's own rough edge.** Reading a state that has ended throws.

## Costs

- **Size.** Files that define a machine total about 27,500 lines, and 132 spec files import XState.
- **The move is made in one piece.** There is no bridge between the two kernels ([Order of work](#order-of-work)),
  so the app does not run on the branch until every machine is across. A design fault shows part-way through and is
  paid for in everything ported by then, which is why the hardest surface goes first. A change to a machine on
  `master` in the meantime is made again on the branch. And nothing of it lands until all of it does.
- **No ecosystem.** No visualizer and no community knowledge; models and people know XState.
- **Edge cases.** XState has years of fixes that a new kernel would rediscover.
- **Compile errors are deep.** A missing `failed` is reported as the whole state not being assignable, with the line
  that says so, "Property 'failed' is missing", third after two of printed types. Every rule the types hold is reported
  this way. Nobody has yet met these errors while writing a feature, and the first port is where their cost shows. How
  long the compiler takes over 49 machines' worth of these types is not measured either.
- **Static analysis needs the compiler**, and is as precise as the helper types: a loosely typed helper blurs the graph.
- **A discipline XState avoids by forbidding it.** After an `await` in `run` or an ask, code should only return. The
  kernel drops what a stale task sends through it, and cannot stop a side effect that bypasses it.
- **A transaction ends at the database.** A step is whole over data, rows and what is sent, and over nothing
  outside: git, files, models and the run history keep their own time ([Rows](#rows)).
- **A check before a wait proves nothing about after it.** The change that comes with an answer can check again and
  refuse. What a handler told others or sent as progress on the strength of the earlier check has already gone, and
  no design that does not block can take that back.

## Order of work

Step 1 is done. No later step is started.

**There is no bridge.** A bridge would run states and XState machines on one bus so that features could move one at
a time, with the app running throughout. It is not built, and is not to be: it is a second kernel's worth of joins to
write, test and then delete, at the boundary where a step meets something that has none. What makes going without
one reasonable is step 1. A component names neither XState nor an actor, a send is `tell` or `broadcast`, and an
ask is the SDK's, so what the move rewrites is the files that define a machine and their specs, and no component.

1. **Bring the XState code to the shared vocabulary and seams.** Done, and merged: spankyed/apack#591 and #593 for
   asks, #596 for `useState`, #597 and #599 for `makes`, #600 for `tell` and `broadcast`
   ([What #591 delivered](#what-591-delivered)). A machine goes on naming XState until it is ported.
2. **Build the kernel in the tree**, with no dependencies, as its own workspace, from the prototype and with its
   checks: the schedule and every ordering, the refusals, what must not compile. Not a sibling repository: its API
   is the pack contract. It takes the store a step is a transaction of ([Rows](#rows)) as something it is given, so
   that it names no database.
3. **Port the host's bus and shell**, which everything else runs inside. Two things they need are settled here,
   against the real ones ([Not built](#not-built)): roles, and restoring a state. The host gives the
   kernel the app's engine as its store, and the engine a pack is handed refuses a write outside a step.
4. **Put the test harness on it**, so that a feature's specs run against the kernel. From here to the end the app
   does not start, and this is how each port is known to work: a feature is across when its specs pass, unchanged in
   what they assert.
5. **Port the commit surface and the code system it asks, first.** It is the hardest: 54 asks, none of them a
   state's own work. If `awaits` and `makes` fall short, or a state turns out to need more than one place to be at,
   it shows here and costs one surface. On XState with `makes` its machine is about 1,620 lines; what it comes to
   here is the measure of what the kernel is worth, to be written down and not acted on. The commit and
   pull-request surfaces are taken apart by concern as they are ported, each concern a state the surface starts.
   The pack rule for a write to what was read is written with it ([Not built](#not-built)), so that every later
   port is held to it.
6. **Port the rest**, the hardest of what is left each time: the brain, the surfaces with states, then the 13
   single-state surfaces and the 20 single-state backend systems, which are the least likely to surprise.
7. **Remove XState**, start the app, run the chain, and regenerate the recorded API reports.

While the branch is open, a change to a file that defines a machine on `master` is made again on the branch, so
such changes are kept few, and the branch is brought up to `master` often enough that each is small.

## The name

`apack-spec` is a working name. "Spec" already means a test file here (`npm run spec`, `*.spec.ts`), so the name is
ambiguous in speech and should be settled before a package is created.
