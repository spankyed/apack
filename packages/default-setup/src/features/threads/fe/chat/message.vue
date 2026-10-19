<template>
  <div
    :data-chat-message="message.id"
    :class="[
      'flex pb-3 animate-fade-in w-full',
      isMarker ? 'justify-center' : (isUser || isCollapsedAsideAsUser) ? 'justify-end' : 'justify-start'
    ]"
  >
    <!-- Marker message: compact divider with toggle -->
    <div v-if="isMarker" class="flex items-center gap-3 w-full px-4 py-1">
      <div class="flex-1 h-px bg-neutral-700/50"></div>
      <button
        @click="markerExpanded = !markerExpanded; $emit('toggle-compacted', message.id, !markerExpanded)"
        class="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors px-2 py-1 rounded hover:bg-neutral-800/50"
        :title="markerExpanded ? 'Collapse compacted messages' : 'Expand compacted messages'"
      >
        <component :is="markerExpanded ? ChevronUp : ChevronDown" :size="14" />
        <span class="italic">{{ message.text }}</span>
      </button>
      <div class="flex-1 h-px bg-neutral-700/50"></div>
    </div>

    <div v-else class="group max-w-full min-w-0">
      <!-- Aside: collapsed interactive message (click to expand) -->
      <div v-if="message.autoHide && message.asideText && !expanded"
           class="text-xs italic py-1 px-2 cursor-pointer hover:bg-neutral-800/50 rounded transition-colors"
           @click="expanded = true">
        <span class="text-neutral-400">{{ asideOutcome }}</span>
        <span v-if="asideContext" class="text-neutral-600 ml-2">{{ asideContext }}</span>
      </div>

      <!-- System message: non-interactive aside -->
      <div v-else-if="isSystem" class="text-xs italic py-1 px-2 text-neutral-500">
        {{ message.text }}
      </div>

      <!-- Normal message rendering -->
      <template v-else-if="!message.autoHide || !message.asideText || expanded">
      <div class="relative">
      <!-- Floating hover UI -->
      <div
        class="absolute transition-opacity duration-200 opacity-0 pointer-events-none -bottom-3 -right-4 z-10 group-hover:opacity-100 group-hover:pointer-events-auto"
      >
        <div class="flex items-center overflow-hidden border rounded-lg shadow-lg bg-neutral-800 border-neutral-700">
          <!-- Timestamp -->
          <span v-if="message.createdAt" class="text-xs text-neutral-400 px-3 py-1.5 border-r border-neutral-700 whitespace-nowrap">
            {{ formatTime(new Date(message.createdAt)) }}
          </span>

          <!-- Revert — shared across all user message states (hidden on stale cancelled) -->
          <button
            v-if="isUser && (isTail || !message.status)"
            @click="$emit('revert', message.id)"
            @contextmenu.prevent="!message.status && openRevertMenu($event)"
            class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
            :title="message.status ? 'Revert to input' : 'Revert (right-click for options)'"
          >
            <Undo2 :size="16" />
          </button>

          <!-- Status-specific actions -->
          <template v-if="isUser && message.status === 'queued'">
            <button
              @click="$emit('unqueue', message.id)"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
              title="Cancel queued message"
            >
              <X :size="16" />
            </button>
          </template>

          <template v-else-if="isUser && message.status === 'cancelled'">
            <button
              @click="copyMessageText"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
              title="Copy message text"
            >
              <Copy :size="16" />
            </button>
            <button
              v-if="isTail"
              @click="$emit('resend', message.id, message.text, message.references)"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
              title="Resend message"
            >
              <RotateCcw :size="16" />
            </button>
          </template>

          <template v-else>
            <button
              v-if="canFork"
              :disabled="forking"
              @click="forking = true; $emit('fork', message.id)"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300 disabled:opacity-30 disabled:pointer-events-none"
              title="Fork conversation"
            >
              <GitFork :size="16" />
            </button>

            <button
              v-if="message.autoHide && expanded"
              @click="expanded = false"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
              title="Collapse"
            >
              <ChevronsUpDown :size="16" />
            </button>

            <button
              v-if="isUser && isTruncated && userExpanded"
              @click="userExpanded = false"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
              title="Collapse"
            >
              <ChevronsUpDown :size="16" />
            </button>

            <button
              @click="copyMessageText"
              class="p-1.5 hover:bg-neutral-700 transition-colors text-neutral-300"
              title="Copy message text"
            >
              <Copy :size="16" />
            </button>
          </template>
        </div>
      </div>

      <!-- Bubble (visual styling + overflow constraint) -->
      <div
        ref="bubbleRef"
        :class="[
          'rounded-xl px-4 py-3 transition-all duration-200 overflow-hidden relative',
          isUser
            ? 'bg-neutral-800/80 text-neutral-100 border border-neutral-700/50'
            : ' text-neutral-100 border border-neutral-700/60',
          isUser && isCommand && 'command-bubble',
          message.status === 'cancelled' ? 'opacity-50' : 'hover:shadow-md',
          isUser && isTruncated && !userExpanded && 'max-h-[200px] cursor-pointer',
        ]"
        @click="isUser && isTruncated && !userExpanded && (userExpanded = true)"
      >
        <!-- Measure original user text independently of plugin-controlled display and controls. -->
        <div v-if="hasNativeUserFrame" ref="originalUserBody" inert aria-hidden="true" class="pointer-events-none invisible absolute left-4 right-4 top-3 leading-relaxed text-[15px]">
          <TiptapEditor mode="viewer" variant="chat" :model-value="message.text" />
        </div>

        <!-- Attachments: files then images, horizontal scroll -->
        <div v-if="message.references?.files?.length || message.references?.images?.length" ref="attachmentStrip"
          class="flex items-end gap-2 mb-2 overflow-x-auto scrollbar-thin">
          <ImageThumbnail v-for="(img, index) in message.references.images" :key="'i-'+index"
            :src="img.url" :name="img.name" @click="$emit('open-lightbox', img.url)" />
          <FileBlock v-for="(file, index) in message.references.files" :key="'f-'+index"
            :file="file" class="flex-shrink-0" />
        </div>

        <div v-if="message.references?.context?.length" class="mb-2 flex flex-wrap gap-1.5" aria-label="Attached context">
          <span v-for="reference in message.references.context" :key="`${reference.refType}:${reference.refId}`"
            :title="`${reference.refType}: ${reference.label}`"
            class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-700/50 bg-neutral-900/60 px-2 py-1 text-xs text-neutral-300">
            <span v-if="reference.shortCode" class="shrink-0 font-mono text-neutral-500">{{ reference.shortCode }}</span>
            <span class="truncate">{{ reference.label }}</span>
          </span>
        </div>

        <!-- Tool-activity blocks render ABOVE text so the work log
             appears before the model's commentary, not after it. -->
        <template v-for="entry in aboveTextBlocks" :key="entry.blockIndex">
          <ThinkingBlock v-if="entry.thinking" class="mb-2" v-bind="entry.thinking"
            @view="open => reportBlockView(entry.blockIndex, open)">
            <template v-for="part in thinkingParts(entry.blockIndex, entry.thinking)" :key="part.kind === 'native' ? part.frame.uuid : `host-${part.start}`">
              <NativeTranscriptMessage v-if="part.kind === 'native'" :frame="part.frame"
                @press="(id, href) => emit('native-ui-press', id, href)" @field="emit('native-ui-field', $event)" />
              <pre v-else class="m-0 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-400">{{ part.text }}</pre>
            </template>
          </ThinkingBlock>
          <InteractionContainer v-else class="mb-2" :blocks="[entry.block]" :message-id="message.id"
            :is-disabled="!!message.responseTimestamp" :response="message.blockResponse" />
        </template>

        <!-- Message content -->
        <div class="leading-relaxed text-[15px]">
          <template v-for="part in nativeParts" :key="part.kind === 'native' ? part.frame.uuid : `host-${part.start}`">
            <NativeTranscriptMessage v-if="part.kind === 'native'" :frame="part.frame"
              @press="(id, href) => emit('native-ui-press', id, href)" @field="emit('native-ui-field', $event)" />
            <TiptapEditor v-else mode="viewer" variant="chat" :model-value="part.text" />
          </template>
        </div>

        <!-- Other block types (approval, choice, etc.) render BELOW text -->
        <InteractionContainer
          v-if="otherBlocks.length > 0"
          :blocks="otherBlocks"
          :message-id="message.id"
          :is-disabled="!!message.responseTimestamp"
          :response="message.blockResponse"
        />

        <!-- Typing indicator for AI messages -->
        <div
          v-if="!isUser && isTyping"
          class="flex gap-1.5 mt-2.5"
        >
          <span class="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse"></span>
          <span class="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse" style="animation-delay: 200ms"></span>
          <span class="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse" style="animation-delay: 400ms"></span>
        </div>

        <!-- Truncation overlay for long user messages -->
        <div v-if="isUser && isTruncated && !userExpanded"
          class="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-neutral-800 via-neutral-800/90 to-transparent flex items-end justify-center pb-2 pointer-events-none">
          <button v-if="hasNativeUserFrame" type="button" aria-label="Expand user message" class="pointer-events-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-blue-400" @click.stop="userExpanded = true"><ChevronDown :size="14" /> Expand message</button>
          <span v-else class="text-xs text-neutral-400 flex items-center gap-1"><ChevronDown :size="14" /> Click to view</span>
        </div>
      </div>
      </div>
      </template>

      <!-- Status indicator (queued / cancelled) -->
      <div v-if="statusIndicator" :class="['flex items-center justify-end gap-1.5 mt-1 px-1 text-xs', statusIndicator.textClass]">
        <span :class="['inline-block w-1.5 h-1.5 rounded-full', statusIndicator.dotClass]" />
        <span>{{ statusIndicator.label }}</span>
      </div>
    </div>

    <!-- Revert context menu (right-click on revert button) -->
    <ContextMenuPopup
      :show="revertMenu.showMenu.value"
      :pos="revertMenu.menuPos.value"
      :items="revertMenuItems"
      @close="revertMenu.showMenu.value = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onUpdated, watch, provide, h } from 'vue'
