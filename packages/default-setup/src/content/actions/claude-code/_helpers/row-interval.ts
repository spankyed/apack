/**
 * How often a growing block's row is committed while a turn streams.
 *
 * **A quarter second, which is what every caller was already passing.** This constant said 2000 and
 * explained why 2000 was right; all four construction sites overrode it with 250 and none said why, so the
 * number the module documented was used by nothing and the specs measured a configuration the app never
 * ran. The call sites were right and this was wrong: the row is what a window joining mid-turn is shown
 * until the next commit reaches the feed's offset, so the interval is that window's staleness and a quarter
 * second is the answer to it.
 *
 * **It is affordable now for a reason that did not hold when it said 2000.** A commit used to rewrite the
 * whole block, so eight times as many of them cost eight times as much — the comment here priced a
 * quarter-second row at 13MB against 1.68MB. Growth is appended now (`BlockText`), so a commit costs the
 * characters since the last one and the interval decides how often a turn commits rather than how much of
 * it is written again. What it still costs is reaching the fold sooner
 * (`TEXT_SEGMENTS_BEFORE_COMPACTION`), which is the figure `row-interval.spec.ts` records.
 *
 * A **discrete** change the user is waiting to see — a block appearing, a tool arriving, a block reaching
 * its final state — is committed at once and does not wait for this.
 */
export const ROW_INTERVAL_MS = 250;
