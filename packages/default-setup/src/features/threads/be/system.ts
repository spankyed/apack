import { claudeProfileOptions } from '#features/code/common/native-profile.ts';
import { getNativeBackgroundStatus, subscribeNativeBackgroundStatus, restoreNativeBackgroundStatus, prepareNativeBackgroundDesktop, getNativeBackgroundDesktopOwner } from '#features/code/be/services/claude-code/handle-store.ts';
import { parseClaudeNativeContinuation } from '#features/code/be/services/claude-code/terminal-session.ts';
import { copyClaudeChannelSelection } from '#features/code/common/native-channels.ts';
import { readSavedClaudeNativeLaunch, readClaudePlanRestoreMode } from '#features/code/be/services/claude-code/native-launch.ts';
import { prepareClaudeNativeInput } from './claude-native-input.ts';
import { syncClaudeTerminalThread } from './claude-terminal-sync.ts';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { createClaudeTeammateRecovery, readClaudeTeammateCheckpoint } from '#features/code/be/services/claude-code/teammate-recovery.ts';
import { buildChildEnv } from '#features/code/be/services/claude-code/runner.ts';
import { createClaudeTerminalViews, type TeammateReconnectAuthority } from './claude-terminal-views.ts';
import { registerThreadTeardown } from './thread-teardown.ts';
import { submitClaudeParentCommand, handleClaudeUiView, suspendClaudeUiThreadViews, operateClaudeMemory } from './claude-ui.ts';
import { featureSettings } from '#generated/settings.ts';

import { broadcast, sendToWindow, tell } from '#generated/events.ts';
import { services } from '#generated/services.ts';
import { setup, fromPromise, spawnChild } from 'xstate';
import { runThreadHistoryOperation, type ThreadHistoryOperationInput } from './history-operation.ts';
import { defineSystem } from '@apackdev/sdk/framework';
import { onConnectionEnded } from '@apackdev/sdk/events';

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

const terminalHistory = new WeakMap<Awaited<ReturnType<typeof services.cli.claudeCode.openNativeTerminal>>, ReturnType<typeof syncClaudeTerminalThread>>();
import { snapshotClaudeBackgroundUiTarget, matchesClaudeBackgroundUiTarget } from '#features/code/be/services/claude-code/ui-owner.ts'

