<template>
  <div class="flex flex-col w-full" :style="promptThemeStyle">
    <form
      @submit.prevent="handleSubmit"
      @keydown.shift.tab.prevent="cyclePhase"
      @keydown.ctrl.tab.prevent="cycleMode"
      class="@container mx-auto w-full max-w-4xl flex-shrink-0 overflow-visible px-5 pb-4 pt-3"
    >
      <div
        ref="inputCardRef"
        class="relative flex min-h-0 flex-col overflow-x-hidden overflow-y-auto rounded-2xl border bg-[#202022]"
        :style="{ '--composer-history-reserve': nativeToolsExpanded ? '2rem' : nativeComposerHeight ? `max(2rem, calc(var(--composer-default-history-reserve) - ${nativeComposerHeight}px))` : undefined, maxHeight: 'calc(var(--composer-available-height) - var(--composer-history-reserve, var(--composer-default-history-reserve)))' }"
        :class="[$style.input, { 'opacity-50': disabled, [$style.inputCommandActive]: commandHighlight, [$style.inputDropActive]: isDraggingFile, [$style.inputRecording]: isListening }]"
        data-onboarding-id="agent-chat-input"
        @paste.capture="handlePaste"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @dragover.prevent
        @drop.prevent="onDrop">
        <NativePanePanel v-if="nativeUi?.panes" :preferred-rows="paneRowsPreference" @resize="paneRowsPreference = $event" :panes="nativeUi.panes" :focus="nativeFocus" :grant-focus="paneFocusGrant" @operate="emit('native-ui-pane', $event)" @press="(id, href) => emit('native-ui-press', id, href)" @field="emit('native-ui-field', $event)" @scroll="emit('native-ui-scroll', $event)" @focus-report="emit('native-ui-focus', $event)" @return-focus="focusComposer" />
        <StatusIndicator :anchor="inputCardRef"/>
        <StatusLine ref="statusLineRef" :status-line="statusLine" :native-status="nativeStatus" :cwd="statusLineCwd" :native-ui="nativeUi" :native-focus="nativeFocus"
          @tools-expanded="nativeToolsExpanded = $event; emit('native-tools-expanded', $event)" @return-focus="focusComposer" @click="emit('statusline-click')" @press="(actionId, href) => emit('native-ui-press', actionId, href)" @field="emit('native-ui-field', $event)" @scroll="emit('native-ui-scroll', $event)" @focus-report="emit('native-ui-focus', $event)" />

        <NativeComposerPlacements v-if="nativeUi?.composer?.length" :frames="nativeUi.composer" location="status" @height="nativeActivityHeight = $event" @press="(id, href) => emit('native-ui-press', id, href)" @field="emit('native-ui-field', $event)" />

        <NativeUiNotices v-if="nativeUi?.notices" :notices="nativeUi.notices" @operate="emit('native-ui-notice', $event)" />

        <!-- Attachment strip: files then images, horizontal scroll -->
        <div v-if="pendingFiles.length || pendingImages.length"
          class="flex shrink-0 items-end gap-2 mx-4 pt-3 overflow-x-auto scrollbar-thin">
          <ImageThumbnail v-for="(img, index) in pendingImages" :key="'i-'+index"
            :src="img.dataUrl" :name="img.name" class="group" @click="$emit('open-lightbox', img.dataUrl)">
            <button type="button" @click="removeImage(index)"
              class="absolute -top-1.5 -right-1.5 w-4 h-4 bg-neutral-900/80 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors opacity-0 group-hover:opacity-100">
              <X :size="10" />
            </button>
          </ImageThumbnail>
          <FileBlock v-for="(file, index) in pendingFiles" :key="'f-'+index"
            :file="file" removable @remove="removeFile(index)" class="flex-shrink-0" />
        </div>

        <p v-if="disabled && disabledReason" role="status" class="px-5 pt-3 text-xs text-neutral-400">{{ disabledReason }}</p>

        <!-- Editor container -->
        <div class="relative w-full min-h-[88px] overflow-y-auto" data-testid="composer-editor-area" @keydown.capture="handleComposerNativeHotkey" :class="{ 'pointer-events-none': isDraggingFile }">
          <TiptapEditor
            ref="tiptapRef"
            mode="input"
            variant="chat"
            :placeholder="disabled ? disabledReason ?? 'API keys required to use chat' : 'Message Agent'"
            :disabled="disabled"
            editor-class="composer-document w-full min-h-[88px] rounded-xl px-5 py-4 pr-10 text-sm leading-6 focus:outline-none"
            @submit="handleSubmit"
            @update:model-value="onContentUpdate"
            :in-history-mode="historyIndex !== -1"
            :pause-available="isBusy"
            @history-prev="onHistoryPrev"
            @history-next="onHistoryNext"
            @clear-input="onClearInput"
            @pause="emit('pause')"
            @open-revert-menu="openRevertMenu"
          />
          <div v-if="nativeCompletions.length && !hostPopupActive" role="group" aria-label="Claude suggestions" class="max-h-40 overflow-y-auto border-t border-neutral-700" @keydown="navigateNativeCompletions">
            <button v-for="(row, index) in nativeCompletions" :key="index" type="button" class="block w-full px-3 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-700 focus-visible:bg-neutral-700 focus-visible:outline focus-visible:outline-blue-400" @mousedown.prevent @click="promptEditor?.selectCompletion(index, row.offerId)">
              <span>{{ row.label ?? row.text }}</span><span v-if="row.description" class="ml-2 text-xs text-neutral-500">{{ row.description }}</span>
            </button>
          </div>
          <p v-if="submissionProblem || nativePromptProblem" class="px-3 text-xs text-neutral-500" role="status">{{ submissionProblem || nativePromptProblem }}</p>
          <RevertHistoryPopup
            :open="revertMenuOpen"
            :anchor-el="inputCardRef"
            :messages="currentThread?.messages ?? []"
            @revert="(id) => { revertMenuOpen = false; emit('revert', id) }"
            @revert-with-files="(id) => { revertMenuOpen = false; emit('revert-with-files', id) }"
            @summarize-from-here="(id) => { revertMenuOpen = false; emit('summarize-from-here', id) }"
            @close="revertMenuOpen = false"
          />
        </div>

        <div v-if="nativeUi?.composer?.length" class="flex min-w-0 items-end gap-2 px-5">
          <NativeComposerPlacements class="min-w-0 flex-1" :frames="nativeUi.composer" location="hint" @height="nativeHintHeight = $event" @press="(id, href) => emit('native-ui-press', id, href)" @field="emit('native-ui-field', $event)" />
          <NativeComposerPlacements class="ml-auto min-w-0" :frames="nativeUi.composer" location="mode" @height="nativeModeHeight = $event" @press="(id, href) => emit('native-ui-press', id, href)" @field="emit('native-ui-field', $event)" />
        </div>

        <!-- Buttons row -->
        <div data-composer-toolbar class="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-3 bg-[#202022] px-3 pb-3 pt-2 text-neutral-500">
          <!-- Left side buttons -->
          <div class="flex items-center min-w-0">
            <!-- Collapsed: ... dropdown menu (narrow) -->
            <DropdownMenuRoot>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="p-2 transition-colors text-neutral-500 @lg:hidden"
                  :class="disabled ? 'cursor-not-allowed opacity-50' : 'hover:text-neutral-200'"
                  aria-label="More actions"
                  :disabled="disabled"
                >
                  <EllipsisVertical :size="20" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  align="start"
                  :side-offset="8"
                  class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 z-50"
                >
                  <DropdownMenuItem
                    v-for="btn in leftButtons"
                    :key="btn.action"
                    @select="handleButtonClick(btn.action)"
                    class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
                    :class="btn.class"
                  >
                    <component :is="btn.icon" :size="16" />
                    <span>{{ btn.label }}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>

            <!-- Expanded: full action buttons (wide) -->
            <template v-for="btn in leftButtons" :key="btn.action">
              <button
                v-if="btn.action !== 'quick-message' && btn.action !== 'voice-input'"
                type="button"
                class="hidden @lg:block p-2 transition-colors text-neutral-500"
                :class="[disabled ? 'cursor-not-allowed opacity-50' : (!btn.class && 'hover:text-neutral-200'), btn.class]"
                :aria-label="btn.label"
                :disabled="disabled"
                :title="btn.label"
                @click="handleButtonClick(btn.action)"
              >
                <component :is="btn.icon" :size="20" />
              </button>
            </template>

            <!-- Quick Prompts Popover (wide) -->
            <QuickPromptsPopup
              v-model:open="popoverOpen"
              :prompts="quickPrompts || []"
              :insert-on-number-key="quickPromptNumberKeyInserts ?? true"
              :disabled="disabled"
              :virtual-reference="virtualRef"

              @update="(prompts) => emit('update-quick-prompts', prompts)"
            />

            <!-- Mic button (wide) -->
            <button
              v-if="speechSupported"
              type="button"
              class="hidden @lg:block p-2 transition-colors text-neutral-500"
              :class="[disabled ? 'cursor-not-allowed opacity-50' : (!isListening && 'hover:text-neutral-200'), isListening && 'text-red-400 animate-pulse']"
              :aria-label="isListening ? 'Stop listening' : 'Voice input'"
              :disabled="disabled"
              @click="handleButtonClick('voice-input')"
            >
              <component :is="isListening ? MicOff : Mic" :size="20" />
            </button>

            <!-- Mode/Phase Selector -->
            <div class="min-w-0 overflow-hidden">
              <ModePhaseSelector
                :modes="modes"
                :current-mode="currentMode"
                :current-phase="currentPhase"
                :default-mode="defaultMode"
                :forced-mode="currentThread?.forcedMode"
                :disabled="disabled"
                @mode-change="handleModeChange"
                @phase-change="handlePhaseChange"
                @set-default-mode="emit('set-default-mode', $event)"
                @set-default-phase="emit('set-default-phase', $event)"
              />
            </div>
          </div>

          <!-- Right side buttons -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <!-- Pause button (only while busy) -->
            <Button
              v-if="isBusy"
              title="Pause agent work"
              type="button"
              variant="secondary"
              class="px-2 @lg:px-4"
              @click.stop="emit('pause')"
            >
              <span class="hidden @lg:inline">Pause</span>
              <PauseIcon :size="22" />
            </Button>
            <Button
              type="submit"
              aria-label="Send"
              :disabled="submitting || (!hasTextContent && !hasAttachments) || disabled"
              class="h-8 gap-2 rounded-lg px-3 text-xs font-medium shadow-sm @lg:px-3.5"
            >
              <span class="hidden @lg:inline">Send</span>
              <CornerDownLeft class="-rotate-45" :size="16" />
            </Button>

          </div>
        </div>

      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { ClaudeComposerSubmitResult } from './native-submit.ts'
