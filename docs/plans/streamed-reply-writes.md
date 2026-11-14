# Streamed reply writes

Status: active. Items 1 and 2 are in `master`; items 3 and 4 are decided or measured, not built.
Scope: how a streamed assistant reply reaches the message store while it arrives. The stream
writer is `packages/default-setup/src/content/actions/claude-code/_helpers/stream-writer.ts`, the
tool-activity writer is beside it, and the consumer that drives them is `stream-consumer.ts`.

## Where it stands (measured 2026-11-14)

A reply of about 400 words (2,400 characters) streamed over 10 seconds, with the writer as `chat.ts`
constructs it:

| Writer | Storage writes | Characters stored |
|---|---|---|
| Before text was appended (`d9102d235b^`, whole text at a 250 ms clock) | 41 | 49,360 |
| `master` (appends at 250 ms, one whole-text write at the end) | 40 (39 appends and 1 final) | 4,744 |

A fold runs once every 32 appended segments (`TEXT_SEGMENTS_BEFORE_COMPACTION`, in
`repository/index.ts`). It rewrites the message text and is not counted in the table, so a reply
of this length commits about 41 times. Measured with a fake-timer harness that records
`appendMessageText`, `updateMessageState` and the text it carries. The harness is in
`tests/content/actions/claude-code/_helpers/stream-writes-budget.spec.ts`. Scratch measurements
were not committed.

The 181 writes for the same length of reply in elmdb's evidence (`docs/evidence/next-phase-10.md`
in the elmdb checkout) predate commit `d9102d235b` and the 250 ms row clock. They are not the
current count, and that evidence should say so when elmdb next changes it.

## 1. Coalesce a streamed reply's writes — in master

**What it is.** The message's text is written at most once per row interval (`ROW_INTERVAL_MS`,
250 ms, `_helpers/row-interval.ts`), appended as segments, and whole once at the end. The end write
runs on stream end, on error and on shutdown, through the turn's `finally`
(`stream-consumer.ts`, `releaseWriters`), which finalises the writer idempotently.

**Why 250 ms.** It is the top of the 100 to 250 ms range. A window that opens mid-reply is shown
the row, which is at most 250 ms behind the feed. The feed itself goes to windows at 80 ms
(`intervalMs`), so the display is not paced by the writes.

**Done when.** A reply of 400 words writes the store at most 48 times and stores at most three
times its length. That is `stream-writes-budget.spec.ts`. The pre-append writer fails it on
characters stored (49,360 against a bound of 7,200), which is the regression it guards.

## 2. Stop rewriting the tool-activity block whole — in master

**What it is.** Each tool entry is written as it starts and as it ends, through
`updateMessageToolEntry`, not as the whole block (`tool-activity-writer.ts`).

**Evidence.** `row-interval.spec.ts` records a turn's amplification falling from 59.6x to 2.02x
when entries stopped being rewritten whole.

**Done when.** That spec holds the turn to its bound. It is already the case.

## 3. Whether streaming text is in the text index while it streams — decided: no

**Decision.** The text index reads `Message.text`. Streaming text sits in segments until a fold, and
a fold runs at 32 segments or at finalisation. So a search misses at most the last 31 segments, which
at 250 ms is about 7.75 seconds of a reply, and a reply's full text is indexed when it completes.

**Why not per write.** Indexing each append would tokenise the growing message once per commit, which
is the quadratic cost this list exists to remove. The 7.75 seconds is bounded and is the smaller cost.

**Revisit when** a reply is long enough that a fold rewrites tens of kilobytes at each interval. The
fold cost has not been measured on a long reply and is the next thing to measure (see Other findings).

## 4. Safe mode for apack's databases — measured reading, not built

**Finding.** `packages/apack-ears/src/lmdb/database.ts` opens databases with `syncs` only, which is
elmdb's group commit. It has no database-level `syncEachCommit`. The per-commit safe path is the
`durable` flag on a commit or write, which `packages/apack-ears/src/database.ts` already passes
through (`commit(options.durable)`). So apack can make any unit durable without an elmdb change.

**Reading.** At 40 commits a reply and elmdb's documented 8.0 ms per durable commit on an Apple M1 Pro
(`docs/architecture/engine.md`, of 2026-11-12, not re-measured here), a reply's safe-mode cost is
about 0.33 seconds, against about 1.4 seconds at 181 writes. Whether a streamed reply needs a
durable commit at all is a separate decision; the streamed text is already on the row's clock.

**Waiting.** The safe-mode measurement waits on the monorepo resolving an elmdb that has `syncEachCommit`; neither the pinned `4b67670` nor `c745183` has it, so nothing is measured here.

**Done when.** The durable commit cost is measured on this machine through `apack-ears`, and the
reading is recorded here with its date.

## Other findings

- **The fold rewrites the whole text every 32 segments.** A reply of 40 KB over a minute is about
  240 appends, so about seven folds, each rewriting up to 40 KB, and each re-tokenising the text. This
  is the remaining quadratic term. Measure it on a long reply before changing it. The candidate
  change is a larger fold threshold, or folding only at finalisation with the index reading segments.
- **The finalising write rewrites the whole text once.** It is one write of about the reply's length.
  Fine at this size; it becomes part of the fold question above for long replies.
- **`updateMessageState` carries `forkable` and `context.cliUuid`** from several sites in
  `stream-consumer.ts`. Each is one small write per message, not per chunk. Batching them is a
  cleanup with no measured cost, so it is not on this list.
- **The `text: ''` clear before a thinking block** (`stream-consumer.ts`, around line 254) is a whole
  field write, guarded to run only while the reply is empty. It is once per message.
- **An elmdb change would be needed for an append operation on strings** only if the text were kept
  in a single field and grown in place. It is not, so no elmdb change is needed for items 1 to 4.
