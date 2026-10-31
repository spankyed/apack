# EARS query efficiency: readings

The evidence for [EARS query efficiency](../../archive/plans/ears-query-efficiency.md) and elmdb's companion
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

## Results

The same spec and fixture, after the fixes (`93d6daf6b7`, `89728905f0`) and against elmdb's `session/bounded-walk`
(its PR #16), load 12 to 14:

| Candidate | Crossings a run (×1 / ×2) | Work that grows | Median ms (×1 / ×2) |
|---|---|---|---|
| A. `chatPage(thread, 50)` | 2 / 2 | none: the hop yields the window, 54 edges, at either size | 1.9 → 0.20 / 3.4 → 0.18 |
| B. `listed()` | 100 → 2 / 200 → 2 | none in crossings; still whole rows | 1.4 → 0.70 / 2.4 → 1.28 |
| C. `searchMessages('deploy')` | 31 → 4 / 31 → 4 | none | 0.55 → 0.73 / 0.57 → 0.97 |
| D. notes `search('note 1')` | 501 → 3 / 1,001 → 3 | none in crossings | 4.9 → 1.9 / 10.3 → 3.4 |

At 4,000 messages the chat page is 6.36 → 0.17 ms.

Each disposition against its target:

- **A, kept.** The page's work no longer depends on thread length. An earlier message's status change no longer runs
  the page again, since the page reads none of it. Answers are unchanged: the threads specs, an empty thread, a short
  one, and a queued message after a bulk add longer than the window.
- **B, kept.** Crossings met their target. The re-runs on a field the list doesn't show turned out not to exist: the
  surface merges the list's rows into its thread map, the sidebar sorts every thread in it by `lastVisitedTimestamp`
  and `lastMessageTimestamp`, and the board shows `updatedAt`, which every attribute write stamps. A visit or a new
  message changes what the window shows, so the list running again is right.
- **C, kept, its target missed by one crossing.** It answers 20 whenever 20 non-marker messages match, where it
  answered 15. When the first 20 matches hold markers, it asks again with a doubled limit: 4 crossings, not 3, and the
  bigger search costs about 0.2 to 0.4 ms.
- **D, kept.** Three crossings at any size. The tree and the trash summarise through the same reads, so they take 3
  crossings too, where they took 2N + 1.

Guards (`query-work.spec.ts`), each shown failing with its fix reverted (the file put back by its hash):
- the chat page reading every message: the first message's change was a commit the page skipped;
- the list's parent per thread: 41 and 81 crossings;
- search cut before its markers: 15 results;
- notes summarised one at a time: 121 and 241 crossings;
- the bulk add leaving its queued message behind: the page of two missed it.

`npm run spec` passed 974 tests.

## Follow-ups, done the same day

- **`addMessage`'s sibling scan.** It read every message's status on each message added, to move queued ones last.
  Message `status` is indexed now (`apack.json`), so the thread's queued messages are found from the index, and the
  thread is read back from its last message only as far as the earliest of them; a thread with none queued reads no
  message. `query-work.spec.ts` holds the order: after each add and a marker, a thread's queued messages last in
  their order, one left far back found, another thread's untouched.
- **The library's `findDocument` and `engineFolderContents`.** `findDocument` walked every collection's documents to
  find the one holding it; it reads its collection by the edge in. A folder's contents read each child folder's
  children in two reads per folder, and the root read every document whole to find those in no folder; both read in
  one read per relation kind now, and the root reads whole only the documents it lists. A randomized differential
  check, the old code against the new over eight trees with folders and documents trashed and deleted, answered the
  same for every folder's contents and every document. Reads on one of them: the root's contents 87 → 7, a document
  20 → 2.

Stopping rule: these three, C's defect and the follow-ups above; anything else is new scope.