import { bindClaudeWindowDraft } from './native-window-draft.ts'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Mic, MicOff, PaperclipIcon, Sparkle, Hash, CornerDownLeft, EllipsisVertical, X } from 'lucide-vue-next'
import FileBlock from './FileBlock.vue'
import ImageThumbnail from './ImageThumbnail.vue'
import NativePanePanel from './NativePanePanel.vue'
import StatusLine from './StatusLine.vue'
import NativeComposerPlacements from './NativeComposerPlacements.vue'
import NativeUiNotices from './NativeUiNotices.vue'
import { setClaudeCompletionOffer } from '../../../../extensions/tiptap/claude-completions.ts'
import { referenceSuggestionPluginKey } from '../../../../extensions/tiptap/reference-plugin-key.ts'
import { claudePromptThemeStyle } from './native-ui-paint.ts'
import { useClaudeUiSelection, replyClaudeUiSelection } from './native-ui-selection.ts'
import { copyClaudeUiText } from './native-ui-clipboard.ts'
import { bindClaudePromptEditor } from './native-prompt-editor.ts'
import { Plugin } from '@tiptap/pm/state'
import { useSpeechRecognition } from './composables/useSpeechRecognition.ts'
import { DOUBLE_ESC_MS } from '@apackdev/ui/components/tiptap/composables/createEditorKeyboard'
import { useAttachments } from './composables/useAttachments.ts'
import { imagePaste } from '#extensions/tiptap/image-paste.ts'
import { useExternalFileDrag } from '@apackdev/ui/composables/useExternalFileDrag'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
// import Square from './square-svg.vue'
import PauseIcon from './pause-svg.vue'
import ModePhaseSelector from './ModePhaseSelector.vue'
import type { Component } from 'vue'
import Button from '@apackdev/ui/design/button'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import StatusIndicator from './status-indicator.vue'
import type { ClaudeUiMountState, AgentThreadData, AgentMode, MessageReferences, QuickPrompt } from '#generated/types.ts'
import { commandSuggestionKey } from '@apackdev/ui/components/tiptap/extensions/command-suggestion'
import { matchesHotkey, useSurfaceStorage, type HotkeyEvent, type HotkeysMap } from '@apackdev/sdk/fe'
import QuickPromptsPopup from './QuickPromptsPopup.vue'
import RevertHistoryPopup from './RevertHistoryPopup.vue'

