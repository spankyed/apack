import { featureSettings } from '#generated/settings.ts';
import { tell } from '#generated/events.ts';
import { services } from '#generated/services.ts';
import { state } from '#generated/state.ts';
import { currentClient, type ContractAsks, type IncomingOnlyEventsOf, type NormalizeAsks } from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';

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
function reported<T>(refused: (error: unknown) => void, run: () => T): T {
  try {
    return run();
  } catch (error) {
    refused(error);
    throw error;
  }
}

export const threadsSystem = state<
  {},
  IncomingOnlyEventsOf<Contract> | Extract<HostLifecycleEvents, { type: 'FEATURE_SETTINGS_UPDATED' }>,
  NormalizeAsks<ContractAsks<Contract>>
>()({
  on: {
    FEATURE_SETTINGS_UPDATED: ({ changes }) => {
      const firstStatusLabel = (): string | undefined =>
        featureSettings.forFeature('threads').get()?.statuses?.[0]?.label;

      if (!changes) return;

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
        transact(() => {
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
        });
      }
    },
    THREAD_DELETED: () => {
      // Internal notification (e.g., refresh chat if active thread deleted)
    },
    CLIENT_CONNECTED: () => {},
    VIEW_THREAD: ({ threadId }) => {
      repository.threadCommands.markAsVisited(threadId as EARS.EntityId);
    },
    INTERACTIVE_MSG_RESPONSE: ({ messageId, threadId, response }) => {
      try {
        if (!repository.chatQueries.messageById(messageId as EARS.EntityId)) return;

        repository.chatCommands.updateMessageBlockResponse({
          messageId: messageId as EARS.EntityId,
          response,
        });

        // Compute aside text for autoHide messages
        const message = repository.chatQueries.messageById(messageId as EARS.EntityId);
        if (message?.autoHide) {
          const asideText = generateAsideText(message, response);
          write(messageId as EARS.EntityId).set('asideText', asideText);
        }

        tell('brain', {
          type: 'TRIGGER_BRAIN_EVENT',
          eventType: 'interactive.message.response',
          payload: { messageId, threadId, response },
        });
      } catch (err) {
        logger.error('forwardInteractiveMessageResponse failed', { error: err });
      }
    },
    REVERT_THREAD: ({ messageId, threadId, restoreFiles, userCliUuid }) => {
      try {
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
    SUMMARIZE_THREAD: ({ messageId, threadId }) => {
      try {
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
    TOGGLE_COMPACTED: ({ markerId, compacted }) => {
      repository.chatCommands.toggleMarkerCompacted(markerId as EARS.EntityId, compacted);
    },
    DELETE_MESSAGE: ({ messageId }) => {
      if (!repository.chatQueries.messageById(messageId as EARS.EntityId)) return;
      write(messageId as EARS.EntityId).destroy();
    },
    PAUSE_TURN: ({ threadId }) => {
      tell('brain', {
        type: 'TRIGGER_BRAIN_EVENT',
        eventType: 'user.thread.pause',
        payload: { threadId },
      });
    },
    FORWARD_BRAIN_EVENT: ({ eventType, payload }) => {
      tell('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType, payload });
    },
  },
  answers: {
    // The thread and its parent's link are one unit, so a refused link leaves no thread behind
    CREATE_THREAD: (thread) => reported((error) => reportThreadOperationError('create', error), () => transact(() => {
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
    UPDATE_THREAD_FIELD: ({ key, value, threadId }) => {
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
    UPDATE_THREAD_STATUS: ({ threadId, status }) => {
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
    SET_THREAD_PARENT: ({ childIds, parentId }) => reported((error) => {
      logger.warn('Failed to set thread parent', { childIds, parentId, error });
      reportThreadOperationError('parent', error, parentId);
    }, () => {
      repository.threadCommands.setParent(parentId as EARS.EntityId, childIds.map(id => id as EARS.EntityId));
    }),
    DELETE_THREAD: ({ threadId }) => {
      // Stop active processes before hard-deleting the thread.
      runThreadTeardown(threadId);
      reported((error) => {
        logger.warn('Failed to delete thread (may already be deleted)', { threadId, error });
        reportThreadOperationError('delete', error, threadId);
      }, () => { repository.threadCommands.delete(threadId as EARS.EntityId); });
    },
    EXPORT_THREADS: ({ directory }) => exportThreads(directory),
    IMPORT_THREADS: ({ directory }) => {
      const result = importThreads(directory);
      if (result.created === 0 && result.errors.length > 0) throw new Error(result.errors.join('\n'));
      return { count: result.created, ...(result.errors.length > 0 ? { errors: result.errors } : {}) };
    },
    GET_CHAT_START: () => repository.chatQueries.chatStart(),
    OPEN_THREAD_CHAT: ({ threadId, restore }, { refuse }) => {
      try {
        services.chat.visitThread(threadId as EARS.EntityId, { restore });
      } catch (err) {
        logger.warn('Thread not found for chat open, skipping', { threadId });
        throw refuse('not-found', errorMessage(err), { threadId });
      }
    },
    USER_MSG: (args, { broadcast }) => {
      try {
        const client = currentClient();
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
    USER_COMMAND: (args, { broadcast }) => {
      try {
        const client = currentClient();
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
    FORK_THREAD: (args, { broadcast }) => {
      const client = currentClient();
      const { messageId, threadId, threadTopic } = args;
      if (!threadId) throw new Error('There is no thread to fork from');

      let result: { id: EARS.EntityId } | undefined;
      const forkContext: Record<string, any> = {};

      try {
        const { created, sourceUserMessagesAfterFork } = transact(() => {
          const sourceMessages = repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages ?? [];
          const sourceIndex = sourceMessages.findIndex((m: any) => m.id === messageId);
          const userMessagesAfterFork = sourceIndex >= 0
            ? sourceMessages.slice(sourceIndex + 1).filter((m: any) => m.sender === 'user').length
            : 0;
          const originalTopic = threadTopic || 'Untitled';

          const forkCount = repository.threadCommands.forkCount(threadId as EARS.EntityId);
          const forkTopic = `Fork ${forkCount + 1} - ${originalTopic}`;

          const nextThread = services.chat.createThread({ topic: forkTopic, instructions: '' });
          if (!nextThread) throw new Error('Failed to create thread');

          repository.threadCommands.linkFork(threadId as EARS.EntityId, nextThread.id);

          repository.chatCommands.copyMessagesUpTo({
            sourceThreadId: threadId as EARS.EntityId,
            targetThreadId: nextThread.id,
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
            repository.threadCommands.update(nextThread.id, { context: forkContext });
          }

          services.chat.visitThread(nextThread.id);
          return { created: nextThread, sourceUserMessagesAfterFork: userMessagesAfterFork };
        });

        result = created;
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
        // Clear forkPending if the transaction already committed before a post-commit failure.
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
  },
});

const _contractMatches: StateMatchesContract<typeof threadsSystem, Contract> = true;
void _contractMatches;

export default threadsSystem;
