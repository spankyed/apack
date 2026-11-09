/**
 * The message as a window shows it, when two channels describe it (G1).
 *
 * A streamed reply arrives as a feed of characters (`MESSAGE_TEXT_APPENDED`) while the message's own view
 * delivers the row on a slower clock, so a window holds a run and a row and has to give one answer.
 *
 * Its own module rather than a function inside `state.ts`, because that module takes a `window` listener at
 * import and this rule needs no browser at all — a spec for it should not have to start one.
 */

/**
 * The row with a streamed run spliced in: **the row wins up to the run's offset and the run continues from
 * there.**
 *
 * That is what makes two channels one answer in both directions. A durable write that lands mid-run makes the
 * row longer than the offset, and the run is still the newer account of everything past it. A run that starts
 * *past* the end of the row belongs to a stream this window joined late, so there is nothing to splice it
 * onto — concatenating would silently drop the middle, and the row is the honest answer until the next
 * durable write reaches the offset.
 */
export function messageStreamText(
  row: string | undefined,
  run: { at: number; text: string } | undefined,
): string | undefined {
  if (!run) return row;
  const text = row ?? '';
  if (run.at > text.length) return row;
  return text.slice(0, run.at) + run.text;
}

/** What a window holds of a block's growth: which block, from where, and what has arrived. */
/**
 * What a run becomes when its stream says `done`: the completed run, or nothing.
 *
 * **The last event carries the tail, and the row reaches a window by another road.** The writer writes the
 * row and then sends what it had not fed yet beside `done` — but the row travels through the message's view
 * subscription and the feed through the bus, two channels nothing orders. A window that simply dropped its
 * run rendered the row as it last knew it, without that tail, until the view caught up: the end of a reply
 * visibly missing and then appearing.
 *
 * Spliced in, the answer is complete at once and already equals what the row will say, so the run it leaves
 * behind changes nothing when the view lands. A `done` carrying no text is the other case — a `finalize`
 * that *replaced* the text, where the row is the only answer and a run spliced over it would hide the
 * replacement, which is what a failed turn's warning is. So is a tail that does not continue the run: this
 * window missed an event, and joining two halves with a hole between them would read as text.
 */
export function finishedRun(
  held: { at: number; text: string } | undefined,
  event: { at: number; text: string },
): { at: number; text: string } | undefined {
  if (!held) return undefined;
  if (event.text.length === 0) return undefined;
  if (held.at + held.text.length !== event.at) return undefined;
  return { at: held.at, text: held.text + event.text };
}

export interface BlockRun {
  block: string;
  at: number;
  text: string;
}

/** Only the shape this rule reads, so nothing here depends on the message model. */
interface GrowingBlock {
  type: string;
  props: Record<string, unknown>;
}

/**
 * The blocks with a run spliced into the one it names, by the same rule as the text: **the row wins up to
 * the run's offset and the run continues from there.**
 *
 * A run for a block the row does not hold yet is a stream this window joined before the first durable
 * write, so there is nothing to splice onto and the row is the honest answer until one arrives — the same
 * reasoning as a run that starts past the end of the text. The blocks are returned unchanged when the
 * splice changes nothing, so a window that is not streaming re-renders nothing.
 */
export function messageStreamBlocks<T extends GrowingBlock>(
  blocks: T[] | undefined,
  run: BlockRun | undefined,
): T[] | undefined {
  if (!run || !blocks) return blocks;
  const at = blocks.findIndex(block => block.type === run.block);
  if (at < 0) return blocks;
  const held = blocks[at];
  const content = typeof held.props.content === 'string' ? held.props.content : '';
  const grown = messageStreamText(content, run);
  if (grown === undefined || grown === content) return blocks;
  const spliced = blocks.slice();
  spliced[at] = { ...held, props: { ...held.props, content: grown } };
  return spliced;
}

/**
 * Has a durable write caught the row up to everything the run has delivered?
 *
 * The run is dropped when it has, so it cannot grow for the life of the message — the same reasoning as the
 * text's, and asked at the same place, since reading the message is the only thing that learns what the row
 * now holds.
 */
export function blockRunCaughtUp<T extends GrowingBlock>(blocks: T[] | undefined, run: BlockRun | undefined): boolean {
  if (!run) return false;
  const held = blocks?.find(block => block.type === run.block);
  const content = typeof held?.props.content === 'string' ? held.props.content : '';
  return content.length >= run.at + run.text.length;
}
