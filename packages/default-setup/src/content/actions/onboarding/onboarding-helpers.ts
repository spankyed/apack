import type { EntityId, Services } from '#generated/services.ts';

export interface OnboardingState {
  step: 'welcome' | 'projects' | 'import-threads' | 'pick-thread' | 'choose-mode' | 'complete';
  threadId: EntityId;
  pendingMessageId: EntityId;
  data: { cliFound?: boolean; authenticated?: boolean; codexFound?: boolean; ccSessionCount?: number; codexSessionCount?: number; chosenMode?: string };
}

export function getOnboardingState(services: Services, threadId: EntityId): OnboardingState | null {
  const thread = services.repository.threadQueries.byId(threadId) as any;
  const state = thread?.context?.onboarding;
  // Steps edit a working copy; persistOnboardingState owns the database write.
  return state ? { ...state, data: { ...state.data } } : null;
}

export function persistOnboardingState(services: Services, threadId: EntityId, state: OnboardingState) {
  const thread = services.repository.threadQueries.byId(threadId) as any;
  services.repository.threadCommands.update(threadId, {
    context: { ...thread?.context, onboarding: state },
  });
}

/**
 * Flash a chat state indicator then set the next persistent state (paused if more steps, idle if finishing).
 */
export function flashState(services: Services, threadId: EntityId, stateId: string = 'working', nextState: 'paused' | 'idle' = 'paused') {
  services.threads.updateChatState(threadId, nextState);
  services.emitter.broadcastToSurface('default-setup/threads', {
    type: 'FLASH_CHAT_STATE',
    threadId: threadId as string,
    stateId,
    durationMs: 800,
  });
}

/** Recent imported threads from both providers, sorted by recency. */
export function getRecentImportedThreads(services: Services, excludeThreadId: EntityId, limit = 7): any[] {
  return services.repository.threadQueries.all()
    .filter((t: any) => (t.tags?.includes('claude-code') || t.tags?.includes('codex')) && t.id !== excludeThreadId)
    .sort((a: any, b: any) => (b.lastMessageTimestamp || b.timestamp) - (a.lastMessageTimestamp || a.timestamp))
    .slice(0, limit);
}

/**
 * Gate before finishing: if both CLIs are available, ask the user to
 * choose their default mode. Otherwise finish directly.
 * Every code path that ends onboarding should call this instead of
 * finishOnboarding() directly.
 */
export function showChooseModeOrFinish(
  services: Services,
  state: OnboardingState,
  threadId: EntityId,
  options?: { skipCompletionMessage?: boolean },
): void {
  if (state.data.cliFound && state.data.codexFound) {
    const { messageId } = services.chat.sendChoiceBlock({
      threadId,
      text: 'Which agent would you like to use by default?',
      prompt: 'Default agent',
      choices: [
        { id: 'Claude Code', label: 'Claude Code', description: 'Anthropic Claude' },
        { id: 'Codex', label: 'Codex', description: 'OpenAI Codex' },
      ],
      allowCustom: false,
      forkable: false,
      autoHide: true,
      asUser: true,
    });
    state.step = 'choose-mode';
    state.pendingMessageId = messageId as EntityId;
    return;
  }

  // Only one CLI — skip the choice and finish
  finishOnboarding(services, state, threadId, options);
}

export function finishOnboarding(
  services: Services,
  state: OnboardingState,
  threadId: EntityId,
  options?: { skipCompletionMessage?: boolean },
) {
  state.step = 'complete';

  services.onboarding.complete();

  services.repository.threadCommands.update(threadId, {
    topic: 'General',
    instructions: 'General conversation thread.',
    forcedMode: null,
  });

  if (!options?.skipCompletionMessage) {
    const recentThreads = getRecentImportedThreads(services, threadId);

    if (recentThreads.length > 0) {
      services.chat.sendChoiceBlock({
        threadId,
        text: "You're all setup! Here are some of your previous threads. Or click `+ New thread` below the chat to get to work on something new!",
        prompt: 'Continue a previous thread',
        choices: recentThreads.map((t: any) => ({ id: t.id, label: t.topic || 'Untitled', description: t.tags?.join(', ') || '' })),
        allowCustom: false,
        forkable: false,
      });
    } else {
      services.chat.sendBlockMessage({
        threadId,
        text: "You're all setup! Click `+ New thread` below the chat to get to work!",
        blocks: [],
        forkable: false,
      });
    }
  }

  if (!options?.skipCompletionMessage) {
    services.chat.showThread(threadId);
  }

  flashState(services, threadId, 'success', 'idle');

  // Use the mode the user chose, or auto-detect from available CLIs
  const defaultMode = state.data.chosenMode
    || ((!state.data.cliFound && state.data.codexFound) ? 'Codex' : 'Claude Code');
  // The chat's settings reach every window with the change; the mode is what the chat's input offers now
  services.settings.set({ kind: 'feature', featureRef: 'default-setup/threads' }, ['chat', 'defaultMode'], defaultMode);
  services.emitter.broadcastToSurface('default-setup/threads', {
    type: 'SET_MODE',
    mode: defaultMode,
  });

  services.emitter.broadcastToSurface('host/application', { type: 'ONBOARDING_COMPLETE' });
}
