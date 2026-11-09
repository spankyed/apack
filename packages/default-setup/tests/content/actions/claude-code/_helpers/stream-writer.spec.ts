// What a streamed reply costs, and what it tells the windows.
//
// **G1**: a streamed reply reached the window by writing the whole accumulated message to EARS every 80 ms,
// which is `flushes x final size / 2` bytes — 15 MB for a 40 KB reply over a minute, measured, and quadratic
// in the reply's length. The characters now travel as a feed and the row is written on a slower clock, so
// what these cases assert is both halves: the feed is a complete, contiguous account of the text, and the row
// is written on `durableMs` rather than on the feed's clock.
//
// Driven on fake timers against a recording `services.chat`, because the subject is which call happens when.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamWriter } from '../../../../../src/content/actions/claude-code/_helpers/stream-writer.ts';
import { recordTurnWrites } from './_support/turn-writes.ts';

type Write = { text: string; responseTimestamp?: number };
type Feed = { at: number; text: string; done?: true };

/**
 * The shared recorder, with this writer's feed beside it.
 *
 * What a writer costs is one concept (`_support/turn-writes.ts`), and it was three phrasings — this spec's
 * `reply * 8`, and two others' own. The text feed stays local because it is this writer's alone.
 */
function recorder() {
  const writes: Write[] = [];
  const feed: Feed[] = [];
  const shared = recordTurnWrites();
  const chat = (shared.services as unknown as { chat: Record<string, (...args: never[]) => unknown> }).chat;
  const services = {
    chat: {
      ...chat,
      // Kept beside the shared recorder's accounting, because these cases read the whole-field writes
      updateMessageState: (id: unknown, updates: Write) => {
        if (updates.text !== undefined) writes.push({ ...updates });
        (chat.updateMessageState as unknown as (i: unknown, u: Write) => void)(id, updates);
      },
      streamMessageText: (params: { messageId: unknown; at: number; text: string; done?: true }) => {
        feed.push({ at: params.at, text: params.text, ...(params.done ? { done: true as const } : {}) });
      },
    },
  };
  return { writes, feed, written: shared.written, kept: shared.kept, messageText: shared.messageText, services: services as never };
}

/** The bytes a run of writes asks the engine to store, which is the figure G1 was priced in */
const writtenBytes = (writes: Write[]) => writes.reduce((total, one) => total + one.text.length, 0);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('what a streamed reply writes', () => {
  it('writes the row on its own clock, not on the feed s', () => {
    const { writes, feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    // One second of a reply at the chunk rate the pricing used
    for (let i = 0; i < 12; i += 1) {
      writer.push('x'.repeat(108));
      vi.advanceTimersByTime(80);
    }

    expect(feed.length, 'the window hears every 80ms').toBeGreaterThanOrEqual(10);
    expect(writes.length, 'the row is not written on the feed s clock').toBeLessThanOrEqual(1);
  });

  /**
   * The headline. The old writer's cost model is `flushes x final size / 2`, so a run this size wrote far
   * more than the reply itself; the feed's job is that the row is written a few times rather than per flush.
   */
  it('costs the engine a few multiples of the reply rather than a multiple of its length', () => {
    const { writes, services, written, kept } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });
    const chunk = 'y'.repeat(108);

    // 120 chunks at 80ms is the pricing's largest trial: 12,960 characters over 9.6s
    for (let i = 0; i < 120; i += 1) {
      writer.push(chunk);
      vi.advanceTimersByTime(80);
    }
    writer.finalize();
    const reply = writer.text.length;

    // The old model over the same run: 120 flushes x 12,960/2 = 777,600 bytes
    expect(writtenBytes(writes), 'the row is still being written').toBeGreaterThan(0);
    // The shared bound, in the terms every writer is held in: what reached storage against what it keeps
    expect(written()).toBeLessThanOrEqual(kept() * 4);
    expect(writtenBytes(writes)).toBeLessThan(reply * 8);
    expect(writes.length, 'one write per durable tick plus the final one').toBeLessThanOrEqual(8);
  });

  it('feeds a complete, contiguous account of the text, so a window can splice it', () => {
    const { feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });
    const chunks = ['Hello', ', ', 'world', '! how', ' are you'];

    for (const chunk of chunks) {
      writer.push(chunk);
      vi.advanceTimersByTime(80);
    }
    writer.finalize();

    let rebuilt = '';
    for (const one of feed) {
      expect(one.at, 'a gap or an overlap in the feed').toBe(rebuilt.length);
      rebuilt += one.text;
    }
    expect(rebuilt).toBe(chunks.join(''));
    expect(feed.at(-1)?.done, 'the last event is what drops the window s run').toBe(true);
  });

  it('writes the row before it says the stream is done', () => {
    const order: string[] = [];
    const services = {
      chat: {
        updateMessageState: (_id: unknown, updates: { responseTimestamp?: number }) =>
          order.push(updates.responseTimestamp ? 'final write' : 'write'),
        appendMessageText: () => order.push('append'),
        streamMessageText: (params: { done?: true }) => order.push(params.done ? 'done' : 'feed'),
      },
    } as never;
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.push('some text');
    writer.finalize();

    // The window falls back to the row on `done`, so a `done` that arrived first would show the text before it
    expect(order.slice(-2)).toEqual(['final write', 'done']);
  });

  it('feeds no event when nothing new has arrived', () => {
    const { feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.push('a');
    writer.flush();
    writer.flush();
    writer.flush();

    expect(feed.map(one => one.text), 'a feed carries characters, so an empty one is no event').toEqual(['a']);
  });

  /**
   * `finalize(text)` replaces the buffer — a summary standing in for the stream — so the run the windows hold
   * is no longer a run of this message. The row is the answer, and `done` is what sends them to it.
   */
  it('abandons the run when the final text replaces what was streamed', () => {
    const { writes, feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.push('a long partial answer that is about to be replaced');
    writer.flush();
    writer.finalize('the short final answer');

    expect(writes.at(-1)?.text).toBe('the short final answer');
    expect(feed.at(-1)).toEqual({ at: 'the short final answer'.length, text: '', done: true });
  });
});

