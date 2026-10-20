import { readSavedClaudeNativeLaunch, readClaudePlanRestoreMode } from '#features/code/be/services/claude-code/native-launch.ts';
import { prepareClaudeNativeInput } from './claude-native-input.ts';
import { syncClaudeTerminalThread } from './claude-terminal-sync.ts';
import { createClaudeTerminalViews } from './claude-terminal-views.ts';
import { registerThreadTeardown } from './thread-teardown.ts';
import { submitClaudeParentCommand, handleClaudeUiView, suspendClaudeUiThreadViews } from './claude-ui.ts';
import { featureSettings } from '#generated/settings.ts';

import { sendToSystem, broadcastToSurface } from '#generated/events.ts';
import { services } from '#generated/services.ts';
import { assign, setup, fromPromise, spawnChild } from 'xstate';
import { runThreadHistoryOperation, type ThreadHistoryOperationInput } from './history-operation.ts';
import { answer } from './answer.ts';
import { defineSystem } from '@apackdev/sdk/framework';

import { write, EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { Contract } from './contract.ts';
import type { MessageEntity, ThreadLinkItem } from './types.ts';
import { type ChangeBlock, toMap, toIdentifierSet, mapScalar, mapArray } from '@apackdev/sdk/utils';
import { exportThreads } from './export-threads.ts';
import { importThreads } from './import-threads.ts';
import { runThreadTeardown } from './thread-teardown.ts';
import { generateAsideText } from './services/chat.ts';
import { createLogger, reportError } from '@apackdev/sdk/logger';

import { errorMessage } from '@apackdev/sdk/utils/pure';

const terminalHistory = new WeakMap<Awaited<ReturnType<typeof services.cli.claudeCode.openNativeTerminal>>, ReturnType<typeof syncClaudeTerminalThread>>();
const terminalViews = createClaudeTerminalViews({
  beforeViewChange: (_client, threadId) => suspendClaudeUiThreadViews(threadId),
  command: submitClaudeParentCommand,
  accepted: (owner, receipt, references) => terminalHistory.get(owner)?.acceptSubmission(receipt, references),
  prepareInput: (text, references) => prepareClaudeNativeInput(text, references, services.chat.resolveReferences),
  get: key => services.cli.claudeCode.getNativeTerminal(key),
  async open(key, signal) {
    const state = repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode;
    if (state?.historyError || state?.forkPending || state?.forkFrom || state?.revertTo) throw new Error('Complete or reset the pending history change before opening the native interface');
    const resume = readSavedClaudeNativeLaunch(state);
    const prePlanMode = readClaudePlanRestoreMode(state);
    const owner = await services.cli.claudeCode.openNativeTerminal(key, {...(resume ? {resume} : {}), ...(prePlanMode ? {prePlanMode} : {}), signal});
    terminalHistory.set(owner, syncClaudeTerminalThread(key as EARS.EntityId, owner, () => {
      const current = services.cli.claudeCode.getNativeTerminal(key);
      return current === owner;
    }, () => services.cli.claudeCode.getNativeLaunch(key)));
    return owner;
  },
});
registerThreadTeardown(key => terminalViews.clear(key));
const logger = createLogger('threads');
export const threadsSpec = defineSystem<Contract>();

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
    historyOperation: fromPromise(async ({input, signal}: {input: ThreadHistoryOperationInput; signal: AbortSignal}) => runThreadHistoryOperation(input, signal)),
  },
  actions: threadsSpec.actions({
    claudeTerminalView: ({ event, client, reply }) => {
      if (event.type === 'CLAUDE_TERMINAL_MOUNT' || event.type === 'CLAUDE_TERMINAL_UNMOUNT' || event.type === 'CLAUDE_TERMINAL_OPEN' || event.type === 'CLAUDE_TERMINAL_CANCEL_OPEN' || event.type === 'CLAUDE_TERMINAL_SUBMIT' || event.type === 'CLAUDE_TERMINAL_INPUT' || event.type === 'CLAUDE_TERMINAL_RESIZE' || event.type === 'CLAUDE_TERMINAL_CLOSE' || event.type === 'CLAUDE_TERMINAL_TASK' || event.type === 'CLAUDE_TERMINAL_NOTICE') terminalViews.handle(event, client, reply);
    },
    claudeUiView: ({ event, client, reply }) => {
      if (event.type === 'CLAUDE_UI_COMMAND_PANEL' || event.type === 'CLAUDE_UI_COMMAND_DECISION' || event.type === 'CLAUDE_UI_AGENT_INPUT' || event.type === 'CLAUDE_UI_CLIENT' || event.type === 'CLAUDE_UI_NOTICE' || event.type === 'CLAUDE_UI_SCROLL' || event.type === 'CLAUDE_UI_PANE' || event.type === 'CLAUDE_UI_MOUNT' || event.type === 'CLAUDE_UI_UNMOUNT' || event.type === 'CLAUDE_UI_PRESS' || event.type === 'CLAUDE_UI_FIELD' || event.type === 'CLAUDE_UI_FOCUS' || event.type === 'CLAUDE_PROMPT_HOST_RESPONSE' || event.type === 'CLAUDE_PROMPT_EDIT' || event.type === 'CLAUDE_PROMPT_AUTOCOMPLETE') handleClaudeUiView(event, client, reply);
    },
    // ---- Thread management actions ----
    sendThreadsConnectedData: () => {
      const connectedData = repository.threadQueries.connectedData();
      const threadsSettings = featureSettings.forFeature('threads').get();

      broadcastToSurface('threads', {
        type: 'THREAD_CONNECTED',
        data: {
          ...connectedData,
          settings: threadsSettings || null
        }
      });
    },
    sendArchivedThreads: () => {
      broadcastToSurface('threads', {
        type: 'ARCHIVED_THREADS_DATA',
        threads: repository.threadQueries.archivedThreads(),
      });
    },
    createThread: ({ event }) => {
      const thread = threadsSpec.typeOf('CREATE_THREAD', event);

      const { id: newThreadId, ...rest } = repository.threadCommands.create({
        topic: thread.topic,
        instructions: thread.instructions,
        tags: thread.tags as string[],
        linkedThreads: thread.linkedThreads as ThreadLinkItem[],
      });

      if (thread.parentThreadId) {
        repository.threadCommands.update(
          thread.parentThreadId as EARS.EntityId,
          {
            linkedThreads: [{
              id: newThreadId,
              relation: 'parent_of' as const
            }]
          }
        );
      }

      broadcastToSurface('threads', {
        type: 'THREAD_CREATED',
        id: newThreadId,
        entityType: EARS.Entity.Thread,
        ...rest
      });
    },
    sendViewData: ({ event }) => {
      const threadId = threadsSpec.typeOf('VIEW_THREAD', event).threadId as EARS.EntityId;

      repository.threadCommands.markAsVisited(threadId);

      broadcastToSurface('threads', {
        type: 'SET_VIEW_DATA',
        id: threadId,
        data: repository.threadQueries.extendedData(threadId),
      });
    },
    updateThreadField: ({ event }) => {
      const { key, value, threadId } = threadsSpec.typeOf('UPDATE_THREAD_FIELD', event);
      const updates = { [key]: value };
      try {
        repository.threadCommands.update(threadId as EARS.EntityId, updates);
      } catch (error) {
        const operation =
          key === 'archived' ? (value ? 'archive' : 'unarchive') :
          key === 'pinned' ? (value ? 'pin' : 'unpin') :
          'update';
        logger.warn('Failed to update thread field', { threadId, key, error });
        reportThreadOperationError(operation, error, threadId);
        return;
      }

      if (key === 'status') {
        broadcastToSurface('threads', {
          type: 'THREAD_UPDATED',
          threadId,
          updates: { status: value as string },
        });
      }

      if (key === 'archived') {
        // Refresh thread list and recent threads since thread visibility changed
        broadcastToSurface('threads', {
          type: 'THREAD_CONNECTED',
          data: {
            ...repository.threadQueries.connectedData(),
            settings: featureSettings.forFeature('threads').get() ?? null,
          },
        });
        // Also refresh archived threads list so the change is visible immediately
        broadcastToSurface('threads', {
          type: 'ARCHIVED_THREADS_DATA',
          threads: repository.threadQueries.archivedThreads(),
        });
        services.chat.sendRecentThreadsRefresh();
      }

      if (key === 'pinned') {
        broadcastToSurface('threads', {
          type: 'THREAD_UPDATED',
          threadId,
          updates: { pinned: value as boolean },
        });
        services.chat.sendRecentThreadsRefresh();
      }

      if (key === 'topic') {
        services.chat.sendRecentThreadsRefresh();
      }
    },
    updateThreadStatus: ({ event }) => {
      const { threadId, status } = threadsSpec.typeOf('UPDATE_THREAD_STATUS', event);
      const updates = { status };
      try {
        repository.threadCommands.update(threadId as EARS.EntityId, updates);
      } catch (error) {
        logger.warn('Failed to update thread status', { threadId, status, error });
        reportThreadOperationError('status', error, threadId);
        return;
      }

      broadcastToSurface('threads', {
        type: 'THREAD_UPDATED',
        threadId,
        updates: { status },
      });

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
          let touched = false;

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
              broadcastToSurface('threads', { type: 'THREAD_UPDATED', threadId: th.id, updates: patch });
              touched = true;
            }
          }

          if (touched) {
            broadcastToSurface('threads', {
                type: 'THREAD_CONNECTED',
                data: {
                  ...repository.threadQueries.connectedData(),
                  settings: featureSettings.forFeature('threads').get() ?? null,
                },
              });
          }
        }
      }

      // Always refresh recent threads — sort order or limit may have changed
      services.chat.sendRecentThreadsRefresh();
    },
    setThreadParent: ({ event }) => {
      const { childIds, parentId } = threadsSpec.typeOf('SET_THREAD_PARENT', event);

      try {
        repository.threadCommands.setParent(
          parentId as EARS.EntityId,
          childIds.map(id => id as EARS.EntityId),
        );
      } catch (error) {
        logger.warn('Failed to set thread parent', { childIds, parentId, error });
        reportThreadOperationError('parent', error, parentId);
        return;
      }

      // Refresh all thread data on the frontend
      broadcastToSurface('threads', {
        type: 'THREAD_CONNECTED',
        data: {
          ...repository.threadQueries.connectedData(),
          settings: featureSettings.forFeature('threads').get() ?? null,
        },
      });
    },
    deleteThread: ({ event }) => {
      const { threadId } = threadsSpec.typeOf('DELETE_THREAD', event);

      // Stop active processes before hard-deleting the thread.
      runThreadTeardown(threadId);

      try {
        repository.threadCommands.delete(threadId as EARS.EntityId);
      } catch (error) {
        logger.warn('Failed to delete thread (may already be deleted)', { threadId, error });
        reportThreadOperationError('delete', error, threadId);
        return;
      }

      broadcastToSurface('threads', {
        type: 'THREAD_DELETED',
        threadId,
      });

      // Refresh recent threads since active thread may have been deleted
      services.chat.sendRecentThreadsRefresh();
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

        const connectedData = repository.threadQueries.connectedData();
        const threadsSettings = featureSettings.forFeature('threads').get();

        broadcastToSurface('threads', {
          type: 'THREAD_CONNECTED',
          data: {
            ...connectedData,
            settings: threadsSettings || null,
          },
        });
      } catch (err) {
        const message = errorMessage(err);
        answer(reply, {
          type: 'THREADS_IMPORT_FAILED',
          errors: [message],
        });
      }
    },

    sendChatConnectedData: () => {
      const data = repository.chatQueries.connectedData();
      broadcastToSurface('threads', {
        type: 'AGENT_CONNECTED',
        data,
      });
    },
    sendThreadChatData: ({ event, reply }) => {
      const { threadId, restore } = threadsSpec.typeOf('OPEN_THREAD_CHAT', event);
      try {
        services.chat.openThreadChatAndRefreshRecent(threadId as EARS.EntityId, { restore, reply });
      } catch (err) {
        logger.warn('Thread not found for chat open, skipping', { threadId });
        broadcastToSurface('threads', {
          type: 'THREAD_CHAT_ERROR',
          threadId: threadId as string,
          error: errorMessage(err),
        });
      }
    },
    loadMoreMessages: ({ event }) => {
      const { threadId, cursor } = threadsSpec.typeOf('LOAD_MORE_MESSAGES', event);
      const result = repository.chatQueries.paginatedMessages(threadId as EARS.EntityId, cursor);
      broadcastToSurface('threads', {
        type: 'OLDER_MESSAGES_LOADED',
        threadId,
        ...result,
      });
    },
    sendThreadTabData: ({ event, reply }) => {
      const { threadId } = threadsSpec.typeOf('OPEN_THREAD_TAB', event);
      try {
        services.chat.openThreadTabAndRefresh(threadId as EARS.EntityId, { reply });
      } catch (err) {
        logger.warn('Thread not found for tab open, skipping', { threadId });
        broadcastToSurface('threads', {
          type: 'THREAD_CHAT_ERROR',
          threadId: threadId as string,
          error: errorMessage(err),
        });
      }
    },
    forwardUserMessage: ({ event }) => {
      try {
        const { text, mode, phase, threadId: providedThreadId, references, cwdOverride, forceDirectoryPicker } = threadsSpec.typeOf('USER_MSG', event);

        const sanitizedRefs = references ? {
          ...references,
          ...(references.files && {
            files: references.files.map(({ ...rest }: any) => rest),
          }),
        } : undefined;

        let threadId: EARS.EntityId;
        let threadData: any = null;

        if (!providedThreadId) {
          const result = repository.chatCommands.createThreadFromMessage(text);
          threadId = result.threadId;
          threadData = result.threadData;

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

        if (threadData) {
          const fullThreadData = repository.threadQueries.byId(threadData.id);

          broadcastToSurface('threads', {
            type: 'THREAD_CREATED',
            id: threadData.id,
            shortCode: threadData.shortCode,
            entityType: EARS.Entity.Thread,
            timestamp: threadData.timestamp,
            topic: fullThreadData?.topic,
            instructions: fullThreadData?.instructions,
            status: fullThreadData?.status
          });

          broadcastToSurface('threads', {
            type: 'LOAD_CHAT_THREAD',
            data: repository.chatQueries.threadData(threadId)!
          });
        } else {
          const userMessage: MessageEntity = {
            id: messageResult.id,
            entityType: EARS.Entity.Message,
            text: messageResult.text,
            sender: messageResult.sender as 'user' | 'assistant' | 'system',
            timestamp: messageResult.timestamp,
            createdAt: messageResult.timestamp,
            updatedAt: messageResult.timestamp,
            ...(sanitizedRefs && { references: sanitizedRefs }),
          };

          broadcastToSurface('threads', {
            type: 'MESSAGE_ADDED',
            threadId: threadId as string,
            message: userMessage
          });
        }

        services.chat.sendRecentThreadsRefresh();

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
        broadcastToSurface('threads', {
          type: 'THREAD_CHAT_ERROR',
          threadId: 'threadId' in event && typeof event.threadId === 'string' ? event.threadId : '',
          error: errorMessage(err),
        });
      }
    },
    forwardUserCommand: ({ event }) => {
      try {
      const { command, text, mode, phase, threadId: providedThreadId, references, cwdOverride } = threadsSpec.typeOf('USER_COMMAND', event);

      const sanitizedRefs = references ? {
        ...references,
        ...(references.files && {
          files: references.files.map(({ ...rest }: any) => rest),
        }),
      } : undefined;

      let threadId: EARS.EntityId;
      let threadData: any = null;

      if (!providedThreadId) {
        const topicText = text ? `/${command} ${text}` : `/${command}`;
        const result = repository.chatCommands.createThreadFromMessage(topicText);
        threadId = result.threadId;
        threadData = result.threadData;

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

      if (threadData) {
        const fullThreadData = repository.threadQueries.byId(threadData.id);

        broadcastToSurface('threads', {
          type: 'THREAD_CREATED',
          id: threadData.id,
          shortCode: threadData.shortCode,
          entityType: EARS.Entity.Thread,
          timestamp: threadData.timestamp,
          topic: fullThreadData?.topic,
          instructions: fullThreadData?.instructions,
          status: fullThreadData?.status
        });

        broadcastToSurface('threads', {
          type: 'LOAD_CHAT_THREAD',
          data: repository.chatQueries.threadData(threadId)!
        });
      } else {
        const userMessage: MessageEntity = {
          id: messageResult.id,
          entityType: EARS.Entity.Message,
          text: messageResult.text,
          sender: messageResult.sender as 'user' | 'assistant' | 'system',
          timestamp: messageResult.timestamp,
          createdAt: messageResult.timestamp,
          updatedAt: messageResult.timestamp,
          ...(sanitizedRefs && { references: sanitizedRefs }),
          isCommand: true,
          command,
        };

        broadcastToSurface('threads', {
          type: 'MESSAGE_ADDED',
          threadId: threadId as string,
          message: userMessage
        });
      }

      services.chat.sendRecentThreadsRefresh();

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
    forkThread: spawnChild('historyOperation', { input: threadsSpec.input(({event, reply}) => {
      const request = threadsSpec.typeOf('FORK_THREAD', event);
      const threadId = request.threadId ?? '';
      const readSnapshot = () => JSON.stringify({thread: repository.threadQueries.byId(threadId as EARS.EntityId),
        messages: repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages});
      return { request: {kind: 'fork' as const, threadId, messageId: request.messageId},
        snapshot: readSnapshot(), readSnapshot,
        rejected: (error: unknown) => {
          logger.warn('History validation rejected fork', {threadId, error: errorMessage(error)});
          if (threadId) services.chat.sendBlockMessage({threadId: threadId as EARS.EntityId, text: `Could not fork: ${errorMessage(error)}`, blocks: [], forkable: false});
        },
        commit: () => {
          const { messageId, threadId, threadTopic } = threadsSpec.typeOf('FORK_THREAD', event);
          if (!threadId) return;

          let result: { id: EARS.EntityId } | undefined;
          const forkContext: Record<string, any> = {};

          try {
            const sourceMessages = repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages ?? [];
            const sourceIndex = sourceMessages.findIndex((m: any) => m.id === messageId);
            const sourceUserMessagesAfterFork = sourceIndex >= 0
              ? sourceMessages.slice(sourceIndex + 1).filter((m: any) => m.sender === 'user' && !m.deleted).length
              : 0;
            const originalTopic = threadTopic || 'Untitled';

            const forkCount = repository.threadCommands.forkCount(threadId as EARS.EntityId);
            const forkTopic = `Fork ${forkCount + 1} - ${originalTopic}`;

            result = services.chat.createThreadAndNotify({ topic: forkTopic, instructions: '' });
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

            services.chat.openThreadChatAndRefreshRecent(result.id, { reply });

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
      };
    }) }),
    revertThread: spawnChild('historyOperation', { input: threadsSpec.input(({event, reply}) => {
      const request = threadsSpec.typeOf('REVERT_THREAD', event);
      const threadId = request.threadId ?? '';
      const readSnapshot = () => JSON.stringify({thread: repository.threadQueries.byId(threadId as EARS.EntityId),
        messages: repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages});
      return { request: {kind: 'revert' as const, threadId, messageId: request.messageId, restoreFiles: request.restoreFiles, userMessageId: request.userCliUuid},
        snapshot: readSnapshot(), readSnapshot,
        rejected: (error: unknown) => {
          logger.warn('History validation rejected revert', {threadId, error: errorMessage(error)});
          if (threadId) services.chat.sendBlockMessage({threadId: threadId as EARS.EntityId, text: `Could not revert: ${errorMessage(error)}`, blocks: [], forkable: false});
        },
        commit: () => {
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

          services.chat.openThreadChatAndRefreshRecent(threadId as EARS.EntityId, { reply });

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
      };
    }) }),
    summarizeThread: spawnChild('historyOperation', { input: threadsSpec.input(({event, reply}) => {
      const request = threadsSpec.typeOf('SUMMARIZE_THREAD', event);
      const threadId = request.threadId ?? '';
      const readSnapshot = () => JSON.stringify({thread: repository.threadQueries.byId(threadId as EARS.EntityId),
        messages: repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages});
      return { request: {kind: 'summarize' as const, threadId, messageId: request.messageId},
        snapshot: readSnapshot(), readSnapshot,
        rejected: (error: unknown) => {
          logger.warn('History validation rejected summarize', {threadId, error: errorMessage(error)});
          if (threadId) services.chat.sendBlockMessage({threadId: threadId as EARS.EntityId, text: `Could not summarize: ${errorMessage(error)}`, blocks: [], forkable: false});
        },
        commit: () => {
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

          services.chat.openThreadChatAndRefreshRecent(threadId as EARS.EntityId, { reply });

          sendToSystem('brain', {
            type: 'TRIGGER_BRAIN_EVENT',
            eventType: 'thread.revert',
            payload: { threadId, messageId, kind: 'summarize', deletedMessageIds: deletion.deletedIds, deletedUserMessageCount, agents, codexDeletedUserMessageCount },
          });
          } catch (err) {
            logger.error('summarizeThread failed', { error: err });
          }
        },
      };
    }) }),
    pauseTurn: ({ event }) => {
      const { threadId } = threadsSpec.typeOf('PAUSE_TURN', event);
      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'user.thread.pause',
        payload: { threadId },
      });
    },
    setClaudePermissionMode: async ({ event, reply }) => {
      // A chooser outcome belongs only to the window that requested it.
      if (!reply) return;
      const { threadId, mode } = threadsSpec.typeOf('SET_CLAUDE_PERMISSION_MODE', event);
      try {
        const result = await services.action.executeIfFound('CC: Update Permission Mode', { threadId, mode });
        reply({ type: 'CLAUDE_PERMISSION_MODE_RESULT', threadId,
          success: result?.success === true,
          ...(result?.success === true ? {} : { reason: result?.reason ?? 'Permission action is unavailable' }),
        });
      } catch (error) {
        reply({ type: 'CLAUDE_PERMISSION_MODE_RESULT', threadId, success: false, reason: errorMessage(error) });
      }
    },
    forwardBrainEvent: ({ event }) => {
      const { eventType, payload } = threadsSpec.typeOf('FORWARD_BRAIN_EVENT', event);
      sendToSystem('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType, payload });
    },
    forwardInteractiveMessageResponse: ({ event }) => {
      try {
      const { messageId, threadId, response } = threadsSpec.typeOf('INTERACTIVE_MSG_RESPONSE', event);

      const message = repository.chatQueries.messageById(messageId as EARS.EntityId);
      if (!message || !repository.chatQueries.hasMessageInThread(messageId as EARS.EntityId, threadId as EARS.EntityId)) return;
      // Retired one-shot decisions cannot regain authority through a delayed frontend response.
      if (message.responseTimestamp && (message.context?.claudeNativeQuestion || message.blocks?.some(block => block.type === 'question' || block.type === 'approval'))) return;

      const result = repository.chatCommands.updateMessageBlockResponse({
        messageId: messageId as EARS.EntityId,
        response
      });

      // Compute aside text for autoHide messages
      let asideText: string | undefined;
      if (message.autoHide) {
        asideText = generateAsideText(message, response);
        write(messageId as EARS.EntityId).set('asideText', asideText);
      }

      sendToSystem('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'interactive.message.response',
        payload: { messageId, threadId, response }
      });

      broadcastToSurface('threads', {
        type: 'UPDATE_MESSAGE_STATE',
        messageId,
        responseTimestamp: result.responseTimestamp,
        blockResponse: response,
        ...(result.blocks && { blocks: result.blocks }),
        ...(asideText && { asideText })
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
      const messageIds = repository.chatCommands.toggleMarkerCompacted(
        markerId as EARS.EntityId,
        compacted,
      );
      for (const msgId of messageIds) {
        broadcastToSurface('threads', {
          type: 'UPDATE_MESSAGE_STATE',
          messageId: msgId as string,
          compacted,
        });
      }
    },
  }),
}).createMachine(
  {
    id: 'threads',
    initial: 'idle',
    context: () => ({}),
    on: {
      CLAUDE_TERMINAL_MOUNT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_UNMOUNT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_OPEN: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_CANCEL_OPEN: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_SUBMIT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_INPUT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_RESIZE: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_TASK: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_NOTICE: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_CLOSE: { actions: 'claudeTerminalView' },
      CLAUDE_UI_COMMAND_PANEL: { actions: 'claudeUiView' },
      CLAUDE_UI_COMMAND_DECISION: { actions: 'claudeUiView' },
      CLAUDE_UI_AGENT_INPUT: { actions: 'claudeUiView' },
      CLAUDE_UI_MOUNT: { actions: 'claudeUiView' },
      CLAUDE_UI_UNMOUNT: { actions: 'claudeUiView' },
      CLAUDE_UI_PRESS: { actions: 'claudeUiView' },
      CLAUDE_PROMPT_HOST_RESPONSE: { actions: 'claudeUiView' },
      CLAUDE_UI_NOTICE: { actions: 'claudeUiView' },
      CLAUDE_UI_SCROLL: { actions: 'claudeUiView' },
      CLAUDE_UI_PANE: { actions: 'claudeUiView' },
      CLAUDE_UI_FOCUS: { actions: 'claudeUiView' },
      CLAUDE_UI_CLIENT: { actions: 'claudeUiView' },
      CLAUDE_UI_FIELD: { actions: 'claudeUiView' },
      CLAUDE_PROMPT_AUTOCOMPLETE: { actions: 'claudeUiView' },
      CLAUDE_PROMPT_EDIT: { actions: 'claudeUiView' },
      SEND_STATE: {
        actions: ['sendThreadsConnectedData', 'sendChatConnectedData'],
      },
      FEATURE_SETTINGS_UPDATED: {
        actions: 'handleSettingsUpdate',
      },
      // Chat/agent global events
      OPEN_THREAD_CHAT: {
        actions: 'sendThreadChatData',
      },
      LOAD_MORE_MESSAGES: {
        actions: 'loadMoreMessages',
      },
      OPEN_THREAD_TAB: {
        actions: 'sendThreadTabData',
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
            actions: 'sendViewData',
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
          SET_CLAUDE_PERMISSION_MODE: { actions: 'setClaudePermissionMode' },
          FORWARD_BRAIN_EVENT: {
            actions: 'forwardBrainEvent',
          },
          GET_ARCHIVED_THREADS: {
            actions: 'sendArchivedThreads',
          },
          REFRESH_THREADS: {
            actions: 'sendThreadsConnectedData',
          },
        },
      },
    },
  }
);

const threadsEntry = { spec: threadsSpec, machine: threadsSystem };

export default threadsEntry;
