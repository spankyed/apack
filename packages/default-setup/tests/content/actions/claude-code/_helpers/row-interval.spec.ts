// What a whole turn's row writes cost, rather than one writer's.
//
// **The bound that existed covered the cheaper half.** `thinking-writer.spec.ts` drives the thinking writer
// alone and holds it to a multiple of what the turn leaves behind — but a turn used to stop writing the row
// through that writer the moment a tool ran, and from then on the row was written by the tool-activity writer
// on a 250ms clock with the whole thinking block riding along in every write. The interval the thinking writer
// was given for exactly this reason did not apply where the cost was, so the figure that spec records was not
// what a turn cost.
//
// **Measured on this fixture: 170x before, 47.9x after** — 1,021,193 bytes written for 6,000 characters kept,
// against 287,176 for the same 6,000. What closed the gap is that a block is a row: `updateMessageState`
// replaced the whole `blocks` field, so one writer had to carry the other's block or delete it, and the
// accumulated thinking text reached storage once per tool event. What remains is one writer rewriting its own
// whole text on its durable interval, which is the same multiple the thinking writer alone has always had.
//
// **The text is no longer where a turn's cost is, and the figure above hid that.** It was measured against
// the thinking text alone, which is not what the turn keeps — the tool-activity block keeps its entries too
// — so it read the entries' writes as the text's amplification. Measured with both: 25x, of which the text
// is 12,518 bytes and the entries 231,404. The text alone is 2.06x on its own fixture (`thinking-writer`),
// down from 47x.
//
// So what remains is the same defect one level down: `entries` is a growing collection in one value, and a
// flush rewrites all of it. It is not the text's problem and a delta does not fit it — an entry is patched
// from `running` to `done`, not appended to — so the move that fits is the one that made a block a row.
// Until then this bound is 30x and the case below says where it goes.
//
// Driven on fake timers against a recording `services.chat`, as its sibling is: the subject is what reaches
// storage, so what is counted is the bytes of every `updateMessageState` a turn makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityId, Services } from '#generated/services.ts';
import { createThinkingWriter } from '../../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts';
import { createToolActivityWriter } from '../../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts';

const MESSAGE = 'message-one' as EntityId;

type Write = { block: string; bytes: number };

function recorder() {
  const writes: Write[] = [];
  const rows = new Map<string, string>();
  const services = {
    chat: {
      updateMessageState: () => {},
      // A block write costs its own row, and the row it wrote is what that block ends up keeping
      updateMessageBlock: (_id: unknown, block: { type: string; props: unknown }) => {
        const bytes = JSON.stringify(block);
        writes.push({ block: block.type, bytes: bytes.length });
        rows.set(block.type, bytes);
        return `row-${block.type}`;
      },
      // An append costs its own characters and nothing of what the block already held
      appendMessageBlockText: (blockId: string, at: number, text: string) => {
        writes.push({ block: blockId.replace('row-', ''), bytes: JSON.stringify({ at, text }).length });
      },
      removeMessageBlock: (_id: unknown, type: string) => { rows.delete(type); },
      streamMessageBlockText: () => {},
    },
  } as unknown as Services;

  const written = (block?: string) => writes
    .filter((write) => block === undefined || write.block === block)
    .reduce((total, write) => total + write.bytes, 0);
  /** What the turn leaves in the rows: every block's final write, which is what an amplification is over */
  const kept = () => [...rows.values()].reduce((total, row) => total + row.length, 0);

  return { services, written, kept };
}

/**
 * One turn, as `stream-consumer.ts` composes it: the model thinks, then tools run while the thinking block
 * rides along in the tool writer's every write.
 *
 * The parameters are the fixture and the figures below are quoted against them, as the sibling spec's are.
 */
async function turn(services: Services, { thinkingTicks = 120, growth = 50, tools = 60 } = {}) {
  const thinking = createThinkingWriter(services, MESSAGE);
  const toolActivity = createToolActivityWriter(services, MESSAGE, { intervalMs: 250 });

  for (let tick = 0; tick < thinkingTicks; tick++) {
    thinking.push('x'.repeat(growth));
    await vi.advanceTimersByTimeAsync(250);
  }

  for (let tool = 0; tool < tools; tool++) {
    toolActivity.append({ id: `tool-${tool}`, name: 'Read', state: 'running' } as never);
    await vi.advanceTimersByTimeAsync(1_000);
    toolActivity.update(`tool-${tool}`, { state: 'done' } as never);
    await vi.advanceTimersByTimeAsync(1_000);
  }
  toolActivity.finalise('done');
  thinking.finalise();

  return thinking.buildBlock()?.props.content.length ?? 0;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('what a turn writes to the row', () => {
  /**
   * The same bound the thinking writer is held to, asked of the turn instead of the writer — which is the
   * only way to ask it, since which writer owns the row changes partway through and the block the expensive
   * one carries is the other's.
   */
  it('writes a bounded multiple of what the turn leaves behind', async () => {
    const AMPLIFICATION = 30;
    const { services, written, kept } = recorder();

    await turn(services);

    expect(kept()).toBeGreaterThan(0);
    expect(written()).toBeLessThanOrEqual(kept() * AMPLIFICATION);
  });

  /**
   * **Which block the turn's cost is in**, which is the thing the single ratio above cannot say and the
   * reason it is still 30x.
   *
   * The thinking text is appended, so it costs about what it is. The tool-activity block's `entries` are
   * still one value rewritten whole on every flush, so that block costs a multiple that grows with the
   * number of tools — and on this fixture it is 95% of the turn. Asserted as a share rather than a figure,
   * since what matters is which of the two is the problem.
   */
  it('spends what it spends on the entries, not on the text', async () => {
    const { services, written } = recorder();

    await turn(services);

    // The text: appended from an offset, so a multiple of itself rather than of the turn's length
    expect(written('thinking')).toBeLessThan(written('tool-activity'));
    expect(written('tool-activity') / written()).toBeGreaterThan(0.9);
  });
});
