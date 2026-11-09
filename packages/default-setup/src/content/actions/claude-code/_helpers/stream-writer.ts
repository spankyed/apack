/**
 * Writer for streaming text into an existing chat message: a feed to the windows, the row on a slower clock.
 *
 * Claude Code's stream-json protocol emits Anthropic text deltas a few characters at a time. Pushing every
 * delta at the window would drown the bus; pushing too rarely makes the UI janky. So the characters go out
 * every `intervalMs`, and what goes out is the **delta** (`chat.streamMessageText`) rather than the message.
 *
 * **The row is written on `durableMs` and at the end** (G1). Writing it every 80 ms was the whole cost of a
 * streamed reply: `updateMessageState` writes the message, so the bytes are `flushes x final size / 2` —
 * 15 MB for a 40 KB reply over a minute, measured, and quadratic in the reply's length. On a 2 s clock the
 * same reply costs ~0.6 MB, and the row still exists while the reply is arriving, so a crash loses seconds
 * of it rather than all of it. That durability is the reason this is not simply one write at the end, and
 * it is also what lets a window that opened mid-stream catch up: it has no run to splice, so it shows the
 * row until the next durable write.
 *
 *  - `push(text)` appends to an in-memory buffer; the feed goes out no sooner than `intervalMs` from the
 *    last one, and the row no sooner than `durableMs`.
 *  - `flush()` sends the pending characters immediately (used after a tool_use note).
 *  - `finalize(text?)` writes the row with optional replacement text and a `responseTimestamp` so the UI
 *    marks the message complete, then sends the last feed event with `done`. That order matters: the window
 *    drops its run on `done`, and the row it falls back to has to be the finished one by then.
 *
 * The writer owns no external state — one instance per streaming message.
 */

import type { Services, EntityId } from '#generated/services.ts';

export interface StreamWriterOptions {
  /**
   * How often the feed reaches the windows — a **frame rate**, and the one clock in this flow that should
   * stay one.
   *
   * Everything else here waits on work rather than on time, and a reviewer coming from that rule will want
   * to convert this too. It should not be: the consumer is a human reading text, and a display has a
   * refresh rate. Twelve updates a second is already past what anyone can tell apart from continuous, so
   * sending faster buys nothing and costs a broadcast through the bus, the subscription and every open
   * window per token. There is also nothing here to wait on — a feed is fire-and-forget, with no
   * acknowledgement a sender could use as backpressure.
   *
   * The first delta is not delayed: nothing has been sent, so the first `push` flushes at once and only a
   * second one inside the frame waits.
   */
  intervalMs?: number;
  /**
   * How often the row is committed.
   *
   * This is not a frame rate: it is how much a crash loses and how stale the row is for a window that
   * joined mid-turn. **Unlike the block writers', this one still rewrites the whole field** — a message's
   * `text` is one attribute, so a commit costs the reply so far and the cost grows with the turn, which is
   * why this is seconds where the blocks' is a quarter of one (`ROW_INTERVAL_MS`). Appending it the way a
   * block's text is appended is what would let these two converge.
   */
  durableMs?: number;
}

export interface StreamWriter {
  /** Append `text` to the running buffer and schedule a throttled flush. */
  push(text: string): void;
  /** Append `text` to the running buffer and flush immediately. */
  pushImmediate(text: string): void;
  /** Force-flush any pending buffered text. */
  flush(): void;
  /** Final flush with optional replacement text + responseTimestamp. */
  finalize(text?: string): void;
  /** Current accumulated text (useful for returning from an action). */
  readonly text: string;
}

export function createStreamWriter(
  services: Services,
  messageId: EntityId,
  opts: StreamWriterOptions = {},
): StreamWriter {
  const intervalMs = opts.intervalMs ?? 80;
  const durableMs = opts.durableMs ?? 2000;
  let buffer = '';
  /** How much of `buffer` the windows have been sent. The feed's offsets are contiguous from 0 */
  let fedUpTo = 0;
  let lastFeedAt = 0;
  let lastWriteAt = 0;
  let feedTimer: ReturnType<typeof setTimeout> | null = null;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const clear = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };

  /** Sends whatever the windows have not been sent. Nothing pending is no event: a feed carries characters */
  const feedNow = () => {
    feedTimer = clear(feedTimer);
    lastFeedAt = Date.now();
    if (fedUpTo >= buffer.length) return;
    const at = fedUpTo;
    const text = buffer.slice(at);
    fedUpTo = buffer.length;
    services.chat.streamMessageText({ messageId, at, text });
  };

  /** Writes the row. Durability only — no window waits for this, which is what makes its clock slow */
  const writeNow = () => {
    writeTimer = clear(writeTimer);
    lastWriteAt = Date.now();
    services.chat.updateMessageState(messageId, { text: buffer });
  };

  const after = (since: number, every: number) => Math.max(0, every - (Date.now() - since));

  const schedule = () => {
    if (!feedTimer) feedTimer = setTimeout(feedNow, after(lastFeedAt, intervalMs));
    if (!writeTimer) writeTimer = setTimeout(writeNow, after(lastWriteAt, durableMs));
  };

  return {
    get text() { return buffer; },
    push(text: string): void {
      if (!text) return;
      buffer += text;
      schedule();
    },
    pushImmediate(text: string): void {
      if (!text) return;
      buffer += text;
      feedNow();
      schedule();
    },
    flush(): void {
      feedNow();
      schedule();
    },
    finalize(text?: string): void {
      feedTimer = clear(feedTimer);
      writeTimer = clear(writeTimer);
      // Replacement text can be shorter than what the windows hold, so the run they are splicing is no
      // longer a run of this message. The row is the answer, and `done` is what tells them to read it.
      const replaced = text !== undefined && text !== buffer;
      if (text !== undefined) buffer = text;
      services.chat.updateMessageState(messageId, {
        text: buffer,
        responseTimestamp: Date.now(),
      });
      lastWriteAt = Date.now();
      // The row is written first, because `done` is what makes a window fall back to it
      const at = replaced ? buffer.length : fedUpTo;
      const tail = replaced ? '' : buffer.slice(at);
      fedUpTo = buffer.length;
      services.chat.streamMessageText({ messageId, at, text: tail, done: true });
    },
  };
}
