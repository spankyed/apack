# Live queries

Status: Steps 1, 1a and 2 implemented, 2026-10-25: `engine.watch`, the read-set index and the harness property;
elmdb's protocol (`elmdb` `78f9fb0`); views in the SDK, host, API, renderer and harness. Step 1's readings and Step 2's
decisions are below. Steps 3–5 not started.

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
- **New arguments start from no result; an error keeps the last one.** Holding the previous page while the next loads
  would show one prompt's data under another's selection. A view that throws, or whose pack is reloading, keeps showing
  what it showed with `status: 'error'`.
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

### 4. The other features

One change per feature, each deleting its data broadcasts and their handlers: `actions`, `flows`, `notes`, `library`,
`database`, `threads`, `brain`, `code`. Each starts by sorting its broadcasts into data (becomes a view),
notification (stays) and result (becomes `reply`), and records the sorting in the change. `code`'s terminal output
and `threads`' streaming tokens are notifications.

### 5. The rule

- `packages/default-setup/CLAUDE.md`'s three jobs of a broadcast: data is a view.
- A pack rule beside the ones `apack pack validate` runs, if one can be stated without guessing: a broadcast whose
  payload is a row type the pack's views already serve. Decided at this step, with the migrated features to test it
  against. If it can't be stated precisely it doesn't ship, since a rule that fires on notifications teaches people to
  ignore it.

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

- Whether `whenView` is needed by more than "select what I just created", or whether `useView` should hold back a
  result older than the window's last reply.
- The minimum re-run interval, from Step 1's readings.

## Out of scope

- Writes from another process (above), until `apack db` goes through the running app.
- Diffs instead of whole results.
- Incremental view maintenance (above, Re-running), unless a measured view needs it, and then in elmdb.
- Live queries over the run history's record store, which has its own reader (`services.runHistory`).