interface ContextReference {
  refType: 'thread' | 'document' | 'note'
  refId: string
  shortCode: string
  label: string
}

const props = defineProps<{
  currentThread: AgentThreadData | null
  currentMode: string
  currentPhase?: string
  modes: AgentMode[]
  defaultMode?: string
  hotkeys?: HotkeysMap
  quickPrompts?: QuickPrompt[]
  quickPromptNumberKeyInserts?: boolean
  quickPromptCursor?: { x: number; y: number } | null
  disabled?: boolean
  disabledReason?: string
  /** Text to prefill the input with (e.g., on revert). Consumed once on change. */
  prefillText?: string
  /** Attachments to prefill the input with (e.g., on revert). Consumed once on change. */
  prefillReferences?: MessageReferences
  /** Whether the current thread is in the user-marked "busy" chat state. Controls Pause button visibility. */
  isBusy?: boolean
  /** Max duration (in minutes) for a single voice-input session. */
  recordingLimitMinutes?: number
  /** CWD label shown in the attached session strip. */
  statusLine?: string
  /** Actual output from the native main-session status helper. */
  nativeStatus?: string
  /** Full CWD path for the statusline click handler. */
  statusLineCwd?: string
  nativePrompt?: { hostRequest?: import('#generated/types.ts').ClaudePromptHostRequest; mountId: string; attachmentId?: string; revision?: number; reply?: import('#generated/types.ts').ClaudePromptReply; completionRevision?: number; completions?: import('#generated/types.ts').ClaudePromptCompletionReply }
  nativeFocus?: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusReply
  nativeSubmit?: (text: string, references: MessageReferences) => Promise<ClaudeComposerSubmitResult>
  nativeUi?: ClaudeUiMountState
}>()

