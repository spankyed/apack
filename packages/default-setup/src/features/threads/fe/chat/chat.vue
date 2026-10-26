<template>
  <div class="flex flex-col h-full">
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
        <!-- Shrinkable content area -->
        <div class="flex flex-col flex-grow overflow-hidden min-h-0">
          <!-- Agent Chat Content -->
          <div class="relative flex-grow w-full overflow-hidden min-h-0" :class="$style.messagesWrapper">
            <div class="h-full overflow-y-auto" :class="$style.messagesContainer" ref="messagesContainer" @scroll="onScroll">
              <div v-if="allMessages.length === 0 && !currentThread?.instructions" class="flex items-center justify-center h-full">
                <p class="text-neutral-700 text-center italic max-w-sm">{{ randomQuote }}</p>
              </div>
              <div v-else class="w-9/12 py-2 mx-auto space-y-1" ref="messagesContent">
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
                <ChatMessage
                  v-for="message in visibleMessages"
                  :key="message.id"
                  :message="message"
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
              </div>
            </div>
            <ScrollToBottomFob :visible="!isNearBottom && allMessages.length > 0" @click="scrollToBottom('smooth')" />
          </div>
          <!-- Input -->
          <div class="flex-shrink-0 w-full" :class="$style.inputContainer">
            <ChatInput
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
              :status-line-cwd="statusLineCwd"
              @send-message="handleSendMessage"
              @send-command="handleSendCommand"
              @mode-change="(mode: string) => actor.send({ type: 'SET_MODE', mode: mode as any })"
              @phase-change="(phase: string) => actor.send({ type: 'SET_PHASE', phase })"
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted, useCssModule } from 'vue'

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

import ChatMessage from './message.vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import ChatInput from './input.vue'
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
import { useSettings } from '#generated/settings-fe.ts';

const threadsSettings = useSettings('threads')
const shell = useShell()
const actor: ThreadsState = useSurface();
const isOnboarding = shell.isOnboarding;
const allMessages = useSelector(actor, (state) => (state.context.currentThread?.messages || []) as MessageEntity[]);
const visibleMessages = computed(() => allMessages.value.filter(m => !(m as any).compacted));
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

const currentThread = useSelector(actor, (state) => state.context.currentThread)
const recentThreadIds = useSelector(actor, (state) => state.context.recentThreadIds)
const threadMap = useSelector(actor, (state) => state.context.threadMap)
const recentThreads = computed(() => threadsFromStore(threadMap.value, recentThreadIds.value) as ThreadEntity[])
const currentMode = useSelector(actor, (state) => state.context.mode)
const currentPhase = useSelector(actor, (state) => state.context.phase)
const modes = useSelector(actor, (state) => state.context.modes)
const hotkeys = useSelector(actor, (state) => state.context.hotkeys)
const quickPrompts = useSelector(actor, (state) => (state.context.chatSettings?.quickPrompts || []) as QuickPrompt[])
const quickPromptNumberKeyInserts = useSelector(actor, (state) => state.context.chatSettings?.quickPromptNumberKeyInserts ?? true)
const quickPromptCursor = useSelector(actor, (state) => state.context.quickPromptCursor)
const recordingLimitMinutes = useSelector(actor, (state) => state.context.settings?.recordingLimitMinutes ?? 3)
// True if the current thread's *raw* chat state matches the one the user
// marked as "busy" in settings. Intentionally ignores chatStateOverrides
// (the short-lived flash used to surface terminal states like success/error):
// pausing a transient visual flash is semantically wrong — we only want
// Pause/Esc to act when the agent is actually in the busy state.
const isBusy = useSelector(actor, ({ context }) => {
  const busyId = context.settings?.chatStates?.find(c => c.busy)?.id
  const threadId = context.currentThread?.id
  return !!busyId && !!threadId && context.chatStates[threadId] === busyId
})
const statusLineCwd = computed(() => {
  return currentThread.value?.context?.claudeCode?.cwd
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
  el.scrollTo({ top: el.scrollHeight, behavior })
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
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

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

  // A message opened from the panel's search is brought into view in place of a load's scroll, once its page is
  // loaded; until then the machine is asking for older pages. One hidden as compacted is as shown as it can be
  const focused = focusMessageId.value
  if (focused) {
    const el = messagesContainer.value?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focused)}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.classList.add(style.focused)
      setTimeout(() => el.classList.remove(style.focused), 1600)
      actor.send({ type: 'FOCUSED_MESSAGE_SHOWN' })
      return
    }
    if (!newMsgs.some((m) => m.id === focused)) return
    actor.send({ type: 'FOCUSED_MESSAGE_SHOWN' })
  }

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
</script>

<style lang="scss" module>
.messagesWrapper {
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 15px;
    height: 40px;
    background: linear-gradient(to bottom, transparent, rgb(28 28 28));
    pointer-events: none;
    z-index: 5;
  }
}

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

.inputContainer {
  // Cap the input at the chat area's height. When the form is taller than the cap
  // (lots of attachments + a small chat panel), anchor it to the bottom and clip
  // the top — so the toolbar (Send/Pause/Mode) stays visible.
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  max-height: 100%;
}
</style>
