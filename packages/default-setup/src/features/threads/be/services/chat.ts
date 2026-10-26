import type { Reply } from '@apackdev/sdk/events';
import { answer } from '../answer.ts';
import { EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { BlockConfig, BlockResponse, MessageEntity, OutgoingThreadsEvents, ThreadCreateData, MessageReferences } from '#features/threads/be/types.ts';

import { readMediaBuffer } from '@apackdev/sdk/utils';
import * as threadsService from './threads.ts';
import { blockRegistry } from '@apackdev/sdk/blocks';
import { createLogger } from '@apackdev/sdk/logger';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('chat');

/**
 * Block-based interaction helpers for creating composable messages
 *
 * These helpers make it easy to create messages using reusable blocks that can be
 * mixed and matched to create complex interactions. Every write here reaches a window through the threads views
 * (`be/views.ts`): the chat page lists the message, and its own view carries what it says.
 */

interface BlockMessageBase {
  threadId: EARS.EntityId;
  text: string;
  blocks: BlockConfig[];
  forkable?: boolean;
}

export type AutoHideOptions =
  | { autoHide: true; asUser: boolean; asideContext?: string }
  | { autoHide?: false; asUser?: undefined; asideContext?: undefined };

type BlockMessageOptions = BlockMessageBase & AutoHideOptions;

/**
 * Create a message with custom blocks (pure function)
 * Returns message data without side effects
 */
function createBlockMessage(options: BlockMessageOptions): {
  messageId: EARS.EntityId;
  threadId: EARS.EntityId;
  message: MessageEntity;
} {
  const { threadId, text, blocks, forkable, autoHide, asUser, asideContext } = options;

  const result = repository.chatCommands.addMessage({
    threadId,
    text,
    sender: 'assistant',
    blocks,
    forkable,
    autoHide,
    asUser,
    asideContext,
  });

  // Construct message entity for return
  const message: MessageEntity = {
    id: result.id,
    entityType: EARS.Entity.Message,
    text: result.text,
    sender: result.sender as 'user' | 'assistant' | 'system',
    timestamp: result.timestamp,
    blocks,
    createdAt: result.timestamp,
    updatedAt: result.timestamp,
    ...(forkable === false && { forkable }),
    ...(autoHide && { autoHide }),
    ...(asUser != null && { asUser }),
    ...(asideContext && { asideContext }),
  };

  return { messageId: result.id, threadId, message };
}

/** Send a message with custom blocks */
export function sendBlockMessage(options: BlockMessageOptions): { messageId: EARS.EntityId } {
  return { messageId: createBlockMessage(options).messageId };
}

/** Send a system message (non-interactive aside) */
export function sendSystemMessage(options: {
  threadId: EARS.EntityId;
  text: string;
}): { messageId: EARS.EntityId } {
  const { threadId, text } = options;

  const result = repository.chatCommands.addMessage({
    threadId,
    text,
    sender: 'system',
  });

  return { messageId: result.id };
}

/**
 * Create a choice interaction using blocks
 */
export function sendChoiceBlock(options: {
  threadId: EARS.EntityId;
  text: string;
  prompt: string;
  choices: Array<{ id: string; label: string; description?: string }>;
  multiSelect?: boolean;
  allowCustom?: boolean;
  compact?: boolean;
  displayText?: string;
  skipOption?: { id: string; label: string };
  forkable?: boolean;
} & AutoHideOptions): { messageId: EARS.EntityId } {
  const { threadId, text, prompt, choices, multiSelect = false, allowCustom = false, compact, displayText, skipOption, forkable, autoHide, asUser, asideContext } = options;

  const blocks: BlockConfig[] = [
    {
      type: 'prompt',
      props: { content: prompt }
    },
    {
      type: 'choice',
      props: { choices, multiSelect, allowCustom, compact, displayText, skipOption }
    }
  ];

  return sendBlockMessage({ threadId, text, blocks, forkable, autoHide, asUser, asideContext } as BlockMessageOptions);
}

/**
 * Create a question interaction — single question or multi-question wizard.
 * Single question = array with one item. Multi = step wizard in the frontend.
 * Response shape: string (single) or Record<string, string> (multi).
 */
export function sendQuestionBlock(options: {
  threadId: EARS.EntityId;
  text: string;
  prompt: string;
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ id: string; label: string; description?: string }>;
    multiSelect?: boolean;
    allowCustom?: boolean;
  }>;
  forkable?: boolean;
} & AutoHideOptions): { messageId: EARS.EntityId } {
  const { threadId, text, questions, forkable, autoHide, asUser, asideContext } = options;

  const blocks: BlockConfig[] = [
    {
      type: 'question',
      props: { questions }
    }
  ];

  return sendBlockMessage({ threadId, text, blocks, forkable, autoHide, asUser, asideContext } as BlockMessageOptions);
}

