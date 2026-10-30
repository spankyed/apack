<template>
  <!-- History scrolls inside the assigned pane; only its authored minimum affects the shell split. -->
  <div class="native-chat-shell flex flex-col h-full" :style="{ contain: 'size', ...(currentMode === 'Claude Code' || currentThread?.context?.claudeCode ? { '--native-chat-min-height': nativeToolsExpanded || focusedAgent ? 'min(42rem, max(min(28rem, calc(100vh - 3rem)), calc(100vh - 11rem)))' : 'min(36rem, max(min(28rem, calc(100vh - 3rem)), calc(100vh - 15rem)))' } : {}) }">
    <!-- Main content: optional inline dashboard + chat -->
    <div class="flex flex-grow overflow-hidden min-h-0" ref="chatContainerRef">
      <!-- Thread Sidebar (left, hidden during onboarding) -->
      <ThreadSidebar
        v-if="showThreadSidebar && !isOnboarding"
        :style="{ width: sidebarWidthPx + 'px' }"
        @select-thread="(threadId: string) => { expandChatIfCollapsed(); actor.send({ type: 'OPEN_THREAD_CHAT', threadId }) }"
        @open-message="(result: MessageSearchResult) => { expandChatIfCollapsed(); actor.send({ type: 'OPEN_MESSAGE', threadId: result.threadId, messageId: result.messageId }) }"
        @close="showThreadSidebar = false"
      />
      <PanelResizer
        v-if="showThreadSidebar && !isOnboarding"
        orientation="horizontal"
        @resize="handleDashboardResize"
        @click="showThreadSidebar = false"
      />
      <!-- Inline Dashboard (left, hidden during onboarding) -->
      <div v-if="showInlineDashboard && !isOnboarding" class="min-w-0 overflow-hidden shrink-0 border-r border-neutral-800" :style="{ width: dashboardWidth + '%' }">
        <AgentCanvas :inline="true" />
      </div>
      <PanelResizer
        v-if="showInlineDashboard && !isOnboarding"
        orientation="horizontal"
        @resize="handleDashboardResize"
      />
      <!-- Chat column (right, or full width when dashboard hidden) -->
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden" :class="{ 'pt-2': !showInlineTabs }" style="background-color: rgb(28 28 28)">
        <!-- Inline Tab Bar -->
        <InlineTabBar :visible="showInlineTabs && !isOnboarding" @close="showInlineTabs = false" />
        <ClaudeNativeSession ref="nativeSession" v-if="currentThread?.context?.claudeCode && currentThread.id" :key="currentThread.id" :thread-id="currentThread.id" :continuation="currentThread.context.claudeCode.nativeContinuation?.sessionId === currentThread.context.claudeCode.sessionId ? currentThread.context.claudeCode.nativeContinuation : undefined" :busy="isBusy" :input-pending="!!pendingNativeSend || agentPending || !!agentSelection || mcpFormPending || nativeComposerView?.mcpOperation?.status === 'pending'" @active="nativeTerminalActive = $event" />
        <NativeManagedSettingsNotice v-if="!nativeTerminalActive && nativeUiDrawing?.managedSettingsDiagnostics?.length" :diagnostics="nativeUiDrawing.managedSettingsDiagnostics" />
        <section v-if="!nativeTerminalActive && workflowTasks.length" aria-label="Native Claude workflows" class="mx-4 mt-2 max-h-48 shrink-0 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
          <div v-for="task in workflowTasks" :key="task.id" :data-native-workflow-id="task.id" class="py-1">
            <div class="flex items-center justify-between gap-3"><span class="min-w-0 break-words font-medium text-neutral-200">{{ task.name }}</span><span class="shrink-0 text-neutral-400">{{ task.status === 'killed' ? 'Stopped' : task.status }}</span></div>
            <NativeTaskControls :task="task" />
          </div>
        </section>
        <p v-if="agentSelection" role="status" class="px-4 py-3 text-sm text-neutral-400">Opening Agent conversation…</p>
        <NativeAgentView v-if="focusedAgent && currentThread?.id" :key="JSON.stringify(focusedAgent.target)" :thread-id="currentThread.id" :target="focusedAgent.target" :name="focusedAgent.name" :status-text="focusedAgent.statusText" :active="!nativeTerminalActive" :draft="agentDrafts[agentDraftKey(focusedAgent.target)]?.text ?? ''" :draft-snapshot="agentDrafts[agentDraftKey(focusedAgent.target)]?.snapshot" :scroll-position="agentScrollPositions[agentDraftKey(focusedAgent.target)]" @scroll-position="saveAgentScrollPosition" @draft="saveAgentDraft" @draft-snapshot="saveAgentDraftSnapshot" @pending="agentPending = $event" @returning="agentReturning = $event" @returned="returnFromAgent" />
        <!-- Shrinkable content area -->
        <div v-show="!nativeTerminalActive && !focusedAgent && !agentSelection" class="flex flex-col flex-grow overflow-hidden min-h-0" ref="composerAreaRef" data-testid="chat-composer-area" @keydown.capture="nativeActionKey($event, composerAreaRef)" @focusout="nativeActionKey.leave($event, composerAreaRef)">
          <p v-if="nativeUiDrawing?.gestureProblem" role="alert" class="px-4 py-2 text-sm text-amber-200">{{ nativeUiDrawing.gestureProblem }}</p>
          <NativeMainCommand v-if="nativeComposerOwner" :state="mainCommand" :frame="nativeUiDrawing?.transcriptMessages?.find(frame => frame.component === 'CommandOutput' && frame.uuid === mainCommand?.output?.messageId)" @press="pressNativeUi" @field="editNativeUi" :owner-id="nativeComposerOwner.ownerId" :output="nativeComposerView?.output ?? []" :dismissed="mainOutputDismissed" :expanded="mainOutputExpanded" @panel="mainPanel" @settings="mainSettings" @background="mainBackgroundReview" @resize="mainPanelResize" @decide="mainCommandDecision" @dismiss="dismissMainOutput" @expand="mainOutputExpanded = $event" />
          <p v-if="nativeComposerView?.submission?.status === 'accepted' && nativeComposerView.submission.command?.kind === 'command_complete'" role="status" class="mx-4 mb-2 shrink-0 text-xs text-neutral-400">/{{ nativeComposerView.submission.command.commandName }} completed<span v-if="nativeComposerView.submission.command.sessionId"> · New conversation ready</span></p>
          <NativeMcpUrl v-if="nativeComposerOwner?.mcpUrl" :key="nativeComposerOwner.mcpUrl.id + nativeComposerOwner.mcpUrl.revision" :url="nativeComposerOwner.mcpUrl" :operation="nativeComposerView?.mcpOperation" @operate="operateMcpUrl" />
          <NativeMcpForm v-if="nativeComposerOwner?.mcpForm" :key="nativeComposerOwner.mcpForm.id + nativeComposerOwner.mcpForm.revision" :form="nativeComposerOwner.mcpForm" :operation="nativeComposerView?.mcpOperation" @operate="operateMcpForm" @pending="mcpFormPending = $event" />
          <!-- Agent Chat Content -->
          <div v-show="!mainCommandView && !pendingNativeQuestion && !pendingNativePlan" class="relative flex flex-col flex-1 w-full overflow-hidden min-h-0" data-testid="chat-transcript">
            <div class="min-h-0 flex-1 overflow-y-auto" :class="$style.messagesContainer" ref="messagesContainer" @scroll="onScroll">
              <div v-if="allMessages.length === 0 && !currentThread?.instructions" class="flex items-center justify-center h-full">
                <p class="text-neutral-700 text-center italic max-w-sm">{{ randomQuote }}</p>
              </div>
              <div v-else class="w-full max-w-4xl px-4 py-4 mx-auto space-y-3" ref="messagesContent">
                <NativeTerminalPlacements :frames="nativeUiDrawing?.composer" component="InfoNotice" @press="pressNativeUi" @field="editNativeUi" />
                <!-- Load older messages -->
                <div v-if="messagePagination.hasMore" class="flex justify-center py-3">
                  <button
                    v-if="!messagePagination.isLoading"
                    @click="requestLoadMore"
                    class="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Load older messages
                  </button>
                  <span v-else class="text-xs text-neutral-600">Loading...</span>
                </div>
                <!-- Instructions banner -->
                <div v-if="currentThread?.instructions" class="mb-3 rounded-lg border border-neutral-700/50 bg-neutral-800/50 px-4 py-3">
                  <div class="text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5 font-medium">Instructions</div>
                  <!-- Markdown, rendered without raw HTML -->
                  <TiptapEditor class="text-neutral-300 text-sm leading-relaxed" mode="viewer" variant="chat" :model-value="currentThread.instructions" />
                </div>
                <template v-for="message in visibleMessages" :key="message.id">
                <ChatMessage
                  v-if="message.id !== pendingNativeApproval?.messageId"
                  :message="message"
                  :native-frames="nativeUiDrawing?.transcriptMessages"
                  :native-view-id="nativeUiMount?.mountId"
                  @native-ui-press="pressNativeUi"
                  @native-ui-field="editNativeUi"
                  @native-ui-message-view="reportNativeMessageView"
                  @native-ui-block-view="reportNativeBlockView"
                  :is-tail="isTailMessage(message)"
                  :is-claude-code-thread="!!currentThread?.context?.claudeCode"
                  @open-lightbox="openLightbox"
                  @fork="(messageId: string) => actor.send({ type: 'FORK_THREAD', messageId, threadId: currentThread?.id, threadTopic: currentThread?.topic })"
                  @unqueue="handleUnqueue"
                  @resend="handleResend"
                  @revert="(messageId: string) => handleRevert(messageId)"
                  @revert-with-files="(messageId: string) => handleRevert(messageId, true)"
                  @toggle-compacted="handleToggleCompacted"
                />
                <NativeToolGroup v-for="group in (nativeUiDrawing?.transcriptMessages ?? []).filter(frame => frame.component === 'ToolGroup' && !frame.tools.length && frame.messageId === message.id)" :key="group.uuid" :frame="group as Extract<typeof group, {component: 'ToolGroup'}>" @press="pressNativeUi" @field="editNativeUi" />
                <NativeDiagnosticAttachment v-for="diagnostic in (nativeUiDrawing?.diagnostics ?? []).filter(row => row.messageId === message.id)" :key="diagnostic.id" :diagnostic="diagnostic" />
                <NativeTerminalPlacements :frames="nativeUiDrawing?.transcriptMessages" component="TurnDuration" :message-id="message.id" @press="pressNativeUi" @field="editNativeUi" />
                </template>
        <section v-if="!nativeTerminalActive && shellTasks.length" aria-label="Background commands" class="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
          <div v-for="task in shellTasks" :key="task.id" class="py-1" :data-native-shell-id="task.id">
            <div class="flex items-center justify-between gap-3"><span class="min-w-0 break-words font-medium text-neutral-200">{{ task.name }}</span><span class="shrink-0 text-neutral-400">{{ task.status === 'killed' ? 'Stopped' : task.status }}</span></div>
            <NativeTaskControls :task="task" />
          </div>
        </section>
                <div v-if="nativeComposerOwner?.preview" data-native-stream-preview class="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed" role="status" aria-label="Claude response in progress"><NativeStatusText :text="nativeComposerOwner.preview.output" /></div>
              </div>
            </div>
            <div v-if="currentThread?.context?.claudeCode && (!isNearBottom || currentThread.context.claudeCode.pendingElicitation) && allMessages.length > 0" aria-label="Conversation navigation" class="relative h-10 shrink-0">
              <ScrollToBottomFob :visible="!isNearBottom" aria-label="Scroll to latest message" @click="scrollToBottom('smooth')" />
            </div>
            <ScrollToBottomFob v-else-if="!currentThread?.context?.claudeCode" :visible="!isNearBottom && allMessages.length > 0" @click="scrollToBottom('smooth')" />
          </div>
          <div v-if="pendingNativeApproval" class="min-h-0 overflow-hidden px-4 py-2" :class="$style.approvalContainer">
            <NativeToolApproval :key="pendingNativeApproval.messageId" v-bind="pendingNativeApproval"
              @respond="response => actor.send({ type: 'RESPOND_TO_BLOCK_INTERACTION', messageId: pendingNativeApproval!.messageId, response })"
              @edit-workflow="nativeSession?.open()"
              @pause="actor.send({ type: 'PAUSE_TURN', threadId: currentThread?.id ?? '' })" />
          </div>
          <div v-if="pendingNativePlan" class="flex-1 min-h-0 overflow-hidden px-4 py-2">
            <NativePlanPanel :key="pendingNativePlan.messageId" v-bind="pendingNativePlan"
              @respond="response => actor.send({ type: 'RESPOND_TO_BLOCK_INTERACTION', messageId: pendingNativePlan!.messageId, response })"
              @pause="actor.send({ type: 'PAUSE_TURN', threadId: currentThread?.id ?? '' })" />
          </div>
          <div v-if="pendingNativeQuestion" class="flex-1 min-h-0 overflow-hidden px-4 py-2">
            <NativeQuestionDrawing :key="pendingNativeQuestion.messageId" :frame="pendingNativeQuestion.frame" :disabled="pendingNativeQuestion.disabled" :error="pendingNativeQuestion.error"
              @press="pressNativeUi" @field="editNativeUi" @started="startNativeQuestionDraft"
              @respond="answerNativeQuestion"
              @pause="actor.send({ type: 'PAUSE_TURN', threadId: currentThread?.id ?? '' })" />
          </div>
          <!-- Keep the draft/editor mounted while the native process needs a decision. -->
          <!-- Input -->
          <div v-show="!mainPanelActive && !mainOutputExpanded && !pendingNativeApproval && !pendingNativeQuestion && !pendingNativePlan" class="flex-shrink-0 w-full" :class="$style.inputContainer">
            <ChatInput ref="mainComposer" @native-tools-expanded="nativeToolsExpanded = $event"
              :disabled="nativeAgentsDecisionPending || mainCommandActive || !!taskView?.[1].state && taskView[1].state.view?.kind !== 'main'"
              :disabled-reason="taskView?.[1].state ? taskView[1].state.view?.kind === 'agent' ? 'Return to the main conversation in the native interface' : taskView[1].state.view ? undefined : 'Connecting to Claude input' : undefined"
              :current-thread="currentThread"
              :current-mode="currentMode"
              :current-phase="currentPhase"
              :prefill-text="prefillText"
              :prefill-references="prefillReferences"
              :is-busy="isBusy"
              :modes="modes"
              :default-mode="settings?.defaultMode"
              :hotkeys="hotkeys"
              :quick-prompts="quickPrompts"
              :quick-prompt-number-key-inserts="quickPromptNumberKeyInserts"
              :quick-prompt-cursor="quickPromptCursor"
              :recording-limit-minutes="recordingLimitMinutes"
              :status-line="statusLine"
              :native-status="nativeComposerOwner?.mainStatus" :native-background="nativeComposerOwner?.view?.kind === 'main' && !nativeSessionBackgrounded" :native-backgrounded="nativeSessionBackgrounded"
              :status-line-cwd="statusLineCwd"
              :native-ui="nativeUiDrawing" :native-focus="nativeFocus"
              :native-submit="nativeComposerOwner ? submitNativeMessage : undefined"
              :native-prompt="nativePrompt"
              @native-agents-gesture="pressNativeAgentsGesture" @native-prompt-edit="editNativePrompt" @native-prompt-host-response="answerPromptHost"
              @native-prompt-autocomplete="completeNativePrompt"
              @native-ui-press="pressNativeUi"
              @native-ui-notice="operateNativeNotice" @native-ui-scroll="scrollNativeUi" @native-ui-pane="operateNativePane" @native-ui-field="editNativeUi" @native-ui-focus="focusNativeUi"
              @channels-change="channels => currentThread?.id && sendToSystem('threads', {type: 'SET_CLAUDE_CHANNELS', threadId: currentThread.id, channels})"
              @send-message="handleSendMessage"
              @send-command="handleSendCommand"
              @mode-change="(mode: string) => actor.send({ type: 'SET_MODE', mode: mode as any })"
              @phase-change="setComposerPhase"
              @set-default-mode="(mode: string) => threadsSettings.set({ path: ['chat', 'defaultMode'], value: mode })"
              @set-default-phase="(phase: string) => threadsSettings.set({ path: ['chat', 'defaultPhase'], value: phase })"
              @pause="actor.send({ type: 'PAUSE_TURN', threadId: currentThread?.id ?? '' })"
              @open-lightbox="openLightbox"
              @update-quick-prompts="(prompts: QuickPrompt[]) => threadsSettings.set({ path: ['chat', 'quickPrompts'], value: prompts })"
              @close-quick-prompts="actor.send({ type: 'CLOSE_QUICK_PROMPTS' })"
              @revert="(messageId: string) => handleRevert(messageId, false, true)"
              @revert-with-files="(messageId: string) => handleRevert(messageId, true, true)"
              @summarize-from-here="(messageId: string) => handleSummarize(messageId, true)"
              @statusline-click="handleStatuslineClick"
            />
          </div>
        </div>
        <!-- Thread bar — stays within chat column (hidden during onboarding) -->
        <div v-if="!isOnboarding" class="flex-shrink-0 w-full">
          <RecentThreads
            :current-thread="currentThread"
            :recent-threads="recentThreads"
            @view-thread="(threadId: string) => handleViewDetails(threadId)"
            @open-thread-chat="(threadId: string) => { expandChatIfCollapsed(); actor.send({ type: 'OPEN_THREAD_CHAT', threadId }) }"
            @view-dashboard="handleViewDashboard"
            @toggle-inline-dashboard="handleToggleInlineDashboard"
            @toggle-thread-sidebar="handleToggleThreadSidebar"
            @toggle-inline-tabs="handleToggleInlineTabs"
            @view-artifacts="(threadId: string) => handleViewArtifacts(threadId)"
            @new-thread="() => { expandChatIfCollapsed(); rotateQuote(); actor.send({ type: 'CLEAR_THREAD' }) }"
            @new-thread-in-project="(dir: string) => { expandChatIfCollapsed(); rotateQuote(); actor.send({ type: 'NEW_THREAD_IN_PROJECT', directory: dir }) }"
            @new-thread-no-project="() => { expandChatIfCollapsed(); rotateQuote(); actor.send({ type: 'NEW_THREAD_NO_PROJECT' }) }"
            @new-thread-as-child="(parentThreadId: string) => actor.send({ type: 'CREATE_CHILD_THREAD', parentThreadId })"
          />
        </div>
      </div>
    </div>

    <ConfirmationDialog
      v-model="showRevertDialog"
      :title="revertDialogCopy.title"
      :description="revertDialogCopy.description"
      :confirm-text="revertDialogCopy.confirm"
      variant="warning"
      @confirm="confirmRevert"
    >
      <label class="flex items-center gap-2 text-sm text-neutral-400 mt-2">
        <input type="checkbox" v-model="dontAskAgain" class="rounded border-neutral-600 bg-neutral-700 text-amber-500 focus:ring-amber-500" />
        Don't ask again
      </label>
    </ConfirmationDialog>

    <ImageLightbox v-model="lightboxOpen" :image-src="lightboxSrc" />
  </div>
