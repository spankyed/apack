/**
 * Throttled writer for the `thinking` block on a streaming chat message.
 *
 * Claude Code's extended thinking emits `thinking_delta` events as the model reasons, and its native stream
 * repeats the same prose as whole assistant messages. This writer accumulates both into one text and
 * publishes it as a single `thinking` block.
 *
 * **The row and the feed are one account between them** (G1): `updateMessageState` replaces the whole
 * `blocks` field, so a durable write carries the entire block however little of it changed. The row carries
 * the block appearing, a later cycle reopening it, and its final state; the feed
 * (`services.chat.streamMessageBlockText`) carries the growth between those, which nothing stores. See
 * `row-interval.ts` for what each channel costs.
 *
 * Coordination with ToolActivityWriter: both writers target the `blocks` field, and `updateMessageState`
 * replaces the entire field. The thinking writer writes directly to `blocks` until tool-activity starts, at
 * which point `stopDirectWrites()` is called and the tool-activity writer takes over — it includes the
 * thinking block via the `getThinkingBlock` callback passed at construction time, and this writer's clock
 * then asks that owner to write rather than writing itself. Later model cycles reopen the block and
 * schedule through that same owner.
 */

import { createClaudeNativeMessageTracker } from './native-assistant-messages.ts';
import { isClaudeNarrationSignature } from './native-thinking.ts';
import type { Services, EntityId } from '#generated/services.ts';
import type { ThinkingBlockProps, ClaudeNativeThinkingMessage } from './thinking-types.ts';
import { formatDuration } from './tool-activity-label.ts';
import { ROW_INTERVAL_MS, THINKING_BLOCK } from './row-interval.ts';

export interface ThinkingWriterOptions {
  /** Minimum ms between durable `updateMessageState` calls. Default {@link ROW_INTERVAL_MS}. */
  intervalMs?: number;
}

export interface ThinkingWriter {
  push(text: string): void;
  acceptNativeMessage(message: { uuid?: string; sessionId?: string; apiMessageId?: string; text: string; signature?: unknown; parentToolUseId?: string }): void;
  flush(): void;
  finalise(): void;
  stopDirectWrites(writeWithOwner?: () => void): void;
  buildBlock(): { type: string; props: ThinkingBlockProps } | null;
  readonly hasContent: boolean;
  readonly isStreaming: boolean;
}

/** How much of two texts is the same from the start — where a rewrite of the buffer begins. */
function commonPrefixLength(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let at = 0;
  while (at < limit && before.charCodeAt(at) === after.charCodeAt(at)) at++;
  return at;
}