// Define emits including new button actions
const emit = defineEmits<{
  (e: 'native-tools-expanded', expanded: boolean): void
  (e: 'send-message', message: string, references?: MessageReferences): void
  (e: 'send-command', command: string, text: string, references?: MessageReferences): void
  (e: 'quick-message'): void
  (e: 'attach-file'): void
  (e: 'voice-input'): void
  (e: 'pause'): void
  (e: 'mode-change', mode: string): void
  (e: 'phase-change', phase: string): void
  (e: 'set-default-mode', mode: string): void
  (e: 'set-default-phase', phase: string): void
  (e: 'open-lightbox', imageSrc: string): void
  (e: 'update-quick-prompts', prompts: QuickPrompt[]): void
  (e: 'close-quick-prompts'): void
  (e: 'revert', messageId: string): void
  (e: 'revert-with-files', messageId: string): void
  (e: 'summarize-from-here', messageId: string): void
  (e: 'native-prompt-autocomplete', request: import('#generated/types.ts').ClaudePromptCompletionRequest): void
  (e: 'native-prompt-host-response', response: import('#generated/types.ts').ClaudePromptHostResponse): void
  (e: 'native-prompt-edit', edit: import('#generated/types.ts').ClaudePromptEdit): void
  (e: 'native-ui-notice', event: import('#generated/types.ts').ClaudeUiNoticeEvent): void
  (e: 'native-ui-scroll', event: import('#generated/types.ts').ClaudeUiScrollEvent): void
  (e: 'native-ui-pane', event: import('#generated/types.ts').ClaudeUiPaneEvent): void
  (e: 'native-ui-focus', event: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusEvent): void
  (e: 'native-ui-field', event: import('#generated/types.ts').ClaudeUiFieldEvent): void
  (e: 'native-ui-press', actionId: string, href?: string): void
  (e: 'statusline-click'): void
}>()


interface ActionButton {
  icon: Component
  label: string
  action: string
  class?: string
}

const tiptapRef = ref<InstanceType<typeof TiptapEditor> | null>(null)
const inputCardRef = ref<HTMLElement | null>(null)
function focusComposer() {
  tiptapRef.value?.editor?.commands.focus()
  void nextTick(() => {
    const card = inputCardRef.value
    if (card) card.scrollTop = Math.max(0, card.scrollHeight - card.clientHeight)
  })
}
const nativeActivityHeight = ref(0), nativeHintHeight = ref(0), nativeModeHeight = ref(0)
const nativeComposerHeight = computed(() => nativeActivityHeight.value + Math.max(nativeHintHeight.value, nativeModeHeight.value))
const nativeToolsExpanded = ref(false)
const statusLineRef = ref<InstanceType<typeof StatusLine> | null>(null)
function handleComposerNativeHotkey(event: KeyboardEvent) {
  const editor = tiptapRef.value?.editor
  if (props.disabled || !editor?.isEmpty || hasAttachments.value || !(event.target instanceof Node) || !editor.view.dom.contains(event.target)) return
  statusLineRef.value?.pressComposerHotkey(event)
}
const nativePromptProblem = ref<string>()
const hostPopupActive = ref(false)
// Keep the person's pane size when panes close/reopen or the plugin changes its request.
const paneRowsPreference = ref<number>()
const paneFocusGrant = ref<string | null>(null)
watch(() => props.nativeUi?.panes?.roster.focus_requested_id, id => {
  if (!id || !document.hasFocus()) return
  const editor = tiptapRef.value?.editor
  const allowed = !!editor && editor.isFocused && !editor.view.composing && !editor.state.doc.textContent.trim() && !props.disabled && !props.isBusy && !submitting.value && !hasAttachments.value && !hostPopupActive.value && !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
  paneFocusGrant.value = allowed ? id : null
  emit('native-ui-pane', { kind: 'focus', id: paneFocusGrant.value })
})

