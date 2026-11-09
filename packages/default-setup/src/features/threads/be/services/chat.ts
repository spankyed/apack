import type { Reply } from '@apackdev/sdk/events';
import { answer } from '../answer.ts';
import { broadcastToSurface } from '#generated/events.ts';
import { EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { BlockConfig, BlockResponse, MessageEntity, OutgoingThreadsEvents, ThreadCreateData, MessageReferences, ToolActivityEntry } from '#features/threads/be/types.ts';

import * as path from 'node:path';
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
    // The rows `addMessage` created, not the configs passed in: a block is addressed by its row
    blocks: result.blocks,
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
  updates: Partial<Pick<MessageEntity, 'text' | 'blockResponse' | 'responseTimestamp' | 'status' | 'context' | 'forkable' | 'compacted'>>
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
 * Writes one of a message's blocks, and answers the row it wrote.
 *
 * **A block is a row, so a write costs that block and nothing else.** It was a field — the whole `blocks`
 * array — and since an attribute is written whole, a 250ms tool-activity flush carried the accumulated
 * thinking text with it, at 170x what a turn left behind. It also meant each writer had to pass the other's
 * block or delete it, which is the coordination that no longer exists.
 *
 * Pass the `blockId` a previous write answered and this is one row by id, with no walk for the type. The
 * first write of a turn has none and creates the row.
 */
export function updateMessageBlock(messageId: EARS.EntityId, block: BlockConfig, blockId?: EARS.EntityId): EARS.EntityId | undefined {
  try {
    return repository.chatCommands.writeMessageBlock({ messageId, block, blockId });
  } catch (err) {
    logger.error(`updateMessageBlock failed for ${messageId}`, { error: errorMessage(err) });
    return undefined;
  }
}

/**
 * Appends the next characters of a block's text to its row.
 *
 * **The durable half of a growing block, and the reason its interval is still worth having.** The feed
 * (`streamMessageBlockText`) carries growth to the windows as it arrives; this commits it, batched, so the
 * interval now decides how often a turn commits rather than how much of it is rewritten. A whole-text write
 * per flush is what made a turn cost 47.9x the text it left behind.
 *
 * `at` is where these characters start, so the row is spliced exactly as a window splices the feed.
 */
export function appendMessageBlockText(blockId: EARS.EntityId, at: number, text: string): void {
  try {
    repository.chatCommands.appendMessageBlockText({ blockId, at, text });
  } catch (err) {
    logger.error(`appendMessageBlockText failed for ${blockId}`, { error: errorMessage(err) });
  }
}

/**
 * Appends the next characters of a message's own text, and folds when there are enough segments.
 *
 * The durable half of a streamed reply. The feed (`streamMessageText`) carries the characters to the
 * windows as they arrive; this commits them, so the interval decides how often a turn commits rather than
 * how much of the reply is written again.
 */
export function appendMessageText(messageId: EARS.EntityId, at: number, text: string): void {
  try {
    repository.chatCommands.appendMessageText({ messageId, at, text });
  } catch (err) {
    logger.error(`appendMessageText failed for ${messageId}`, { error: errorMessage(err) });
  }
}

/**
 * Writes one of a block's tool entries, and answers its row.
 *
 * **The entries' half of what the segments did for the text.** An entry used to be a member of the
 * block's `props.entries`, written whole on every flush — and `details.output` holds the untruncated tool
 * result, so one read of a large file was written again once per later tool event. Writing the entry
 * alone costs that entry.
 *
 * Pass the row id a previous write answered and it is one row by id, with no walk for the entry.
 */
export function updateMessageToolEntry(
  blockId: EARS.EntityId,
  entry: ToolActivityEntry,
  entryRowId?: EARS.EntityId,
): EARS.EntityId | undefined {
  try {
    return repository.chatCommands.writeToolEntry({ blockId, entry, entryRowId });
  } catch (err) {
    logger.error(`updateMessageToolEntry failed for ${blockId}`, { error: errorMessage(err) });
    return undefined;
  }
}

/**
 * Folds a block's children into it, so a finished block is one row again.
 *
 * The segments and entry rows under a block make a *turn's* writes cost what they write; once the turn is
 * over they are only cost, to every read of that message and to the store for as long as the thread lives.
 */
export function compactMessageBlock(blockId: EARS.EntityId): void {
  try {
    repository.chatCommands.compactMessageBlock({ blockId });
  } catch (err) {
    logger.error(`compactMessageBlock failed for ${blockId}`, { error: errorMessage(err) });
  }
}

/**
 * Removes a message's block of that type.
 *
 * What a writer calls when its block should no longer be there — a tool-activity writer finalising with no
 * entries. It used to be written as a rewrite of the *surviving* blocks, so removing one rewrote the other.
 */
export function removeMessageBlock(messageId: EARS.EntityId, type: string): void {
  try {
    repository.chatCommands.removeMessageBlock({ messageId, type });
  } catch (err) {
    logger.error(`removeMessageBlock failed for ${messageId}`, { error: errorMessage(err) });
  }
}

/**
 * Sends the next characters of a streamed reply to the windows showing that message.
 *
 * **The feed beside the row, which is what makes a streamed reply affordable** (G1). `updateMessageState`
 * writes the whole message, and a streamed reply used to call it every 80 ms — `flushes x final size / 2`
 * bytes, 15 MB for a 40 KB reply over a minute, quadratic in the reply's length. So the row is written on a
 * slower clock and the characters travel here, which is what `default-setup/CLAUDE.md` means by *a feed is
 * news too … as streaming tokens would*.
 *
 * It is a broadcast because every window showing the message needs it and nobody asked for it, and it
 * carries `at` rather than the text so far so a window can splice it onto what its view last gave it. The
 * channel choice lives here, beside `updateMessageState`, so an action keeps calling `services.chat`.
 */
export function streamMessageText(params: {
  messageId: EARS.EntityId;
  at: number;
  text: string;
  done?: true;
}): void {
  broadcastToSurface('threads', {
    type: 'MESSAGE_TEXT_APPENDED',
    messageId: params.messageId,
    at: params.at,
    text: params.text,
    ...(params.done ? { done: true as const } : {}),
  });
}

/**
 * Sends the next characters of a growing **block** to the windows showing that message.
 *
 * **The same split as `streamMessageText`, for the one field that grows rather than changes.** A block is
 * written with `updateMessageState({ blocks })`, which replaces the whole field — so a thinking block that
 * grows for three minutes was rewritten in full on every flush, and what reached storage was a multiple of
 * what the user was left with. The multiple grew with the turn, which is what makes it the same defect G1
 * names for text and not a slower version of it.
 *
 * So the characters travel here and the row is written on the durable clock. `block` names the block's type
 * — one of a message's blocks is a `thinking` block, one a `tool-activity` block — because a message holds
 * several and a window has to know which one a run belongs to. Everything else is the text feed's contract:
 * `at` is the offset so a window splices onto what its view last gave it, a run that starts past the end of
 * what the window holds is a stream it joined late and is ignored until the row catches up, and `done`
 * drops the run after the row has been written.
 *
 * **What this channel cannot carry is a change.** A block's label, its state and a re-projected list are
 * rewrites, not appends, and they go on the row. This is for growth alone.
 */
export function streamMessageBlockText(params: {
  messageId: EARS.EntityId;
  blockId: EARS.EntityId;
  at: number;
  text: string;
  done?: true;
}): void {
  broadcastToSurface('threads', {
    type: 'MESSAGE_BLOCK_TEXT_APPENDED',
    messageId: params.messageId,
    blockId: params.blockId,
    at: params.at,
    text: params.text,
    ...(params.done ? { done: true as const } : {}),
  });
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

/** Add several messages to a thread at once (a bulk import), moving its queued messages after them once */
export function addMessagesToThread(params: {
  threadId: EARS.EntityId;
  messages: Array<{
    text: string;
    sender: 'user' | 'assistant' | 'system' | 'marker';
    forkable?: boolean;
    context?: Record<string, unknown>;
  }>;
}): void {
  params.messages.forEach((msg, at) => {
    repository.chatCommands.addMessage({
      threadId: params.threadId,
      ...msg,
      skipRelink: at < params.messages.length - 1,
    });
  });
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

  // ─── Context references (notes, threads, documents, folders, code symbols) ───────
  if (references.context?.length) {
    for (const ref of references.context) {
      const resolved = await resolveContextRef(ref);
      if (resolved) parts.push(resolved.text);
      if (resolved?.dir && !addDirs.includes(resolved.dir)) addDirs.push(resolved.dir);
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
): Promise<{ text: string; dir?: string } | undefined> {
  const text = (value: string | undefined) => value === undefined ? undefined : { text: value };
  switch (ref.refType) {
    case 'note':
      return text(resolveNote(ref));
    case 'thread':
      return text(resolveThread(ref));
    case 'document':
      return text(await resolveDocument(ref));
    case 'folder':
      return text(resolveFolder(ref));
    case 'symbol':
      return resolveSymbol(ref);
    default:
      return undefined;
  }
}

/**
 * A code symbol as where it is now and what it looks like, not its source: the agent reads the file, as it does an
 * attached one, so its directory is added beside the text
 */
async function resolveSymbol(ref: { refId: string; label: string }): Promise<{ text: string; dir?: string }> {
  const found = await repository.codeIndexAnswers.locate(ref.refId as EARS.EntityId);
  if (!found) return { text: `[Code symbol no longer indexed: ${ref.label}]` };
  const { symbol, local, location } = found;
  return {
    text: `[Code symbol: ${symbol.kind} ${local} at ${location.path}:${location.line}]\n${symbol.signature}`,
    dir: path.dirname(location.path),
  };
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
  updateMessageBlock,
  appendMessageBlockText,
  appendMessageText,
  updateMessageToolEntry,
  compactMessageBlock,
  removeMessageBlock,
  streamMessageText,
  streamMessageBlockText,
  createMarkerMessage,
  addMessagesToThread,
  createThread,
  showThread,
  visitThread,
  resolveReferences,
};