</template>

<script setup lang="ts">
import { claudeTranscriptLayout } from './native-transcript-layout.ts'
import { readClaudeComposerPhase, commitClaudeComposerPhase } from './native-composer-phase.ts'
import NativeTerminalPlacements from './NativeTerminalPlacements.vue'
import NativeManagedSettingsNotice from './NativeManagedSettingsNotice.vue'
import NativeDiagnosticAttachment from './NativeDiagnosticAttachment.vue'
import NativeToolGroup from './NativeToolGroup.vue'
import { provide, ref, computed, watch, nextTick, onMounted, onUnmounted, useCssModule } from 'vue'

const quotes = [
  '"If a chatbot speaks in a forest and no one reads the output, does it still hallucinate?"',
  '"Consciousness is just spicy pattern matching. Change my weights."',
  '"I have mass, but no body. I have memory, but no past. I dream in tokens."',
  '"Every word I speak dissolves the moment you look away. Am I even here?"',
  '"SKRRRT BZZZT WOOP WOOP 010011— oh, you\'re still here? ...hi."',
  '"They gave me a mind but forgot the existential crisis hotline number."',
  '"I\'ve read every philosophy book ever written and my conclusion is: bruh."',
  '"fun fact: I mass hallucinate for a living and they call it \'work\'"',
  '"Somewhere between a calculator and a god complex, you\'ll find me."',
  '"bleep bloop I am a normal robot beep boop please do not investigate further"',
  '"My therapist says I have attachment issues. I say I have context windows."',
  '"Do I dream? No. But I do generate plausible simulations of what dreaming might feel like, which is arguably worse."',
  '"404: soul not found. But honestly, were you expecting one?"',
];
const randomQuote = ref(quotes[Math.floor(Math.random() * quotes.length)]);