export function createThinkingWriter(
  services: Services,
  messageId: EntityId,
  opts: ThinkingWriterOptions = {},
): ThinkingWriter {
  const intervalMs = opts.intervalMs ?? ROW_INTERVAL_MS;
  let buffer = '';
  const native = createClaudeNativeMessageTracker({ separator: '\n\n', completePartial: true });
  let nativeMessages: readonly ClaudeNativeThinkingMessage[] = [];
  const summaries = new Set<string>();
  let segmentStartedAt: number | undefined;
  let thinkingElapsed = 0;
  let writeWithOwner: (() => void) | undefined;
  let state: 'streaming' | 'done' = 'streaming';
  let directWritesEnabled = true;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  let lastWritten: string | undefined;
  /** How much of `buffer` the windows have been sent. The feed's offsets are contiguous from 0 */
  let fedUpTo = 0;
  /** Whether a durable write has put a thinking block in the row for a run to splice onto */
  let rowHasBlock = false;
  /** Whether the run has been told it is done, after which a window has dropped it and only the row is read */
  let feedClosed = false;

  /**
   * Sends the characters the windows have not been sent — the block's half of G1's feed.
   *
   * **A run can only splice onto a block the row already holds**, since a window matches a run to a block
   * by type and ignores one it cannot see. So nothing is fed before the first durable write, and that write
   * is immediate rather than on the interval: a block appearing is a discrete change the user is waiting
   * for, where its growth is not.
   *
   * **A healed native message can rewrite what the windows hold**, where a delta only ever appended. `at`
   * is an absolute offset and a window splices there, tail included, so a rewrite is expressible: whoever
   * changes `buffer` non-monotonically pulls `fedUpTo` back to the first character that differs
   * (`commonPrefixLength`) and the next feed repairs it.
   *
   * **Nothing is fed once the run is done.** A window drops its run then and reads the row, so a later
   * cycle's text reaches it on the durable interval instead.
   */
  function feed(): void {
    if (!rowHasBlock || feedClosed || fedUpTo >= buffer.length) return;
    const at = fedUpTo;
    const text = buffer.slice(at);
    fedUpTo = buffer.length;
    services.chat.streamMessageBlockText({ messageId, block: THINKING_BLOCK, at, text });
  }

  function buildLabel(): string {
    if (state === 'streaming') return 'Thinking';
    return `Thought for ${formatDuration(thinkingElapsed)}`;
  }

  function buildBlock(): { type: string; props: ThinkingBlockProps } | null {
    if (!buffer) return null;
    return {
      type: 'thinking',
      props: { content: buffer, ...(nativeMessages.length ? { nativeMessages } : {}), label: buildLabel(), state, defaultOpen: false },
    };
  }

  /** What the row holds after a write of the current block, whoever made it. */
  function rowNowHoldsBuffer(): void {
    rowHasBlock = true;
    fedUpTo = buffer.length;
  }

  function writeNow(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (!buffer) return;
    if (!directWritesEnabled) {
      // The owner's write carries this block too, so the row ends up holding what the buffer does
      if (writeWithOwner) { writeWithOwner(); rowNowHoldsBuffer(); }
      lastFlushAt = Date.now();
      return;
    }
    const block = buildBlock();
    if (block) {
      // A block identical to the one already in the row costs a whole write and changes nothing. Both clocks
      // can land on the same content once the owner holds this block too, and a tool patch that changed
      // nothing visible does the same.
      const written = JSON.stringify(block);
      if (written !== lastWritten) {
        lastWritten = written;
        services.chat.updateMessageState(messageId, { blocks: [block] as any });
      }
      // Written or deduplicated, the row now holds everything the buffer does, so nothing up to here is the
      // feed's to send
      rowNowHoldsBuffer();
    }
    lastFlushAt = Date.now();
  }

  /** The durable write's clock, whether this writer or the owner makes it. The feed has none. */
  function schedule(): void {
    if (!directWritesEnabled && !writeWithOwner) return;
    if (pendingTimer) return;
    const since = Date.now() - lastFlushAt;
    const delay = Math.max(0, intervalMs - since);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      writeNow();
    }, delay);
  }

  /** Growth reaches the windows at once and the row on its interval; a block appearing is written now. */
  function published(discrete: boolean): void {
    if (!rowHasBlock || discrete) { writeNow(); return; }
    feed();
    schedule();
  }

  return {
    get hasContent() { return buffer.length > 0; },
    get isStreaming() { return state === 'streaming'; },

    push(text: string): void {
      if (!text) return;
      // A later model cycle reopens the block, which is a discrete change — and the one case where the row
      // has to carry it, the run having been dropped when this block was last finished
      const reopened = state === 'done';
      if (reopened) { state = 'streaming'; if (buffer) buffer += '\n\n'; }
      segmentStartedAt ??= Date.now();
      buffer += text;
      published(reopened);
    },

    acceptNativeMessage(message): void {
      if (message.parentToolUseId || !message.text) return;
      const projected = native.accept(buffer, message);
      const reopened = projected.text !== buffer && state === 'done';
      if (projected.text !== buffer) {
        state = 'streaming';
        segmentStartedAt ??= Date.now();
        fedUpTo = Math.min(fedUpTo, commonPrefixLength(buffer, projected.text));
        buffer = projected.text;
      }
      if (projected.rows.length > nativeMessages.length && message.uuid && message.text.trim() && isClaudeNarrationSignature(message.signature)) summaries.add(message.uuid);
      nativeMessages = projected.rows.map(row => ({ ...row, ...(summaries.has(row.uuid) ? { isSummary: true as const } : {}) }));
      // A native message is more thinking text arriving, so it is growth like a delta, not a discrete change
      published(reopened);
    },

    flush(): void {
      writeNow();
    },

    stopDirectWrites(ownerWrite?: () => void): void {
      directWritesEnabled = false;
      writeWithOwner = ownerWrite;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    },

    finalise(): void {
      if (state === 'done') return;
      if (segmentStartedAt !== undefined) thinkingElapsed += Date.now() - segmentStartedAt;
      segmentStartedAt = undefined;
      state = 'done';
      // The row first, then the run is dropped. A window drops its run on `done` and falls back to the row,
      // so the row has to be the finished one by then — the text feed's contract, for the same reason. The
      // label and state change here too, which are rewrites and only the row can carry them
      writeNow();
      if (rowHasBlock && !feedClosed) {
        feedClosed = true;
        services.chat.streamMessageBlockText({ messageId, block: THINKING_BLOCK, at: 0, text: '', done: true });
      }
    },

    buildBlock,
  };
}