import type { MessageEntity } from '#generated/types.ts'
import { Undo2, GitFork, Copy, FileCode2, ChevronsUpDown, ChevronDown, ChevronUp, X, RotateCcw } from 'lucide-vue-next'
import NativeToolDrawing from './NativeToolDrawing.vue'
import { claudeToolDrawings } from '#extensions/blocks/display/native-tool-drawings.ts'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import ThinkingBlock from '#extensions/blocks/display/ThinkingBlock.vue'
import type { ThinkingBlockProps } from '#features/threads/be/types.ts'
import { claudeNativeMessageParts, claudeThinkingMessageParts } from './native-message-parts.ts'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import InteractionContainer from './interactions/InteractionContainer.vue'
import FileBlock from './FileBlock.vue'
import ImageThumbnail from './ImageThumbnail.vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import { useContextMenu } from '@apackdev/ui/composables/useContextMenu'

interface ChatMessageProps {
  message: MessageEntity
  nativeFrames?: ClaudeUiTranscriptFrame[]
  nativeViewId?: string
  isTyping?: boolean
  isTail?: boolean
  isClaudeCodeThread?: boolean
}

interface ChatMessageEmits {
  (e: 'native-ui-press', actionId: string, href?: string): void
  (e: 'native-ui-field', event: ClaudeUiFieldEvent): void
  (e: 'native-ui-block-view', view: { messageId: string; blockIndex: number; open: boolean }): void
  (e: 'native-ui-message-view', view: { messageId: string; isExpanded: boolean }): void
  (e: 'revert', messageId: string): void
  (e: 'revert-with-files', messageId: string): void
  (e: 'fork', messageId: string): void
  (e: 'open-lightbox', imageSrc: string): void
  (e: 'unqueue', messageId: string): void
  (e: 'resend', messageId: string, text: string, references?: any): void
  (e: 'toggle-compacted', markerId: string, compacted: boolean): void
}