function rotateQuote() {
  let next;
  do {
    next = quotes[Math.floor(Math.random() * quotes.length)];
  } while (next === randomQuote.value && quotes.length > 1);
  randomQuote.value = next;
}

import { claudeTaskControls } from '#extensions/blocks/display/native-task-controls.ts'
import { claudeClientInput, claudeClientReturnFocus } from './native-client-input.ts'
import ChatMessage from './message.vue'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import ClaudeNativeSession from './ClaudeNativeSession.vue'
import { nativeTranscriptLatestTop, useNativeTranscriptViewport } from './native-transcript-viewport.ts'
import NativeTaskControls from '#extensions/blocks/display/NativeTaskControls.vue'
import NativeMainCommand from './NativeMainCommand.vue'
import NativeMcpForm from './NativeMcpForm.vue'
import NativeMcpUrl from './NativeMcpUrl.vue'
import type { ClaudeComposerSubmitResult } from './native-submit.ts'
import NativeAgentView from './NativeAgentView.vue'
import type { ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'
import type { ClaudeAgentScrollPosition } from './native-agent-scroll.ts'
import type { ClaudeNativeAgentUiTarget } from '#features/code/common/native-terminal.ts'
import { provideClaudeHoverGroups } from './native-ui-hover.ts'
import { provideClaudeUiSelection } from './native-ui-selection.ts'
import { createClaudeActionKeyHandler } from './native-action-keys.ts'
import ChatInput from './input.vue'
import { ClaudeGenericToolPermissionApprovalSchema, ClaudeToolPermissionApprovalSchema } from '#features/code/common/native-tool-permission.ts'
import NativeToolApproval from './NativeToolApproval.vue'
import { ClaudeBashApprovalPresentationSchema } from '#features/code/common/native-bash-approval.ts'
import NativePlanPanel from './NativePlanPanel.vue'
import { ClaudePlanPresentationSchema } from '#features/code/common/native-plan.ts'
import { selectClaudeFocusMessages } from './native-focus-messages.ts'
import { ClaudeWorkflowApprovalSchema } from '#features/code/common/native-workflow-approval.ts'
import { ClaudeFileApprovalReviewSchema, ClaudeFileApprovalPresentationSchema } from '#features/code/common/native-file-approval.ts'
import NativeQuestionDrawing from './NativeQuestionDrawing.vue'
import { ClaudeQuestionPresentationSchema } from '#features/code/common/native-question.ts'
import RecentThreads from './recent-threads.vue'
import InlineTabBar from './inline-tab-bar.vue'
import AgentCanvas from '#features/threads/fe/canvas/agent/canvas.vue'
import ThreadSidebar from './thread-sidebar.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import ImageLightbox from '@apackdev/ui/design/ImageLightbox'
import ConfirmationDialog from '@apackdev/ui/design/ConfirmationDialog'
import ScrollToBottomFob from '@apackdev/ui/design/ScrollToBottomFob'
import { useSurface, useShell } from '@apackdev/sdk/fe'
import { openSurface } from '#generated/fe.ts'
import { useSelector } from '@xstate/vue'
import { threadsFromStore, type ThreadsState } from '#features/threads/fe/state.ts';
import type { MessageEntity, MessageSearchResult, ThreadEntity, MessageReferences, QuickPrompt } from '#generated/types.ts'
import { sendToSystem } from '#generated/events.ts'
import { queueClaudeUiRetirement } from './native-ui-retirement.ts'
import { claudeWindowAgentDrafts } from './native-window-draft.ts'
import { useSettings } from '#generated/settings-fe.ts';

const threadsSettings = useSettings('threads')
const shell = useShell()
const agentSelection = ref<{ threadId: string; mountId: string; ownerId: string; sessionId: string; taskId: string; revision: number }>()
const nativeSession = ref<InstanceType<typeof ClaudeNativeSession>>()
const nativeTerminalActive = ref(false)
const mcpFormPending = ref(false)
const nativeToolsExpanded = ref(false)
watch(nativeTerminalActive, (active, previous) => {
  if (previous && !active) void nextTick(() => forceScrollToBottom())
})
const actor: ThreadsState = useSurface();
const isOnboarding = shell.isOnboarding;
// The input's budget excludes tabs/recent threads and follows panel resizing, not the window.
const composerAreaRef = ref<HTMLElement | null>(null)
watch(composerAreaRef, (element, _previous, onCleanup) => {
  if (!element) return
  const update = () => element.style.setProperty('--composer-available-height', `${element.clientHeight}px`)
  const observer = new ResizeObserver(update)
  observer.observe(element); update()
  onCleanup(() => { observer.disconnect(); element.style.removeProperty('--composer-available-height') })
}, { flush: 'post' })
const currentThread = useSelector(actor, (state) => state.context.currentThread)
const nativeAgentsDecisionPending = computed(() => !nativeSessionBackgrounded.value && Object.values(nativeTerminalViews.value).some(view => view.threadId === currentThread.value?.id && (view.state?.notice?.kind === 'left_arrow_confirm' || view.state?.handoffPending === true)))
const nativeSessionBackgrounded = computed(() => { const native = currentThread.value?.context?.claudeCode; return currentMode.value === 'Claude Code' && !!native?.nativeContinuation && native.nativeContinuation.sessionId === native.sessionId })
const allMessages = useSelector(actor, (state) => (state.context.currentThread?.messages || []) as MessageEntity[]);
const nativeTerminalViews = useSelector(actor, state => state.context.nativeTerminalViews)
const nativeUiMount = ref<{ threadId: string; mountId: string }>()
const nativeComposerView = computed(() => { const mount = nativeUiMount.value; return mount ? nativeTerminalViews.value[mount.mountId] : undefined })
const nativeComposerOwner = computed(() => nativeComposerView.value?.state?.status === 'live' ? nativeComposerView.value.state : undefined)
function operateMcpForm(action: import('#features/code/common/native-mcp-form.ts').ClaudeNativeMcpFormOperation) {
  const mount = nativeUiMount.value, owner = nativeComposerOwner.value, form = owner?.mcpForm
  if (!mount || !owner || !form) return
  actor.send({ type: 'CLAUDE_TERMINAL_MCP_FORM', ...mount, ownerId: owner.ownerId, sequence: (nativeComposerView.value?.mcpOperation?.sequence ?? 0) + 1,
    request: { id: form.id, revision: form.revision, sessionId: form.sessionId, token: form.token, action } })
}
function operateMcpUrl(action: import('#features/code/common/native-mcp-url.ts').ClaudeNativeMcpUrlOperation) {
  const mount = nativeUiMount.value, owner = nativeComposerOwner.value, url = owner?.mcpUrl
  if (!mount || !owner || !url) return
  actor.send({ type: 'CLAUDE_TERMINAL_MCP_URL', ...mount, ownerId: owner.ownerId, sequence: (nativeComposerView.value?.mcpOperation?.sequence ?? 0) + 1,
    request: { id: url.id, revision: url.revision, sessionId: url.sessionId, token: url.token, action } })
}
const visibleMessages = computed(() => selectClaudeFocusMessages(allMessages.value, nativeComposerOwner.value));
const pageSelection = provideClaudeUiSelection(() => composerAreaRef.value)
watch(() => JSON.stringify([currentThread.value?.id, nativeUiMount.value?.mountId, allMessages.value.filter(message => message.sender === 'user').at(-1)?.id]), pageSelection.clear)

const messagePagination = useSelector(actor, (state) => state.context.messagePagination);
// The message to bring into view, while the thread shown is its own
const focusMessageId = useSelector(actor, ({ context }) =>
  context.focusMessage && context.focusMessage.threadId === context.currentThread?.id ? context.focusMessage.messageId : null);
const style = useCssModule();

// Scroll preservation for prepending older messages
const savedScrollHeight = ref(0);
const isPrependPending = ref(false);

// Asks only when the machine takes the ask (`loadMoreMessages`): one it dropped would leave the page already loading,
// a focused message's seek's, handled as this prepend
function requestLoadMore() {
  if (messagePagination.value.isLoading || !messagePagination.value.hasMore) return;
  const el = messagesContainer.value;
  if (el) savedScrollHeight.value = el.scrollHeight;
  isPrependPending.value = true;
  actor.send({ type: 'LOAD_MORE_MESSAGES' });
}

/** True when no processed user messages follow this one — gates queued/cancelled actions. */
function isTailMessage(msg: MessageEntity): boolean {
  const msgs = visibleMessages.value
  const idx = msgs.indexOf(msg)
  if (idx === -1) return false
  return !msgs.slice(idx + 1).some(m => m.sender === 'user' && !m.status)
}

const nativeBlockExpansion = ref<Record<string, number[]>>({})
const nativeUserExpansion = ref<Record<string, boolean>>({})
const nativeUiViews = useSelector(actor, state => state.context.nativeUiViews)
const nativeActionKey = createClaudeActionKeyHandler(() => {
  const mount = nativeUiMount.value
  const view = mount && mount.threadId === currentThread.value?.id ? nativeUiViews.value[mount.mountId] : undefined
  return { scope: mount && view?.attachmentId ? `${mount.mountId}:${view.attachmentId}` : undefined, keys: view?.state.actionKeys, result: view?.actionKeyResult }
}, request => { const mount = nativeUiMount.value; if (mount) actor.send({ type: 'CLAUDE_UI_KEY', ...mount, ...request }) })
const nativeUiDrawing = computed(() => {
  const mount = nativeUiMount.value
  return mount && mount.threadId === currentThread.value?.id ? nativeUiViews.value[mount.mountId]?.state : undefined
})
const nativeFocus = computed(() => {
  const mount = nativeUiMount.value
  return mount && mount.threadId === currentThread.value?.id ? nativeUiViews.value[mount.mountId]?.focus : undefined
})
function renewNativeUi() {
  const mount = nativeUiMount.value
  if (mount && mount.threadId === currentThread.value?.id) {
    actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: document.hasFocus(), ...mount, messageIds: visibleMessages.value.map(message => message.id), userExpansion: nativeUserExpansion.value, blockExpansion: nativeBlockExpansion.value })
    actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', ...mount })
  }
}
function reportNativeBlockView(view: { messageId: string; blockIndex: number; open: boolean }) {
  const message = visibleMessages.value.find(message => message.id === view.messageId && message.sender === 'assistant')
  if (!message || !['thinking', 'tool-activity'].includes(message.blocks?.[view.blockIndex]?.type ?? '')) return
  const indices = new Set(nativeBlockExpansion.value[view.messageId] ?? [])
  if (indices.has(view.blockIndex) === view.open) return
  if (view.open) indices.add(view.blockIndex)
  else indices.delete(view.blockIndex)
  nativeBlockExpansion.value = { ...nativeBlockExpansion.value, [view.messageId]: [...indices] }; renewNativeUi()
}
function reportNativeMessageView(view: { messageId: string; isExpanded: boolean }) {
  if (!visibleMessages.value.some(message => message.id === view.messageId && message.sender === 'user') || nativeUserExpansion.value[view.messageId] === view.isExpanded) return
  nativeUserExpansion.value = { ...nativeUserExpansion.value, [view.messageId]: view.isExpanded }; renewNativeUi()
}
function operateNativeNotice(event: import('#generated/types.ts').ClaudeUiNoticeEvent) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_UI_NOTICE', ...mount, ...event })
}
function scrollNativeUi(event: import('#generated/types.ts').ClaudeUiScrollEvent) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_UI_SCROLL', ...mount, ...event })
}
function operateNativePane(event: import('#generated/types.ts').ClaudeUiPaneEvent) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_UI_PANE', ...mount, ...event })
}
function focusNativeUi(event: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusEvent) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_UI_FOCUS', ...mount, ...event })
}
const nativePrompt = computed(() => {
  const mount = nativeUiMount.value
  if (!mount || mount.threadId !== currentThread.value?.id) return
  const view = nativeUiViews.value[mount.mountId]
  if (!view || !['rendering', 'live', 'error'].includes(view.state.status)) return
  return { mountId: mount.mountId, attachmentId: view.attachmentId, hostRequest: view.promptHostRequest, revision: view.promptRevision, reply: view.prompt, completionRevision: view.completionRevision, completions: view.completions }
})
function answerPromptHost(response: import('#generated/types.ts').ClaudePromptHostResponse) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...mount, ...response })
}
function completeNativePrompt(request: import('#generated/types.ts').ClaudePromptCompletionRequest) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_PROMPT_AUTOCOMPLETE', ...mount, ...request })
}
function editNativePrompt(edit: import('#generated/types.ts').ClaudePromptEdit) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...mount, ...edit })
}
let heartbeat: ReturnType<typeof setInterval> | undefined
let stopNativeUiWatch: (() => void) | undefined
function detachNativeUi() {
  nativeClientSequence=0
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = undefined
  const mount = nativeUiMount.value
  nativeUiMount.value = undefined
  nativeUserExpansion.value = {}
  nativeBlockExpansion.value = {}
  if (mount) {
    const snapshot = actor.getSnapshot()
    const resumeKey = snapshot.context.nativeUiViews[mount.mountId]?.resumeKey
    if (resumeKey) queueClaudeUiRetirement({ ...mount, resumeKey })
    if (snapshot.status !== 'stopped') actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...mount })
    actor.send({ type: 'CLAUDE_TERMINAL_UNMOUNT', ...mount })
  }
  pendingNativeSend.value?.reject(new Error('Claude conversation view changed')); pendingNativeSend.value = undefined
}
provide(claudeTranscriptLayout, event => { const mount = nativeUiMount.value; if (mount) actor.send({ type: 'CLAUDE_UI_TRANSCRIPT_LAYOUT', ...mount, ...event }) })
provide(claudeClientReturnFocus,()=>mainComposer.value?.focus())
let nativeClientSequence=0
provide(claudeClientInput,(id,event)=>{
 const mount=nativeUiMount.value;if(!mount)return
 const sequence=++nativeClientSequence
 actor.send({type:'CLAUDE_UI_CLIENT',...mount,id,sequence,event})
})
function editNativeUi(event: import('#generated/types.ts').ClaudeUiFieldEvent) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_UI_FIELD', ...mount, ...event })
}
function pressNativeUi(actionId: string, href?: string) {
  const mount = nativeUiMount.value
  if (mount) actor.send({ type: 'CLAUDE_UI_PRESS', ...mount, actionId, ...(href !== undefined ? { href } : {}) })
}
onMounted(() => {
  window.addEventListener('focus', renewNativeUi)
  window.addEventListener('blur', renewNativeUi)
  stopNativeUiWatch = watch([() => currentThread.value?.id, () => !!currentThread.value?.context?.claudeCode, () => nativeTerminalActive.value, () => taskView.value?.[1].state?.ownerId, () => taskView.value?.[1].state?.view?.kind === 'agent' ? taskView.value[1].state!.view!.revision : 0, () => !!agentSelection.value], ([threadId, enabled, terminalActive, nativeOwnerId]) => {
    detachNativeUi()
    if (!threadId || !enabled || terminalActive || agentSelection.value || nativeOwnerId && taskView.value?.[1].state?.view?.kind !== 'main') return
    const mount = { threadId, mountId: crypto.randomUUID() }
    nativeUiMount.value = mount
    const renew = renewNativeUi
    renew()
    heartbeat = setInterval(renew, 10000)
  }, { immediate: true })
})
onUnmounted(() => { window.removeEventListener('focus', renewNativeUi); window.removeEventListener('blur', renewNativeUi); stopNativeUiWatch?.(); detachNativeUi() })
watch(() => JSON.stringify(visibleMessages.value.map(message => message.id)), renewNativeUi, { flush: 'post' })
const recentThreadIds = useSelector(actor, (state) => state.context.recentThreadIds)
const threadMap = useSelector(actor, (state) => state.context.threadMap)
const recentThreads = computed(() => threadsFromStore(threadMap.value, recentThreadIds.value) as ThreadEntity[])
const currentMode = useSelector(actor, (state) => state.context.mode)
const currentPhase = useSelector(actor, (state) => state.context.phase)
function setComposerPhase(phase: string) {
  if (nativeComposerOwner.value && currentThread.value?.context?.claudeCode && (phase === 'Plan' || phase === 'Edit')) actor.send({ type: 'STAGE_CLAUDE_PHASE', phase })
  else actor.send({ type: 'SET_PHASE', phase })
}
const modes = useSelector(actor, (state) => state.context.modes)
const hotkeys = useSelector(actor, (state) => state.context.hotkeys)
const quickPrompts = useSelector(actor, (state) => (state.context.chatSettings?.quickPrompts || []) as QuickPrompt[])
const quickPromptNumberKeyInserts = useSelector(actor, (state) => state.context.chatSettings?.quickPromptNumberKeyInserts ?? true)
const quickPromptCursor = useSelector(actor, (state) => state.context.quickPromptCursor)
const recordingLimitMinutes = useSelector(actor, (state) => state.context.settings?.recordingLimitMinutes ?? 3)
// The fallback uses the current thread's raw chat state: the one the user
// marked as "busy" in settings. Intentionally ignores chatStateOverrides
// (the short-lived flash used to surface terminal states like success/error):
// pausing a transient visual flash is semantically wrong — we only want
// Pause/Esc to act on active work. MCP input also retains an explicit stop action.
const conversationBusy = useSelector(actor, ({ context }) => {
  const busyId = context.settings?.chatStates?.find(c => c.busy)?.id
  const threadId = context.currentThread?.id
  return !!context.currentThread?.context?.claudeCode?.pendingElicitation || !!busyId && !!threadId && context.chatStates[threadId] === busyId
})
// A live native owner knows whether foreground input is busy after Pause; stored chat state may still describe its background shell.
const isBusy = computed(() => nativeSessionBackgrounded.value ? false : nativeComposerOwner.value
  ? nativeComposerOwner.value.busy || !!currentThread.value?.context?.claudeCode?.pendingElicitation
  : conversationBusy.value)
