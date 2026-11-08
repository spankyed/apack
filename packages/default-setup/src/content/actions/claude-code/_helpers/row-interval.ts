/**
 * How often a growing block is written to its message row while a turn streams.
 *
 * **A flush writes the whole block, so the cost of one grows with the turn.** `updateMessageState` replaces
 * the field, which means every flush re-writes all of the thinking text and all of the tool entries
 * accumulated so far. On a quarter-second clock a three-minute turn wrote its block seven hundred times, and
 * the two writers compound: once tool activity starts, the thinking block rides along in every tool-activity
 * write, so one payload carries both. What reaches storage is then quadratic in the length of the turn while
 * what the user ends up with is a few tens of kilobytes.
 *
 * So continuous growth — thinking deltas, tool progress — is written on this interval, and a **discrete**
 * change the user is waiting to see, a tool appearing or the block reaching its final state, is written
 * immediately and resets it. The interval is the slowest one at which a block still reads as live: a browser
 * tab's own throttling floor, and roughly the gap at which a progress label stops looking stuck.
 */
export const ROW_INTERVAL_MS = 2000;
