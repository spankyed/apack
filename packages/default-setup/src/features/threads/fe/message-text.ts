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
