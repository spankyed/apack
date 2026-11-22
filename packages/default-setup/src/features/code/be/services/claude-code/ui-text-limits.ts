/** Original remote text APIs count UTF-16 units, not JSON or UTF-8 bytes. */
export const CLAUDE_UI_TEXT_MAX_LENGTH = 1_000_000
export const CLAUDE_UI_TEXT_LIMIT_MESSAGE = 'Shorten the Claude draft to 1,000,000 UTF-16 units and try again.'
// JSON.stringify can escape each unit as six ASCII bytes (controls or lone surrogates).
// Leave bounded room for session/client identity and the surrounding protocol envelope.
export const CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES = 6 * CLAUDE_UI_TEXT_MAX_LENGTH + 65_536

/** Forward composer RPCs that carry native-limit text in requests and replies. */
export const CLAUDE_UI_PROMPT_RPC_SUBTYPES = [
  'ui_prompt_edit', 'ui_prompt_autocomplete', 'apack_ui_parent_command',
  'apack_prepare_prompt', 'apack_terminal_draft', 'apack_prompt_outcome',
] as const
