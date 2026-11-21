import { featureSettings } from '#generated/settings.ts';

import { broadcast, tell } from '#generated/events.ts';
import { services } from '#generated/services.ts';
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';

import { write, transact, type EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { Contract } from './contract.ts';
import type { ThreadLinkItem } from './types.ts';
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

/**
 * A thread operation's failure, reported as well as answered: a window shows its own refusal, and the report is what
 * says it anywhere else
 */
function reported<T>(refused: (error: unknown) => void, write: () => T): T {
  try {
    return write();
  } catch (error) {
    refused(error);
    throw error;
  }
}

export const answers = threadsSpec.answers({
  // The thread and its parent's link are one unit, so a refused link leaves no thread behind
  CREATE_THREAD: ({ args: thread }) => reported((error) => reportThreadOperationError('create', error), () => transact(() => {
    const { id } = repository.threadCommands.create({
      topic: thread.topic,
      instructions: thread.instructions,
      tags: thread.tags as string[],
      linkedThreads: thread.linkedThreads as ThreadLinkItem[],
    });
    if (thread.parentThreadId) {
      repository.threadCommands.addLinks(thread.parentThreadId as EARS.EntityId, [{ id, relation: 'parent_of' }]);
    }
    return { id };
  })),
  UPDATE_THREAD_FIELD: ({ args: { key, value, threadId } }) => {
    const operation =
      key === 'archived' ? (value ? 'archive' : 'unarchive') :
      key === 'pinned' ? (value ? 'pin' : 'unpin') :
      'update';
    reported((error) => {
      logger.warn('Failed to update thread field', { threadId, key, error });
      // A link closing a loop is the form's to show, answered to it with the reason
      if (key === 'linkedThreads' && error instanceof RepositoryError && error.code === RepositoryErrorCode.VALIDATION_ERROR) return;
      reportThreadOperationError(operation, error, threadId);
    }, () => { repository.threadCommands.update(threadId as EARS.EntityId, { [key]: value }); });
  },
  UPDATE_THREAD_STATUS: ({ args: { threadId, status } }) => {
    reported((error) => {
      logger.warn('Failed to update thread status', { threadId, status, error });
      reportThreadOperationError('status', error, threadId);
    }, () => { repository.threadCommands.update(threadId as EARS.EntityId, { status }); });
    // Notify flows — all logic lives in the flow layer
    tell('brain', {
      type: 'TRIGGER_BRAIN_EVENT',
      eventType: 'thread.status.changed',
      payload: { threadId, status, userInduced: true },
    });
  },
  SET_THREAD_PARENT: ({ args: { childIds, parentId } }) => reported((error) => {
    logger.warn('Failed to set thread parent', { childIds, parentId, error });
    reportThreadOperationError('parent', error, parentId);
  }, () => {
    repository.threadCommands.setParent(parentId as EARS.EntityId, childIds.map(id => id as EARS.EntityId));
  }),
  DELETE_THREAD: ({ args: { threadId } }) => {
    // Stop active processes before hard-deleting the thread.
    runThreadTeardown(threadId);
    reported((error) => {
      logger.warn('Failed to delete thread (may already be deleted)', { threadId, error });
      reportThreadOperationError('delete', error, threadId);
    }, () => { repository.threadCommands.delete(threadId as EARS.EntityId); });
  },
  EXPORT_THREADS: ({ args: { directory } }) => exportThreads(directory),
  IMPORT_THREADS: ({ args: { directory } }) => {
    const result = importThreads(directory);
    if (result.created === 0 && result.errors.length > 0) throw new Error(result.errors.join('\n'));
    return { count: result.created, ...(result.errors.length > 0 ? { errors: result.errors } : {}) };
  },
  GET_CHAT_START: () => repository.chatQueries.chatStart(),
  OPEN_THREAD_CHAT: ({ args: { threadId, restore }, refuse }) => {
    try {
      services.chat.visitThread(threadId as EARS.EntityId, { restore });
    } catch (err) {
      logger.warn('Thread not found for chat open, skipping', { threadId });
      throw refuse('not-found', errorMessage(err), { threadId });
    }
  },
  USER_MSG: ({ args, client }) => {
      try {
        const { text, mode, phase, threadId: providedThreadId, references, cwdOverride, forceDirectoryPicker } = args;

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

        // A window that asked opens the thread from its answer. One no window asked for (a flow's) is shown to every window
        if (started && !client) broadcast('threads', { type: 'SHOW_THREAD', threadId });

        tell('brain', {
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
        return { threadId, started };
      } catch (err) {
        logger.error('forwardUserMessage failed', { error: err });
        throw err;
      }
  },
  USER_COMMAND: ({ args, client }) => {
      try {
      const { command, text, mode, phase, threadId: providedThreadId, references, cwdOverride } = args;

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

      if (started && !client) broadcast('threads', { type: 'SHOW_THREAD', threadId });

      tell('brain', {
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
      return { threadId, started };
      } catch (err) {
        logger.error('forwardUserCommand failed', { error: err });
        throw err;
      }
  },
  FORK_THREAD: ({ args, client }) => {
      const { messageId, threadId, threadTopic } = args;
      if (!threadId) throw new Error('There is no thread to fork from');

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

        services.chat.visitThread(result.id);
        // A window that asked opens the fork from its answer. One no window asked for is shown to every window
        if (!client) broadcast('threads', { type: 'SHOW_THREAD', threadId: result.id });

        tell('brain', {
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
        throw err;
      }
      return { threadId: result.id };
  },
});

export const threadsSystem = setup({
  types: threadsSpec.types,
  actors: {
  },
  actions: {
    ...answers.actions,
    ...threadsSpec.actions({
    // ---- Thread management actions ----
    visitThread: ({ event }) => {
      repository.threadCommands.markAsVisited(threadsSpec.typeOf('VIEW_THREAD', event).threadId as EARS.EntityId);
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
      tell('brain', {
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

      tell('brain', {
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
      tell('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'user.thread.pause',
        payload: { threadId },
      });
    },
    forwardBrainEvent: ({ event }) => {
      const { eventType, payload } = threadsSpec.typeOf('FORWARD_BRAIN_EVENT', event);
      tell('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType, payload });
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

      tell('brain', {
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
  },
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
      OPEN_THREAD_CHAT: answers.on.OPEN_THREAD_CHAT,
      GET_CHAT_START: answers.on.GET_CHAT_START,
      THREAD_DELETED: {
        // Internal notification (e.g., refresh chat if active thread deleted)
      },
    },
    states: {
      idle: {
        on: {
          // Thread management
          CREATE_THREAD: answers.on.CREATE_THREAD,
          VIEW_THREAD: {
            actions: 'visitThread',
          },
          UPDATE_THREAD_FIELD: answers.on.UPDATE_THREAD_FIELD,
          UPDATE_THREAD_STATUS: answers.on.UPDATE_THREAD_STATUS,
          DELETE_THREAD: answers.on.DELETE_THREAD,
          SET_THREAD_PARENT: answers.on.SET_THREAD_PARENT,
          EXPORT_THREADS: answers.on.EXPORT_THREADS,
          IMPORT_THREADS: answers.on.IMPORT_THREADS,
          // Chat/agent events
          USER_MSG: answers.on.USER_MSG,
          INTERACTIVE_MSG_RESPONSE: {
            actions: 'forwardInteractiveMessageResponse',
          },
          USER_COMMAND: answers.on.USER_COMMAND,
          FORK_THREAD: answers.on.FORK_THREAD,
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