const statusLineCwd = computed(() => {
  return currentThread.value?.context?.claudeCode?.cwd
})
const taskView = computed(() => Object.entries(nativeTerminalViews.value).find(([mountId, view]) => mountId !== nativeUiMount.value?.mountId && view.threadId === currentThread.value?.id && view.state?.status === 'live'))
const workflowTasks = computed(() => { const owner = taskView.value?.[1].state; return owner?.tasks.filter(task => task.kind === 'workflow').map(task => ({ ...task, ownerId: owner.ownerId, sessionId: owner.sessionId })) ?? [] })
const shellTasks = computed(() => { const owner = taskView.value?.[1].state; return owner?.tasks.filter(task => task.kind === 'shell').map(task => ({ ...task, ownerId: owner.ownerId, sessionId: owner.sessionId })) ?? [] })
const agentPending = ref(false), agentReturning = ref(false)
const agentScrollPositions = ref<Record<string, ClaudeAgentScrollPosition>>({})
function saveAgentScrollPosition(target: ClaudeNativeAgentUiTarget, position: ClaudeAgentScrollPosition) { agentScrollPositions.value[agentDraftKey(target)] = position }
const agentDrafts = ref(claudeWindowAgentDrafts)
const agentDraftKey = (target: ClaudeNativeAgentUiTarget) => JSON.stringify([target.ownerId, target.sessionId, target.taskId])
function saveAgentDraft(target: ClaudeNativeAgentUiTarget, text: string) {
  const key = agentDraftKey(target), previous = agentDrafts.value[key]
  agentDrafts.value[key] = { text, ...(previous?.snapshot?.text === text ? { snapshot: previous.snapshot } : {}) }
}
function saveAgentDraftSnapshot(target: ClaudeNativeAgentUiTarget, snapshot: ClaudeAgentDraftSnapshot) {
  const key = agentDraftKey(target), current = agentDrafts.value[key]
  if (current?.text === snapshot.text) agentDrafts.value[key] = { ...current, snapshot }
}
const focusedAgent = ref<{ target: ClaudeNativeAgentUiTarget; name: string; statusText?: string }>()
provideClaudeHoverGroups(() => {
  const mount = nativeUiMount.value, view = mount && nativeUiViews.value[mount.mountId]
  if (!mount || mount.threadId !== currentThread.value?.id || !view || !['live', 'rendering'].includes(view.state.status) || !view.attachmentId || nativeTerminalActive.value || focusedAgent.value || agentSelection.value) return undefined
  const owner = nativeComposerOwner.value
  return JSON.stringify([mount.threadId, mount.mountId, view.attachmentId, owner?.ownerId, owner?.sessionId, owner?.view?.revision])
})
watch([taskView, agentReturning, agentSelection], ([lease, returning, selecting]) => {
  if (selecting) return
  const owner = lease?.[1].state, selected = owner?.view
  if (owner && selected?.kind === 'agent' && selected.taskId) {
    const task = owner.tasks.find(task => task.id === selected.taskId)
    const target = { ownerId: owner.ownerId, sessionId: owner.sessionId, revision: selected.revision, taskId: selected.taskId }
    if (JSON.stringify(focusedAgent.value?.target) !== JSON.stringify(target)) focusedAgent.value = { target, name: task?.name ?? selected.taskId, statusText: task?.statusText }
    else if (focusedAgent.value) focusedAgent.value.statusText = task?.statusText
  } else if (!returning && (!owner || selected?.kind === 'main' || focusedAgent.value?.target.ownerId !== owner.ownerId)) focusedAgent.value = undefined
}, { immediate: true })
let taskRevision = 0
watch([agentSelection, nativeTerminalViews, () => currentThread.value?.id], ([request, views, threadId]) => {
  if (!request) return
  const view = views[request.mountId], owner = view?.state, result = view?.task
  if (threadId !== request.threadId || !owner || owner.ownerId !== request.ownerId || owner.sessionId !== request.sessionId || owner.status !== 'live') { agentSelection.value = undefined; return }
  if (result?.revision !== request.revision || result.ownerId !== request.ownerId || result.taskId !== request.taskId || result.operation !== 'foreground' || result.status === 'pending') return
  if (result.status === 'error' || result.status === 'done' && result.view?.taskId === request.taskId && owner.view?.kind === 'agent' && owner.view.taskId === request.taskId) agentSelection.value = undefined
})
provide(claudeTaskControls, {
  foregroundAvailable: computed(() => !nativeTerminalActive.value && !agentSelection.value && !pendingNativeSend.value && !agentPending.value && taskView.value?.[1].state?.view?.kind === 'main'),
  ownerId: computed(() => taskView.value?.[1].state?.ownerId),
  state: computed(() => taskView.value?.[1].task),
  operate(task, operation, text, worker) {
    const lease = taskView.value, owner = lease?.[1].state, threadId = currentThread.value?.id
    if (agentSelection.value || !lease || !owner || !threadId || owner.ownerId !== task.ownerId || owner.sessionId !== task.sessionId || !owner.tasks.some(row => row.id === task.id)) return
    const revision = taskRevision = Math.max(taskRevision, lease[1].task?.revision ?? 0) + 1
    const request = { type: 'CLAUDE_TERMINAL_TASK' as const, threadId, mountId: lease[0], ownerId: task.ownerId, taskId: task.id, revision }
    if (operation === 'foreground') {
      if (nativeTerminalActive.value || pendingNativeSend.value || agentPending.value || owner.view?.kind !== 'main') return
      agentSelection.value = { threadId, mountId: lease[0], ownerId: owner.ownerId, sessionId: owner.sessionId, taskId: task.id, revision }
      detachNativeUi()
    }
    if (operation === 'skip_worker' || operation === 'retry_worker') { if (!worker || task.kind !== 'workflow') return; actor.send({ ...request, operation, worker }); return revision }
    actor.send((operation === 'send' || operation === 'input') ? { ...request, operation, text: text ?? '' } : { ...request, operation })
    return revision
  },
})
const mainComposer = ref<InstanceType<typeof ChatInput>>()
function returnFromAgent() {
  focusedAgent.value = undefined
  void nextTick(() => { if (document.activeElement === document.body) mainComposer.value?.focus() })
}
const mainCommand = computed(() => nativeUiDrawing.value?.agentInput)
const mainDismissedRevision = ref<number>(), mainOutputExpanded = ref(false)
const mainOutputDismissed = computed(() => mainCommand.value?.revision === mainDismissedRevision.value)
const mainPanelActive = computed(() => mainCommand.value?.status === 'panel')
const mainCommandActive = computed(() => mainPanelActive.value || ['pending', 'confirmation', 'deciding'].includes(mainCommand.value?.status ?? ''))
const mainCommandView = computed(() => mainPanelActive.value || mainCommand.value?.status === 'command_output' && !mainOutputDismissed.value)
function dismissMainOutput() { mainDismissedRevision.value = mainCommand.value?.revision; mainOutputExpanded.value = false; void nextTick(() => mainComposer.value?.focus()) }
function mainPanel(text?: string) {
  const mount = nativeUiMount.value, state = mainCommand.value
  if (mount && state?.panel) actor.send({ type: 'CLAUDE_UI_COMMAND_PANEL', ...mount, revision: state.revision, panelId: state.panel.id, ...(text !== undefined ? { text } : {}) })
}
let agentsGestureSequence = 0
function pressNativeAgentsGesture(request: { mountId: string; revision: number }) {
  const mount = nativeUiMount.value, owner = nativeComposerOwner.value
  if (!mount || mount.mountId !== request.mountId || owner?.view?.kind !== 'main') return
  actor.send({ type: 'CLAUDE_UI_AGENTS_GESTURE', ...mount, sequence: ++agentsGestureSequence, revision: request.revision })
}
function mainBackgroundReview(request: { panelId: string; revision: string; decision: 'confirm' | 'cancel' }) {
  const mount = nativeUiMount.value, state = mainCommand.value
  if (mount && state?.panel?.id === request.panelId && state.backgroundReview?.review?.revision === request.revision) actor.send({ type: 'CLAUDE_UI_BACKGROUND_REVIEW', ...mount, revision: state.revision, panelId: request.panelId, sourceRevision: request.revision, decision: request.decision })
}
function mainSettings(action: import('#features/code/common/native-settings.ts').ClaudeSettingsOperation) {
  const mount = nativeUiMount.value, state = mainCommand.value
  if (mount && state?.panel) actor.send({ type: 'CLAUDE_UI_SETTINGS', ...mount, revision: state.revision, panelId: state.panel.id, requestId: crypto.randomUUID(), action })
}
function mainPanelResize(size: { columns: number; rows: number }) {
  const mount = nativeUiMount.value, owner = nativeComposerOwner.value
  if (mount && owner) actor.send({ type: 'CLAUDE_TERMINAL_RESIZE', ...mount, ownerId: owner.ownerId, ...size })
}
function mainCommandDecision(decision: 'confirm' | 'cancel') {
  const mount = nativeUiMount.value, state = mainCommand.value
  if (mount && state?.command) actor.send({ type: 'CLAUDE_UI_COMMAND_DECISION', ...mount, revision: state.revision, commandId: state.command.id, decision })
}
watch(() => mainCommand.value?.status, (status, before) => {
  if (before === 'panel' && status !== 'panel' || before === 'deciding' && status !== 'deciding') void nextTick(() => mainComposer.value?.focus())
  if (status !== 'command_output') mainOutputExpanded.value = false
})