const terminalViews = createClaudeTerminalViews({
  async desktop(continuation, jobId, pid, key) {
    return snapshotClaudeBackgroundUiTarget(await prepareNativeBackgroundDesktop(key, continuation, jobId, pid))
  },
  backgroundApproval(key, target) {
    const owner = getNativeBackgroundDesktopOwner(key, {sessionId: target.parentSessionId, continuedInSessionId: target.jobSessionId})
    if (!matchesClaudeBackgroundUiTarget(owner, target)) return
    const control = owner?.controls.value
    return control && control.kind !== 'question' ? {id: control.dialog.id, revision: control.dialog.revision} : undefined
  },
  backgroundQuestion(key, target) {
    const owner = getNativeBackgroundDesktopOwner(key, {sessionId: target.parentSessionId, continuedInSessionId: target.jobSessionId})
    if (!matchesClaudeBackgroundUiTarget(owner, target)) return
    const control = owner?.controls.value
    const question = control?.kind === 'question' ? control.dialog : undefined
    return question ? {id: question.id, revision: question.revision} : undefined
  },
  backgroundTurn(key, target) {
    const owner = getNativeBackgroundDesktopOwner(key, {sessionId: target.parentSessionId, continuedInSessionId: target.jobSessionId})
    return matchesClaudeBackgroundUiTarget(owner, target) ? owner?.controls.turn : undefined
  },
  async interruptBackground(key, request) {
    const target = request.target
    const owner = getNativeBackgroundDesktopOwner(key, {sessionId: target.parentSessionId, continuedInSessionId: target.jobSessionId})
    if (!owner || !matchesClaudeBackgroundUiTarget(owner, target)) throw Error('Background response owner changed')
    await owner.controls.interrupt(request.turnId)
  },
  desktopCurrent(key, target) {
    return matchesClaudeBackgroundUiTarget(getNativeBackgroundDesktopOwner(key, {sessionId:target.parentSessionId,continuedInSessionId:target.jobSessionId}), target)
  },
  backgroundInfo(key) {
    const state = repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode;
    const continuation = state?.sessionId ? parseClaudeNativeContinuation({ ...state.nativeContinuation, type: 'continued-in' }, state.sessionId) : undefined;
    return getNativeBackgroundStatus(key, continuation);
  },
  subscribeBackground: subscribeNativeBackgroundStatus,
  async restoreBackground(key) {
    const state = repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode
    const continuation = state?.sessionId ? parseClaudeNativeContinuation({...state.nativeContinuation,type:'continued-in'},state.sessionId) : undefined
    if (continuation && typeof state?.cwd === 'string') await restoreNativeBackgroundStatus(key,continuation,state.cwd,claudeProfileOptions(state).env)
  },
  async replyBackground(continuation, request, key) {
    const owner = services.cli.claudeCode.getNativeTerminal(key)
    const current = owner?.state.continuation
    if (owner) {
      if (current?.sessionId !== continuation.sessionId || current.continuedInSessionId !== continuation.continuedInSessionId) throw new Error('Background reply owner is unavailable')
      return owner.replyBackground(request.id, request.pid, request.text)
    }
    return services.cli.claudeCode.replyBackgroundSession(continuation, request,
      { cwd: repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode?.cwd, ...claudeProfileOptions(repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode), timeoutMs: 15000 })
  },
  openAttachment: (continuation,jobId,key,signal) => services.cli.claudeCode.openBackgroundAttachment(continuation,jobId,{cwd:repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode?.cwd,...claudeProfileOptions(repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode),timeoutMs:15000,signal}),
  continuation(key) {
    const state = repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode;
    return state?.sessionId ? parseClaudeNativeContinuation({ ...state.nativeContinuation, type: 'continued-in' }, state.sessionId) : undefined;
  },
  background: (continuation, request, key) => services.cli.claudeCode.backgroundSession(continuation, request,
    { cwd: repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode?.cwd, ...claudeProfileOptions(repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode), timeoutMs: 15000 }),
  beforeViewChange: (_client, threadId) => suspendClaudeUiThreadViews(threadId),
  command: submitClaudeParentCommand,
  accepted: (owner, receipt, references) => terminalHistory.get(owner)?.acceptSubmission(receipt, references),
  prepareInput: (text, references) => prepareClaudeNativeInput(text, references, services.chat.resolveReferences),
  savedSession: key => repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode?.sessionId,
  async loadTeammateRecovery(key, signal) {
    const state = repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode;
    const launch = readSavedClaudeNativeLaunch(state);
    if (!launch || signal.aborted || state?.historyError || state?.forkPending || state?.forkFrom || state?.revertTo) return [];
    const records = await readClaudeTeammateCheckpoint({profile:resolveAppEnvironment().userDataDir, threadId:key, sessionId:launch.sessionId});
    const env = buildChildEnv(claudeProfileOptions(state).env);
    const result: TeammateReconnectAuthority[] = [];
    for (const record of records) {
      if (signal.aborted) break;
      if (record.cwd !== launch.cwd) continue;
      const recovery = createClaudeTeammateRecovery(record, env);
      if (await recovery.canReconnect(signal)) result.push({target:{ownerId:record.ownerId, sessionId:record.sessionId, taskId:record.taskId, name:record.name},
        open:recovery.reconnect, available:recovery.canReconnect});
    }
    return result;
  },
  get: key => services.cli.claudeCode.getNativeTerminal(key),
  async open(key, signal) {
    const state = repository.threadQueries.byId(key as EARS.EntityId)?.context?.claudeCode;
    if (state?.historyError || state?.forkPending || state?.forkFrom || state?.revertTo) throw new Error('Complete or reset the pending history change before opening the native interface');
    const resume = readSavedClaudeNativeLaunch(state);
    const prePlanMode = readClaudePlanRestoreMode(state);
    const owner = await services.cli.claudeCode.openNativeTerminal(key, {...claudeProfileOptions(state), ...(resume ? {resume} : {}), ...(prePlanMode ? {prePlanMode} : {}), signal});
    terminalHistory.set(owner, syncClaudeTerminalThread(key as EARS.EntityId, owner, () => {
      const current = services.cli.claudeCode.getNativeTerminal(key);
      return current === owner;
    }, () => services.cli.claudeCode.getNativeLaunch(key)));
    return owner;
  },
});
registerThreadTeardown(key => terminalViews.clear(key));

