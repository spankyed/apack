import type { ClaudeNativeAssistantMessage } from './native-assistant-messages.ts';

export interface ClaudeNativeThinkingMessage extends ClaudeNativeAssistantMessage { isSummary?: true }

/**
 * Local mirror of the `thinking` block types so helper files in this
 * directory can typecheck independently.
 *
 * Kept in sync with the threads feature types. If the
 * canonical shape changes, mirror it here too.
 */

export interface ThinkingBlockProps {
  /** Accumulated thinking text. */
  content: string;
  /** Original native ranges and verified narration classification; never signature bytes. */
  nativeMessages?: readonly ClaudeNativeThinkingMessage[];
  /** Collapsed header label (e.g. "Thinking…" or "Thought for 3s"). */
  label: string;
  /** Block state — drives spinner visibility. */
  state: 'streaming' | 'done';
  /** Initial open/closed state. Collapsed by default. */
  defaultOpen?: boolean;
}