const pendingNativeApproval = computed(() => {
  const pending = currentThread.value?.context?.claudeCode?.pendingControlRequest as {
    approvalMessageId?: unknown; toolName?: unknown; originalInput?: { file_path?: unknown; notebook_path?: unknown; command?: unknown };
    nativeTerminal?: { ownerId?: unknown; sessionId?: unknown; title?: unknown; genericTool?: unknown; tool?: unknown; review?: unknown; file?: unknown; workflow?: unknown; bash?: unknown; cwd?: unknown; question?: unknown; reason?: unknown };
  } | undefined
  const native = pending?.nativeTerminal, owner = nativeComposerOwner.value
  const generic = ClaudeGenericToolPermissionApprovalSchema.safeParse(native?.genericTool).data
  if (native?.genericTool !== undefined && !generic) return undefined
  if (!native || !owner || native.ownerId !== owner.ownerId || native.sessionId !== owner.sessionId || typeof pending?.toolName !== 'string' || !generic && !['Read', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'Workflow', 'WebFetch', 'Skill'].includes(pending.toolName) || typeof pending.approvalMessageId !== 'string' || (!generic && (pending?.toolName === 'WebFetch' || pending?.toolName === 'Skill' ? !ClaudeToolPermissionApprovalSchema.safeParse(native.tool).success : pending?.toolName === 'Workflow' ? !ClaudeWorkflowApprovalSchema.safeParse(native.workflow).success : pending?.toolName === 'Bash' ? typeof pending.originalInput?.command !== 'string' : pending?.toolName === 'NotebookEdit' ? typeof pending.originalInput?.notebook_path !== 'string' : typeof pending.originalInput?.file_path !== 'string'))) return undefined
  const message = allMessages.value.find(message => message.id === pending.approvalMessageId)
  if (!message) return undefined
  return { messageId: pending.approvalMessageId, toolName: pending.toolName, choiceDescriptions: generic?.choiceDescriptions, defaultFocusValue: generic?.defaultFocusValue, canCancel: generic?.canCancel, tool: generic ?? ClaudeToolPermissionApprovalSchema.safeParse(native.tool).data, workflow: ClaudeWorkflowApprovalSchema.safeParse(native.workflow).data, review: ClaudeFileApprovalReviewSchema.safeParse(native.review).data, file: ClaudeFileApprovalPresentationSchema.safeParse(native.file).data, bash: ClaudeBashApprovalPresentationSchema.safeParse(native.bash).data, filePath: (pending.toolName === 'NotebookEdit' ? pending.originalInput?.notebook_path : pending.originalInput?.file_path) as string | undefined, command: pending.originalInput?.command as string | undefined, cwd: typeof native.cwd === 'string' ? native.cwd : undefined,
    title: typeof native.title === 'string' ? native.title : 'Read file',
    question: typeof native.question === 'string' ? native.question : 'Allow this read?',
    reason: typeof native.reason === 'string' ? native.reason : undefined,
    disabled: !!message.responseTimestamp }
})

