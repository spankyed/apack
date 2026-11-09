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
// So this holds a turn to the bound a single writer was held to, which is the claim worth gating. Taking it
// below that means storing the block's text as a delta rather than whole, as the feed already sends it.
//
// Driven on fake timers against a recording `services.chat`, as its sibling is: the subject is what reaches
// storage, so what is counted is the bytes of every `updateMessageState` a turn makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityId, Services } from '#generated/services.ts';
import { createThinkingWriter } from '../../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts';
import { createToolActivityWriter } from '../../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts';

const MESSAGE = 'message-one' as EntityId;

function recorder() {
  const writes: string[] = [];
  const services = {
    chat: {
      updateMessageState: (_id: unknown, updates: unknown) => { writes.push(JSON.stringify(updates)); },
      // What a block write costs is its own row, which is what is counted
      updateMessageBlock: (_id: unknown, block: unknown) => { writes.push(JSON.stringify(block)); return 'block-one'; },
      removeMessageBlock: () => {},
      streamMessageBlockText: () => {},
    },
  } as unknown as Services;
  return { services, writes };
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
    const AMPLIFICATION = 60;
    const { services, writes } = recorder();

    const kept = await turn(services);

    const written = writes.reduce((total, write) => total + write.length, 0);
    expect(kept).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(kept * AMPLIFICATION);
  });
});