export function startClaudeTerminalViews(): () => void {
  const unsubscribe = onConnectionEnded(client => terminalViews.disconnect(client));
  return () => {
    unsubscribe();
    terminalViews.clear();
  };
}

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
  EDIT_CLAUDE_QUEUED_PROMPT: ({ args, client, signal }) => terminalViews.handle(
    args, client, client ? result => sendToWindow(client, 'threads', result) : undefined, signal),
  CLAUDE_MEMORY: ({ args, client, signal }) => operateClaudeMemory(args, client, signal),
  SET_CLAUDE_PERMISSION_MODE: async ({ args: { threadId, mode }, client }) => {
    if (!client) throw new Error('A Claude permission change requires a requesting window');
    const result = await services.action.executeIfFound('CC: Update Permission Mode', { threadId, mode });
    if (result?.success !== true) throw new Error(result?.reason ?? 'Permission action is unavailable');
  },
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

        if (mode === 'Claude Code' && cwdOverride) {
          repository.threadCommands.update(threadId, { context: { claudeCode: { cwd: cwdOverride } } });
        }
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
  FORK_THREAD: async ({ args, client, signal }) => {
      const { messageId, threadId, threadTopic } = args;
      if (!threadId) throw new Error('There is no thread to fork from');

      let result: { id: EARS.EntityId } | undefined;
      const forkContext: Record<string, any> = {};

      const readSnapshot = () => JSON.stringify({
        thread: repository.threadQueries.byId(threadId as EARS.EntityId),
        messages: repository.chatQueries.threadData(threadId as EARS.EntityId)?.messages,
      });
      await runThreadHistoryOperation({
        request: { kind: 'fork', threadId, messageId },
        snapshot: readSnapshot(), readSnapshot,
        rejected: error => { throw error; },
        commit: () => {
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
        },
      }, signal);
      signal.throwIfAborted();
      if (!result) throw new Error('Failed to create thread');
      return { threadId: result.id };
  },
});

