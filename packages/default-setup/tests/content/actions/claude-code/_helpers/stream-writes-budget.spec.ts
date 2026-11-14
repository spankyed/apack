// What a 400-word streamed reply costs the store, in the configuration the app runs.
//
// The sibling specs pin the writer's clocks with chosen intervals. This one takes the writer as `chat.ts`
// constructs it — `createStreamWriter(services, id)`, with the default `durableMs` — and streams a reply of
// about 400 words at a typical model pace, so the figure is the one a user's reply costs.
//
// **Measured when this was written (2026-11-14): 40 storage writes and 4,744 characters stored for 2,400
// characters streamed over 10 s.** The writes are 39 appends on the row's 250 ms clock plus one whole-text
// write at the end. The writer before text was appended (`d9102d235b^`) made 41 whole-text writes for the
// same reply and stored 49,360 characters, twenty times the text. The reply's first version wrote on an
// 80 ms clock and was far higher again.
//
// The bounds, and why they are these:
//  - **Writes at most 48.** Ten seconds at the 250 ms clock is 40 durable writes, the final write is one,
//    and the rest is the timer's edge. A return to a per-flush write at the feed's clock is over 100 here.
//  - **Characters stored at most three times the reply.** The appends store the text once and the final
//    write stores it once more, so the honest figure is about twice the reply. Three leaves room for the
//    final write's replacement; the whole-text rewrite that this guards against is 20 times.
//
// The reply is fixed at 400 words, about 2,400 characters, which is the case the 181 writes in elmdb's
// evidence were counted on. Driven on fake timers against a recording `services.chat`, because the subject
// is which write happens when.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamWriter } from '../../../../../src/content/actions/claude-code/_helpers/stream-writer.ts';

const REPLY_CHARS = 2_400;
const STREAM_MS = 10_000;
const CHUNK = 4;

const MAX_STORAGE_WRITES = 48;
const MAX_CHARS_STORED = REPLY_CHARS * 3;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a 400-word streamed reply, in the configuration the app runs', () => {
  it('writes the store a bounded number of times, storing about the reply once more', () => {
    let storageWrites = 0;
    let charsStored = 0;
    const services = {
      chat: {
        appendMessageText: (_id: unknown, _at: number, text: string) => {
          storageWrites += 1;
          charsStored += text.length;
        },
        updateMessageState: (_id: unknown, updates: { text?: string }) => {
          if (updates.text === undefined) return;
          storageWrites += 1;
          charsStored += updates.text.length;
        },
        streamMessageText: () => {},
      },
    };

    const writer = createStreamWriter(services as never, 'm-1' as never);
    const chunks = REPLY_CHARS / CHUNK;
    const gap = STREAM_MS / chunks;
    for (let i = 0; i < chunks; i += 1) {
      writer.push('a'.repeat(CHUNK));
      vi.advanceTimersByTime(gap);
    }
    writer.finalize();
    vi.advanceTimersByTime(STREAM_MS);

    expect(writer.text.length).toBe(REPLY_CHARS);
    expect(storageWrites, 'storage writes for one reply').toBeLessThanOrEqual(MAX_STORAGE_WRITES);
    expect(charsStored, 'characters stored for one reply').toBeLessThanOrEqual(MAX_CHARS_STORED);
  });
});
