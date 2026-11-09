// What a growing thinking block costs, and what it tells the windows.
//
// **The block's half of G1.** `updateMessageState` replaces the whole `blocks` field, so a thinking block
// that grew for three minutes was rewritten in full on every flush and what reached storage was a multiple
// of what the user was left with — the same defect as the text's, and the multiple grows with the turn. The
// text was fixed by a feed beside the row; these cases assert that the block now has one too: the row
// carries the block appearing and its final state, the feed carries the growth, and what reaches storage is
// a bounded multiple of what the turn leaves behind.
//
// Driven on fake timers against a recording `services.chat`, because the subject is which call happens when.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityId, Services } from '#generated/services.ts';
import { createThinkingWriter } from '../../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts';
import { ROW_INTERVAL_MS, THINKING_BLOCK } from '../../../../../src/content/actions/claude-code/_helpers/row-interval.ts';

type Feed = { block: string; at: number; text: string; done?: true };

function recorder() {
  const writes: string[] = [];
  /** What the row holds after each write, the store's text assembled the way a read assembles it */
  const rows: string[] = [];
  let row = '';
  const feed: Feed[] = [];
  const services = {
    chat: {
      updateMessageBlock: (_id: unknown, block: { props: { content?: string } }) => {
        writes.push(JSON.stringify(block));
        row = block.props.content ?? '';
        rows.push(row);
        return 'block-one';
      },
      // An append costs its own characters and splices onto what the row holds, as the repository does
      appendMessageBlockText: (_id: unknown, at: number, text: string) => {
        writes.push(JSON.stringify({ at, text }));
        row = row.slice(0, at) + text;
        rows.push(row);
      },
      removeMessageBlock: () => {},
      streamMessageBlockText: (params: Feed & { messageId: unknown }) => {
        feed.push({ block: params.block, at: params.at, text: params.text, ...(params.done ? { done: true as const } : {}) });
      },
    },
  } as unknown as Services;
  return { services, writes, rows, feed };
}

const writerOn = (services: Services) => createThinkingWriter(services, 'message-one' as EntityId);

/** The text a window ends up with: the row it last read, with every delta spliced onto it in turn. */
const windowText = (row: string, feed: Feed[]) =>
  feed.filter(one => !one.done).reduce((text, one) => text.slice(0, one.at) + one.text, row);

/**
 * What the row held after the nth write.
 *
 * A write is no longer always the whole block: growth is appended from an offset, so what the row holds is
 * assembled rather than read off one write. The recorder keeps that, as the repository does.
 */
const contentOf = (rows: string[], nth: number) => rows[nth] as string;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('what a growing thinking block costs', () => {
  /**
   * **The block appearing is written at once.** It is the discrete change the user is waiting for, and a run
   * cannot splice onto a block the row has not got — a window matches a run to a block by type and ignores
   * one it cannot see. So the first content is a row write and everything after it is growth.
   */
  it('writes the block as soon as there is one, and feeds what follows', () => {
    const { services, writes, feed } = recorder();
    const writer = writerOn(services);

    writer.push('Thinking');
    expect(writes).toHaveLength(1);
    expect(feed).toHaveLength(0);

    writer.push(' about it');
    expect(writes).toHaveLength(1);
    expect(feed).toEqual([{ block: THINKING_BLOCK, at: 8, text: ' about it' }]);
  });

  /**
   * **The row and the feed are one account between them**, which is the whole contract: the row carries the
   * block up to its first write and the feed continues contiguously from exactly there. A gap or an overlap
   * between the two is text the user never sees or sees twice, and neither channel can detect it alone.
   */
  it('continues the feed from exactly where the row left off', () => {
    const { services, rows, feed } = recorder();
    const writer = writerOn(services);

    writer.push('one ');
    writer.push('two ');
    writer.push('three');

    const row = contentOf(rows, 0);
    expect(row).toBe('one ');
    expect(feed[0].at).toBe(row.length);
    expect(windowText(row, feed)).toBe('one two three');
  });

  /** The row still collects it, on the durable clock, so a crash loses seconds of a turn rather than all. */
  it('writes the row on the durable interval while it grows', async () => {
    const { services, writes, rows } = recorder();
    const writer = writerOn(services);

    writer.push('Thinking');
    expect(writes).toHaveLength(1);
    writer.push(' more');
    expect(writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(ROW_INTERVAL_MS);
    expect(writes).toHaveLength(2);
    // An append, not a rewrite: the row holds the growth and the write carried only the new characters
    expect(contentOf(rows, 1)).toBe('Thinking more');
    expect(writes[1]).toBe(JSON.stringify({ at: 8, text: ' more' }));
  });

  /**
   * **The row is written before the run is dropped.** A window drops its run on `done` and falls back to
   * the row, so the row has to be the finished one by then — the text feed's contract, for the same reason.
   * The label and the state change here too, and only the row can carry a change.
   */
  it('writes the finished row before dropping the run', () => {
    const { services, writes, feed } = recorder();
    const writer = writerOn(services);

    writer.push('Thinking');
    writer.push(' about it');
    writer.finalise();

    expect(writes.at(-1)).toContain('Thought for');
    expect(feed.at(-1)).toEqual({ block: THINKING_BLOCK, at: 0, text: '', done: true });
  });

  /**
   * **The bound this split exists for**, stated as the thing the defect was about rather than as a number
   * of writes: a flush carries the whole block, so what reaches storage is a multiple of what the user is
   * left with, and the multiple used to grow with the turn.
   *
   * A bound derived from `ROW_INTERVAL_MS` could not catch the interval being lowered again, since it would
   * scale by the same factor as the writes — so this one is absolute and holds whatever the clock is set to.
   *
   * **Measured on this fixture**: 36KB of thinking over three minutes writes 74KB, which is 2.06x. It wrote
   * 1.68MB — 47x — while a flush carried the whole block, and 13MB on a quarter-second row, so the durable
   * interval was worth 7.7x of that. What removed the rest is the text being appended from an offset rather
   * than rewritten, so the interval now decides how often the turn commits and not how much of it is
   * written again. What is left is the text once, plus one whole-text write per compaction
   * (`TEXT_SEGMENTS_BEFORE_COMPACTION`), which is what the bound is over.
   */
  it('writes a bounded multiple of what the turn leaves behind', async () => {
    const AMPLIFICATION = 4;
    const { services, writes } = recorder();
    const writer = writerOn(services);
    const ticks = 720, growth = 50;

    for (let tick = 0; tick < ticks; tick++) {
      writer.push('x'.repeat(growth));
      await vi.advanceTimersByTimeAsync(250);
    }
    writer.finalise();

    const written = writes.reduce((total, write) => total + write.length, 0);
    const kept = writer.buildBlock()?.props.content.length ?? 0;
    expect(kept).toBe(ticks * growth);
    expect(written).toBeLessThanOrEqual(kept * AMPLIFICATION);
  });
});