/**
 * Create an approval interaction using blocks
 */
export function sendApprovalBlock(options: {
  threadId: EARS.EntityId;
  text: string;
  prompt: string;
  context?: string;
  requireReason?: boolean;
  allowReason?: boolean;
  forkable?: boolean;
} & AutoHideOptions): { messageId: EARS.EntityId } {
  const { threadId, text, prompt, context, requireReason = false, allowReason = true, forkable, autoHide, asUser, asideContext } = options;

  const blocks: BlockConfig[] = [
    {
      type: 'prompt',
      props: { content: prompt }
    }
  ];

  if (context) {
    blocks.push({
      type: 'note',
      props: { content: context, variant: 'info', label: 'Context' }
    });
  }

  blocks.push({
    type: 'approval',
    props: { requireReason, allowReason }
  });

  return sendBlockMessage({ threadId, text, blocks, forkable, autoHide, asUser, asideContext } as BlockMessageOptions);
}

/**
 * Update a message with block interaction response data
 */
export function updateMessageBlockResponse(
  messageId: EARS.EntityId,
  response: any
): void {
  repository.chatCommands.updateMessageBlockResponse({
    messageId,
    response
  });
}

/**
 * Update message state with any mutable fields
 * Main interface for ad hoc message state updates (text, blocks, blockResponse, responseTimestamp): a window showing
 * the message sees it through the message's view, the one view a streamed reply re-runs
 *
 * @example
 * // Re-enable interactive blocks by clearing response
 * updateMessageState(messageId, {
 *   responseTimestamp: undefined,
 *   blockResponse: undefined
 * });
 *
 * @example
 * // Update message text
 * updateMessageState(messageId, {
 *   text: 'Updated message content'
 * });
 */
export function updateMessageState(
  messageId: EARS.EntityId,
  updates: Partial<Pick<MessageEntity, 'text' | 'blocks' | 'blockResponse' | 'responseTimestamp' | 'status' | 'context' | 'forkable' | 'compacted'>>
): void {
  try {
    repository.chatCommands.updateMessageState({
      messageId,
      updates
    });
  } catch (err) {
    logger.error(`updateMessageState failed for ${messageId}`, { error: errorMessage(err) });
  }
}

/**
 * Create a marker message that compacts eligible prior messages in a thread.
 * The repository determines which messages are eligible (excludes markers and already-compacted).
 */
export function createMarkerMessage(params: {
  threadId: EARS.EntityId;
  text: string;
}): { messageId: EARS.EntityId; compactedMessageIds: EARS.EntityId[] } {
  const result = repository.chatCommands.createMarkerMessage(params);
  return { messageId: result.id, compactedMessageIds: result.compactedMessageIds };
}

/** Add several messages to a thread at once, leaving queued messages where they are (a bulk import) */
export function addMessagesToThread(params: {
  threadId: EARS.EntityId;
  messages: Array<{
    text: string;
    sender: 'user' | 'assistant' | 'system' | 'marker';
    forkable?: boolean;
    context?: Record<string, unknown>;
  }>;
}): void {
  for (const msg of params.messages) {
    repository.chatCommands.addMessage({
      threadId: params.threadId,
      ...msg,
      skipRelink: true,
    });
  }
}

/**
 * Create a new thread
 *
 * @example
 * const { id: threadId, shortCode, timestamp, status } = createThread({
 *   topic: 'Assistant Birth',
 *   instructions: 'Welcome!',
 *   role: EARS.RoleKind.ASSISTANT_BIRTH,
 *   forcedMode: 'birth'
 * });
 */
export function createThread(
  options: ThreadCreateData
): { id: EARS.EntityId; shortCode: string; timestamp: number; status: string } {
  return repository.threadCommands.create(options);
}

