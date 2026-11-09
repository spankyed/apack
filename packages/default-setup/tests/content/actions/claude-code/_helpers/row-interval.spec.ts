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
// **Both halves are now rows, and the denominator is what the turn keeps.** An earlier version of this case
// measured both writers' bytes against the thinking text alone, which is not what the turn keeps — the
// tool-activity block keeps its entries too — so it read that block's writes as the text's amplification.
// The 170x and 47.9x in this branch's first two commits are that mistake.
//
// **Measured with this fixture, whose tools carry a 4KB `details.output` because that is what the product
// stores: 15,111,163 bytes written for 253,451 kept, which is 59.6x. Now 515,176 for 254,973, or 2.02x.**
// Both figures are the same fixture and the same denominator; the 30x between them is the entries ceasing
// to be one value rewritten whole on every flush.
//
// Of what is left, about half is the fold at the end: a finished block carries its children's content in
// its own row, so that content is written once more when the turn stops. That is the trade — one write
// against every later read of the message assembling forty rows, and against the thread keeping them.
//
// A turn now writes about what it keeps, so the bound is the thinking writer's 4x rather than a number
// standing in for a known defect. The case below keeps saying *which* block the cost is in, because that
// is what a single ratio cannot say and what let the first figure mislead.
//
// Driven on fake timers against a recording `services.chat`, as its sibling is: the subject is what reaches
// storage, so what is counted is the bytes of every `updateMessageState` a turn makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityId, Services } from '#generated/services.ts';
import { createThinkingWriter } from '../../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts';
import { createToolActivityWriter } from '../../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts';
import { recordTurnWrites } from './_support/turn-writes.ts';

const MESSAGE = 'message-one' as EntityId;

/**
 * One turn, as `stream-consumer.ts` composes it: the model thinks, then tools run while the thinking block
 * rides along in the tool writer's every write.
 *
 * The parameters are the fixture and the figures below are quoted against them, as the sibling spec's are.
 */
async function turn(services: Services, { thinkingTicks = 120, growth = 50, tools = 60, output = 4_000 } = {}) {
  const thinking = createThinkingWriter(services, MESSAGE);
  const toolActivity = createToolActivityWriter(services, MESSAGE, {});

  for (let tick = 0; tick < thinkingTicks; tick++) {
    thinking.push('x'.repeat(growth));
    await vi.advanceTimersByTimeAsync(250);
  }

  for (let tool = 0; tool < tools; tool++) {
    toolActivity.append({ id: `tool-${tool}`, tool: 'Read', summary: `file-${tool}.ts`, status: 'running' });
    await vi.advanceTimersByTimeAsync(1_000);
    // `details.output` is the untruncated tool result, which is what the product stores: only
    // `outputSummary` is capped. A read of a file is the common case and the expensive one
    toolActivity.update(`tool-${tool}`, {
      status: 'ok',
      outputSummary: `${output} bytes`,
      details: { output: 'x'.repeat(output) },
    });
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
    const AMPLIFICATION = 4;
    const { services, written, kept } = recordTurnWrites();

    await turn(services);

    expect(kept()).toBeGreaterThan(0);
    expect(written()).toBeLessThanOrEqual(kept() * AMPLIFICATION);
  });

  /**
   * **Neither block pays for the other's growth**, which is the thing the single ratio above cannot say.
   *
   * Each block's writes are held against what that block keeps, so a block that starts rewriting a growing
   * value fails here however small the turn's total happens to be. Asserted per block for that reason: when
   * the entries were one value, the turn's ratio was 95% that block and the text's own figure looked fine.
   */
  it('holds each block to what that block keeps', async () => {
    const { services, written, kept } = recordTurnWrites();

    await turn(services);

    expect(written('thinking')).toBeLessThanOrEqual(kept() * 4);
    expect(written('tool-activity')).toBeLessThanOrEqual(kept() * 4);
  });
});
