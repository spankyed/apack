/** Admits every normalized 2.1.302 environment document (200 entries × 10,000 UTF-16 units).
 * Raw whitespace-heavy documents may be larger; refuse the transport boundary explicitly, never truncate.
 */
export const CLAUDE_NATIVE_EDITOR_MAX_BYTES = 8 * 1024 * 1024
export const CLAUDE_NATIVE_EDITOR_MESSAGE_MAX_BYTES = 6 * CLAUDE_NATIVE_EDITOR_MAX_BYTES + 65_536