/**
 * Open a thread in the chat: visited (`visitThread`), and the chat told to show it — the window that asked, or, from an action, which has no asker, every
 * window, as `answer` decides.
 */
export function showThread(
  threadId: EARS.EntityId,
  options: { restore?: boolean; reply?: Reply<OutgoingThreadsEvents> } = {},
): void {
  visitThread(threadId, options);
  answer(options.reply, { type: 'SHOW_THREAD', threadId, ...(options.restore && { restore: options.restore }) });
}

/**
 * What opening a thread writes, for a window that opened it itself: marked visited (unless this restores the window's
 * chat), and a finished turn's `success` flash cleared. Throws for a thread that is gone.
 */
export function visitThread(threadId: EARS.EntityId, options: { restore?: boolean } = {}): void {
  const thread = repository.threadQueries.byId(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);
  if (!options.restore) repository.threadCommands.markAsVisited(threadId);
  if (thread.chatState === 'success') threadsService.updateChatState(threadId, 'idle');
}

// ─── Reference resolution ─────────────────────────────────────────────────

/**
 * Resolve all message reference types (images, files, notes, threads,
 * library docs/folders) into prompt-ready content for the Claude Code CLI.
 *
 * Returns:
 * - `textPrefix`  — formatted text for non-image references, prepended to the user message
 * - `imageBlocks` — Anthropic image content blocks (base64-encoded), with text labels
 * - `addDirs`     — directories for `--add-dir` (attached file auto-reads)
 */
export async function resolveReferences(
  references: MessageReferences | undefined,
): Promise<{ textPrefix: string; imageBlocks: any[]; addDirs: string[] }> {
  if (!references) return { textPrefix: '', imageBlocks: [], addDirs: [] };

  const parts: string[] = [];
  const imageBlocks: any[] = [];
  const addDirs: string[] = [];

  // ─── Files ──────────────────────────────────────────────────────────
  if (references.files?.length) {
    for (const file of references.files) {
      parts.push(`[Attached file: ${file.path}]`);
      const lastSlash = file.path.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = file.path.slice(0, lastSlash);
        if (!addDirs.includes(dir)) addDirs.push(dir);
      }
    }
  }

  // ─── Context references (notes, threads, documents, folders) ───────
  if (references.context?.length) {
    for (const ref of references.context) {
      const resolved = await resolveContextRef(ref);
      if (resolved) parts.push(resolved);
    }
  }

  // ─── Images → labeled base64 content blocks ─────────────────────────
  if (references.images?.length) {
    for (const img of references.images) {
      const match = img.url.match(/^media:\/\/([^/]+)\/(.+)$/);
      if (!match) continue;
      const mediaRef = { entityId: match[1], filename: match[2], alt: img.name || '', originalUrl: img.url };
      const result = readMediaBuffer(mediaRef);
      if (!result) continue;
      const label = img.name || match[2];
      imageBlocks.push({ type: 'text', text: `[Image: ${label}]` });
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: result.mimeType,
          data: result.data.toString('base64'),
        },
      });
    }
  }

  return { textPrefix: parts.join('\n\n'), imageBlocks, addDirs };
}

// ─── Per-type context reference resolution ────────────────────────────────

async function resolveContextRef(
  ref: MessageReferences extends { context?: (infer R)[] } ? NonNullable<R> : never,
): Promise<string | undefined> {
  switch (ref.refType) {
    case 'note':
      return resolveNote(ref);
    case 'thread':
      return resolveThread(ref);
    case 'document':
      return resolveDocument(ref);
    case 'folder':
      return resolveFolder(ref);
    default:
      return undefined;
  }
}

function resolveNote(ref: { refId: string; label: string }): string {
  const note = repository.noteQueries.byIdDTO(ref.refId as EARS.EntityId);
  if (!note) return `[Note: ${ref.label} (not found)]`;
  return `--- Note: ${note.title} ---\n${note.content}\n---`;
}

function resolveThread(ref: { refId: string; label: string }): string {
  const thread = repository.threadQueries.byId(ref.refId as EARS.EntityId);
  if (!thread) return `[Thread: ${ref.label} (not found)]`;
  const sessionId = thread.context?.claudeCode?.sessionId;
  return `[Thread: ${thread.topic}${sessionId ? ` (session: ${sessionId})` : ''}]`;
}

