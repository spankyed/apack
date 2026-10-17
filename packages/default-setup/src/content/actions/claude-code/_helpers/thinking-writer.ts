import { createClaudeNativeMessageTracker } from './native-assistant-messages.ts';
import { isClaudeNarrationSignature } from './native-thinking.ts';
/**
 * Throttled writer for the `thinking` block on a streaming chat message.
 *
 * Claude Code's extended thinking emits `thinking_delta` events as the model
 * reasons. This writer accumulates the thinking text and pushes a single
 * `thinking` block via `updateMessageState({ blocks })`.
 *
 * Coordination with ToolActivityWriter: both writers target the `blocks`
 * field, and `updateMessageState` replaces the entire field. The thinking
 * writer writes directly to `blocks` until tool-activity starts, at which
 * point `stopDirectWrites()` is called and the tool-activity writer takes
 * over — it includes the thinking block via `getThinkingBlock`. Later model
 * cycles reopen the summary and schedule writes through that same owner.
 */

import type { Services, EntityId } from '#generated/services.ts';
import type { ThinkingBlockProps, ClaudeNativeThinkingMessage } from './thinking-types.ts';
import { formatDuration } from './tool-activity-label.ts';

export interface ThinkingWriterOptions {
  /** Minimum ms between `updateMessageState` calls. Default 250ms. */
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

export function createThinkingWriter(
  services: Services,
  messageId: EntityId,
  opts: ThinkingWriterOptions = {},
): ThinkingWriter {
  const intervalMs = opts.intervalMs ?? 250;
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

  function writeNow(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (!buffer) return;
    if (!directWritesEnabled) { writeWithOwner?.(); lastFlushAt = Date.now(); return; }
    const block = buildBlock();
    if (block) {
      services.chat.updateMessageState(messageId, { blocks: [block] as any });
    }
    lastFlushAt = Date.now();
  }

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

  return {
    get hasContent() { return buffer.length > 0; },
    get isStreaming() { return state === 'streaming'; },

    push(text: string): void {
      if (!text) return;
      if (state === 'done') { state = 'streaming'; if (buffer) buffer += '\n\n'; }
      segmentStartedAt ??= Date.now();
      buffer += text;
      schedule();
    },

    acceptNativeMessage(message): void {
      if (message.parentToolUseId || !message.text) return;
      const projected = native.accept(buffer, message);
      if (projected.text !== buffer) {
        state = 'streaming'; segmentStartedAt ??= Date.now(); buffer = projected.text;
      }
      if (projected.rows.length > nativeMessages.length && message.uuid && message.text.trim() && isClaudeNarrationSignature(message.signature)) summaries.add(message.uuid);
      nativeMessages = projected.rows.map(row => ({ ...row, ...(summaries.has(row.uuid) ? { isSummary: true as const } : {}) }));
      writeNow();
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
      writeNow();
    },

    buildBlock,
  };
}
