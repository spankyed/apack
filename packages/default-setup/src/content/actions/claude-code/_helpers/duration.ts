/**
 * How long something took, as a turn's writers put it to the user.
 *
 * Its own module because it is all that is left of a `tool-activity-label.ts` here. That file held a copy
 * of the collapsed label the activity block shows — the same function as the block's own
 * (`extensions/blocks/display/tool-activity-label.ts`), differing only in semicolons — and it existed
 * because the backend *stored* the label it computed. It does not: the label is derived from the entries,
 * so the component derives it and nothing writes it. What was duplicated is gone with the write.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
