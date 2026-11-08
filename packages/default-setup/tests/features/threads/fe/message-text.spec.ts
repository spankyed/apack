// How a window shows a message that two channels describe (G1).
//
// A streamed reply arrives as a feed of characters while the message's own view delivers the row on a slower
// clock, so the window holds a run and the row and has to give one answer. The rule is `messageStreamText`:
// **the row wins up to the run's offset and the run continues from there.** Every case below is a state the
// two channels can actually be in, and the last two are the ones a simpler rule gets wrong — a window that
// joined mid-stream, and a run the row has already overtaken.
import { describe, expect, it } from 'vitest';
import { messageStreamText } from '#features/threads/fe/message-text.ts';

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