const props = withDefaults(defineProps<ChatMessageProps>(), {
  isTyping: false,
  isTail: false,
  isClaudeCodeThread: false,
})

const emit = defineEmits<ChatMessageEmits>()
provide(claudeToolDrawings, {
  render: (component, toolUseId, fallback) => h(NativeToolDrawing, { component, toolUseId }, fallback),
  frames: computed(() => (props.nativeFrames ?? []).filter(frame => frame.messageId === props.message.id && (frame.component === 'ToolResult' || frame.component === 'ToolUse' || frame.component === 'ToolProgress'))),
  press: (id, href) => emit('native-ui-press', id, href),
  field: event => emit('native-ui-field', event),
  view: (id, open) => { const index = props.message.blocks?.findIndex(block => block.type === 'tool-activity' && block.props.entries?.some((entry: { id: string }) => entry.id === id)) ?? -1; if (index >= 0) reportBlockView(index, open) },
})


const nativeParts = computed(() => claudeNativeMessageParts(props.message.id, props.message.text || '', props.message.sender === 'assistant' || props.message.sender === 'user' ? props.nativeFrames : []))

const blockExpansion = new Map<number, boolean>()
function reportBlockView(blockIndex: number, open: boolean) {
  blockExpansion.set(blockIndex, open)
  emit('native-ui-block-view', { messageId: props.message.id, blockIndex, open })
}
watch(() => props.nativeViewId, () => {
  for (const [blockIndex, open] of blockExpansion) emit('native-ui-block-view', { messageId: props.message.id, blockIndex, open })
}, { flush: 'post' })

