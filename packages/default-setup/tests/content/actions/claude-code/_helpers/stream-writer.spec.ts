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
  const services = {
    chat: {
      updateMessageState: (id: unknown, updates: Write) => {
        writes.push({ ...updates });
        (shared.services as unknown as { chat: { updateMessageState(id: unknown, u: Write): void } }).chat.updateMessageState(id, updates);
      },
      streamMessageText: (params: { messageId: unknown; at: number; text: string; done?: true }) => {
        feed.push({ at: params.at, text: params.text, ...(params.done ? { done: true as const } : {}) });
      },
    },
  };
  return { writes, feed, written: shared.written, kept: shared.kept, services: services as never };
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
    expect(written()).toBeLessThanOrEqual(kept() * 8);
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
