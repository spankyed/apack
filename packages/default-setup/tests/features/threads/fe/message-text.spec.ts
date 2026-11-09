// How a window shows a message that two channels describe (G1).
//
// A streamed reply arrives as a feed of characters while the message's own view delivers the row on a slower
// clock, so the window holds a run and the row and has to give one answer. The rule is `messageStreamText`:
// **the row wins up to the run's offset and the run continues from there.** Every case below is a state the
// two channels can actually be in, and the last two are the ones a simpler rule gets wrong — a window that
// joined mid-stream, and a run the row has already overtaken.
import { describe, expect, it } from 'vitest';
import { blockRunCaughtUp, messageStreamBlocks, messageStreamText } from '#features/threads/fe/message-text.ts';

describe('what a window shows while a reply is streaming', () => {
  it('shows the row when no reply is streaming into it', () => {
    expect(messageStreamText('the whole answer', undefined)).toBe('the whole answer');
    expect(messageStreamText(undefined, undefined)).toBeUndefined();
  });

  it('continues the row from where the run starts', () => {
    expect(messageStreamText('Hello', { at: 5, text: ', world' })).toBe('Hello, world');
  });

  it('starts from nothing when the row has no text yet', () => {
    expect(messageStreamText(undefined, { at: 0, text: 'Hel' })).toBe('Hel');
    expect(messageStreamText('', { at: 0, text: 'Hel' })).toBe('Hel');
  });

  /**
   * **A durable write can land while the run is in flight**, so the row is longer than the run's offset. The
   * run is still the newer account of everything past that offset, so it wins there and the row wins before
   * it — which is what stops a 2 s-old row from erasing the last 2 s of a reply.
   */
  it('keeps the run when the row has caught up past its offset', () => {
    expect(messageStreamText('Hello, wor', { at: 5, text: ', world!' })).toBe('Hello, world!');
  });

  /**
   * **A window that opened mid-stream has a run starting past the end of its row**, with nothing to splice it
   * onto. Concatenating would show `Hello` + ` are you?` and silently drop the middle; the honest answer is
   * the row, until the next durable write reaches the offset.
   */
  it('shows the row when the run starts past the end of it, rather than text with a hole in it', () => {
    expect(messageStreamText('Hello', { at: 12, text: ' are you?' })).toBe('Hello');
    expect(messageStreamText(undefined, { at: 12, text: ' are you?' })).toBeUndefined();
  });

  it('is monotonic as a reply arrives, which is the property a reader actually feels', () => {
    const row = 'Hello';
    let shown = messageStreamText(row, undefined) ?? '';
    for (const run of [{ at: 5, text: ',' }, { at: 5, text: ', wo' }, { at: 5, text: ', world' }]) {
      const next = messageStreamText(row, run) ?? '';
      expect(next.startsWith(shown), `${shown} -> ${next}`).toBe(true);
      shown = next;
    }
    expect(shown).toBe('Hello, world');
  });
});

/**
 * The same rule for a block that grows (G1's other half).
 *
 * A thinking block's text arrives as a feed while the row carries the block itself — its label, its state —
 * on the durable clock. So a window holds a run for one of a message's blocks and has to give one answer
 * for that block, by exactly the rule the text uses. What is different is that a message holds several
 * blocks, so a run names which one it belongs to, and that a block the row does not hold yet has nothing
 * for a run to splice onto.
 */
describe('what a window shows while a block is growing', () => {
  const thinking = (content: string) => ({ type: 'thinking', props: { content, label: 'Thinking' } });

  it('returns the blocks untouched when nothing is growing', () => {
    const blocks = [thinking('all of it')];
    expect(messageStreamBlocks(blocks, undefined)).toBe(blocks);
    expect(messageStreamBlocks(undefined, { block: 'thinking', at: 0, text: 'x' })).toBeUndefined();
  });

  it('continues the named block from where the run starts', () => {
    const shown = messageStreamBlocks([thinking('Think')], { block: 'thinking', at: 5, text: 'ing on' });

    expect(shown?.[0].props.content).toBe('Thinking on');
    // The rest of the block is the row's, and the splice leaves it exactly as it was
    expect(shown?.[0].props.label).toBe('Thinking');
  });

  it('leaves every other block alone', () => {
    const blocks = [{ type: 'tool-activity', props: { content: 'untouched' } }, thinking('Think')];
    const shown = messageStreamBlocks(blocks, { block: 'thinking', at: 5, text: 'ing' });

    expect(shown?.[0]).toBe(blocks[0]);
    expect(shown?.[1].props.content).toBe('Thinking');
  });

  /**
   * **A run for a block the row has not got is a window that joined before the first durable write.** There
   * is nothing to splice onto, and inventing the block from the run alone would show text with no label and
   * no state — so the row is the honest answer until one arrives.
   */
  it('ignores a run for a block the row does not hold', () => {
    const blocks = [{ type: 'tool-activity', props: {} }];
    expect(messageStreamBlocks(blocks, { block: 'thinking', at: 0, text: 'Think' })).toBe(blocks);
  });

  it('ignores a run that starts past the end of what the block holds', () => {
    const blocks = [thinking('Think')];
    expect(messageStreamBlocks(blocks, { block: 'thinking', at: 99, text: 'ing' })).toBe(blocks);
  });

  /** The run is dropped once a durable write has caught the row up to everything it delivered. */
  it('knows when the row has caught up with the run', () => {
    expect(blockRunCaughtUp([thinking('Thinking on')], { block: 'thinking', at: 5, text: 'ing on' })).toBe(true);
    expect(blockRunCaughtUp([thinking('Think')], { block: 'thinking', at: 5, text: 'ing on' })).toBe(false);
    expect(blockRunCaughtUp([thinking('Thinking on')], undefined)).toBe(false);
    expect(blockRunCaughtUp(undefined, { block: 'thinking', at: 0, text: 'x' })).toBe(false);
  });
});