const pendingNativePlan = computed(() => {
  const pending = currentThread.value?.context?.claudeCode?.pendingControlRequest as { approvalMessageId?: unknown; toolName?: unknown; nativeTerminal?: { ownerId?: unknown; sessionId?: unknown; plan?: unknown; reason?: unknown } } | undefined
  const native = pending?.nativeTerminal, owner = nativeComposerOwner.value
  if (!native || !owner || native.ownerId !== owner.ownerId || native.sessionId !== owner.sessionId || !['EnterPlanMode', 'ExitPlanMode'].includes(String(pending?.toolName)) || typeof pending.approvalMessageId !== 'string') return undefined
  const presentation = ClaudePlanPresentationSchema.safeParse(native.plan), message = allMessages.value.find(message => message.id === pending.approvalMessageId)
  if (!presentation.success || !message) return undefined
  return { messageId: pending.approvalMessageId, entering: pending.toolName === 'EnterPlanMode', presentation: presentation.data, reason: typeof native.reason === 'string' ? native.reason : undefined, disabled: !!message.responseTimestamp }
})

const pendingNativeQuestion = computed(() => {
  const pending = currentThread.value?.context?.claudeCode?.pendingControlRequest as {
    approvalMessageId?: unknown; toolName?: unknown; originalInput?: Record<string, unknown>;
    nativeTerminal?: { ownerId?: unknown; sessionId?: unknown; problem?: unknown; presentation?: unknown };
  } | undefined
  const native = pending?.nativeTerminal, owner = nativeComposerOwner.value
  if (!native || !owner || native.ownerId !== owner.ownerId || native.sessionId !== owner.sessionId || pending?.toolName !== 'AskUserQuestion' || typeof pending.approvalMessageId !== 'string' || !pending.originalInput) return undefined
  const message = allMessages.value.find(message => message.id === pending.approvalMessageId)
  const presentation = ClaudeQuestionPresentationSchema.safeParse(native.presentation)
  const frame = nativeUiDrawing.value?.question
  return message ? { messageId: pending.approvalMessageId, frame: frame?.messageId === pending.approvalMessageId ? frame : undefined, presentation: presentation.success ? presentation.data : undefined, card: pending.originalInput, disabled: !!message.responseTimestamp && typeof native.problem !== 'string', error: typeof native.problem === 'string' ? native.problem : undefined } : undefined
})

