// What the tool-activity writer writes, which until now nothing asked.
//
// It had no spec at all while it was the most expensive writer in a turn: `row-interval.spec.ts` drove it
// only as the other half of a turn, and the bound there was measured against the thinking text, so this
// writer's own cost was never the subject of anything. An entry is now a row, which is what this holds it
// to — one entry's write costs that entry, and a block write carries no entries at all.
//
// Driven on fake timers against the shared recorder, as its siblings are: the subject is which call
// happens when.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityId } from '#generated/services.ts';
import { createToolActivityWriter } from '../../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts';
import { recordTurnWrites } from './_support/turn-writes.ts';

const MESSAGE = 'message-one' as EntityId;
const entry = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, tool: 'Read', summary: `${id}.ts`, status: 'running' as const, ...over });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('what the tool-activity writer writes', () => {
  /**
   * **A block write carries no entries**, which is the whole of why a tool event costs its own entry. The
   * entries live in rows and only a read assembles them; carrying them here too would store the list
   * twice and bring back the write this removed.
   */
  it('keeps the entries out of the block it writes', () => {
    const { services, writes } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    writer.append(entry('one'));
    writer.flush();

    const block = writes.map((write) => JSON.parse(write)).find((write) => write.type === 'tool-activity');
    expect(block).toBeDefined();
    expect(block.props).not.toHaveProperty('entries');
    // Nor the label, which is derived from the entries: the block that shows it computes it
    expect(block.props).not.toHaveProperty('label');
    expect(block.props.state).toBe('streaming');
  });

  /** An entry's own row is written when it arrives, and again when it is patched — never its neighbours' */
  it('writes the entry that changed and no other', () => {
    const { services, written } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    writer.append(entry('one'));
    writer.flush();
    const afterFirst = written();

    writer.append(entry('two'));
    writer.update('two', { status: 'ok', details: { output: 'x'.repeat(5_000) } });
    const grew = written() - afterFirst;

    // The second entry's own bytes, not the first one's carried along with them
    expect(grew).toBeGreaterThan(5_000);
    expect(grew).toBeLessThan(11_000);
  });

  /**
   * `details` merges field-wise, as the writer's own `update` does. The CLI records the input when a tool
   * starts and the output when it answers, so a patch that replaced `details` would drop the input.
   */
  it('keeps a detail recorded earlier when a later patch carries another', () => {
    const { services, writes } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    writer.append(entry('one', { details: { input: { file: 'a.ts' } } }));
    // The block's row has to exist before an entry can hang off it, so nothing is written until it does
    writer.flush();
    writer.update('one', { status: 'ok', details: { output: 'done' } });

    const last = JSON.parse(writes.at(-1)!);
    expect(last.details).toEqual({ input: { file: 'a.ts' }, output: 'done' });
  });

  /** The CLI re-emits a tool_use after a permission pause, and a re-emitted one is not a second entry */
  it('ignores an entry it already holds', () => {
    const { services } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    writer.append(entry('one'));
    writer.append(entry('one', { summary: 'again.ts' }));

    expect(writer.entries).toHaveLength(1);
    expect(writer.entries[0]!.summary).toBe('one.ts');
  });

  /**
   * An entry still `running` when the turn ends is stranded, and the group would otherwise show a spinner
   * for it for ever. `error` and `denied` are terminal and meaningful, so they are left alone.
   */
  it('settles a stranded entry and preserves the terminal ones', () => {
    const { services } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    writer.append(entry('running-one'));
    writer.append(entry('failed', { status: 'error' }));
    writer.append(entry('refused', { status: 'denied' }));
    writer.finalise('done');

    expect(writer.entries.map((held) => held.status)).toEqual(['ok', 'error', 'denied']);
  });

  /**
   * The bound, in the terms every turn writer is held in: what reached storage against what it keeps.
   *
   * The fixture's tools carry a 4KB `details.output`, which is what the product stores — only
   * `outputSummary` is capped. With the entries in one value this wrote 59.6x what it kept, because every
   * later flush carried every earlier output again.
   */
  it('writes a bounded multiple of what its entries keep', () => {
    const { services, written, kept } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    for (let tool = 0; tool < 40; tool++) {
      writer.append(entry(`tool-${tool}`));
      writer.flush();
      writer.update(`tool-${tool}`, { status: 'ok', details: { output: 'x'.repeat(4_000) } });
      writer.flush();
    }
    writer.finalise('done');

    expect(kept()).toBeGreaterThan(40 * 4_000);
    expect(written()).toBeLessThanOrEqual(kept() * 4);
  });

  /**
   * **The block's row is written when the block changes, not when a tool does.**
   *
   * This is what storing a derived label cost: `label` is `computeLabel(entries, state, phase)`, so every
   * tool event changed it and every event wrote this row — about 120 writes across a turn of 60 tools.
   * Nothing stores it now (the block that shows it derives it), and what is left on the row changes when
   * the turn does: the block appearing, and its state at the end.
   *
   * Asserted as a count rather than as bytes, because the bytes were never the expensive part of a write.
   */
  it('writes its block when the block changes, not when a tool does', () => {
    const { services, writes } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    for (let tool = 0; tool < 20; tool++) {
      writer.append(entry(`tool-${tool}`));
      writer.flush();
      writer.update(`tool-${tool}`, { status: 'ok' });
      writer.flush();
    }
    writer.finalise('done');

    const blockWrites = writes.filter((write) => JSON.parse(write).type === 'tool-activity');
    // It appears, it finishes, and its entries fold into it. Twenty tools in between cost it nothing —
    // the third write is the fold, which is the price of a finished block being one row
    expect(blockWrites).toHaveLength(3);
  });

  /** No tool ran, so this writer has no block and leaves none — and the thinking block is not its to touch */
  it('writes nothing when the turn ran no tools', () => {
    const { services, writes } = recordTurnWrites();
    const writer = createToolActivityWriter(services, MESSAGE, {});

    writer.flush();
    writer.finalise('done');

    expect(writer.hasEntries).toBe(false);
    expect(writes).toEqual([]);
  });
});