const nativeCompletions = ref<(import('#generated/types.ts').ClaudePromptCompletionRow & { offerId: string })[]>([])
const submitting = ref(false)
const submissionProblem = ref<string>()
let pendingNativeCommand: { revision: number; accept(): void } | undefined
watch(() => props.nativeUi?.agentInput, state => {
  if (state?.status !== 'command_done' && state?.status !== 'error') return
  const pending = pendingNativeCommand
  if (!pending || pending.revision !== state.revision) return
  pendingNativeCommand = undefined
  if (state.status === 'command_done' && state.decision === 'confirm') pending.accept()
})
defineExpose({ focus: focusComposer })
let composerEpoch = 0
watch([() => props.currentThread?.id, () => props.currentMode, () => props.currentPhase], () => { composerEpoch++; submissionProblem.value = undefined }, { flush: 'sync' })
onUnmounted(() => { composerEpoch++ })
const promptThemeStyle = computed(() => claudePromptThemeStyle(props.nativeUi?.promptPalette))
// Restore only this native session's parent input before adopting it into a fresh prompt host.
watch([() => tiptapRef.value?.editor, () => props.currentThread?.id, () => props.currentThread?.context?.claudeCode?.sessionId], ([editor, threadId, sessionId], _previous, cleanup) => {
  if (editor && threadId && sessionId) cleanup(bindClaudeWindowDraft(editor, JSON.stringify([threadId, sessionId])))
}, { flush: 'post' })
let promptEditor: ReturnType<typeof bindClaudePromptEditor> | undefined
watch([() => tiptapRef.value?.editor, () => props.nativePrompt?.mountId, () => props.nativePrompt?.attachmentId], ([editor, mountId]) => {
  promptEditor?.dispose(); promptEditor = undefined; nativePromptProblem.value = undefined
  if (editor && mountId) promptEditor = bindClaudePromptEditor(editor, edit => emit('native-prompt-edit', edit), message => { nativePromptProblem.value = message }, props.nativePrompt?.revision, { initialRevision: props.nativePrompt?.completionRevision, request: request => emit('native-prompt-autocomplete', request), update: (rows, offerId) => {
    nativeCompletions.value = offerId ? rows.map(row => ({ ...row, offerId })) : []
    const owner = promptEditor
    setClaudeCompletionOffer(editor, offerId && rows.length ? { id: offerId, rows: rows.map((row, index) => ({ ...row, select: () => owner?.selectCompletion(index, offerId) ?? false })), dismiss: () => owner?.dismissCompletions() } : undefined)
  } }, { canSuggest: () => !props.disabled && !props.isBusy && !submitting.value && !hasAttachments.value && !hostPopupActive.value && !nativeCompletions.value.length && document.hasFocus() && !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') })
}, { flush: 'post' })
watch(() => tiptapRef.value?.editor, (editor, _previous, onCleanup) => {
  if (!editor) { hostPopupActive.value = false; return }
  const update = () => {
    const command = commandSuggestionPluginKey.getState(editor.state)
    hostPopupActive.value = !!(command?.active && !command.selectedCommand) || referenceSuggestionPluginKey.getState(editor.state)?.active === true
  }
  update(); editor.on('transaction', update)
  onCleanup(() => { editor.off('transaction', update) })
})
const pageSelection = useClaudeUiSelection()
watch(() => props.nativePrompt?.hostRequest, request => {
  if (!request) return
  if (request.kind === 'selection') {
    const owner = promptEditor, epoch = composerEpoch, mountId = props.nativePrompt?.mountId, attachment = props.nativePrompt?.attachmentId
    void replyClaudeUiSelection(request.replyUrl, pageSelection, request.expiresAt, () => composerEpoch === epoch && !!owner && promptEditor === owner && props.nativePrompt?.mountId === mountId && props.nativePrompt?.attachmentId === attachment && props.nativePrompt?.hostRequest === request)
      .then(submitted => emit('native-prompt-host-response', { requestId: request.requestId, kind: 'selection', submitted }))
    return
  }
  if (request.kind === 'copy') {
    const owner = promptEditor, attachment = props.nativePrompt?.attachmentId
    void copyClaudeUiText(request.text, request.expiresAt, () => !!owner && promptEditor === owner && props.nativePrompt?.attachmentId === attachment && props.nativePrompt?.hostRequest === request)
      .then(copied => emit('native-prompt-host-response', { requestId: request.requestId, kind: 'copy', copied }))
    return
  }
  const available = Date.now() < request.expiresAt && !!promptEditor && !props.disabled && !submitting.value && document.hasFocus() && !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
  if (request.kind === 'read') {
    const box = available ? promptEditor?.readDraft() : undefined
    emit('native-prompt-host-response', { requestId: request.requestId, kind: 'read', ...(box ? { box } : {}) })
  } else if (request.kind === 'suggest') {
    const shown = available && (promptEditor?.showSuggestion(request.text, request.revision) ?? false)
    emit('native-prompt-host-response', { requestId: request.requestId, kind: 'suggest', shown })
  } else {
    const filled = available && (promptEditor?.fillDraft(request.input, request.revision) ?? false)
    emit('native-prompt-host-response', { requestId: request.requestId, kind: 'fill', filled })
  }
})
watch(() => props.nativePrompt?.reply, reply => { if (reply) promptEditor?.receive(reply) })
watch(() => props.nativePrompt?.completions, reply => { if (reply) promptEditor?.receiveCompletions(reply) })
function navigateNativeCompletions(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); promptEditor?.dismissCompletions(); tiptapRef.value?.editor?.view.focus(); return }
  if (event.key === 'Tab') { event.stopPropagation(); return }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll('button'))
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  event.preventDefault(); event.stopPropagation(); buttons[next]?.focus()
}
onUnmounted(() => promptEditor?.dispose())


const messageContent = ref('')
const hasTextContent = ref(false)
const popoverOpen = ref(false)
const navigatingHistory = ref(false)
const revertMenuOpen = ref(false)

function openRevertMenu() {
  // TiptapEditor only emits this when the editor is empty, so we don't
  // need to re-check here. Don't open if there are no user messages to
  // revert to — the popup itself hides in that case, but this avoids the
  // teleport churn.
  const hasUserMsgs = (props.currentThread?.messages ?? []).some(
    (m) => m.sender === 'user' && (m as any).status !== 'cancelled',
  )
  if (!hasUserMsgs) return
  revertMenuOpen.value = true
}

const virtualRef = computed(() => {
  if (!props.quickPromptCursor) return null
  const { x, y } = props.quickPromptCursor
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }
})

watch(() => props.quickPromptCursor, (cursor) => {
  popoverOpen.value = !!cursor
})

watch(popoverOpen, (isOpen) => {
  if (!isOpen && props.quickPromptCursor) emit('close-quick-prompts')
})

// Prefill the input when the parent sets prefillText (e.g., on revert).
watch(() => props.prefillText, (text) => {
  if (text && tiptapRef.value?.editor) {
    tiptapRef.value.editor.chain().setMeta('claude-prompt-by', 'app').setContent(text).run()
    tiptapRef.value.editor.commands.focus('end')
  }
})

// Prefill attachments when the parent sets prefillReferences (e.g., on revert).
watch(() => props.prefillReferences, (refs) => {
  if (refs) restoreFromReferences(refs)
})