async function resolveDocument(ref: { refId: string; label: string }): Promise<string> {
  const resolved = repository.libraryQueries.resolveSymlinkPath(ref.refId);
  if (resolved) return `[Library doc: ${ref.label} → ${resolved.absolutePath}]`;

  const text = repository.libraryQueries.getText(ref.refId as EARS.EntityId);
  if (!text) return `[Library doc: ${ref.label} (not found)]`;
  return `--- Doc: ${ref.label} ---\n${text}\n---`;
}

function resolveFolder(ref: { refId: string; label: string }): string {
  const resolved = repository.libraryQueries.resolveSymlinkPath(ref.refId);
  if (resolved) return `[Library folder: ${ref.label} → ${resolved.absolutePath}]`;
  return `[Library folder: ${ref.label} (id: ${ref.refId})]`;
}

// ─── Aside text generation ────────────────────────────────────────────────

/**
 * Generate a compact aside summary for a collapsed interactive message.
 * Pure function — no side effects.
 */
export function generateAsideText(message: MessageEntity, response: BlockResponse): string {
  // Derive a short context label from blocks (preferred) or message text (fallback).
  // tool-input blocks give us a clean tool name; prompt blocks are shorter than message.text.
  const toolInputBlock = message.blocks?.find(b => b.type === 'tool-input');
  const promptBlock = message.blocks?.find(b => b.type === 'prompt');
  const contextText = message.asideContext
    ?? toolInputBlock?.props?.toolName
    ?? (promptBlock?.props?.content ? truncate(String(promptBlock.props.content), 50) : null)
    ?? (message.text ? truncate(message.text, 50) : null);
  const context = contextText ? ` — ${contextText}` : '';

  // Cancelled
  if (response && typeof response === 'object' && 'cancelled' in response && response.cancelled) {
    return `Cancelled${context}`;
  }

  // Determine the primary interactive block type
  const primaryBlock = message.blocks?.find(b =>
    ['approval', 'choice', 'text', 'question', 'file-picker', 'project-select', 'button-group'].includes(b.type)
  );

  if (!primaryBlock) {
    return truncate(message.text, 80);
  }

  const blockDef = blockRegistry.get(primaryBlock.type);
  if (blockDef?.be?.generateAsideText) {
    const result = blockDef.be.generateAsideText(primaryBlock, response, context);
    if (result !== null) return result;
  }

  switch (primaryBlock.type) {
    case 'approval': {
      if (typeof response === 'object' && response !== null && 'approved' in response) {
        const reason = 'reason' in response && response.reason
          ? `: ${truncate(String(response.reason), 30)}`
          : '';
        const outcome = response.approved ? `✓ Approved${reason}` : `✗ Denied${reason}`;
        return `${outcome}${context}`;
      }
      return truncate(message.text, 80);
    }

    case 'choice': {
      if (typeof response === 'string') {
        return `Selected: ${truncate(response, 40)}${context}`;
      }
      if (Array.isArray(response)) {
        return `Selected: ${truncate(response.join(', '), 40)}${context}`;
      }
      return truncate(message.text, 80);
    }

    case 'text': {
      if (typeof response === 'string') {
        return `Replied: ${truncate(response, 40)}${context}`;
      }
      return truncate(message.text, 80);
    }

    case 'question':
      return `Answered${context}`;

    case 'project-select':
    case 'file-picker': {
      const filePath = typeof response === 'string'
        ? response
        : typeof response === 'object' && response !== null && 'path' in response
          ? (typeof (response as any).path === 'string' ? (response as any).path : (response as any).path?.[0])
          : Array.isArray(response) ? response[0] : null;
      if (filePath) {
        return `Selected: ${truncate(String(filePath), 50)}${context}`;
      }
      if (Array.isArray(response)) {
        return `Selected ${response.length} file${response.length === 1 ? '' : 's'}${context}`;
      }
      return truncate(message.text, 80);
    }

    default:
      return truncate(message.text, 80);
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/** `services.chat`: thread message and notification operations for actions and systems */
export const chatService = {
  sendBlockMessage,
  sendSystemMessage,
  sendChoiceBlock,
  sendQuestionBlock,
  updateMessageState,
  createMarkerMessage,
  addMessagesToThread,
  createThread,
  showThread,
  visitThread,
  resolveReferences,
};