const expanded = ref(false)
const forking = ref(false)
const revertMenu = useContextMenu()

const isUser = computed(() => props.message.sender === 'user')
const statusIndicator = computed(() => {
  if (!isUser.value || !props.message.status) return null
  if (props.message.status === 'queued') return { label: 'Queued', dotClass: 'bg-amber-500 animate-pulse', textClass: 'text-neutral-400' }
  if (props.message.status === 'cancelled') return { label: 'Cancelled', dotClass: 'bg-neutral-500', textClass: 'text-neutral-500' }
  return null
})
const isMarker = computed(() => props.message.sender === 'marker')
const isSystem = computed(() => props.message.sender === 'system')
const isCollapsedAsideAsUser = computed(() =>
  props.message.autoHide && props.message.asideText && !expanded.value && props.message.asUser
)
const markerExpanded = ref(false)
const isCommand = computed(() => props.message.isCommand ?? false)
const canFork = computed(() => {
  if (props.message.forkable === false) return false
  if (!props.isClaudeCodeThread || props.message.sender !== 'assistant') return true
  return typeof (props.message.context as any)?.cliUuid === 'string'
})

// Long user message truncation
const bubbleRef = ref<HTMLElement | null>(null)
const userExpanded = ref(false)
const isTruncated = ref(false)
const MAX_USER_MSG_HEIGHT = 200
const originalUserBody = ref<HTMLElement | null>(null), attachmentStrip = ref<HTMLElement | null>(null)
const hasNativeUserFrame = computed(() => isUser.value && nativeParts.value.some(part => part.kind === 'native' && part.frame.component === 'UserMessage'))