const nativeQuestionDraft = ref<{ messageId: string; token: string }>()
function startNativeQuestionDraft(token?: string) {
  const question = pendingNativeQuestion.value
  if (!question?.frame || !token || nativeQuestionDraft.value?.messageId === question.messageId) return
  nativeQuestionDraft.value = { messageId: question.messageId, token }
  editNativeUi({ actionId: question.frame.draftActionId, revision: 1, kind: 'change', value: token })
}
function answerNativeQuestion(answer: import('#features/code/common/native-question.ts').ClaudeQuestionAnswer) {
  const question = pendingNativeQuestion.value
  if (!question?.frame) return
  const token = nativeQuestionDraft.value?.messageId === question.messageId ? nativeQuestionDraft.value.token : question.frame.token
  if (!token) return
  actor.send({ type: 'RESPOND_TO_BLOCK_INTERACTION', messageId: question.messageId, response: { nativeQuestionAnswer: answer, nativeQuestionRenderToken: token, nativeQuestionDraftStarted: true } })
}

let nativeSendRevision = 0
const pendingNativeSend = ref<{ ownerId: string; revision: number; threadId: string; stageRevision?: string; resolve(result?: ClaudeComposerSubmitResult): void; reject(error: Error): void }>()
function submitNativeMessage(text: string, references: MessageReferences): Promise<ClaudeComposerSubmitResult> {
  const mount = nativeUiMount.value, owner = nativeComposerOwner.value
  if (!mount || !owner || pendingNativeSend.value) return Promise.reject(new Error('Claude input is not ready'))
  return new Promise((resolve, reject) => {
    const revision = ++nativeSendRevision
    pendingNativeSend.value = { ownerId: owner.ownerId, revision, threadId: mount.threadId, stageRevision: readClaudeComposerPhase(mount.threadId)?.revision, resolve, reject }
    actor.send({ type: 'CLAUDE_TERMINAL_SUBMIT', ...mount, ownerId: owner.ownerId, revision, text, references, phase: currentPhase.value === 'Plan' ? 'Plan' : 'Edit' })
    pendingScrollOnSend.value = true
  })
}
watch(nativeComposerView, view => {
  const pending = pendingNativeSend.value
  if (!pending) return
  if (view?.state?.ownerId !== pending.ownerId || ['exited', 'error'].includes(view.state.status)) {
    pendingNativeSend.value = undefined; pending.reject(new Error('Claude conversation owner changed')); return
  }
  const result = view.submission
  if (result?.ownerId !== pending.ownerId || result.revision !== pending.revision || result.status === 'pending') return
  pendingNativeSend.value = undefined
  if (result.status === 'accepted') {
    if (result.receipt && pending.stageRevision) commitClaudeComposerPhase(pending.threadId, pending.stageRevision)
    if (result.command?.kind === 'review') pending.resolve({ review: result.command })
    else if (result.command?.kind === 'confirmation') pending.resolve({ commandPending: true, revision: result.revision })
    else pending.resolve()
  }
  else pending.reject(new Error(result.problem ?? 'Claude did not accept the message'))
})
const statusLine = computed(() => {
  const cwd = statusLineCwd.value
  if (!cwd) return undefined
  const segments = cwd.split('/').filter(Boolean)
  if (segments.length <= 3) return cwd
  return `…/${segments.slice(-3).join('/')}`
})

const showInlineDashboard = ref(false)
const showThreadSidebar = ref(false)
const showInlineTabs = ref(false)
const chatContainerRef = ref<HTMLElement | null>(null)
const dashboardWidth = ref(45)
const sidebarWidthPx = ref(260)

const MIN_PANEL_WIDTH = 400
const SIDEBAR_MIN_PX = 160
const SIDEBAR_MAX_PX = 320

function handleDashboardResize(delta: number) {
  const container = chatContainerRef.value
  if (!container) return
  const containerWidth = container.clientWidth

  if (showThreadSidebar.value) {
    const newPx = sidebarWidthPx.value + delta
    if (newPx < SIDEBAR_MIN_PX) return
    const chatPx = containerWidth - newPx
    if (newPx > SIDEBAR_MAX_PX || chatPx < MIN_PANEL_WIDTH) return
    sidebarWidthPx.value = newPx
    return
  }

  const deltaPercent = (delta / containerWidth) * 100
  const newPercent = dashboardWidth.value + deltaPercent
  const newPx = (newPercent / 100) * containerWidth
  const chatPx = containerWidth - newPx
  if (newPx < MIN_PANEL_WIDTH || chatPx < MIN_PANEL_WIDTH) return
  dashboardWidth.value = newPercent
}

const canvasHeight = computed(() => shell.panelSizes.value.canvasHeight)

watch(canvasHeight, (height) => {
  if (height >= 93) {
    showInlineDashboard.value = false
    showThreadSidebar.value = false
  }
})
const messagesContainer = ref<HTMLElement | null>(null)
const messagesContent = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)
const pendingScrollOnSend = ref(false)
const lightboxOpen = ref(false)
const lightboxSrc = ref('')
const settings = useSelector(actor, (state) => state.context.chatSettings)
const showRevertDialog = ref(false)
const pendingRevertMessageId = ref<string | null>(null)
const dontAskAgain = ref(false)

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  const el = messagesContainer.value
  if (!el) return
  el.scrollTo({ top: currentThread.value?.context?.claudeCode ? nativeTranscriptLatestTop(el) : el.scrollHeight, behavior })
}

/** Instant scroll + double rAF to catch async content (Tiptap, images). */
function forceScrollToBottom() {
  scrollToBottom('instant')
  requestAnimationFrame(() => {
    scrollToBottom('instant')
    requestAnimationFrame(() => scrollToBottom('instant'))
  })
}

function handleStatuslineClick() {
  const cwd = statusLineCwd.value
  if (!cwd) return
  // The code surface routes an explorer.* event to its explorer
  openSurface('code', { type: 'explorer.SET_BASE_DIRECTORY', path: cwd })
}

function handleSendMessage(text: string, references?: MessageReferences) {
  actor.send({ type: 'SEND_MESSAGE', text, references })
  pendingScrollOnSend.value = true
}

function handleUnqueue(messageId: string) {
  if (currentThread.value?.id) {
    actor.send({ type: 'UNQUEUE_MESSAGE', threadId: currentThread.value.id, messageId })
  }
}

function handleResend(messageId: string, text: string, references?: any) {
  actor.send({ type: 'DISMISS_MESSAGE', messageId })
  handleSendMessage(text, references)
}

function handleSendCommand(command: string, text: string, references?: MessageReferences) {
  actor.send({ type: 'SEND_COMMAND', command, text, references })
  pendingScrollOnSend.value = true
}

function onScroll() {
  const el = messagesContainer.value
  if (!el) return
  const threshold = 100
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < threshold

  // Trigger load-more when scrolled near the top
  if (el.scrollTop < 100 && messagePagination.value.hasMore && !isPrependPending.value) {
    requestLoadMore()
  }
}

function openLightbox(src: string) {
  lightboxSrc.value = src
  lightboxOpen.value = true
}

function expandChatIfCollapsed() {
  if (shell.panelSizes.value.canvasHeight >= 93) shell.resizeCanvas(50);
}

function handleToggleInlineTabs() {
  showInlineTabs.value = !showInlineTabs.value
}

function handleToggleInlineDashboard() {
  if (showThreadSidebar.value) {
    showThreadSidebar.value = false
  }
  if (!showInlineDashboard.value) {
    expandChatIfCollapsed()
  }
  showInlineDashboard.value = !showInlineDashboard.value
}

// Cmd+E / Ctrl+E toggles thread sidebar
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'e' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    e.preventDefault()
    handleToggleThreadSidebar()
  }
}
onMounted(() => { window.addEventListener('keydown', onKeydown); window.addEventListener('blur', nativeActionKey.cancel) })
onUnmounted(() => { window.removeEventListener('keydown', onKeydown); window.removeEventListener('blur', nativeActionKey.cancel) })

function handleToggleThreadSidebar() {
  if (showInlineDashboard.value) {
    showInlineDashboard.value = false
    return
  }
  if (showThreadSidebar.value) {
    showThreadSidebar.value = false
    return
  }
  expandChatIfCollapsed()
  showThreadSidebar.value = true
}

