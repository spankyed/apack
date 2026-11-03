import { featureSettings } from '#generated/settings.ts';

import { sendToSystem } from '#generated/events.ts';
import { services } from '#generated/services.ts';
import { setup } from 'xstate';
import { answer } from './answer.ts';
import { defineSystem } from '@apackdev/sdk/framework';

import { write, transact, type EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { Contract } from './contract.ts';
import type { OutgoingThreadsEvents, ThreadLinkItem } from './types.ts';
import type { Reply } from '@apackdev/sdk/events';
import { type ChangeBlock, toMap, toIdentifierSet, mapScalar, mapArray } from '@apackdev/sdk/utils';
import { exportThreads } from './export-threads.ts';
import { importThreads } from './import-threads.ts';
import { runThreadTeardown } from './thread-teardown.ts';
import { generateAsideText } from './services/chat.ts';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { RepositoryError, RepositoryErrorCode } from '@apackdev/sdk/repositories';

import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('threads');
export const threadsSpec = defineSystem<Contract>();

/**
 * One of a window's writes to its threads, answered to whoever asked: with the thread it made, or that it landed, or
 * why it was refused, since the surface holds its views behind its own unanswered writes. The write runs whether or
 * not anybody asked. A refusal is also reported, as every thread operation's failure is.
 */
function answerWrite(
  reply: Reply<OutgoingThreadsEvents> | undefined,
  refused: (error: unknown) => void,
  write: () => OutgoingThreadsEvents | void,
): void {
  let outcome: OutgoingThreadsEvents;
  try {
    outcome = write() ?? { type: 'THREAD_WRITTEN' };
  } catch (error) {
    refused(error);
    reply?.({ type: 'THREAD_WRITE_FAILED', error: errorMessage(error) });
    return;
  }
  reply?.(outcome);
}

function reportThreadOperationError(
  operation: 'create' | 'update' | 'delete' | 'archive' | 'unarchive' | 'pin' | 'unpin' | 'status' | 'parent',
  error: unknown,
  threadId?: string,
) {
  const operationLabels: Record<typeof operation, string> = {
    create: 'create',
    update: 'update',
    delete: 'delete',
    archive: 'archive',
    unarchive: 'unarchive',
    pin: 'pin',
    unpin: 'unpin',
    status: 'update status for',
    parent: 'move',
  };

  reportError({
    error,
    title: `Could not ${operationLabels[operation]} thread`,
    source: 'threads',
    operation,
    entityId: threadId,
  });
}

export const threadsSystem = setup({
  types: threadsSpec.types,
  actors: {
  },
  actions: threadsSpec.actions({
    // ---- Thread management actions ----
    createThread: ({ event, reply }) => {
      const thread = threadsSpec.typeOf('CREATE_THREAD', event);
      // The thread and its parent's link are one unit, so a refused link leaves no thread behind
      answerWrite(reply, (error) => reportThreadOperationError('create', error), () => transact(() => {
        const { id: newThreadId } = repository.threadCommands.create({
          topic: thread.topic,
          instructions: thread.instructions,
          tags: thread.tags as string[],
          linkedThreads: thread.linkedThreads as ThreadLinkItem[],
        });

        if (thread.parentThreadId) {
          repository.threadCommands.addLinks(thread.parentThreadId as EARS.EntityId, [{ id: newThreadId, relation: 'parent_of' }]);
        }
        return { type: 'THREAD_CREATED' as const, id: newThreadId };
      }));
    },
    visitThread: ({ event }) => {
      repository.threadCommands.markAsVisited(threadsSpec.typeOf('VIEW_THREAD', event).threadId as EARS.EntityId);
    },
    updateThreadField: ({ event, reply }) => {
      const { key, value, threadId } = threadsSpec.typeOf('UPDATE_THREAD_FIELD', event);
      const operation =
        key === 'archived' ? (value ? 'archive' : 'unarchive') :
        key === 'pinned' ? (value ? 'pin' : 'unpin') :
        'update';
      answerWrite(reply, (error) => {
        logger.warn('Failed to update thread field', { threadId, key, error });
        // A link closing a loop is the form's to show, answered to it with the reason
        if (key === 'linkedThreads' && error instanceof RepositoryError && error.code === RepositoryErrorCode.VALIDATION_ERROR) return;
        reportThreadOperationError(operation, error, threadId);
      }, () => { repository.threadCommands.update(threadId as EARS.EntityId, { [key]: value }); });
    },
    updateThreadStatus: ({ event, reply }) => {
      const { threadId, status } = threadsSpec.typeOf('UPDATE_THREAD_STATUS', event);
      let written = false;
      answerWrite(reply, (error) => {
        logger.warn('Failed to update thread status', { threadId, status, error });
        reportThreadOperationError('status', error, threadId);
      }, () => {
        repository.threadCommands.update(threadId as EARS.EntityId, { status });
        written = true;
      });
      if (!written) return;

      // Notify flows — all logic lives in the flow layer
      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'thread.status.changed',
        payload: { threadId, status, userInduced: true },
      });
    },
    handleSettingsUpdate: ({ event }) => {
      const firstStatusLabel = (): string | undefined =>
        featureSettings.forFeature('threads').get()?.statuses?.[0]?.label;

      const { changes } = threadsSpec.typeOf('FEATURE_SETTINGS_UPDATED', event);

      if (changes) {
        const sBlock = changes.statuses as ChangeBlock | undefined;
        const sRenames = toMap(sBlock?.renames);
        const sRemoved = toIdentifierSet(sBlock?.removed, (item: any) => item.label);
        const statusNeedsWork = sRenames.size || sRemoved.size;

        const statusFallback = () => firstStatusLabel();

        const tBlock = changes.tags as ChangeBlock | undefined;
        const tRenames = toMap(tBlock?.renames);
        const tRemoved = toIdentifierSet(tBlock?.removed, (item: any) => item.name);
        const tagNeedsWork = tRenames.size || tRemoved.size;

        if (statusNeedsWork || tagNeedsWork) {
          for (const th of repository.threadQueries.all()) {
            const patch: { status?: string; tags?: string[] } = {};

            if (statusNeedsWork) {
              const nextStatus = mapScalar(th.status, sRenames, sRemoved, statusFallback);
              if (nextStatus !== th.status && nextStatus) {
                patch.status = nextStatus;
              }
            }

            if (tagNeedsWork) {
              const { next: nextTags, changed } = mapArray(th.tags, tRenames, tRemoved);
              if (changed) {
                patch.tags = nextTags;
              }
            }

            if (Object.keys(patch).length) {
              repository.threadCommands.update(th.id, patch);
            }
          }
        }
      }
    },
    setThreadParent: ({ event, reply }) => {
      const { childIds, parentId } = threadsSpec.typeOf('SET_THREAD_PARENT', event);
      answerWrite(reply, (error) => {
        logger.warn('Failed to set thread parent', { childIds, parentId, error });
        reportThreadOperationError('parent', error, parentId);
      }, () => {
        repository.threadCommands.setParent(parentId as EARS.EntityId, childIds.map(id => id as EARS.EntityId));
      });
    },
    deleteThread: ({ event, reply }) => {
      const { threadId } = threadsSpec.typeOf('DELETE_THREAD', event);

      // Stop active processes before hard-deleting the thread.
      runThreadTeardown(threadId);

      answerWrite(reply, (error) => {
        logger.warn('Failed to delete thread (may already be deleted)', { threadId, error });
        reportThreadOperationError('delete', error, threadId);
      }, () => { repository.threadCommands.delete(threadId as EARS.EntityId); });
    },
    exportThreadsToFile: ({ event, reply }) => {
      const ev = event as { type: 'EXPORT_THREADS'; directory: string };

      try {
        const { filePath, threadCount } = exportThreads(ev.directory);

        answer(reply, {
          type: 'THREADS_EXPORTED',
          filePath,
          threadCount,
        });
      } catch (err) {
        const message = errorMessage(err);
        answer(reply, {
          type: 'THREADS_EXPORT_FAILED',
          errors: [message],
        });
      }
    },
    importThreadItems: ({ event, reply }) => {
      const ev = event as { type: 'IMPORT_THREADS'; directory: string };

      try {
        const result = importThreads(ev.directory);

        if (result.created === 0 && result.errors.length > 0) {
          answer(reply, {
            type: 'THREADS_IMPORT_FAILED',
            errors: result.errors,
          });
          return;
        }

        answer(reply, {
          type: 'THREADS_IMPORTED',
          count: result.created,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        });
      } catch (err) {
        const message = errorMessage(err);
        answer(reply, {
          type: 'THREADS_IMPORT_FAILED',
          errors: [message],
        });
      }
    },

    getChatStart: ({ reply }) => {
      reply?.({ type: 'CHAT_STARTED', data: repository.chatQueries.chatStart() });
    },
    openThreadChat: ({ event, reply }) => {
      const { threadId, restore } = threadsSpec.typeOf('OPEN_THREAD_CHAT', event);
      try {
        services.chat.visitThread(threadId as EARS.EntityId, { restore });
      } catch (err) {
        logger.warn('Thread not found for chat open, skipping', { threadId });
        answer(reply, { type: 'THREAD_CHAT_ERROR', threadId: threadId as string, error: errorMessage(err) });
      }
    },
    forwardUserMessage: ({ event, reply }) => {
      try {
        const { text, mode, phase, threadId: providedThreadId, references, cwdOverride, forceDirectoryPicker } = threadsSpec.typeOf('USER_MSG', event);

        const sanitizedRefs = references ? {
          ...references,
          ...(references.files && {
            files: references.files.map(({ ...rest }: any) => rest),
          }),
        } : undefined;

        let threadId: EARS.EntityId;
        let started = false;

        if (!providedThreadId) {
          const result = repository.chatCommands.createThreadFromMessage(text);
          threadId = result.threadId;
          started = true;

          logger.info('Created new thread for user message', {
            threadId,
            shortCode: result.threadData.shortCode,
          });

          repository.threadCommands.markAsVisited(threadId);
        } else {
          threadId = providedThreadId as EARS.EntityId;
        }

        const messageResult = repository.chatCommands.addMessage({
          threadId,
          text,
          sender: 'user',
          references: sanitizedRefs,
          ...(mode ? { context: { agent: mode } } : {}),
        });

        // The window that sent the first message of a thread shows the thread it started
        if (started) answer(reply, { type: 'SHOW_THREAD', threadId });

        sendToSystem('brain', {
          type: 'TRIGGER_BRAIN_EVENT',
          eventType: 'user.message',
          payload: {
            text,
            mode,
            phase,
            threadId,
            messageId: messageResult.id,
            ...(sanitizedRefs && { references: sanitizedRefs }),
            ...(cwdOverride && { cwdOverride }),
            ...(forceDirectoryPicker && { forceDirectoryPicker }),
          },
        });
      } catch (err) {
        logger.error('forwardUserMessage failed', { error: err });
        answer(reply, {
          type: 'THREAD_CHAT_ERROR',
          threadId: 'threadId' in event && typeof event.threadId === 'string' ? event.threadId : '',
          error: errorMessage(err),
        });
      }
    },
    forwardUserCommand: ({ event, reply }) => {
      try {
      const { command, text, mode, phase, threadId: providedThreadId, references, cwdOverride } = threadsSpec.typeOf('USER_COMMAND', event);

      const sanitizedRefs = references ? {
        ...references,
        ...(references.files && {
          files: references.files.map(({ ...rest }: any) => rest),
        }),
      } : undefined;

      let threadId: EARS.EntityId;
      let started = false;

      if (!providedThreadId) {
        const topicText = text ? `/${command} ${text}` : `/${command}`;
        const result = repository.chatCommands.createThreadFromMessage(topicText);
        threadId = result.threadId;
        started = true;

        logger.info('Created new thread for user command', {
          threadId,
          command,
          shortCode: result.threadData.shortCode,
        });

        repository.threadCommands.markAsVisited(threadId);
      } else {
        threadId = providedThreadId as EARS.EntityId;
      }

      const messageResult = repository.chatCommands.addMessage({
        threadId,
        text: text ? `/${command} ${text}` : `/${command}`,
        sender: 'user',
        references: sanitizedRefs,
        isCommand: true,
        command,
        ...(mode ? { context: { agent: mode } } : {}),
      });

      if (started) answer(reply, { type: 'SHOW_THREAD', threadId });

      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'user.command',
        payload: {
          command,
          text,
          mode,
          phase,
          threadId,
          messageId: messageResult.id,
          ...(sanitizedRefs && { references: sanitizedRefs }),
          ...(cwdOverride && { cwdOverride }),
        },
      });
      } catch (err) {
        logger.error('forwardUserCommand failed', { error: err });
      }
    },
    forkThread: ({ event, reply }) => {
      const { messageId, threadId, threadTopic } = threadsSpec.typeOf('FORK_THREAD', event);
      if (!threadId) return;

      let result: { id: EARS.EntityId } | undefined;
      const forkContext: Record<string, any> = {};

      try {
        const sourceMessages = repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages ?? [];
        const sourceIndex = sourceMessages.findIndex((m: any) => m.id === messageId);
        const sourceUserMessagesAfterFork = sourceIndex >= 0
          ? sourceMessages.slice(sourceIndex + 1).filter((m: any) => m.sender === 'user').length
          : 0;
        const originalTopic = threadTopic || 'Untitled';

        const forkCount = repository.threadCommands.forkCount(threadId as EARS.EntityId);
        const forkTopic = `Fork ${forkCount + 1} - ${originalTopic}`;

        result = services.chat.createThread({ topic: forkTopic, instructions: '' });
        if (!result) throw new Error('Failed to create thread');

        repository.threadCommands.linkFork(threadId as EARS.EntityId, result.id);

        repository.chatCommands.copyMessagesUpTo({
          sourceThreadId: threadId as EARS.EntityId,
          targetThreadId: result.id,
          upToMessageId: messageId,
        });

        // Set forkPending on the NEW thread so chat actions queue messages
        // until the async handle-fork actions finish persisting session state.
        const sourceThread = repository.threadQueries.byId(threadId as EARS.EntityId);
        const sourceContext = (sourceThread as any)?.context ?? {};
        for (const [key, value] of Object.entries(sourceContext)) {
          if (value && typeof value === 'object') {
            forkContext[key] = { forkPending: true };
          }
        }
        if (Object.keys(forkContext).length > 0) {
          repository.threadCommands.update(result.id, { context: forkContext });
        }

        services.chat.showThread(result.id, { reply });

        sendToSystem('brain', {
          type: 'TRIGGER_BRAIN_EVENT',
          eventType: 'thread.fork',
          payload: {
            sourceThreadId: threadId,
            sourceMessageId: messageId,
            newThreadId: result.id,
            sourceUserMessagesAfterFork,
          },
        });
      } catch (err) {
        logger.error('forkThread failed', { error: err });
        // Clear forkPending if it was set, so the thread doesn't permanently reject messages.
        if (result && Object.keys(forkContext).length > 0) {
          const clearContext = Object.fromEntries(
            Object.keys(forkContext).map(key => [key, { forkPending: undefined }])
          );
          repository.threadCommands.update(result.id, { context: clearContext });
        }
      }
    },
    revertThread: ({ event }) => {
      try {
      const { messageId, threadId, restoreFiles, userCliUuid } = threadsSpec.typeOf('REVERT_THREAD', event);
      const beforeMessages = repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages ?? [];

      // Stop active processes before soft-deleting so nothing races
      // against the deletion (e.g. a stream consumer writing to messages).
      runThreadTeardown(threadId);

      const deletion = repository.chatCommands.softDeleteMessagesAfter({
        threadId: threadId as EARS.EntityId,
        messageId: messageId as EARS.EntityId,
      });
      const deletedIds = new Set(deletion.deletedIds);
      const deletedMessages = beforeMessages.filter((m: any) => deletedIds.has(m.id));
      const deletedUserMessageCount = deletedMessages.filter((m: any) => m.sender === 'user').length;

      // Determine which agent flows had messages deleted so each flow can
      // skip its revert handler when it isn't affected.
      const agents = {
        claudeCode: deletedMessages.some((m: any) =>
          m.context?.cliUuid || m.context?.agent === 'Claude Code'
        ),
        codex: deletedMessages.some((m: any) =>
          m.context?.agent === 'Codex'
        ),
      };
      const codexDeletedUserMessageCount = agents.codex
        ? deletedMessages.filter((m: any) => m.sender === 'user' && m.context?.agent === 'Codex').length
        : 0;

      // Unified `thread.revert` brain event — the `kind` discriminator
      // tells the claude-code flow which variant to run.
      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'thread.revert',
        payload: {
          threadId,
          messageId,
          kind: restoreFiles ? 'rewind' : 'revert',
          deletedMessageIds: deletion.deletedIds,
          deletedUserMessageCount,
          agents,
          codexDeletedUserMessageCount,
          ...(restoreFiles && userCliUuid ? { userCliUuid } : {}),
        },
      });
      } catch (err) {
        logger.error('revertThread failed', { error: err });
      }
    },
    summarizeThread: ({ event }) => {
      try {
      const { messageId, threadId } = threadsSpec.typeOf('SUMMARIZE_THREAD', event);
      const beforeMessages = repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages ?? [];

      // Stop active processes before soft-deleting (same as revert).
      runThreadTeardown(threadId);

      // Matches Claude Code's native `direction: 'from'` — the pivot and
      // everything after it disappear from the visible transcript, then a
      // synthetic `/compact` turn runs against the truncated session.
      const deletion = repository.chatCommands.softDeleteMessagesAfter({
        threadId: threadId as EARS.EntityId,
        messageId: messageId as EARS.EntityId,
      });
      const deletedIds = new Set(deletion.deletedIds);
      const deletedMessages = beforeMessages.filter((m: any) => deletedIds.has(m.id));
      const deletedUserMessageCount = deletedMessages.filter((m: any) => m.sender === 'user').length;

      const agents = {
        claudeCode: deletedMessages.some((m: any) =>
          m.context?.cliUuid || m.context?.agent === 'Claude Code'
        ),
        codex: deletedMessages.some((m: any) =>
          m.context?.agent === 'Codex'
        ),
      };
      const codexDeletedUserMessageCount = agents.codex
        ? deletedMessages.filter((m: any) => m.sender === 'user' && m.context?.agent === 'Codex').length
        : 0;

      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'thread.revert',
        payload: { threadId, messageId, kind: 'summarize', deletedMessageIds: deletion.deletedIds, deletedUserMessageCount, agents, codexDeletedUserMessageCount },
      });
      } catch (err) {
        logger.error('summarizeThread failed', { error: err });
      }
    },
    pauseTurn: ({ event }) => {
      const { threadId } = threadsSpec.typeOf('PAUSE_TURN', event);
      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'user.thread.pause',
        payload: { threadId },
      });
    },
    forwardBrainEvent: ({ event }) => {
      const { eventType, payload } = threadsSpec.typeOf('FORWARD_BRAIN_EVENT', event);
      sendToSystem('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType, payload });
    },
    forwardInteractiveMessageResponse: ({ event }) => {
      try {
      const { messageId, threadId, response } = threadsSpec.typeOf('INTERACTIVE_MSG_RESPONSE', event);

      if (!repository.chatQueries.messageById(messageId as EARS.EntityId)) return;

      repository.chatCommands.updateMessageBlockResponse({
        messageId: messageId as EARS.EntityId,
        response
      });

      // Compute aside text for autoHide messages
      let asideText: string | undefined;
      const message = repository.chatQueries.messageById(messageId as EARS.EntityId);
      if (message?.autoHide) {
        asideText = generateAsideText(message, response);
        write(messageId as EARS.EntityId).set('asideText', asideText);
      }

      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'interactive.message.response',
        payload: { messageId, threadId, response }
      });
      } catch (err) {
        logger.error('forwardInteractiveMessageResponse failed', { error: err });
      }
    },
    deleteMessage: ({ event }) => {
      const { messageId } = threadsSpec.typeOf('DELETE_MESSAGE', event);
      if (!repository.chatQueries.messageById(messageId as EARS.EntityId)) return;
      write(messageId as EARS.EntityId).destroy();
    },
    toggleCompacted: ({ event }) => {
      const { markerId, compacted } = threadsSpec.typeOf('TOGGLE_COMPACTED', event);
      repository.chatCommands.toggleMarkerCompacted(markerId as EARS.EntityId, compacted);
    },
  }),
}).createMachine(
  {
    id: 'threads',
    initial: 'idle',
    context: () => ({}),
    on: {
      FEATURE_SETTINGS_UPDATED: {
        actions: 'handleSettingsUpdate',
      },
      // Chat/agent global events
      OPEN_THREAD_CHAT: {
        actions: 'openThreadChat',
      },
      GET_CHAT_START: {
        actions: 'getChatStart',
      },
      THREAD_DELETED: {
        // Internal notification (e.g., refresh chat if active thread deleted)
      },
    },
    states: {
      idle: {
        on: {
          // Thread management
          CREATE_THREAD: {
            actions: 'createThread',
          },
          VIEW_THREAD: {
            actions: 'visitThread',
          },
          UPDATE_THREAD_FIELD: {
            actions: 'updateThreadField',
          },
          UPDATE_THREAD_STATUS: {
            actions: 'updateThreadStatus',
          },
          DELETE_THREAD: {
            actions: 'deleteThread',
          },
          SET_THREAD_PARENT: {
            actions: 'setThreadParent',
          },
          EXPORT_THREADS: {
            actions: 'exportThreadsToFile',
          },
          IMPORT_THREADS: {
            actions: 'importThreadItems',
          },
          // Chat/agent events
          USER_MSG: {
            actions: 'forwardUserMessage',
          },
          INTERACTIVE_MSG_RESPONSE: {
            actions: 'forwardInteractiveMessageResponse',
          },
          USER_COMMAND: {
            actions: 'forwardUserCommand',
          },
          FORK_THREAD: {
            actions: 'forkThread',
          },
          REVERT_THREAD: {
            actions: 'revertThread',
          },
          SUMMARIZE_THREAD: {
            actions: 'summarizeThread',
          },
          TOGGLE_COMPACTED: {
            actions: 'toggleCompacted',
          },
          DELETE_MESSAGE: {
            actions: 'deleteMessage',
          },
          PAUSE_TURN: {
            actions: 'pauseTurn',
          },
          FORWARD_BRAIN_EVENT: {
            actions: 'forwardBrainEvent',
          },
        },
      },
    },
  }
);

const threadsEntry = { spec: threadsSpec, machine: threadsSystem };

export default threadsEntry;