watch([() => props.message.id, () => props.isClaudeCodeThread, () => isUser.value, () => isTruncated.value, () => userExpanded.value], () => {
  if (isUser.value && props.isClaudeCodeThread) emit('native-ui-message-view', { messageId: props.message.id, isExpanded: !isTruncated.value || userExpanded.value })
}, { immediate: true })

function checkTruncation() {
  if (bubbleRef.value && isUser.value) {
    if (hasNativeUserFrame.value && !originalUserBody.value?.scrollHeight) return
    const height = hasNativeUserFrame.value && originalUserBody.value
      ? originalUserBody.value.scrollHeight + (attachmentStrip.value ? attachmentStrip.value.offsetHeight + 8 : 0) + 26
      : bubbleRef.value.scrollHeight
    isTruncated.value = height > MAX_USER_MSG_HEIGHT
  }
}

// Use ResizeObserver so truncation is detected even when TiptapEditor renders async (e.g. on refresh)
watch(bubbleRef, (el, _prev, onCleanup) => {
  if (!el || !isUser.value) return
  const observer = new ResizeObserver(checkTruncation)
  observer.observe(el)
  checkTruncation()
  onCleanup(() => observer.disconnect())
}, { immediate: true })

watch(originalUserBody, (element, _prior, onCleanup) => {
  if (!element) return
  const observer = new ResizeObserver(checkTruncation); observer.observe(element); checkTruncation()
  onCleanup(() => observer.disconnect())
})

onUpdated(checkTruncation)

const revertMenuItems = [
  {
    label: 'Revert & restore files',
    icon: FileCode2,
    class: 'text-neutral-200',
    action: () => emit('revert-with-files', props.message.id),
  },
]

function openRevertMenu(e: MouseEvent) {
  revertMenu.open(e, revertMenuItems.length)
}

// Split aside text into primary outcome and secondary context at the " — " separator
const asideOutcome = computed(() => {
  const text = props.message.asideText ?? ''
  const idx = text.indexOf(' — ')
  return idx === -1 ? text : text.slice(0, idx)
})
const asideContext = computed(() => {
  const text = props.message.asideText ?? ''
  const idx = text.indexOf(' — ')
  return idx === -1 ? '' : text.slice(idx + 3)
})

// Split blocks by type so tool-activity and thinking render above text while
// other block types (approval, choice, etc.) render below text.
const ABOVE_TEXT_BLOCKS = new Set(['tool-activity', 'thinking'])
function thinkingProps(block: { type: string; props?: unknown }): ThinkingBlockProps | undefined {
  if (block.type !== 'thinking' || !block.props || typeof block.props !== 'object') return
  const value = block.props as Partial<ThinkingBlockProps>
  if (typeof value.content !== 'string' || typeof value.label !== 'string' || (value.state !== 'streaming' && value.state !== 'done')) return
  return value as ThinkingBlockProps
}
const aboveTextBlocks = computed(() => (props.message.blocks ?? []).map((block, blockIndex) => ({ block, blockIndex, thinking: thinkingProps(block) })).filter(entry => ABOVE_TEXT_BLOCKS.has(entry.block.type)))
const thinkingParts = (blockIndex: number, block: ThinkingBlockProps) => claudeThinkingMessageParts(props.message.id, blockIndex, block, props.isClaudeCodeThread ? props.nativeFrames : [])
const otherBlocks = computed(() =>
  (props.message.blocks ?? []).filter((b: any) => !ABOVE_TEXT_BLOCKS.has(b.type))
)

const copyMessageText = async () => {
  try {
    await navigator.clipboard.writeText(props.message.text)
  } catch (error) {
    console.error('Failed to copy text:', error)
  }
}

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<style lang="scss" scoped>
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in {
  animation: fade-in 0.3s ease-out;
}

.command-bubble {
  border-color: rgba(180, 180, 255, 0.3);
  box-shadow: 0 0 8px -2px rgba(180, 180, 255, 0.12);
}

</style>
