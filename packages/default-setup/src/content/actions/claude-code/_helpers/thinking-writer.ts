/**
 * Throttled writer for the `thinking` block on a streaming chat message.
 *
 * Claude Code's extended thinking emits `thinking_delta` events as the model
 * reasons. This writer accumulates the thinking text and pushes a single
 * `thinking` block via `updateMessageState({ blocks })`.
 *
 * **It owns its block's row for the whole turn.** A block is an entity, so this writer writes the `thinking`
 * row and the tool-activity writer writes its own; neither carries the other's and neither has to stop. It
 * holds the row's id from the first write, so every flush after it is one row by id.
 */

import type { Services, EntityId } from '#generated/services.ts';
import type { ThinkingBlockProps } from './thinking-types.ts';
import { formatDuration } from './tool-activity-label.ts';
import { ROW_INTERVAL_MS, THINKING_BLOCK } from './row-interval.ts';

export interface ThinkingWriterOptions {
  /** Minimum ms between durable `updateMessageState` calls. Default {@link ROW_INTERVAL_MS}. */
  intervalMs?: number;
}

export interface ThinkingWriter {
  push(text: string): void;
  flush(): void;
  finalise(): void;
  buildBlock(): { type: string; props: ThinkingBlockProps } | null;
  readonly hasContent: boolean;
  readonly isStreaming: boolean;
}

export function createThinkingWriter(
  services: Services,
  messageId: EntityId,
  opts: ThinkingWriterOptions = {},
): ThinkingWriter {
  const intervalMs = opts.intervalMs ?? ROW_INTERVAL_MS;
  let buffer = '';
  let firstPushAt = 0;
  let finalisedAt = 0;
  let state: 'streaming' | 'done' = 'streaming';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  /** How much of `buffer` the windows have been sent. The feed's offsets are contiguous from 0 */
  let fedUpTo = 0;
  /** The block's own row, from the first durable write; a run can only splice onto a block the row holds */
  let blockId: EntityId | undefined;

  /**
   * Sends the characters the windows have not been sent — the block's half of G1's feed.
   *
   * **A run can only splice onto a block the row already holds**, since a window matches a run to a block
   * by type and ignores one it cannot see. So nothing is fed before the first durable write, and that write
   * is immediate rather than on the interval: a block appearing is a discrete change the user is waiting
   * for, where its growth is not.
   *
   * The buffer here only ever grows — `push` appends and a finished writer takes no more text — so there is
   * no rewrite this channel could be asked to carry.
   */
  function feed(): void {
    if (!blockId || fedUpTo >= buffer.length) return;
    const at = fedUpTo;
    const text = buffer.slice(at);
    fedUpTo = buffer.length;
    services.chat.streamMessageBlockText({ messageId, block: THINKING_BLOCK, at, text });
  }

  function buildLabel(): string {
    if (state === 'streaming') return 'Thinking';
    const elapsed = (finalisedAt || Date.now()) - (firstPushAt || Date.now());
    return `Thought for ${formatDuration(elapsed)}`;
  }

  function buildBlock(): { type: string; props: ThinkingBlockProps } | null {
    if (!buffer) return null;
    return {
      type: 'thinking',
      props: { content: buffer, label: buildLabel(), state, defaultOpen: false },
    };
  }

  function writeNow(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (!buffer) return;
    const block = buildBlock();
    if (block) {
      blockId = services.chat.updateMessageBlock(messageId, block, blockId);
      // The row now holds everything the buffer does, so nothing up to here is the feed's to send
      fedUpTo = buffer.length;
    }
    lastFlushAt = Date.now();
  }

  /** The durable write's clock. The feed has none: growth goes out as it arrives. */
  function schedule(): void {
    if (pendingTimer) return;
    const since = Date.now() - lastFlushAt;
    const delay = Math.max(0, intervalMs - since);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      writeNow();
    }, delay);
  }

  return {
    get hasContent() { return buffer.length > 0; },
    get isStreaming() { return state === 'streaming'; },

    push(text: string): void {
      if (!text || state === 'done') return;
      if (!firstPushAt) firstPushAt = Date.now();
      buffer += text;
      // The first content is the block appearing, which is written at once; everything after it is growth,
      // which the feed carries while the row collects it on the durable interval
      if (!blockId) { writeNow(); return; }
      feed();
      schedule();
    },

    flush(): void {
      writeNow();
    },

    finalise(): void {
      if (state === 'done') return;
      finalisedAt = Date.now();
      state = 'done';
      // The row first, then the run is dropped. A window drops its run on `done` and falls back to the row,
      // so the row has to be the finished one by then — the text feed's contract, for the same reason. The
      // label and state change here too, which are rewrites and only the row can carry them
      writeNow();
      if (blockId) {
        services.chat.streamMessageBlockText({ messageId, block: THINKING_BLOCK, at: 0, text: '', done: true });
      }
    },

    buildBlock,
  };
}