/** This surface's window storage: the prefix is its ref, so this name is scoped to it. */
const storage = useSurfaceStorage()
const MAX_HISTORY = 100

function loadHistory(): string[] {
  try {
    const stored = storage.get('chat-sent-history')
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveHistory(history: string[]) {
  try {
    storage.set('chat-sent-history', JSON.stringify(history.slice(-MAX_HISTORY)))
  } catch { /* ignore */ }
}

const sentHistory = ref<string[]>(loadHistory())
const historyIndex = ref(-1)
const lastClearedContent = ref<string | null>(null)

const commandHighlight = computed(() => {
  const editor = tiptapRef.value?.editor
  if (!editor) return false
  const state = commandSuggestionKey.getState(editor.state)
  return state?.active === true
})

const {
  pendingImages, pendingFiles, hasAttachments,
  handlePaste, handleFileDrop, addImageFromUrl, removeImage, openFilePicker, removeFile,
  captureAttachments, restoreFromReferences,
} = useAttachments()
watch([hasTextContent, () => props.isBusy, () => props.disabled, submitting, hasAttachments, hostPopupActive], values => {
  if (values.some(Boolean)) paneFocusGrant.value = null
})
watch(() => props.nativeUi?.panes?.roster.shown_id, (id, previous) => {
  if (!id && previous && document.hasFocus() && document.activeElement?.closest('[data-native-pane-panel]')) {
    void nextTick(() => tiptapRef.value?.editor?.commands.focus())
  }
})
watch(() => props.nativeUi?.panes?.roster.focused_id, id => {
  if (!id && !props.nativeUi?.panes?.roster.focus_requested_id) paneFocusGrant.value = null
})
watch([() => props.disabled, () => props.isBusy, submitting, hasAttachments, hostPopupActive, () => nativeCompletions.value.length], ([disabled, busy, sending, attachments, popup, completions]) => {
  if (disabled || busy || sending || attachments || popup || completions) promptEditor?.dismissSuggestion()
})


const { isDragging: isDraggingFile, onDragEnter, onDragLeave, onDrop } = useExternalFileDrag({
  onDrop: handleFileDrop,
})

watch(tiptapRef, (ref) => {
  if (ref?.editor) ref.editor.registerPlugin(imagePaste(addImageFromUrl))
}, { immediate: true })

const onContentUpdate = (md: string) => {
  messageContent.value = md
  hasTextContent.value = !!tiptapRef.value?.editor?.state.doc.textContent.trim()
  if (!navigatingHistory.value) {
    historyIndex.value = -1
  }
  // The revert-history popup is only meaningful against an empty input.
  // The moment the user types, dismiss it so the keystroke feels uninterrupted.
  if (revertMenuOpen.value && md.trim()) {
    revertMenuOpen.value = false
  }
}

function onClearInput() {
  const editor = tiptapRef.value?.editor
  if (!editor) return
  const md = messageContent.value
  if (!md.trim()) return
  lastClearedContent.value = md
  editor.chain().setMeta('claude-prompt-by', 'app').clearContent(true).run()
}

function onHistoryPrev() {
  if (!sentHistory.value.length) return
  const editor = tiptapRef.value?.editor
  if (!editor) return

  if (historyIndex.value === -1) {
    historyIndex.value = sentHistory.value.length - 1
  } else if (historyIndex.value > 0) {
    historyIndex.value--
  }

  navigatingHistory.value = true
  editor.chain().setMeta('claude-prompt-by', 'app').setContent(sentHistory.value[historyIndex.value]).run()
  navigatingHistory.value = false
}

function onHistoryNext() {
  const editor = tiptapRef.value?.editor
  if (!editor) return

  if (historyIndex.value === -1) {
    if (lastClearedContent.value) {
      navigatingHistory.value = true
      editor.chain().setMeta('claude-prompt-by', 'app').setContent(lastClearedContent.value).run()
      lastClearedContent.value = null
      navigatingHistory.value = false
    }
    return
  }

  if (historyIndex.value < sentHistory.value.length - 1) {
    historyIndex.value++
    navigatingHistory.value = true
    editor.chain().setMeta('claude-prompt-by', 'app').setContent(sentHistory.value[historyIndex.value]).run()
    navigatingHistory.value = false
  } else {
    historyIndex.value = -1
    navigatingHistory.value = true
    editor.chain().setMeta('claude-prompt-by', 'app').clearContent(true).run()
    navigatingHistory.value = false
  }
}

const { isSupported: speechSupported, isListening, toggle: toggleSpeech, start: startSpeech, stop: stopSpeech } = useSpeechRecognition({
  onResult(transcript) {
    const editor = tiptapRef.value?.editor
    if (!editor) return
    const trimmed = transcript.trim()
    if (!trimmed) return
    editor.chain().setMeta('claude-prompt-by', 'person').insertContent(trimmed + '. ').run()
  },
  maxDurationMs: () => {
    const mins = props.recordingLimitMinutes
    return typeof mins === 'number' && mins > 0 ? mins * 60_000 : undefined
  },
})

// Push-to-talk: start on keydown, stop on keyup (uses configured hotkey)
function toHotkeyEvent(e: KeyboardEvent): HotkeyEvent {
  return {
    type: 'HOTKEY_PRESSED',
    key: e.key,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    preventDefault: () => e.preventDefault(),
  }
}
const handleVoiceKeydown = (e: KeyboardEvent) => {
  const hotkey = props.hotkeys?.textToSpeech
  if (!hotkey) return
  if (matchesHotkey(toHotkeyEvent(e), hotkey)) {
    e.preventDefault()
    startSpeech()
  }
}
const handleVoiceKeyup = (e: KeyboardEvent) => {
  if (isListening.value) stopSpeech()
}
// Global ESC handling (works regardless of which element has focus):
//   1. pause available (streaming) → single ESC pauses
//   2. empty input, double-ESC → open revert menu
let lastGlobalEscTime = 0
const handleGlobalEsc = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
  // Skip if focus is inside the ProseMirror editor — the editor's own handler covers that case
  if ((e.target as HTMLElement)?.closest?.('.ProseMirror')) return
  // Skip if the revert menu is already open
  if (revertMenuOpen.value) return

  // Single ESC pauses when streaming
  if (props.isBusy) {
    lastGlobalEscTime = 0
    emit('pause')
    return
  }

  // Double-ESC on empty input opens revert menu
  if (hasTextContent.value) return
  const now = Date.now()
  if (now - lastGlobalEscTime < DOUBLE_ESC_MS) {
    lastGlobalEscTime = 0
    openRevertMenu()
  } else {
    lastGlobalEscTime = now
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleVoiceKeydown)
  window.addEventListener('keyup', handleVoiceKeyup)
  document.addEventListener('keydown', handleGlobalEsc)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleVoiceKeydown)
  window.removeEventListener('keyup', handleVoiceKeyup)
  document.removeEventListener('keydown', handleGlobalEsc)
})