export const threadsSystem = setup({
  types: threadsSpec.types,
  actors: {
    historyOperation: fromPromise(async ({input, signal}: {input: ThreadHistoryOperationInput; signal: AbortSignal}) => runThreadHistoryOperation(input, signal)),
  },
  actions: {
    ...answers.actions,
    ...threadsSpec.actions({
    claudeTerminalView: ({ event, client }) => {
      if (event.type === 'CLAUDE_TEAMMATE_TERMINAL_OPEN' || event.type === 'CLAUDE_BACKGROUND_OPEN' || event.type === 'CLAUDE_BACKGROUND_INPUT' || event.type === 'CLAUDE_BACKGROUND_RESIZE' || event.type === 'CLAUDE_BACKGROUND_CLOSE' || event.type === 'CLAUDE_TERMINAL_MOUNT' || event.type === 'CLAUDE_TERMINAL_UNMOUNT' || event.type === 'CLAUDE_TERMINAL_OPEN' || event.type === 'CLAUDE_TERMINAL_CANCEL_OPEN' || event.type === 'CLAUDE_TERMINAL_SUBMIT' || event.type === 'CLAUDE_TERMINAL_INPUT' || event.type === 'CLAUDE_TERMINAL_RESIZE' || event.type === 'CLAUDE_TERMINAL_CLOSE' || event.type === 'CLAUDE_TERMINAL_BACKGROUND' || event.type === 'CLAUDE_TERMINAL_TASK' || event.type === 'CLAUDE_TERMINAL_QUEUE_CANCEL' || event.type === 'CLAUDE_TERMINAL_QUEUE_EDIT_APPLIED' || event.type === 'CLAUDE_TERMINAL_QUEUE_SEND_NOW' || event.type === 'CLAUDE_TERMINAL_POLICY_RECHECK' || event.type === 'CLAUDE_TERMINAL_NOTICE' || event.type === 'CLAUDE_TERMINAL_MCP_FORM' || event.type === 'CLAUDE_TERMINAL_MCP_URL') terminalViews.handle(event, client, client ? result => sendToWindow(client, 'threads', result) : undefined);
    },
    claudeUiView: ({ event, client }) => {
      if (event.type === 'CLAUDE_UI_TRANSCRIPT_LAYOUT' || event.type === 'CLAUDE_UI_AGENTS_GESTURE' || event.type === 'CLAUDE_UI_BACKGROUND_REVIEW' || event.type === 'CLAUDE_UI_SETTINGS' || event.type === 'CLAUDE_UI_COMMAND_PANEL' || event.type === 'CLAUDE_UI_COMMAND_DECISION' || event.type === 'CLAUDE_UI_AGENT_INPUT' || event.type === 'CLAUDE_UI_CLIENT' || event.type === 'CLAUDE_UI_NOTICE' || event.type === 'CLAUDE_UI_SCROLL' || event.type === 'CLAUDE_UI_PANE' || event.type === 'CLAUDE_UI_MOUNT' || event.type === 'CLAUDE_UI_UNMOUNT' || event.type === 'CLAUDE_UI_KEY' || event.type === 'CLAUDE_UI_APPROVAL_ANSWER' || event.type === 'CLAUDE_UI_DECISION_PAUSE' || event.type === 'CLAUDE_UI_QUESTION_PAUSE' || event.type === 'CLAUDE_UI_QUESTION_REJECT' || event.type === 'CLAUDE_UI_QUESTION_ANSWER' || event.type === 'CLAUDE_UI_PRESS' || event.type === 'CLAUDE_UI_FIELD' || event.type === 'CLAUDE_UI_FOCUS' || event.type === 'CLAUDE_PROMPT_HOST_RESPONSE' || event.type === 'CLAUDE_PROMPT_EDIT' || event.type === 'CLAUDE_PROMPT_AUTOCOMPLETE') handleClaudeUiView(event, client, client ? result => sendToWindow(client, 'threads', result) : undefined);
    },
    // ---- Thread management actions ----
    visitThread: ({ event }) => {
      repository.threadCommands.markAsVisited(threadsSpec.typeOf('VIEW_THREAD', event).threadId as EARS.EntityId);
    },
    setClaudeChannels: ({event}) => {
      const {threadId,channels}=threadsSpec.typeOf('SET_CLAUDE_CHANNELS',event);
      try {
        if(services.cli.claudeCode.getNativeTerminal(threadId)||services.cli.claudeCode.isConversationBusy(threadId))throw Error('Stop the native session and wait for current work before changing channels');
        const thread=repository.threadQueries.byId(threadId as EARS.EntityId);
        if(!thread)throw Error('Conversation no longer exists');
        const context={...thread.context,claudeCode:{...thread.context?.claudeCode,channelSelection:copyClaudeChannelSelection(channels)}};
        repository.threadCommands.update(thread.id,{context});
      }catch(error){reportThreadOperationError('update',error,threadId);}
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
    revertThread: spawnChild('historyOperation', { input: threadsSpec.input(({event, client}) => {
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

          services.chat.visitThread(threadId as EARS.EntityId);
          const show = { type: 'SHOW_THREAD' as const, threadId: threadId as EARS.EntityId };
          if (client) sendToWindow(client, 'threads', show); else broadcast('threads', show);

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
      };
    }) }),
    summarizeThread: spawnChild('historyOperation', { input: threadsSpec.input(({event, client}) => {
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

          services.chat.visitThread(threadId as EARS.EntityId);
          const show = { type: 'SHOW_THREAD' as const, threadId: threadId as EARS.EntityId };
          if (client) sendToWindow(client, 'threads', show); else broadcast('threads', show);

          tell('brain', {
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
      const { threadId, nativePause } = threadsSpec.typeOf('PAUSE_TURN', event);
      if (nativePause !== undefined) {
        void services.action.executeIfFound('CC: Pause Turn', { threadId, nativePause }).then(result => {
          if (result?.success !== true) logger.warn('Native Pause refused', { threadId, reason: result?.reason ?? 'Pause action unavailable' });
        }).catch(error => logger.error('Native Pause failed', { threadId, error: errorMessage(error) }));
        return;
      }
      // A print Pause can arrive after native takeover. Only addressed controls can pause that owner.
      if (services.cli.claudeCode.getNativeTerminal(threadId)) return;
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

      const message = repository.chatQueries.messageById(messageId as EARS.EntityId);
      if (!message || !repository.chatQueries.hasMessageInThread(messageId as EARS.EntityId, threadId as EARS.EntityId)) return;
      // Retired one-shot decisions cannot regain authority through a delayed frontend response.
      if (message.responseTimestamp && (message.context?.claudeNativeQuestion || message.blocks?.some(block => block.type === 'question' || block.type === 'approval'))) return;

      // Question image bytes are for the live native decision and the native transcript.
      const storedResponse = message.context?.claudeNativeQuestion && response && typeof response === 'object' && 'nativeQuestionImages' in response
        ? Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'nativeQuestionImages'))
        : response;
      repository.chatCommands.updateMessageBlockResponse({
        messageId: messageId as EARS.EntityId,
        response: storedResponse
      });

      // Compute aside text for autoHide messages
      let asideText: string | undefined;
      if (message.autoHide) {
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
      CLAUDE_TERMINAL_MOUNT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_UNMOUNT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_OPEN: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_CANCEL_OPEN: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_SUBMIT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_INPUT: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_RESIZE: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_BACKGROUND: { actions: 'claudeTerminalView' },
      CLAUDE_TEAMMATE_TERMINAL_OPEN: { actions: 'claudeTerminalView' },
      CLAUDE_BACKGROUND_OPEN: { actions: 'claudeTerminalView' },
      CLAUDE_BACKGROUND_INPUT: { actions: 'claudeTerminalView' },
      CLAUDE_BACKGROUND_RESIZE: { actions: 'claudeTerminalView' },
      CLAUDE_BACKGROUND_CLOSE: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_TASK: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_QUEUE_CANCEL: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_QUEUE_EDIT_APPLIED: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_QUEUE_SEND_NOW: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_POLICY_RECHECK: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_NOTICE: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_MCP_URL: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_MCP_FORM: { actions: 'claudeTerminalView' },
      CLAUDE_TERMINAL_CLOSE: { actions: 'claudeTerminalView' },
      CLAUDE_UI_AGENTS_GESTURE: { actions: 'claudeUiView' },
      CLAUDE_UI_BACKGROUND_REVIEW: { actions: 'claudeUiView' },
      CLAUDE_UI_SETTINGS: { actions: 'claudeUiView' },
      CLAUDE_UI_COMMAND_PANEL: { actions: 'claudeUiView' },
      CLAUDE_UI_COMMAND_DECISION: { actions: 'claudeUiView' },
      CLAUDE_UI_AGENT_INPUT: { actions: 'claudeUiView' },
      CLAUDE_UI_MOUNT: { actions: 'claudeUiView' },
      CLAUDE_UI_UNMOUNT: { actions: 'claudeUiView' },
      CLAUDE_UI_KEY: { actions: 'claudeUiView' },
      CLAUDE_UI_APPROVAL_ANSWER: { actions: 'claudeUiView' },
      CLAUDE_UI_QUESTION_REJECT: { actions: 'claudeUiView' },
      CLAUDE_UI_QUESTION_PAUSE: { actions: 'claudeUiView' },
      CLAUDE_UI_DECISION_PAUSE: { actions: 'claudeUiView' },
      CLAUDE_UI_QUESTION_ANSWER: { actions: 'claudeUiView' },
      CLAUDE_UI_PRESS: { actions: 'claudeUiView' },
      CLAUDE_PROMPT_HOST_RESPONSE: { actions: 'claudeUiView' },
      CLAUDE_UI_NOTICE: { actions: 'claudeUiView' },
      CLAUDE_UI_TRANSCRIPT_LAYOUT: { actions: 'claudeUiView' },
      CLAUDE_UI_SCROLL: { actions: 'claudeUiView' },
      CLAUDE_UI_PANE: { actions: 'claudeUiView' },
      CLAUDE_UI_FOCUS: { actions: 'claudeUiView' },
      CLAUDE_UI_CLIENT: { actions: 'claudeUiView' },
      CLAUDE_UI_FIELD: { actions: 'claudeUiView' },
      CLAUDE_PROMPT_AUTOCOMPLETE: { actions: 'claudeUiView' },
      CLAUDE_PROMPT_EDIT: { actions: 'claudeUiView' },
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
          SET_CLAUDE_CHANNELS: {actions: 'setClaudeChannels'},
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
          SET_CLAUDE_PERMISSION_MODE: answers.on.SET_CLAUDE_PERMISSION_MODE,
          EDIT_CLAUDE_QUEUED_PROMPT: answers.on.EDIT_CLAUDE_QUEUED_PROMPT,
          CLAUDE_MEMORY: answers.on.CLAUDE_MEMORY,
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
