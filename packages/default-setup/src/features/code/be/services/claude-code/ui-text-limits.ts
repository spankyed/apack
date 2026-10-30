/** Original remote text APIs count UTF-16 units, not JSON or UTF-8 bytes. */
export const CLAUDE_UI_TEXT_MAX_LENGTH = 1_000_000
// JSON.stringify can escape each unit as six ASCII bytes (controls or lone surrogates).
// Leave bounded room for session/client identity and the surrounding protocol envelope.
export const CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES = 6 * CLAUDE_UI_TEXT_MAX_LENGTH + 65_536