const leftButtons = computed<ActionButton[]>(() => {
  const buttons: ActionButton[] = [
    {
      icon: Hash,
      label: 'Add reference',
      action: 'add-reference'
    },
    {
      icon: PaperclipIcon,
      label: 'Attach file',
      action: 'attach-file'
    },
    {
      icon: Sparkle,
      label: 'Quick message',
      action: 'quick-message'
    },
  ]
  // Note: In expanded view, 'quick-message' is rendered via QuickPromptsPopup instead
  if (speechSupported.value) {
    buttons.push({
      icon: isListening.value ? MicOff : Mic,
      label: isListening.value ? 'Stop listening' : 'Voice input',
      action: 'voice-input',
      class: isListening.value ? 'text-red-400 animate-pulse' : undefined,
    })
  }
  return buttons
})


// Computed properties for cleaner template
const visibleModes = computed(() => props.modes.filter(m => !m.hidden))

// Reset to first visible mode when switching from forced-mode thread, and focus editor
watch(() => props.currentThread?.id, () => {
  if (props.currentMode && !props.currentThread?.forcedMode && !visibleModes.value.some(m => m.name === props.currentMode)) {
    emit('mode-change', visibleModes.value[0].name)
  }
  nextTick(() => tiptapRef.value?.editor?.commands.focus('end'))
})

const handleButtonClick = (action: string) => {
  if (props.disabled) return
  if (action === 'attach-file') {
    openFilePicker()
    return
  }
  if (action === 'voice-input') {
    toggleSpeech()
    emit('voice-input')
    return
  }
  if (action === 'quick-message') {
    popoverOpen.value = true
    return
  }
  if (action === 'add-reference') {
    const editor = tiptapRef.value?.editor
    if (editor) {
      editor.chain().focus().command(({ tr, dispatch }) => {
        if (dispatch) {
          tr.insertText('#')
        }
        return true
      }).run()
    }
    return
  }
  // @ts-expect-error - dynamic event emission
  emit(action)
}


const cycleMode = () => {
  if (props.disabled) return
  const modes = visibleModes.value
  if (!modes.length) return
  const currentIndex = modes.findIndex(m => m.name === props.currentMode)
  const nextMode = modes[(currentIndex + 1) % modes.length]
  emit('mode-change', nextMode.name)
}

const cyclePhase = () => {
  if (props.disabled) return
  const phases = visibleModes.value.find(m => m.name === props.currentMode)?.phases ?? []
  if (!phases.length) return
  const currentIndex = phases.findIndex(p => p.name === props.currentPhase)
  const nextPhase = phases[(currentIndex + 1) % phases.length]
  emit('phase-change', nextPhase.name)
}

const handleModeChange = (newMode: string) => {
  if (props.disabled) return
  emit('mode-change', newMode)
}

const handlePhaseChange = (newPhase: string) => {
  if (props.disabled) return
  emit('phase-change', newPhase)
}

function collectContextReferences(editor: NonNullable<typeof tiptapRef.value>['editor']): ContextReference[] {
  if (!editor) return []
  const refs: ContextReference[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'reference') {
      refs.push({
        refType: node.attrs.refType,
        refId: node.attrs.refId,
        shortCode: node.attrs.shortCode,
        label: node.attrs.label,
      })
    }
  })
  return refs
}

