# Live queries

Status: Steps 1–5 implemented, 2026-10-25: `engine.watch`, the read-set index and the harness property (step 1,
`517900b52`); elmdb's protocol (step 1a, done: `elmdb` `78f9fb0`); views in the SDK, host, API, renderer and harness
(`e4f65d409`); prompts on views (`cdeb2c846`); step 4, one change per feature: actions (`0a7313f0f`), flows
(`50d788397`), notes (`675f2c6f0`), library (`301c6c917`), database (`ec02c7754`), threads (`522b5f5c5`), brain
(`d19538a74`), browser (`fab8e242d`), code (`7b80bffb8`) and logs (`97812929a`), with the run-history fetches answered
to their asker alone; step 5, the guide rewritten and the pack rule decided against (`b9d9be8bb`). No feature in default-setup broadcasts row data. Step 1's readings and
the decisions each step made are below.

A view's data reaches the frontend as a live query: the backend declares a read, a window subscribes to it with its
own arguments, and the engine runs the read again after every commit that could change its result. Nothing that writes
says who is looking, and no surface keeps a copy of the data that it patches from events.

## Why

A broadcast does three jobs (the root `CLAUDE.md`, Architecture): a notification, a view's data fetch, and a command's
result. Commands already have `reply`. Data fetches are still hand-written: each write is followed by a broadcast, and
every window patches its copy from it. That's where the bugs come from:

- The prompts surface replaced the prompt a window had open when any prompt changed, closed it when any prompt was
  deleted, and listed a prompt twice when it heard of it twice. Fixed in `c427e84fd`, one handler at a time.
- The same system still broadcasts `PROMPTS_PAGE_LOADED` and `PROMPTS_ALL_LOADED` to every window, so one window's page
  request moves every window's page.
- Across default-setup's systems there are 289 `broadcastToSurface` calls (`code` 118, `threads` 38, `library` 31,
  `notes` 27, `brain` 21, `database` 19, `flows` 13, `prompts` 10, `actions` 7, `logs` 4, `browser` 1). Not all of
  them are data: terminal output and run progress are notifications and stay broadcasts. The ones that carry rows are
  each a handler that can update the wrong item, miss one, or add one twice.

This is the separation of server state from UI state that Convex's `useQuery`, Firestore's listeners, Meteor and
React Query all make: the server owns the data and the client subscribes to it; the client's state machine owns only
what the user is doing (which prompt is open, which page is showing).

## The contract

**`engine.watch(read, listener)`**, in `@apackdev/ears`:

- runs `read` at once and hands the listener its result;
- after any commit that could change the result, runs it again, and calls the listener only when the result differs
  (structural equality), with the commit sequence it reflects;
- **never misses a change**; it may re-run a read whose result turns out unchanged, which the equality check absorbs;
- **delivers asynchronously**: a listener runs after the commit that caused it, never inside the write, so no code
  comes to depend on a callback landing mid-unit. elmdb's notifications cross a native boundary after the commit, so
  this is the only timing both engines can keep;
- coalesces: several commits before the re-run (an import of 200 prompts, each its own commit) cause one re-run;
- returns `stop()`. A read that throws hands the listener the error, and stays watched, so the next relevant commit
  tries again.

**A watched read is a pure read of the engine.** What it reads elsewhere — the clock, settings, a module-level cache, a
file — is not tracked, so its result would go stale without a word. Convex holds its queries to the same rule. The
guide states it, and the harness pins it (Step 1).

The contract is the same one elmdb specifies (`elmdb/docs/engine.md`, Change sets and watch). Dependency tracking is
private to each engine, so the move to elmdb swaps the implementation under the same API (below, The move to elmdb).

**Views**, in the SDK and host: a feature declares named, typed live reads; a window subscribes to one with
arguments; the host keeps one engine watch per subscription and sends its results to that window only.

```ts
// be/views.ts, named in apack.json: features.prompts.views = "./be/views.ts#promptViews"
export const promptViews = defineViews({
  page: ({ page }: { page: number }) => repository.promptQueries.connectedData(page),
  byId: ({ id }: { id: EARS.EntityId }) => repository.promptQueries.byId(id),
});

// fe: a component; the result is reactive and typed from the declaration
const list = useView('page', () => ({ page: page.value }));   // { data, status, seq, error }
const open = useView('byId', () => selectedId.value && { id: selectedId.value });
```

What each job of a broadcast becomes:

| Job | Today | Then |
|---|---|---|
| A view's data | a broadcast after each write, patched into each window's copy | a view |
| A command's result | `reply` | `reply`, plus the commit sequence it wrote |
| A notification | a broadcast | a broadcast |

## Design

### Dependency tracking: read sets over keys

Every read and write the engine makes goes through one seam, `KvReader.get`/`range` and `KvWriter.put`/`del`/`clear`
(`kv.ts`, reached only through `store-access.ts`). Tracking happens there:

- **While a watched read runs, the reader records what it touched:** each key it got, and each range it scanned, up to
  the last key it visited when a limit or the visitor stopped it, or to the range's end when it was exhausted. This is
  the read-conflict-range technique FoundationDB uses for its transactions, applied to notification.
- **Each commit records the keys it wrote**, as encoded bytes, and once the outermost unit commits it hands them to the
  watch registry. A unit that throws commits nothing and notifies nothing. `clear` (a reset, a `replaceWith`) counts as
  writing everything.
- **A watch re-runs when a written key is one it got, or falls inside a range it scanned.** Comparisons are on encoded
  bytes, which is the store's own order.

