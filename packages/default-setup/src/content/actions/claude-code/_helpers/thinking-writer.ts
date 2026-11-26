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
 *
 * **And the text is appended rather than rewritten.** Growth goes to the row as a segment from the offset it
 * starts at — the same `(at, text)` the feed sends the windows — so the interval decides how often the turn
 * commits rather than how much of it is written again.
 */

import { createClaudeNativeMessageTracker } from './native-assistant-messages.ts';
import { isClaudeNarrationSignature } from './native-thinking.ts';
import type { Services, EntityId } from '#generated/services.ts';
import type { ThinkingBlockProps, ClaudeNativeThinkingMessage } from './thinking-types.ts';
import { formatDuration } from './duration.ts';
import { ROW_INTERVAL_MS } from './row-interval.ts';

export interface ThinkingWriterOptions {
  /** Minimum ms between durable `updateMessageState` calls. Default {@link ROW_INTERVAL_MS}. */
  intervalMs?: number;
}

export interface ThinkingWriter {
  push(text: string): void;
  acceptNativeMessage(message: { uuid?: string; sessionId?: string; apiMessageId?: string; text: string; signature?: unknown; parentToolUseId?: string }): void;
  flush(): void;
  finalise(): void;
  buildBlock(): { type: string; props: ThinkingBlockProps } | null;
  readonly hasContent: boolean;
  readonly isStreaming: boolean;
}

/** How much of two texts is the same from the start — where a heal of the buffer begins. */
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
  /** When the current thinking segment began, and the time every finished one took */
  let segmentStartedAt: number | undefined;
  let thinkingElapsed = 0;
  let state: 'streaming' | 'done' = 'streaming';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  /** How much of `buffer` the windows have been sent. The feed's offsets are contiguous from 0 */
  let fedUpTo = 0;
  /** The block's own row, from the first durable write; a run can only splice onto a block the row holds */
  let blockId: EntityId | undefined;
  /** How much of `buffer` the row holds, as its own text plus the segments appended to it */
  let rowUpTo = 0;
  /**
   * Whether the text changed behind what the row already holds, which only a write of the block can mend.
   *
   * **A native message can heal text it already sent** — a completed block replacing the partial that
   * streamed — and an append cannot take that back: the row's segments up to `rowUpTo` are then wrong. A
   * whole-block write replaces the text, so that is the one path a heal can take.
   */
  let healed = false;

  /**
   * Sends the characters the windows have not been sent — the block's half of G1's feed.
   *
   * **A run can only splice onto a block the row already holds**, since a window matches a run to a block
   * by that row's id and ignores one it cannot see. So nothing is fed before the first durable write, and
   * that write is immediate rather than on the interval: a block appearing is a discrete change the user is
   * waiting for, where its growth is not. It is also what makes the id available to name here.
   *
   * **A healed native message rewrites what the windows already hold**, where a delta only ever appended.
   * `at` is an absolute offset and a window splices there, tail included, so a rewrite is expressible:
   * whoever changes `buffer` behind what was sent pulls `fedUpTo` back to the first character that differs.
   */
  function feed(): void {
    if (!blockId || fedUpTo >= buffer.length) return;
    const at = fedUpTo;
    const text = buffer.slice(at);
    fedUpTo = buffer.length;
    services.chat.streamMessageBlockText({ messageId, blockId, at, text });
  }

  function buildLabel(): string {
    if (state === 'streaming') return 'Thinking';
    // Thinking time rather than wall time: a turn's thinking comes in cycles with tool work between them,
    // and the waiting is not what the user spent thinking about
    return `Thought for ${formatDuration(thinkingElapsed)}`;
  }

  function buildBlock(): { type: string; props: ThinkingBlockProps } | null {
    if (!buffer) return null;
    return {
      type: 'thinking',
      props: { content: buffer, ...(nativeMessages.length ? { nativeMessages } : {}), label: buildLabel(), state, defaultOpen: false },
    };
  }

  /**
   * Commits what has grown since the last flush.
   *
   * **Growth is appended; everything else is a write of the block.** A segment is written once and never
   * rewritten, which is what stops a turn's cost growing with it — writing the whole block on every flush
   * cost 47.9x the text the turn left behind. A write of the block is for what is not growth: the block
   * appearing, and the label and state changing when it finishes, which are rewrites no append can carry.
   * That write also replaces the text, so it is what folds the segments back in.
   */
  function writeNow(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (!buffer) return;

    if (blockId && state === 'streaming' && !healed) {
      if (buffer.length > rowUpTo) {
        services.chat.appendMessageBlockText(blockId, rowUpTo, buffer.slice(rowUpTo));
        rowUpTo = buffer.length;
      }
    } else {
      const block = buildBlock();
      if (block) {
        blockId = services.chat.updateMessageBlock(messageId, block, blockId);
        rowUpTo = buffer.length;
        healed = false;
      }
    }
    // The row now holds everything the buffer does, so nothing up to here is the feed's to send
    fedUpTo = buffer.length;
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
      if (!text) return;
      // **A later model cycle reopens the block**, which is a discrete change and the one case the row has
      // to carry: a window dropped its run when this block last finished
      const reopened = state === 'done';
      if (reopened) { state = 'streaming'; if (buffer) buffer += '\n\n'; }
      segmentStartedAt ??= Date.now();
      buffer += text;
      if (reopened) { writeNow(); return; }
      // The first content is the block appearing, which is written at once; everything after it is growth,
      // which the feed carries while the row collects it on the durable interval
      if (!blockId) { writeNow(); return; }
      feed();
      schedule();
    },

    acceptNativeMessage(message): void {
      if (message.parentToolUseId || !message.text) return;
      const projected = native.accept(buffer, message);
      const reopened = projected.text !== buffer && state === 'done';
      if (projected.text !== buffer) {
        state = 'streaming';
        segmentStartedAt ??= Date.now();
        const common = commonPrefixLength(buffer, projected.text);
        if (common < rowUpTo || common < fedUpTo) healed = true;
        fedUpTo = Math.min(fedUpTo, common);
        buffer = projected.text;
      }
      if (projected.rows.length > nativeMessages.length && message.uuid && message.text.trim()
        && isClaudeNarrationSignature(message.signature)) summaries.add(message.uuid);
      nativeMessages = projected.rows.map(row => ({ ...row, ...(summaries.has(row.uuid) ? { isSummary: true as const } : {}) }));
      // More thinking text arriving is growth like a delta, except where it is the block appearing or a
      // cycle reopening, which the row has to carry
      if (!blockId || reopened || healed) { writeNow(); return; }
      feed();
      schedule();
    },

    flush(): void {
      writeNow();
    },

    finalise(): void {
      if (state === 'done') return;
      if (segmentStartedAt !== undefined) thinkingElapsed += Date.now() - segmentStartedAt;
      segmentStartedAt = undefined;
      state = 'done';
      // The row first, then the run is dropped. A window drops its run on `done` and falls back to the row,
      // so the row has to be the finished one by then — the text feed's contract, for the same reason. The
      // label and state change here too, which are rewrites and only the row can carry them
      // No compaction after it: the write above carries the whole text, and a whole-block write is what
      // folds the segments in. Asking for one as well wrote the text twice
      writeNow();
      if (blockId) {
        services.chat.streamMessageBlockText({ messageId, blockId, at: 0, text: '', done: true });
      }
    },

    buildBlock,
  };
}