const handleSubmit = async () => {
  if (props.disabled || submitting.value) return
  const editor = tiptapRef.value?.editor
  if (!editor) return
  const epoch = composerEpoch, bridge = promptEditor
  if (props.nativePrompt && !bridge) { submissionProblem.value = 'Claude input is connecting'; return }
  submitting.value = true
  submissionProblem.value = undefined
  try {
    if (bridge) {
      const revision = bridge.revision
      if (!await bridge.settle() || bridge.revision !== revision || promptEditor !== bridge) {
        if (epoch === composerEpoch) submissionProblem.value = nativePromptProblem.value ?? 'Claude input changed while preparing this message. Send again.'
        return
      }
    }
    if (epoch !== composerEpoch || editor.isDestroyed || tiptapRef.value?.editor !== editor || props.disabled) return
    const md = ((editor.storage as any).markdown.getMarkdown() as string)
      .replace(/(\n&nbsp;)+$/, '')
      .trim()
    if (!editor.state.doc.textContent.trim() && !hasAttachments.value) return
    const doc = editor.state.doc
    const entityId = props.currentThread?.id || 'chat-attachments'
    const attachments = captureAttachments()
    const contextRefs = collectContextReferences(editor)
    const cmdState = commandSuggestionKey.getState(editor.state)
    const attachmentRefs = await attachments.collect(entityId)
    if (epoch !== composerEpoch || editor.isDestroyed || tiptapRef.value?.editor !== editor || props.disabled) return
    const references: MessageReferences = {
      ...attachmentRefs,
      ...(contextRefs.length > 0 ? { context: contextRefs } : {}),
    }

    // Explicitly selected app commands stay on the app command route under either owner.
    if (cmdState?.active && cmdState.selectedCommand) {
      const commandName = cmdState.selectedCommand.name
      const prefix = `/${commandName} `
      const bodyText = md.startsWith(prefix) ? md.slice(prefix.length) : md.slice(`/${commandName}`.length)
      emit('send-command', commandName, bodyText.trim(), references)
      if (editor.state.doc === doc) {
        const { tr } = editor.state
        tr.setMeta(commandSuggestionKey, { deactivate: true })
        editor.view.dispatch(tr)
      }
    } else if (props.nativeSubmit) {
      const result = await props.nativeSubmit(md, references)
      if (epoch !== composerEpoch || editor.isDestroyed || tiptapRef.value?.editor !== editor) return
      if (result && 'review' in result) {
        if (editor.state.doc === doc) { editor.chain().setMeta('claude-prompt-by', 'app').setContent(result.review.text).run(); submissionProblem.value = `Removed ${result.review.removed} invisible characters. Review and send again.` }
        return
      }
      if (result && 'commandPending' in result) {
        pendingNativeCommand = { revision: result.revision, accept() {
          if (epoch !== composerEpoch || editor.isDestroyed || tiptapRef.value?.editor !== editor) return
          sentHistory.value.push(md); saveHistory(sentHistory.value)
          if (editor.state.doc === doc) { editor.chain().setMeta('claude-prompt-by', 'app').clearContent(true).run(); messageContent.value = ''; hasTextContent.value = false; attachments.clear() }
        } }
        return
      }
      if (epoch !== composerEpoch || editor.isDestroyed || tiptapRef.value?.editor !== editor) return
    } else {
      emit('send-message', md, references)
    }

    sentHistory.value.push(md)
    saveHistory(sentHistory.value)
    historyIndex.value = -1
    lastClearedContent.value = null
    if (editor.state.doc === doc) {
      editor.chain().setMeta('claude-prompt-by', 'app').clearContent(true).run()
      messageContent.value = ''
      hasTextContent.value = false
    }
    attachments.clear()
  } catch (error) {
    if (epoch === composerEpoch) submissionProblem.value = error instanceof Error ? error.message : 'Message could not be sent'
  } finally { submitting.value = false }
}

</script>

<style lang="scss" module>
.input :global(.ProseMirror[data-native-suggestion="true"] p.is-editor-empty:first-child)::before { content: none; }
.input :global(.tiptap-wrapper .ProseMirror) { padding: 0; }
.input {
  --composer-default-history-reserve: clamp(8rem, calc(var(--composer-available-height) * 0.3), 10rem);
  border-color: rgba(255, 255, 255, 0.09);
  box-shadow: 0 12px 40px -20px rgba(0, 0, 0, 0.6);
  &:focus-within { border-color: rgba(147, 180, 240, 0.32); }
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
@media (max-height: 700px) {
  .input { --composer-default-history-reserve: 2rem; }
  .input :global([data-testid="composer-editor-area"]), .input :global(.composer-document) { min-height: 40px; }
  .input :global(.composer-document) { padding-top: 8px; padding-bottom: 8px; }
  .input :global(.ProseMirror) { min-height: 24px; }
}
.inputCommandActive, .inputCommandActive:focus-within {
  border-color: rgba(180, 180, 255, 0.45);
  box-shadow: 0 0 0 1px rgba(180, 180, 255, 0.1), 0 0 12px -2px rgba(180, 180, 255, 0.15);
}
.inputDropActive, .inputDropActive:focus-within {
  border-color: rgba(100, 180, 255, 0.6);
  box-shadow: 0 0 0 1px rgba(100, 180, 255, 0.15), 0 0 12px -2px rgba(100, 180, 255, 0.2);
}
.inputRecording, .inputRecording:focus-within {
  border-color: rgba(239, 68, 68, 0.6);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.15), 0 0 12px -2px rgba(239, 68, 68, 0.2);
}
</style>