describe('the last word is said once', () => {
  /**
   * **A turn's owner finalises as a backstop, so a second call must do nothing.**
   *
   * Every exit from the stream consumer now passes through one `finally` that releases the turn's
   * writers. A path that finalised with text of its own — a warning replacing the reply, a paused turn's
   * partial — is followed by that backstop, and before this guard the row was written twice and `done`
   * emitted twice. `thinking-writer.finalise` and the codex consumer's wrapper already guarded; this one
   * did not.
   */
  it('writes the row once when finalised twice', () => {
    const { writes, feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.push('the answer');
    writer.finalize('a warning instead');
    const afterFirst = writes.length;
    const doneCount = feed.filter(one => one.done).length;

    writer.finalize();

    expect(writes).toHaveLength(afterFirst);
    expect(feed.filter(one => one.done)).toHaveLength(doneCount);
    expect(writer.text).toBe('a warning instead');
  });

  /**
   * And the backstop still disarms an armed timer, which is the other half of what it is for: nothing
   * disposed a writer, so a turn that ended without finalising left a timer that wrote the row up to a
   * durable interval later — onto a message something else had already marked complete.
   */
  it('disarms a pending write even when it has already finalised', () => {
    const { writes, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.finalize('done early');
    const after = writes.length;

    // A push after finalising arms the durable timer again; the backstop's clear is what stops it landing
    writer.push('late');
    writer.finalize();
    vi.advanceTimersByTime(5000);

    expect(writes).toHaveLength(after);
  });

  /**
   * **A backstop finalising an empty buffer must not claim the row.** A tool-only turn, a superseded
   * consumer and a paused turn each leave this writer with nothing and mark the message complete
   * themselves, deliberately leaving `text` as it stands rather than blanking the `Thinking…` placeholder.
   * The `finally` that releases a turn's writers finalises all three regardless, so an empty buffer that
   * wrote `text: ''` would undo exactly what those three paths took care to do.
   *
   * Nothing was fed either, so there is no run in any window to end and no `done` to send.
   *
   * An explicit `''` is a different statement — a caller saying the reply is empty — and is written.
   */
  it('leaves the row alone when it finalises with nothing to say', () => {
    const { writes, feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.finalize();

    expect(writes, 'the row is not this writer\'s to decide').toHaveLength(0);
    expect(feed, 'and no window holds a run of this message').toHaveLength(0);
  });

  it('writes an empty reply when it is told to say one', () => {
    const { writes, feed, services } = recorder();
    const writer = createStreamWriter(services, 'm-1' as never, { intervalMs: 80, durableMs: 2000 });

    writer.finalize('');

    expect(writes).toEqual([expect.objectContaining({ text: '' })]);
    expect(feed.at(-1)?.done, 'and ends whatever run a window holds').toBe(true);
  });
});
