<template>
  <div class="flex flex-col w-full">
    <form
      @submit.prevent="handleSubmit"
      @keydown.shift.tab.prevent="cyclePhase"
      @keydown.ctrl.tab.prevent="cycleMode"
      class="@container pb-4 max-w-[80%] mx-auto w-full flex-shrink-0 overflow-visible"
    >
      <div
        ref="inputCardRef"
        class="relative flex flex-col border rounded-lg bg-neutral-800 overflow-visible"
        :class="[$style.input, { 'opacity-50': disabled, [$style.inputCommandActive]: commandHighlight, [$style.inputDropActive]: isDraggingFile, [$style.inputRecording]: isListening }]"
        data-onboarding-id="agent-chat-input"
        @paste.capture="handlePaste"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @dragover.prevent
        @drop.prevent="onDrop">
        <StatusIndicator :anchor="inputCardRef"/>
        <StatusLine :status-line="statusLine" :cwd="statusLineCwd" :native-ui="nativeUi"
          @click="emit('statusline-click')" @press="emit('native-ui-press', $event)" />

        <!-- Attachment strip: files then images, horizontal scroll -->
        <div v-if="pendingFiles.length || pendingImages.length"
          class="flex items-end gap-2 mx-4 pt-3 overflow-x-auto scrollbar-thin">
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

        <!-- Editor container -->
        <div class="relative w-full min-h-12" :class="{ 'pointer-events-none': isDraggingFile }">
          <TiptapEditor
            ref="tiptapRef"
            mode="input"
            variant="chat"
            :placeholder="disabled ? 'API keys required to use chat' : 'Message Agent'"
            :disabled="disabled"
            editor-class="w-full px-1.5 pr-2 py-2 rounded-lg min-h-12 focus:outline-none"
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

        <!-- Buttons row -->
        <div class="relative flex items-center justify-between px-3 pb-2 text-neutral-500">
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
              :disabled="(!hasTextContent && !hasAttachments) || disabled"
              class="px-2 @lg:px-4"
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Mic, MicOff, PaperclipIcon, Sparkle, Hash, CornerDownLeft, EllipsisVertical, X } from 'lucide-vue-next'
import FileBlock from './FileBlock.vue'
import ImageThumbnail from './ImageThumbnail.vue'
import StatusLine from './StatusLine.vue'
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
  /** Full CWD path for the statusline click handler. */
  statusLineCwd?: string
  nativeUi?: ClaudeUiMountState
}>()

// Define emits including new button actions
const emit = defineEmits<{
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
  (e: 'native-ui-press', actionId: string): void
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
    tiptapRef.value.editor.commands.setContent(text)
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
  collectAttachments, clearAll, restoreFromReferences,
} = useAttachments()

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
  editor.commands.clearContent(true)
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
  editor.commands.setContent(sentHistory.value[historyIndex.value])
  navigatingHistory.value = false
}

function onHistoryNext() {
  const editor = tiptapRef.value?.editor
  if (!editor) return

  if (historyIndex.value === -1) {
    if (lastClearedContent.value) {
      navigatingHistory.value = true
      editor.commands.setContent(lastClearedContent.value)
      lastClearedContent.value = null
      navigatingHistory.value = false
    }
    return
  }

  if (historyIndex.value < sentHistory.value.length - 1) {
    historyIndex.value++
    navigatingHistory.value = true
    editor.commands.setContent(sentHistory.value[historyIndex.value])
    navigatingHistory.value = false
  } else {
    historyIndex.value = -1
    navigatingHistory.value = true
    editor.commands.clearContent(true)
    navigatingHistory.value = false
  }
}

const { isSupported: speechSupported, isListening, toggle: toggleSpeech, start: startSpeech, stop: stopSpeech } = useSpeechRecognition({
  onResult(transcript) {
    const editor = tiptapRef.value?.editor
    if (!editor) return
    const trimmed = transcript.trim()
    if (!trimmed) return
    editor.commands.insertContent(trimmed + '. ')
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
  if (e.key !== 'Escape') return
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
  if (props.disabled) return
  const editor = tiptapRef.value?.editor
  if (!editor) return
  const md = ((editor.storage as any).markdown.getMarkdown() as string)
    .replace(/(\n&nbsp;)+$/, '')  // strip trailing empty-line placeholders from EmptyLinePreserver
    .trim()
  const textContent = editor.state.doc.textContent.trim()
  if (textContent || hasAttachments.value) {
    const entityId = props.currentThread?.id || 'chat-attachments'
    const attachmentRefs = await collectAttachments(entityId)
    const contextRefs = collectContextReferences(editor)
    const references: MessageReferences = {
      ...attachmentRefs,
      ...(contextRefs.length > 0 ? { context: contextRefs } : {}),
    }

    // Check if this is a command submission
    const cmdState = commandSuggestionKey.getState(editor.state)
    if (cmdState?.active && cmdState.selectedCommand) {
      const commandName = cmdState.selectedCommand.name
      const prefix = `/${commandName} `
      const bodyText = md.startsWith(prefix) ? md.slice(prefix.length) : md.slice(`/${commandName}`.length)
      emit('send-command', commandName, bodyText.trim(), references)

      // Deactivate the command suggestion
      const { tr } = editor.state
      tr.setMeta(commandSuggestionKey, { deactivate: true })
      editor.view.dispatch(tr)
    } else {
      emit('send-message', md, references)
    }

    sentHistory.value.push(md)
    saveHistory(sentHistory.value)
    historyIndex.value = -1
    lastClearedContent.value = null
    editor.commands.clearContent(true)
    messageContent.value = ''
    hasTextContent.value = false
    clearAll()
  }
}
</script>

<style lang="scss" module>
.input {
  border-color: rgb(60 60 60);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.inputCommandActive {
  border-color: rgba(180, 180, 255, 0.45);
  box-shadow: 0 0 0 1px rgba(180, 180, 255, 0.1), 0 0 12px -2px rgba(180, 180, 255, 0.15);
}
.inputDropActive {
  border-color: rgba(100, 180, 255, 0.6);
  box-shadow: 0 0 0 1px rgba(100, 180, 255, 0.15), 0 0 12px -2px rgba(100, 180, 255, 0.2);
}
.inputRecording {
  border-color: rgba(239, 68, 68, 0.6);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.15), 0 0 12px -2px rgba(239, 68, 68, 0.2);
}
</style>
