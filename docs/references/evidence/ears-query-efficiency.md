# EARS query efficiency: readings

The evidence for [EARS query efficiency](../../plans/ears-query-efficiency.md) and elmdb's companion
`docs/roadmap/query-work-efficiency.md`. 2026-10-29, on `session/query-efficiency` from `3d2929177d`, against elmdb's
checkout at `5f65c43` (the binding built from engine source identical to it). Machine: Apple M1 Pro, 10 cores, 32 GiB,
macOS 26.3.1, Node 23.11.1; load averages 8 to 12 throughout, so times are readings and the counts are the evidence.

## The fixture and the four candidates

`packages/default-setup/tests/features/threads/be/query-work.spec.ts`, under `startApp` (the threads and notes
systems), at two sizes, 100 threads with 1,000 messages and 250 notes, and twice that:

- every thread with one message, but the first, which holds all of the messages, every 50th mentioning a deploy;
- five markers after them;
- three queued messages last;
- one archived thread and one parent link;
- notes titled `Note <n>`.

The four candidates are A to D below. Crossings are reads of elmdb counted by `testCalls()` (`@apackdev/sdk/testing`,
over `EarsAdmin.calls`). Per-stage work comes from `explain()`'s stages: a relation hop's `kept` is the edges it
yielded, a stage's `visited` what it took in. EXPLAIN's total `visited` counts only start and index visits, so it reads
`1` for a walk of any length. Times are medians of 15 runs inside the spec.

## Baseline

| Candidate | Crossings a run (×1 / ×2) | Work that grows | Median ms (×1 / ×2) | Re-runs from another thread's visit / its reply |
|---|---|---|---|---|
| A. `chat` view, `chatPage(thread, 50)` | 2 / 2 | the hop yields every message, 1,008 / 2,008, to answer 53 ids | 1.9 / 3.4 | 0 / 0 |
| B. `list` view, `threadQueries.listed()` | 100 / 200 | one parent read per thread; whole rows, 11 fields each | 1.4 / 2.4 | 0–1 / 1 |
| C. `messageSearch` view, `searchMessages('deploy')` | 31 / 31 | none: 20 hits, then 2 point reads for each hit that isn't a marker | 0.55 / 0.57 | 0 / 0 |
| D. notes `search` view, `noteQueries.search('note 1')` | 501 / 1,001 | two reads per note, on every keystroke | 4.9 / 10.3 | 0 / 0 |

Measured apart, at 1,000, 2,000 and 4,000 messages in one thread:

| Read | 1,000 | 2,000 | 4,000 |
|---|---|---|---|
| The hop, `.pick(['status'])` | 1.54 ms | 2.97 ms | 6.25 ms |
| The hop, `.ids()` | 0.89 ms | 1.80 ms | 3.96 ms |
| The hop, `.count()` | 0.79 ms | 1.62 ms | 3.38 ms |
| The hop, `.reverse().limit(54).pick(['status'])` | 0.87 ms | 1.74 ms | 3.65 ms |
| The hop, `.limit(54).pick(['status'])` | 0.32 ms | 0.58 ms | 1.11 ms |
| `chatPage(thread, 50)` | 1.52 ms | 3.05 ms | 6.36 ms |

The forward limit still grows with the thread because `relations::edges` collects a whole edge list before the hop
yields its first edge, and `reverse` collects everything before it.

C's answer is short: 15 results where 25 and 45 messages match, because the five markers are dropped in JS after
`limit(20)`.

## Admitted

**A. Opening a thread.**
- Plan: `query.ids(thread).out(contains, Message).pick(['status'])` over the whole list, then the page is sliced in JS.
- Costly operation: the hop collects the entity's whole edge list, so a thread of M messages costs O(M) on every open
  and on every re-run (each new message or status change) for a page of 50.
- No existing plan step bounds it. A forward `limit` still collects the list, and `reverse` collects its input.
- Fix in elmdb: a hop visits its edges as it reads them, stopping when its consumer stops; `reverse` right after a hop
  from one entity over one kind walks the edges backward, stopping the same way.
- Then apack reads the page from the end: `out(...).reverse().limit(k)`, with `k` grown until the window holds
  `limit + 1` messages that aren't queued, or the thread ends.
- Writes keep queued messages last. `addMessagesToThread` is the one writer that leaves one behind newer messages,
  so it moves them last once after its batch.
- Target: the page's hop yields at most `limit + 1 + queued` edges at both thread sizes, and the answer (ids, order,
  `hasMore`) is unchanged.

**B. The thread list.**
- Plan: `query(Thread).pickAll()`, then `in(parent_of, Thread)` once per thread.
- Costly operations: one crossing per thread, and whole rows, so a write to a field the list doesn't show re-runs it.
- Fix: pick the fields the list and board read, and read every parent edge in one `inEdges` over all thread ids.
- Target: 2 crossings at both sizes; no re-run on a write to a field the list doesn't read (the visit's
  `lastVisitedTimestamp`).

**D. Searching notes.**
- Plan: `summaries()` does two reads per note (parent, child count), then filters titles in JS.
- Costly operation: 2N + 1 crossings on every keystroke, to answer the notes whose title matches.
- Fix: filter titles on the picked rows first, then build summaries for the matches only, each parent and child count
  read in one edge read over the matched ids.
- Target: a constant number of crossings, independent of how many notes exist or match.

**C. Message search's short answer.** It is a defect rather than waste, fixed with B and D. The marker filter moves
into the plan, before `limit(20)`. The thread and topic of each hit are read in two reads over all hit ids, not two
for each hit. Target: 20 results whenever 20 non-marker messages match, in at most 3 crossings.

## Not admitted

- **The library's `findDocument` and `engineFolderContents`, and the notes `tree`.** They do reads per row of the
  same kind, but none is one of the three scenarios. Reopen on a library or notes-tree measurement of its own.
- **`addMessage`'s sibling scan.** It reads every message's status on each message it adds, to move queued ones last:
  O(M) on the write path. Reopen once the bounded backward walk lands, which it could use.

Stopping rule: these three and C's defect; anything else is new scope.