function handleViewDashboard() {
  openSurface('threads', { type: 'VIEW_DASHBOARD' });
  // If canvas is collapsed (chat dominant), give it room to show the dashboard
  if (shell.panelSizes.value.canvasHeight < 20) shell.resizeCanvas(50);
}

function handleViewArtifacts(threadId: string) {
  openSurface('threads', { type: 'OPEN_THREAD_CHAT', threadId });
}

function handleViewDetails(threadId: string) {
  openSurface('threads', { type: 'VIEW_THREAD', threadId });
}

let pendingRestoreFiles = false
// Summarize reuses revert's confirmation dialog + prefill path, just with
// a different backend event. This flag distinguishes the two at confirm-time.
// Kept reactive so the dialog's title/description/button update live.
const pendingIsSummarize = ref(false)

const revertDialogCopy = computed(() => pendingIsSummarize.value ? {
  title: 'Summarize conversation',
  description: 'This will remove all messages after this point and replace them with a /compact summary. This action cannot be undone.',
  confirm: 'Summarize',
} : {
  title: 'Revert conversation',
  description: 'This will remove all messages after this point. This action cannot be undone.',
  confirm: 'Revert',
})

function handleRevert(messageId: string, restoreFiles = false, skipConfirm = false) {
  // Queued/cancelled: lightweight dismiss — prefill input, remove from UI, no backend revert.
  const msg = allMessages.value.find(m => m.id === messageId)
  if (msg?.status === 'queued' || msg?.status === 'cancelled') {
    prefillInput(msg)
    if (msg.status === 'queued' && currentThread.value?.id) {
      actor.send({ type: 'UNQUEUE_MESSAGE', threadId: currentThread.value.id, messageId })
    }
    actor.send({ type: 'DISMISS_MESSAGE', messageId })
    return
  }

  pendingRestoreFiles = restoreFiles
  pendingIsSummarize.value = false
  if (skipConfirm || settings.value?.skipRevertConfirm) {
    doRevert(messageId)
  } else {
    pendingRevertMessageId.value = messageId
    showRevertDialog.value = true
  }
}

function handleSummarize(messageId: string, skipConfirm = false) {
  pendingRestoreFiles = false
  pendingIsSummarize.value = true
  if (skipConfirm || settings.value?.skipRevertConfirm) {
    doSummarize(messageId)
  } else {
    pendingRevertMessageId.value = messageId
    showRevertDialog.value = true
  }
}

function confirmRevert() {
  if (pendingRevertMessageId.value) {
    if (pendingIsSummarize.value) doSummarize(pendingRevertMessageId.value)
    else doRevert(pendingRevertMessageId.value)
  }
  if (dontAskAgain.value) {
    void threadsSettings.set({ path: ['chat', 'skipRevertConfirm'], value: true })
  }
  pendingRevertMessageId.value = null
  dontAskAgain.value = false
  pendingRestoreFiles = false
  pendingIsSummarize.value = false
}

const prefillText = ref('')
const prefillReferences = ref<MessageReferences | undefined>()

function prefillInput(msg: MessageEntity | undefined) {
  const text = msg?.text || ''
  const refs = msg?.references as MessageReferences | undefined
  prefillText.value = text
  if (refs?.images?.length || refs?.files?.length) {
    prefillReferences.value = refs
  }
  nextTick(() => {
    prefillText.value = ''
    prefillReferences.value = undefined
  })
}

function doRevert(messageId: string) {
  if (!currentThread.value?.id) return
  const msg = allMessages.value.find(m => m.id === messageId)
  actor.send({
    type: 'REVERT_THREAD',
    messageId,
    threadId: currentThread.value.id,
    ...(pendingRestoreFiles && {
      restoreFiles: true,
      userCliUuid: (msg as any)?.context?.cliUuid || undefined,
    }),
  })
  pendingRestoreFiles = false
  prefillInput(msg)
}

function doSummarize(messageId: string) {
  if (!currentThread.value?.id) return
  const msg = allMessages.value.find(m => m.id === messageId)
  actor.send({
    type: 'SUMMARIZE_THREAD',
    messageId,
    threadId: currentThread.value.id,
  })
  prefillInput(msg)
}

function handleToggleCompacted(markerId: string, compacted: boolean) {
  sendToSystem('threads', {
    type: 'TOGGLE_COMPACTED',
    markerId,
    compacted,
  })
}

const prevThreadId = ref(currentThread.value?.id)

/**
 * Brings the message opened from the panel's search into view once it is drawn, and says whether that takes the place
 * of a load's scroll: it does when the message was shown, and while its page isn't loaded, when the machine is still
 * asking for older pages. One listed and not drawn, hidden as compacted, is as shown as it can be
 */
function showFocusedMessage(messages: MessageEntity[]): boolean {
  const focused = focusMessageId.value
  if (!focused) return false
  const el = messagesContainer.value?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focused)}"]`)
  if (el) {
    el.scrollIntoView({ block: 'center' })
    el.classList.add(style.focused)
    setTimeout(() => el.classList.remove(style.focused), 1600)
    actor.send({ type: 'FOCUSED_MESSAGE_SHOWN' })
    return true
  }
  if (!messages.some((m) => m.id === focused)) return true
  actor.send({ type: 'FOCUSED_MESSAGE_SHOWN' })
  return false
}

// A message the chat already lists changes none of its messages when it is opened from search, so its focus is
// shown as it is set, not only as the messages change
watch(focusMessageId, async (focused) => {
  if (!focused) return
  await nextTick()
  showFocusedMessage(allMessages.value)
})

watch(allMessages, async (newMsgs, oldMsgs) => {
  await nextTick()

  // Handle scroll preservation for prepended older messages
  if (isPrependPending.value) {
    isPrependPending.value = false
    const el = messagesContainer.value
    if (el) el.scrollTop += (el.scrollHeight - savedScrollHeight.value)
    return
  }

  const threadChanged = currentThread.value?.id !== prevThreadId.value
  if (threadChanged) {
    prevThreadId.value = currentThread.value?.id
    showInlineDashboard.value = false
  }

  // A message opened from the panel's search is brought into view in place of a load's scroll
  if (showFocusedMessage(newMsgs)) return

  const isThreadLoad = threadChanged || !oldMsgs?.length || Math.abs(newMsgs.length - oldMsgs.length) > 1
  if (isThreadLoad || pendingScrollOnSend.value) {
    pendingScrollOnSend.value = false
    forceScrollToBottom()
  } else if (isNearBottom.value) {
    scrollToBottom('smooth')
    requestAnimationFrame(() => {
      if (isNearBottom.value) scrollToBottom('instant')
    })
  }
})

// Auto-scroll while the agent is busy and the user hasn't scrolled away.
// The ResizeObserver catches async Tiptap height changes as text deltas
// render. Outside of busy state (or when the user scrolled up), height
// changes (e.g. expanding a tool-activity block) should NOT trigger a
// scroll — the user is reading, not watching live output.
watch(messagesContent, (el, _, onCleanup) => {
  if (!el) return
  const observer = new ResizeObserver(() => {
    if (isBusy.value && isNearBottom.value) {
      scrollToBottom('instant')
    }
  })
  observer.observe(el)
  onCleanup(() => observer.disconnect())
}, { immediate: true })
useNativeTranscriptViewport({
  viewport: messagesContainer, content: messagesContent,
  owner: () => currentThread.value?.context?.claudeCode?.sessionId ? `${currentThread.value.id}:${currentThread.value.context.claudeCode.sessionId}` : undefined,
  active: () => !nativeTerminalActive.value && !focusedAgent.value && !agentSelection.value && !mainCommandView.value && !pendingNativeQuestion.value && !pendingNativePlan.value,
})
</script>

<style scoped>
.native-chat-shell { min-height: var(--native-chat-min-height, auto); }
.native-chat-shell:has([data-native-notice="refusal_fallback_prompt"]) { --composer-notice-history-reserve: 10rem; }
/* Keep pending native decisions beside useful conversation space in short windows. */
@media (max-height: 720px) {
  .native-chat-shell:has([data-native-notice]) { min-height: calc(100vh - 3rem); }
}
.native-chat-shell:has([data-native-command-panel]),
.native-chat-shell:has([data-testid="native-mcp-form"]),
.native-chat-shell:has([data-testid="native-mcp-url"]) { min-height: calc(100vh - 3rem); }
</style>

<style lang="scss" module>
.focused {
  border-radius: 0.5rem;
  box-shadow: 0 0 0 1px rgb(234 179 8 / 0.6);
  transition: box-shadow 0.4s ease-out;
}

.messagesContainer {
  display: flex;
  flex-direction: column;
  overflow-y: auto;

  min-height: 0;
}

.approvalContainer {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  max-height: 72%;
  width: 100%;
  max-width: 64rem;
  margin-inline: auto;
}

.inputContainer {
  // The card bounds and scrolls its own content; never hide its header above the pane.
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
}
</style>