Why keys rather than logical dependencies (types, fields, ids): a read set of keys and ranges is exactly what the read
saw, which is the tightest dependency set available without understanding the query. Logical tracking is strictly
coarser — it re-runs whenever a change *might* matter. And the engine's derived reads — a type's id list, counts, the
trash, the value indexes, each relation kind's out and in keys — are keys too, so recording at the seam covers every
one of them, and every read added later, with nobody declaring anything. A create of a prompt writes the type's
id-list key that a page read scanned; an edit writes `['v', id, field]`, which only the reads that got that field
recorded. So an edit to prompt B doesn't re-run the read of prompt A, and an indexed `where status = 'open'` records
only that value's index range.

### Matching a commit against every watch: an index, not a scan

Checking each written key against each watch's read set costs watches × ranges × keys per commit, which grows with
every open view. The registry indexes the read sets instead, as FoundationDB's resolver indexes conflict ranges:

- **point keys** (what reads got) in a hash map from encoded key to the watches that got it;
- **scanned ranges** in an interval index over their encoded endpoints (a sorted array of endpoints with the watches
  each range belongs to, or an interval tree), answering "which ranges contain this key" by a stabbing query.

A written key then costs one hash lookup and one O(log N + matches) search, N being the ranges held. A commit costs
O(K log N + matches) for its K written keys, whatever the number of views. A re-run replaces its watch's entries: it
removes the old read set's and inserts the new one's, so the index holds exactly the current read sets.

**Cost when unused.** Recording happens only inside a watched read, and write keys are kept only while a watch exists,
so an engine with no watches pays nothing. Step 1 measures the rest with the ears bench before anything depends on it.

### Identical subscriptions share one watch

Two windows on the same view with the same arguments are one watch with two listeners, keyed by the view's ref and its
canonical arguments. Reference-counted: the last listener leaving stops it. So the work is proportional to the
*distinct* live queries, not to windows times components, which is what Convex does with its query cache.

### Re-running, and what wasn't chosen

An invalidated watch re-runs its whole read. Views are pages and single rows, so a re-run is bounded by the page size,
not the table's, and counts are read off stored counters. The equality check compares the new result with the last
delivered one (structurally, O(result)) and delivers nothing when they're equal.

**Not chosen: incremental view maintenance.** Differential dataflow and DBSP (Budiu et al., VLDB 2023), as Materialize
and Noria run them, push each change through the query's operators, so an update costs the size of the change rather
than of the result. That is the asymptotic optimum, and the wrong trade here, for two reasons:

- **It needs the query as data.** A view is a JavaScript function over repository code, and a delta can't be pushed
  through a closure. elmdb's plans are data, so if it ever pays, it belongs there.
- **Our re-runs are already cheap.** IVM wins when a re-run is expensive — a large join, an aggregate over a big table —
  and no view here is. A view that becomes one is the case for it, measured, in elmdb.

**Not seen:** writes from another process (`apack db exec` run offline against the files). Those reach the files and
not the app's engine. The follow-up that serves `apack db` through the running app closes this; until then the guide
says so.

### The move to elmdb

What survives unchanged: the contract above, views, `useView`, codegen, the subscription per view, the commit sequence
on replies, every migrated feature, and the harness's watch property, which is written against the contract and so
becomes elmdb's acceptance test for its watch. What is thrown away: the read recorder, the write log and the registry's
index in `@apackdev/ears`, which are private to the JS engine by design.

Two things elmdb's protocol needs, agreed before Step 1 so the contract is one both engines can keep:

1. **Tracked reads, matched in elmdb.** `db.watch(plan, listener)` watches one plan, and a view is a function that may
   run several plans and filter in JavaScript (elmdb's "a caller's own function can't cross"). So: a read call may ask
   to be tracked under a token; elmdb records the key ranges those reads touched and holds the interval index in
   Rust; a commit's result names the tokens it touched. The facade re-runs the view whose token was named.
   Matching runs where the keys are, nothing larger than a token crosses the boundary, and elmdb's watch is as precise
   as the JS engine's, rather than tracking types, fields and ids. `watch(plan)` stays, as a convenience over it.
2. **A commit sequence on every change set and batch result,** a number that only increases, so replies and views can
   be ordered (read your writes, below).

### Views: the host owns their lifetime

- **One tRPC subscription per view subscription** (`views.watch({ surface, view, args })`). The window's `useView`
  opens it and closes it when its component unmounts or its arguments change. The socket closing ends every
  subscription on it, as `RpcContext.closed` already ends everything per connection. Nothing has to notice a window
  going away, and no per-client registry has to be cleaned up by hand.
- **The view runs in the API process**, on the bound engine, as the feature's backend code. A pack reload stops the
  pack's watches and starts them again on its new code; a pack disabled ends them with an error the view reports.
- **Results go only to the window that asked.** That's the subscription itself, so a page request can no longer move
  another window's page.
- **Read your writes.** A command's reply carries the commit sequence its write reached, and `useView` exposes the
  sequence its result reflects. A surface that must show its own write, for example selecting a prompt it just created,
  waits for `view.seq >= reply.seq` (`whenView`, a helper beside `useView`). Without this, a reply can arrive before
  the list that holds the new row: the two travel on different channels.
- **Typed from the declaration.** Codegen reads `features.<id>.views` as it reads repositories and contracts, and
  `#generated/fe` types `useView`'s names, arguments and result, so a misspelled view or a wrong argument doesn't
  compile. `untypedUseView(ref, view, args)` is the escape hatch, by the repo's `untyped` rule.
- **Whole results, not diffs.** Views are pages and single rows. Diffing waits for a reading that says it's needed.

### What surfaces stop doing

A surface machine holds UI state only: which prompt is selected, which page, what's expanded. It doesn't hold rows.
Its views come from `useView` in the components. Where a machine must react to data (the open prompt was deleted, so
go back to the list), the component sends it an event when the view's result changes. That event is about the UI, not
the data.

`SEND_STATE` and the connected-data broadcasts (`PROMPTS_CONNECTED`) shrink to what isn't a row: settings and
capabilities. Settings already have their own channel (`FEATURE_SETTINGS_UPDATED`).

## Steps

### 1. `watch` in the engine

- The read recorder and the write log at the seam: `store-access.ts` holds the active recorder, and `kv.ts`'s writer
  logs keys while the registry has watches.
- The registry: watches; the point-key map and the interval index over scanned ranges, replaced per re-run; the
  coalesced, asynchronous re-run (scheduled after the commit, deduplicated per watch); the equality check; the
  sequence; `stop`.
- Shared watches: keyed by a read's identity and canonical arguments, reference-counted. The engine exposes the
  primitive; the host keys views by ref and arguments (Step 2).
- `watch` on `Ears`. A public export, so `npm run api:update` and the guide's Persistence section.
- **The model-based harness gains the property that matters:** after every op in a random workload, each watch's last
  delivered result equals its read run afresh. Watches are generated over the same reads `derivedOf` already checks
  (ids, counts, the trash, an indexed and an unindexed `where`, `withRole`, `out`/`in`). This is the "never misses a
  change" guarantee, tested against every write path, savepoints and refused units included.
- The index's own spec, against a brute-force scan over random read sets and writes: the same watches matched for every
  key, ranges ending at and beyond the key included, and nothing left in the index after every watch stops.
- A listener called synchronously inside a write fails a case, since delivery is after the commit.
- The pure-read rule: a read that consults something outside the engine is the documented way to go stale, and a case
  shows it does, so the guide's rule is pinned by behaviour rather than prose alone.
- Mutation checks: a write log that drops `del`, a range recorded only to its first key, a notification from a unit
  that rolled back, a `clear` that notifies nobody, an index that keeps a re-run watch's old ranges. Each must fail.
- Readings with the ears bench: a create with 0, 10, 100 and 1,000 watches open (commit cost must stay flat, which is
  what the index is for), and a page read watched against unwatched.

**Done when:** the harness passes on both backends with watches, each mutation fails it, the index agrees with the
brute-force scan, and the bench readings are recorded here.

**Readings** (2026-10-25, `npm run bench -w @apackdev/ears`, LMDB, MacBook Pro, Node 23.11; a busy machine, load
average 6–10, so read the trend, not the third digit). Means:

| Case | Mean |
|---|---|
| 1,000 creates, 0 watches open on other rows | 129 ms |
| … 10 watches | 122 ms |
| … 100 watches | 155 ms |
| … 1,000 watches | 132 ms |
| 1,000 creates, then 100 watches on a page of the type run again (one burst) | 178 ms |
| 1,000 page reads (`query('Task').limit(50).pickAll()`) | 428 ms |
| 1,000 page reads, tracked as a watch runs them | 474 ms |

Commit cost is flat from 0 to 1,000 watches (the spread is the machine's), which is what the index is for. Tracking
adds about 11% to a watched read and nothing to an unwatched one. A burst of 1,000 commits re-runs each of 100 page
watches once, about 0.5 ms a re-run.

**Found while measuring, not this plan's:** an indexed `where` with a `limit` reads every match before limiting
(`query('Task').where('status', 'open').limit(50).pickAll()` took 32 ms over 13k matches), since it gives matches in
the type's order. A view that pages through an indexed `where` pays that on every re-run.

**Mutation checks**, each failing at least one spec (`watch.spec.ts`, `read-set-index.spec.ts`, the harness): a write
log that drops `del`, a stopped range recorded one key short, a `get` not recorded, a unit that threw notifying, a
`clear` notifying nobody, an index that keeps a re-run watch's old entries.

### 1a. elmdb's protocol

The two asks under The move to elmdb, written into `elmdb/docs/engine.md` (tracked reads, the token in a commit's
result, the commit sequence) with this plan as their reason. It's a spec change in elmdb, not an implementation; it
lands before Step 2 so nothing above the engine is built on a contract elmdb can't keep.

### 2. Views in the SDK and host

- `defineViews` and the view types in `@apackdev/sdk`; `features.<id>.views` in `apack.json`, its schema
  (`schema:update`) and codegen into `#generated/fe`.
- `views.watch` in the API's routers, delegating to a host module (`@apackdev/host/views`): resolving the view from
  the registered pack, one engine watch per subscription, restarting on a pack reload.
- `useView`, `whenView` and `untypedUseView` in `@apackdev/sdk/fe`; `reply` carrying the commit sequence.
- The pack test harness gets the same views, so a pack's specs drive them with two clients.

**Done when:** a spec with two clients holds that each receives only its own view's results, that two clients on the
same view and arguments share one engine watch, that an unmount or a socket close ends the watch (the registry is empty
afterwards), and that a pack reload re-runs the views on the new code.

**Decisions made building it** (2026-10-25):

- **`useView(feature, view, args)` names the feature.** The plan's sketch took it from the component's surface, but a
  type can't follow a runtime scope, so the name is what makes the view, its arguments and its result checkable; it
  also lets a component read another of its own pack's features' views, which the scope couldn't.
- **Typed views are the pack's own features'.** A dependency's go through `untypedUseView`. Typing them would put the
  views' types in the facade a dependent reads, which changes what a snapshot carries; nothing asks for it yet.
- **The registry is what a view's code is.** Views ride in the registration (`PackFeature.views`, checked against the
  manifest like systems and surfaces), and the host resolves a request there each time it starts one. The registry
  gained `onRegistrationChanged`, told once a registration, replacement or unregistration has committed, and the view
  host restarts that pack's watches on it — so a reload re-runs them on the new code, a pack gone is an error that a
  later registration clears, and nothing in the pack runtime has to remember that views exist.
- **Arguments are data, compared as data.** `viewKey` sorts object keys, so `{ a, b }` and `{ b, a }` are one watch on
  the host and one subscription in a component; `null` or `undefined` leaves a view idle, and a view that takes no
  arguments is called with none.
- **New arguments start from no result, unless the caller keeps the previous one; an error keeps the last one.**
  Holding the previous result by default would show one prompt's data under another's selection. A pager is the
  opposite case — blanking the list between pages is wrong — so `useView` takes `{ keepPrevious: true }` (Step 3 added
  it, for the prompts list; React Query's `placeholderData: keepPreviousData` is the same choice). A view that throws,
  or whose pack is reloading, keeps showing what it showed with `status: 'error'`.
- **Delivery is always asynchronous on the host too.** A subscriber joining a running watch is handed its last result
  on a microtask, and an unresolvable request's error likewise, so no caller sees an observer run inside `watch`.
- **A restarted watch whose result reads the same isn't delivered again**, compared as the JSON it crosses the wire as.
  The engine's own equality covers commits; this covers the restart, which the engine sees as a new watch.
- **The commit sequence on `reply`, and `whenView`, are deferred until a feature needs them.** A command's reply is sent
  after its write committed, and a subscription opened after the reply reads at or past that commit, so "select what I
  just created" (a `byId` view opened on the reply's id) is read-your-writes by construction. What would need the
  sequence is a view already open that must include the write before the UI acts on it; Step 3 and Step 4 say whether
  one exists. Every `ViewUpdate` and `ViewState` carries its commit already, so adding it to `reply` is small.
- **The renderer re-subscribes its views when the API moves port**, beside the bus subscription. A socket that drops and
  comes back keeps them, since tRPC's client sends its pending subscriptions again on reconnect.

**Proofs:** `apack-host/tests/views/view-host.spec.ts` (own results per subscriber, one engine watch per request
whatever the key order, the last to leave stops it, a replaced pack's new code, errors that keep the subscription; two
mutations — no sharing, no restart — each fail it), `api/tests/transport/views.spec.ts` (two sockets on one view share
one watch, and each socket closing ends its subscriptions, over a real adapter), `apack-sdk/tests/fe/views.spec.ts`
(`untypedUseView`'s states, re-subscribing only for different arguments, idle, the scope ending it, a late delivery
ignored), and the codegen cases in `compiles.spec.ts`. The harness's `watchView` is first used by Step 3's spec.

### 3. Prompts on views

- `promptViews` with `page` and `byId`; the surface's `useView`s; the machine reduced to UI state.
- Deleted: `PROMPT_CREATED`, `PROMPT_UPDATED`, `PROMPT_DELETED`, `PROMPTS_PAGE_LOADED`, `PROMPTS_ALL_LOADED`, the rows
  in `PROMPTS_CONNECTED`, and every handler for them.
- `tests/features/prompts/fe/page-and-selection.spec.ts` rewritten against two clients: an edit or a delete in one
  leaves the other's open prompt alone unless it's the same prompt; each window keeps its own page; an import shows
  each prompt once.

**Done when:** the prompts feature has no data broadcast left, and the two-client spec passes.

**Decisions made building it** (2026-10-25):

- **Two views: `list({ limit, categories })` and `byId({ id })`.** "Load more" raises the window's `limit` rather than
  appending pages it has to dedupe, so the page guard and the two-clicks case are gone with it; the code panel's
  prompts list holds its own limit and reads the same view, instead of reading the prompts surface's state.
- **The category filter moved to the view.** It filtered the loaded page in the window, so "the first 20 Creative
  prompts" was "the Creative ones among the first 20". The list reads every prompt either way, since its count does,
  which is what a re-run costs: a few hundred rows.
- **Categories come from the settings, read where they're shown** (`useSettings('prompts')`). `PROMPTS_CONNECTED`
  existed to carry them beside the rows, and with the rows gone the system answers no `SEND_STATE` at all.
- **The machine hears a view through one UI event, `PROMPT.LOADED`.** The canvas sends it when the open prompt's view
  reads something: it fills the form once per opening (so another window's edit doesn't overwrite what the user is
  typing), keeps the breadcrumb's label, and `null` — the prompt deleted here or anywhere — returns to the list. Only
  for the prompt open now, so a slow result for one the user left is ignored. The call correlation for
  `PROMPT_SELECT` went with the ask: there is no ask.
- **`whenView` wasn't needed.** Nothing here selects a prompt it just created: a save returns to the list, and a new
  `byId` subscription reads after the write that preceded it.
- **What's left on the wire is the outcomes** — `PROMPTS_IMPORTED`, `PROMPTS_EXPORTED` and their failures — replied to
  whoever asked.

**Proofs:** `tests/features/prompts/be/views.spec.ts`, two windows over the harness: an edit or a delete reaches the
window with that prompt open and not the other, one window reading further down the list moves nobody else's page
(with the list's limit ignored, this case fails), an import of three prompts arrives as one change listing each once,
and the category filter. `tests/features/prompts/fe/page-and-selection.spec.ts` holds the machine to UI state: opening asks the backend
nothing, the form fills once, a stale result is ignored, a deleted prompt returns to the list.

### 4. The other features

One change per feature, each deleting its data broadcasts and their handlers: `actions`, `flows`, `notes`, `library`,
`database`, `threads`, `brain`, `code`. Each starts by sorting its broadcasts into data (becomes a view),
notification (stays) and result (becomes `reply`), and records the sorting in the change. `code`'s terminal output
and `threads`' streaming tokens are notifications.

**Progress, one change per feature:**

- **actions** — the same two views as prompts (`list`, `byId`) and the same machine, which holds the open action, the
  list's limit, the filter and the form. Sorted: every broadcast was data (`ACTIONS_LISTED`, `ACTION_SELECTED`,
  `ACTION_CREATED/UPDATED/DELETED`, the two page events) except the four import and export outcomes, which stay
  replies. The flows editor kept its own copy of the action list from `FLOWS_CONNECTED` and three of those events;
  its palette reads the `list` view instead, so the flows surface's inbox no longer takes action events at all. The
  code surface's actions panel reads the same view with a limit of its own.
- **flows** — two views, `list()` (every flow, newest first, and the root flow) and `graph({ flowId })` (a flow's
  nodes and edges, or `null` once it's gone). Sorted: the data was `FLOWS_CONNECTED`'s rows (the flows, the root
  flow's graph, the prompts and actions for node forms), `FLOW_SELECTED`, `FLOW_REFRESHED`, `FLOW_CREATED`,
  `FLOW_DELETED` and the node and edge confirmations broadcast to every window; the results are `FLOW_OPENED`,
  `NODE_CREATED` and `EDGE_CREATED`, now with `FLOW_WRITTEN` and `FLOW_WRITE_FAILED`, all replies. The model catalog
  is a fetch: `FLOWS_CONNECTED` broadcast it to every window on every publish; the surface asks
  (`GET_MODEL_CATALOG`, answered `MODEL_CATALOG_READ` to it alone) on `SURFACE_STARTED`. Node forms read the
  prompts and actions views, and the settings come from `useSettings`. Decisions:
  - **The editor is the one surface that edits its copy of the data at once**, and so the one where applying a view's
    result can be wrong: a result computed before the editor's own write landed would put the old value back under
    the user's typing. So **every graph write is answered**, a refusal included (`FLOW_WRITE_FAILED`; an unanswered
    write would hold the view for good), the machine records each write's call, and **a result that arrives while any
    is unanswered is held**. When the last is answered, a held result — or a refused write — makes the canvas read the
    view again (`graphRefresh`), and otherwise the next result, which carries the last write, is applied as it comes.
    Re-reading gives the host's current result, which by then holds every write the backend answered, so this needs
    neither the commit sequence on replies nor any ordering between a connection's subscriptions. It is TanStack
    Query's optimistic-update shape: apply the edit, settle the mutation, read the server's state.
  - **`useView` gained `refresh()`** for it: subscribe afresh to the same request, keeping what it shows meanwhile.
  - **The breadcrumb and the history read the list through one UI event, `FLOWS.READ`** (each flow's label, and the
    root flow), which the canvas sends when the list view reads; the machine keeps no flow rows.
  - **Revealing a node of the flow already shown answers at once**: the graph on screen is the view's current result,
    so the node is in it or it isn't, where the old code asked the backend again.
  - **A write nobody asked for still runs**: `answerWrite` runs the write before answering, because `reply?.(write())`
    skips its argument when there is no `reply`. The views spec caught it (an applier's or a migration's write).
- **notes** — five views: `tree()`, every note as the tree shows it; `note({ id })`, one note with its text;
  `recent({ limit })`, what the welcome page lists; `search({ text })`; `trash()`. Sorted: every broadcast was data
  (`NOTES_CONNECTED`, `NOTE_CREATED` sent to every window, which selected the new note in all of them, `NOTE_UPDATED`,
  `NOTE_DELETED`, `NOTE_RESTORED`, `TRASHED_NOTES`, `NOTES_SEARCH_RESULTS`) except the import and export outcomes.
  The writes are answered as the flow editor's are (`NOTE_CREATED` to the asker with the note, `NOTE_WRITTEN`,
  `NOTE_WRITE_FAILED`). Decisions:
  - **The tree reads no text, and no time a write moves.** A tree view of whole rows would send every note's body to
    every window on each save; `summaries()` picks only the fields the tree shows, so typing in a note re-runs the views
    showing that note and not the tree (with whole rows, the views spec's "the tree heard nothing" fails). The open
    note's and the selected task's text come from `note({ id })`. The welcome page's lists read `updatedAt` and
    `lastSeen`, which every save moves, so they are their own view, subscribed only while that page shows — which is
    why it takes its `limit` as an argument: a view with no arguments can't be left idle.
  - **The hold behind writes became an SDK primitive, `ViewWrites`** (`@apackdev/sdk/fe`: `viewWrites`, `writeSent`,
    `viewRead`, `writeAnswered`, `writing`), at its second use. The flows editor moved onto it; the notes surface uses
    one for its tree and its open notes, and the canvas reads all three views again on each of its `refreshes`.
  - **A note opens with its title selected when this window created it** (`createdNoteId`), where it used to guess
    from an empty text the summary no longer carries.
  - **The surface's settings come from `useSettings('notes')`**, the trash from its view, and the note artifact viewer
    and the `@`-reference items read the note and tree views, so they work whether or not the notes surface is running.
- **library** — three views: `index()`, every document and folder by name; `folder({ folderId })`, one folder's
  contents; `document({ id })`, one document. Sorted: every broadcast was data or a refetch cue (`LIBRARY_CONNECTED`,
  `LIBRARY_INDEX_LOADED`, `NAVIGATION_CHANGED`, `DOCUMENT_CREATED`/`UPDATED`/`DELETED`, `COLLECTION_*`, `ITEM_RENAMED`,
  `ITEMS_DELETED`, `ITEMS_MOVED`, `SYMLINK_UPDATED`) except the import and export outcomes. Writes are answered
  (`COLLECTION_CREATED` to the asker with the folder, `LIBRARY_WRITTEN`, `LIBRARY_WRITE_FAILED`). Decisions:
  - **What is on disk is not a view, and a view says so.** A symlinked folder and its files live on disk, which a read
    set can't cover, and a view that read disk would be a view that is silently stale. So a view reads the engine and
    nothing else: `folder` and `document` answer `{ onDisk: true }` for what is on disk, and the window fetches it by
    request and reply (`GET_FOLDER_CONTENTS`, `GET_DOCUMENT`). A write the library makes there is announced with one
    notification, `FOLDER_CHANGED { folderId }` (`null` when the folder can't be named), and a window refetches the disk
    folders it shows. Changes made to those folders outside the app are not seen until the user refreshes, as before;
    watching the filesystem is a separate feature.
  - **Whether a symlink still reaches its disk is a fetch too** (`CHECK_SYMLINKS` → `SYMLINKS_CHECKED`), taken out of
    the folder read it used to sit in, which is what let `engineFolderContents` become synchronous and so a view.
  - **The tree watches each folder it shows.** The canvas renders one renderless `FolderReader` per folder shown (the
    one open, and each expanded), each holding that folder's view, and every result lands in the slot its folder
    names, so a late result for a folder the user has left writes nothing shown. A re-run keeps the user's selection
    where its items still exist (the old handler cleared it on every reload, which a view re-running on another
    window's commit would make constant).
  - **No `ViewWrites` here.** The library applies no edit before its write lands: the editor leaves on save, and a
    rename shows once the folder view re-runs. Holding results behind writes guards an optimistic edit, and there is
    none to guard.
  - **The editor mounts once its document has arrived.** `DocumentEditor` hydrates its form once, on mount, so it is
    rendered only when `editingDocument` is set, and keyed by the document; a document opened from a link used to
    open an empty form when its fetch lost that race. A document deleted while open returns to the browser.
  - **A refused write is shown** (`writeError`, a dismissible line above the canvas). Every failure used to be
    swallowed.
  - **Settings come from `useSettings('library')` and the index from its view**, in the editor, the panel and the
    `@`-reference items, so the surface publishes neither.
- **database** — no views. Sorted: the schema (`DATABASE_REFRESH`), the run history (`FLOW_RUNS_RESULT`,
  `FLOW_EVENTS_RESULT`, `NODE_DETAILS_RESULT`), the backup summary and the export, import and reset outcomes were all
  broadcast; every one is now replied to its asker. Decisions:
  - **The schema is fetched, not watched.** `getSchemaStats` walks the whole store (`r.range({ prefix: ['v'] })`), so
    its read set is every attribute key and a view of it would re-run that walk after every commit anyone makes —
    a full scan every 80 ms while a thread streams. The window asks for it (`GET_SCHEMA` → `SCHEMA_READ`) when it
    opens, on refresh, after its own transaction and after any replacement; another window's write shows on its next
    ask. Watching it needs counts the engine keeps as it writes, which is under Open.
  - **The run history is not the engine's**: it lives in its record store (`services.runHistory`), which no read set
    covers, so it stays request and reply, its answers keyed as before (the node-details map, the page's offset).
  - **A replacement is one notification, `DATABASE_REPLACED`**, broadcast after an import or a reset from any window,
    with no data: every window drops the results and run history it holds, which name rows that may be gone, and asks
    for the schema again. The window that asked hears its own outcome besides.
  - **The generated query stays a broadcast** (`AI_QUERY_LOADING`, `AI_QUERY_GENERATED`, `AI_QUERY_ERROR`): a flow
    sends it, and a flow run is no delivery, so there is no sender to reply to. It carries a query, never rows.
    Answering through a flow is under Open.
  - **Its first ask moved to `SURFACE_STARTED`** with the threads change below: as committed, `GET_SCHEMA` went out
    from the machine's entry, in no delivery, so it carried no sender and its answer went nowhere.
- **threads** — seven views: `list()`, `archived({ sortOrder })`, `recent({ limit, sortOrder })`, `detail({ id })`,
  `chat({ threadId, limit })`, `message({ id })` and `tab({ threadId })`. Sorted: every broadcast was data or a refetch
  cue (`THREAD_CONNECTED`, `SET_VIEW_DATA`, `THREAD_CREATED`/`UPDATED`/`DELETED`, `ARCHIVED_THREADS_DATA`,
  `AGENT_CONNECTED`, `LOAD_CHAT_THREAD`, `REFRESH_RECENT_THREADS`, `MESSAGE_ADDED`, `UPDATE_MESSAGE_STATE`,
  `OLDER_MESSAGES_LOADED`, `SET_CHAT_STATE`, `ARTIFACT_ADDED`/`UPDATED`, `THREAD_TAB_REQUESTED`,
  `AGENT_SETTINGS_UPDATED`), in the system, its services and twelve content actions, except the import and export
  outcomes and three of a flow's notifications that carry no row (`SET_MODE`, `SET_PHASE`, `FLASH_CHAT_STATE`).
  Writes are answered (`THREAD_CREATED` with the id, `THREAD_WRITTEN`, `THREAD_WRITE_FAILED`). Decisions:
  - **A message is its own view, and no list reads a message's content.** The chat page and the detail page are a
    thread's fields and its messages' ids in display order; `message({ id })` is the whole message. A streamed reply
    rewrites one message's text per flush, so it re-runs that message's view and nothing else. **Measured** (the views
    spec's streaming case run against the clock — real 10 ms sleeps between tokens, which the committed spec drives
    flush by flush instead — 2026-10-25 on the dev machine through the harness, three runs alike): a token every
    ~10 ms through the Claude Code stream writer (80 ms throttle) made 16 flushes in 1.27 s — about 12.6 a second — and
    the message's view re-ran 16 times, once per flush; the chat page, detail, list, recent and tab views re-ran 0
    times. A view of whole messages would have re-sent the page, and re-rendered every message, 12.6 times a second.
  - **The machine follows the views, through a new SDK primitive, `fromView`.** The threads surface is drawn as four
    canvas routes and the chat area beside every surface, so no one component is mounted for as long as it runs: a
    view in one would stop when another area showed, and a view in each would arrive twice. `fromView(feature, view,
    read)` (`#generated/fe`, `untypedFromView` in `@apackdev/sdk/fe`) is the subscription as XState actor logic; the
    machine spawns a child per view with its arguments and stops or replaces it when they change — one per open tab
    and one per listed message.
  - **A surface asks for what it starts from on `SURFACE_STARTED`.** A send from a machine's entry runs in no delivery,
    carries no sender, and so cannot be answered — which the database's first ask had already got wrong. The shell
    now hands every surface it spawns `SURFACE_STARTED` through `notifySurfaceActor`, and the SDK declares the
    lifecycle events (`SurfaceLifecycleEvent`). Threads asks `GET_CHAT_START`, answered `CHAT_STARTED` with the thread
    to open, the tabs every window opens and the settings — a reply, where `AGENT_CONNECTED` was a broadcast to every
    window on every `SEND_STATE`.
  - **The thread map is derived, not patched.** It is the union of what the list, recent and archived views last gave,
    rebuilt on each, so a thread deleted anywhere leaves it; a deleted thread's chat, tab and detail views end with
    `null`, which closes its tab and its page. The recent and archived views take their limit and order as arguments
    from the settings the surface holds, since a view reading settings would not be re-run when they change.
  - **Thread writes hold the thread-level views** (`ViewWrites`): pinning, renaming and the detail page's fields are
    applied on screen at once, so a result from before the write would undo them. Once answered, a held result reads
    the views again by replacing their children — a fresh subscription's first result is computed after the write.
    Message views are not held: nothing applies a message edit before its write.
  - **The chat pages by a growing limit**, not a cursor: `LOAD_MORE_MESSAGES` asks the chat view for 50 more, and the
    page that comes back holds every message the window shows, so a message arriving while it reads older ones cannot
    be lost between two pages.
  - **A thread a window's first message started is shown to that window** (`SHOW_THREAD`, a reply), as is a fork; a
    thread a flow opens is shown to every window, there being no window to answer. A window that opens a thread itself
    is answered nothing: it already shows it, and the visit reaches every window's recent list through its view.
  - **The services stopped notifying, and their names say so**: `createThreadAndNotify` is `createThread`,
    `openThreadChatAndRefreshRecent` is `showThread` (and `visitThread`), `sendRecentThreadsRefresh` and
    `openThreadTabAndRefresh` are gone, and `services.artifact` is `create`/`update`.
- **brain** — no views: a run's tree and its nodes are in the run history's record store, which no read set covers.
  Sorted: the tree and the run-node answers (`RECEIVE_SURFACE_DATA`, `RUN_NODE_OPENED`, `RUN_NODE_DETAILS`) were
  broadcast to every window, and are now replied to the window that asked; the brain's state (`BRAIN_STARTED`,
  `BRAIN_KILLED`, `BRAIN_PAUSED`, `BRAIN_RESUMED`, `INSPECT_TOGGLED`), the event pulse and the run's live feed
  (`RUN_NODE_SPAWNED`, `RUN_NODE_UPDATED`) are notifications and stay. Decisions:
  - **The live feed is a notification**, by the plan's own rule for streaming: it patches the tree a window already
    holds, as tokens patch a message, and carries no stored row of the engine's.
  - **The brain's state is news; the tree is fetched.** Publishing (`SEND_STATE`) broadcasts the state alone, and a
    run starting again is announced with `BRAIN_STARTED`, on which each window asks for the new root's tree. An ask is
    answered with the tree and then the state, so a window just started learns both in that order.
  - **The surface asks in a delivery, always**: on `SURFACE_STARTED`, on activation, on `BRAIN_STARTED`, and on an
    event's pulse straight away, where it used to ask from a 100 ms timer — an ask from a timer carries no sender, so
    its answer would have gone nowhere. What the pulse's event writes after the ask arrives as the live feed.
- **browser** — not in the plan's list, but its one broadcast was rows: `BROWSER_CONNECTED`, the saved tabs and
  bookmarks, sent to every window on every publish. Decision: **a fetch, not a view.** The saved session is a snapshot
  a window restores once and then owns — each window syncs its own tabs back — so a view would hand every window the
  tabs another window just synced. The surface asks on `SURFACE_STARTED` (`GET_SAVED_SESSION`), answered to it alone
  (`SAVED_SESSION_READ`).
- **code** — no views: what it shows is the repository, the files, GitHub and the running terminals, none of them
  stored rows but the action and prompt it opens in the editor. Sorted: some 120 broadcasts across the seven child
  systems, nearly all of them a window's result sent to every window — a file's contents, a diff, a branch list, a
  pull request's details, an error. Every one is now answered through one rule (`code/be/answer.ts`): the window that
  asked, or every window when nobody did, which is what the git watcher's refresh and an action's request are. What
  stays broadcast is news: a file changed on disk, the repository changed, a terminal created, renamed, moved or
  closed, a terminal's output. Decisions:
  - **The action and prompt the editor opens are answers, not views.** `codeActions.ACTION_SELECTED` and
    `codePrompts.PROMPT_SELECTED` are the row an editor takes to edit, as a file read is a file's text: following it
    live would replace what the user is typing with another window's save. They reach the window that opened them.
  - **`reply` answers the delivered message only** (`_Delivery.event`, `@apackdev/sdk/events`). The code system tells
    its children what to do with events of its own making — a new base directory, a connection — while handling
    another system's message; the settings system's \`FEATURE_SETTINGS_UPDATED\` was handing those children's handlers
    a \`reply\` addressed to host/settings, so the explorer's listing and the worktree list were answered to the
    settings system. Each door now records the event object it hands the receiver, and a handler is handed \`reply\`
    only when the event it handles is that object — which a system forwarding the event to a child still is.
  - **Terminals stay process state.** The running terminals are the service's processes, mirrored to the engine only
    to restore them, so their lifecycle is news and the list (\`TERMINALS_LISTED\`) an answer.
- **logs** — the buffer is a fetch. `LOGS_CONNECTED` and `LOGS_UPDATE` sent the whole log list to every window, on
  every publish and every settings change; the list is data a window shows, whether or not a stored row backs it, and
  it lives in the system's memory, so no view can serve it. The surface asks (`GET_LOGS`, answered `LOGS_READ` to it
  alone) on `SURFACE_STARTED` and again when the settings that filter it change. Each entry as it is logged
  (`LOG_ADDED`) is a feed and a clear (`LOGS_CLEARED`) is news; both stay.
- **A fetch nobody asked for is answered to nobody.** The database's run-history fetches and the backup summary went
  through `answer(reply, …)`, whose fallback broadcasts when there is no asker — right for a command's outcome, which
  someone must hear, and wrong for a fetch, which would then send run data to every window. They reply only. The
  code feature's "no repository" error (`requireGitRepository`) is answered to the asker like the rest of its results.
- **What still broadcasts, by feature**, read from every call site: brain — its state, the event pulse, the run's feed;
  code — a file changed on disk, the repository changed, a terminal's lifecycle and output, and the connection's base
  directory and settings; database — `DATABASE_REPLACED`; flows — `FLOWS_CONNECTED`, the models the editor offers;
  library — `FOLDER_CHANGED` (its search-index sends are commented out with the feature); logs — the feed and the
  clear; content actions — a flow's notifications to the chat (`SET_MODE`, `SET_PHASE`, `FLASH_CHAT_STATE`), the
  generated query or commit message a flow sends the window that asked (no return address through a flow, under
  Open), `ONBOARDING_COMPLETE`. The `answer` helpers' fallbacks carry import and export outcomes, `SHOW_THREAD`, and
  results no window asked for. None is a row.

### 5. The rule

- `packages/default-setup/CLAUDE.md`'s three jobs of a broadcast: data is a view.
- A pack rule beside the ones `apack pack validate` runs, if one can be stated without guessing: a broadcast whose
  payload is a row type the pack's views already serve. Decided at this step, with the migrated features to test it
  against. If it can't be stated precisely it doesn't ship, since a rule that fires on notifications teaches people to
  ignore it.

**Done**, and the decisions:

- **The guide says data is a view, a result is a reply, news is a broadcast** (`packages/default-setup/CLAUDE.md`, "What
  a system sends a surface"), with the worked views, what is not a view and why (disk, the run history, a walk over the
  store), `reply` answering only the delivered message, `SURFACE_STARTED` as where a surface asks, and feeds as news.
  The guard histories it kept are the ones still in the code.
- **The pack rule doesn't ship: it can't be stated precisely with what a rule can see.** The pack rules read each
  file's syntax, with no type checker, and "a payload of a type a view serves" is a question about types. Asked of the
  contract instead, where codegen does have types, it still can't be answered: a contract's `outgoing` holds a
  feature's answers and its news alike, and an answer carrying a row is right (`NOTE_CREATED` with its summary,
  `SAVED_SESSION_READ`, `RECEIVE_SURFACE_DATA`) — so the rule would fire on every reply that names a row, and still miss
  the broadcast an `answer(reply, event)` makes when nobody asked. The condition that would make it precise is a
  contract that declares its answers apart from its news; until then the guide is the rule. Under Open.

## Risks

- **Re-run cost on hot writes.** A streaming message is rewritten every 80 ms (`stream-writer.ts`); every view whose
  read set holds it re-runs at that rate. Coalescing bounds it to one re-run per scheduling turn per view, and the
  equality check stops it reaching the window when nothing it shows changed. Step 1's readings decide whether views
  need a minimum interval.
- **A view that reads too much** (a whole table to show a count) re-runs on every write to that table. That's correct
  but expensive. The cure is a narrower read, which the engine already offers (`count`, `pick`, the indexes).
- **Two channels.** A reply and a view result can arrive in either order. The sequence makes that explicit instead of
  hoping. A surface that ignores it can show its own write a moment late, never a wrong row.

## Open

- **Schema counts the engine keeps.** A watchable schema needs per-type, per-kind counts written beside the data,
  so a view reads a few keys instead of walking the store (the database feature's step-4 decision).
- **An answer through a flow.** A surface that asks a flow for something (the database's generated query) hears the
  result by broadcast, since a flow run carries no return address. Carrying the asker's address into the run would
  let a step reply.
- **`whenView` wasn't needed, by any feature.** Every surface that selects what it just created takes the id from the
  write's answer — `NOTE_CREATED`, `THREAD_CREATED`, `COLLECTION_CREATED`, `NODE_CREATED` — and selects it once the
  view that lists it gives it, which a view does after the write's commit; an editor holds its views behind its own
  writes (`ViewWrites`) and reads them again once they are answered. The commit sequence on `reply` stays unbuilt.
- **A contract that declares its answers apart from its news** (`answers` beside `outgoing`): what would make the step 5
  pack rule statable, and type `reply` against the asker's incoming events rather than the answerer's outgoing.
- The minimum re-run interval, from Step 1's readings.

## Out of scope

- Writes from another process (above), until `apack db` goes through the running app.
- Diffs instead of whole results.
- Incremental view maintenance (above, Re-running), unless a measured view needs it, and then in elmdb.
- Live queries over the run history's record store, which has its own reader (`services.runHistory`).
