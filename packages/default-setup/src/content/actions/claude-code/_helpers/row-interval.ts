/**
 * How often a growing block is written to its message row while a turn streams.
 *
 * **A flush writes the whole block, so the cost of one grows with the turn.** `updateMessageState` replaces
 * the field, which means every flush re-writes all of the thinking text and all of the tool entries
 * accumulated so far, and the two writers compound: once tool activity starts the thinking block rides
 * along in every tool-activity write. What reaches storage is then a multiple of what the user ends up
 * with, and the multiple grows with the length of the turn.
 *
 * So continuous growth is **fed** rather than written — `services.chat.streamMessageBlockText`, the block's
 * half of G1's split — and the row is written on this interval for durability, which is what lets a crash
 * lose seconds of a turn rather than all of it. A **discrete** change the user is waiting to see, a tool
 * appearing or the block reaching its final state, is written immediately and resets the interval.
 *
 * The interval is the slowest one at which the row is still a useful fallback for a window that joined
 * mid-turn, since what it is no longer carrying is the live view.
 */
export const ROW_INTERVAL_MS = 2000;

/** The block whose growth is fed: a message holds one, and the feed names which it belongs to. */
export const THINKING_BLOCK = 'thinking';
