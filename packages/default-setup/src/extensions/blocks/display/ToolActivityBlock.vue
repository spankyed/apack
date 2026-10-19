<template>
  <div data-native-tool-activity class="rounded-lg border border-neutral-700 bg-neutral-800/40 overflow-hidden">
    <!-- Header row: chevron + icon + label + badge/spinner -->
    <button
      type="button"
      class="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-neutral-700/40 transition-colors"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <ChevronRight
        class="w-4 h-4 text-neutral-400 flex-shrink-0 self-center transition-transform"
        :class="{ 'rotate-90': isOpen }"
      />
      <Wrench class="w-4 h-4 text-neutral-400 flex-shrink-0 self-center" />
      <span class="text-sm text-neutral-200 truncate shrink min-w-[8rem]">{{ label }}</span>
      <span v-if="state === 'streaming'" class="flex gap-1 flex-shrink-0 self-baseline" aria-hidden>
        <span class="w-1 h-1 rounded-full bg-neutral-500 streaming-dot" style="animation-delay: 0ms" />
        <span class="w-1 h-1 rounded-full bg-neutral-500 streaming-dot" style="animation-delay: 150ms" />
        <span class="w-1 h-1 rounded-full bg-neutral-500 streaming-dot" style="animation-delay: 300ms" />
      </span>
      <span class="flex-1 min-w-8" />
      <template v-if="previewEntry">
        <span class="text-[11px] text-neutral-500 flex-shrink-0">{{ previewEntry.tool }}</span>
        <span class="text-[11px] text-neutral-600 truncate font-mono text-right min-w-0">{{ previewEntry.summary }}</span>
      </template>
      <!-- <span v-if="badge" class="text-xs text-neutral-500 flex-shrink-0 tabular-nums">{{ badge }}</span> -->
    </button>

    <!-- Artifact ref link — shown below the header when set (Phase C diff) -->
    <button
      v-if="artifactRef && state !== 'streaming'"
      type="button"
      class="w-full text-left px-3 py-1.5 border-t border-neutral-800/60 text-xs text-neutral-400 hover:bg-neutral-700/30 hover:text-neutral-200 transition-colors flex items-center gap-1.5"
      @click.stop="selectArtifact"
    >
      <ArrowRight class="w-3 h-3 flex-shrink-0" />
      <span class="truncate">View changes ({{ artifactRef.label }})</span>
    </button>

    <!-- Expanded list of entries — capped height with internal scroll for long turns -->
    <div
      v-if="isOpen && entries.length > 0"
      ref="listEl"
      class="border-t border-neutral-700 max-h-80 overflow-y-auto"
      @scroll="onListScroll"
    >
      <div
        v-for="(entry, index) in entries"
        :key="entry.id || index"
        :data-native-agent-id="entry.nativeAgent?.id" :data-native-tool-use-id="entry.id"
        class="px-3 py-2 text-xs border-b border-neutral-800/60 last:border-0 hover:bg-neutral-800/40 cursor-default"
        :class="{ 'opacity-50 line-through': entry.status === 'denied' }"
      >
        <div class="flex min-w-0 items-center gap-2">
          <NativeToolDrawing component="ToolUse" :tool-use-id="entry.id">
          <!-- Status icon -->
          <Check v-if="entry.status === 'ok'" class="w-3 h-3 text-emerald-500 flex-shrink-0" />
          <Loader2 v-else-if="entry.status === 'running'" class="w-3 h-3 text-neutral-400 animate-spin flex-shrink-0" />
          <X v-else-if="entry.status === 'denied'" class="w-3 h-3 text-neutral-500 flex-shrink-0" />
          <AlertCircle v-else-if="entry.status === 'error'" class="w-3 h-3 text-red-500 flex-shrink-0" />

          <!-- Tool name -->
          <span class="font-mono text-neutral-300 min-w-[4.5rem] flex-shrink-0">{{ entry.tool }}</span>

          <!-- Summaries -->
          <div class="flex-1 min-w-0">
            <JsonHoverPopup :value="entry.details?.input" :label="entry.tool" width="trigger">
              <div class="text-neutral-400 truncate font-mono text-left" dir="rtl">{{ entry.summary }}</div>
            </JsonHoverPopup>
            <JsonHoverPopup
              v-if="entry.outputSummary && entry.status !== 'running' && !entry.nativeAgent && !entry.nativeResult"
              :value="entry.details?.output || entry.details?.error"
              :label="`${entry.tool} output`"
              width="trigger"
            >
              <div class="truncate text-[10px] text-neutral-500">{{ entry.outputSummary }}</div>
            </JsonHoverPopup>
          </div>

          </NativeToolDrawing>
          <!-- Duration badge -->
          <span v-if="entry.durationMs != null" class="text-neutral-500 text-[10px] tabular-nums flex-shrink-0 min-w-[2.5rem] text-right">
            {{ formatDuration(entry.durationMs) }}
          </span>
          <span v-else-if="entry.status === 'running'" class="text-neutral-500 text-[10px] flex-shrink-0">
            running
          </span>
        </div>
        <NativeToolDrawing component="ToolProgress" :tool-use-id="entry.id" />
        <NativeToolDrawing v-if="entry.nativeResult" component="ToolResult" :tool-use-id="entry.id" class="mt-1">
          <JsonHoverPopup v-if="entry.outputSummary && !entry.nativeAgent" :value="entry.details?.output || entry.details?.error" :label="`${entry.tool} output`" width="trigger"><div class="truncate text-[10px] text-neutral-500">{{ entry.outputSummary }}</div></JsonHoverPopup>
        </NativeToolDrawing>
        <section v-if="entry.nativeAgent" class="mt-2 min-w-0 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2" aria-label="Native agent status">
          <div class="flex min-w-0 items-center justify-between gap-2 text-[10px] text-neutral-500">
            <span class="min-w-0 truncate" :title="entry.nativeAgent.name">{{ entry.nativeAgent.name }}</span><span class="shrink-0">{{ entry.nativeAgent.status }}</span>
          </div>
          <div role="status" :aria-label="`Claude agent ${entry.nativeAgent.name} status`" :tabindex="entry.nativeAgent.statusText ? 0 : -1" class="mt-1 max-h-28 min-w-0 overflow-y-auto overscroll-contain rounded text-[11px] leading-4 focus-visible:outline focus-visible:outline-blue-400" data-testid="native-agent-status-text">
            <NativeStatusText v-if="entry.nativeAgent.statusText" :text="entry.nativeAgent.statusText" />
          </div>
          <NativeTaskControls v-if="entry.nativeAgent.ownerId && entry.nativeAgent.sessionId" :task="{ ...entry.nativeAgent, ownerId: entry.nativeAgent.ownerId, sessionId: entry.nativeAgent.sessionId }" />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { sendToSurface } from '#generated/events.ts'
import { type PropType, ref, computed, watch, nextTick, inject, onMounted, onBeforeUnmount, defineComponent } from 'vue'
import { ChevronRight, Wrench, Check, Loader2, X, AlertCircle, ArrowRight } from 'lucide-vue-next'
import JsonHoverPopup from '@apackdev/ui/components/JsonHoverPopup'
import { computeLabel } from './tool-activity-label.ts'

import type { ToolActivityEntry } from '#features/threads/be/types.ts'
import { claudeToolDrawings } from './native-tool-drawings.ts'
import NativeTaskControls from './NativeTaskControls.vue'
import NativeStatusText from './NativeStatusText.vue'

interface ArtifactRef {
  artifactId: string
  label: string
}

interface Props {
  entries: ToolActivityEntry[]
  label: string
  state: 'streaming' | 'done' | 'error'
  defaultOpen?: boolean
  artifactRef?: ArtifactRef
  phase?: string
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: false,
})

const nativeDrawings = inject(claudeToolDrawings, undefined)
// The owning message supplies its native renderer; this display block owns no feature UI.
const NativeToolDrawing = defineComponent({
  props: { toolUseId: { type: String, required: true }, component: { type: String as PropType<'ToolUse' | 'ToolResult' | 'ToolProgress'>, required: true } },
  setup(props, { slots }) { return () => nativeDrawings?.render(props.component, props.toolUseId, slots.default ?? (() => [])) ?? slots.default?.() },
})

onMounted(() => { if (props.entries[0]) nativeDrawings?.view(props.entries[0].id, isOpen.value) })
onBeforeUnmount(() => { if (props.entries[0]) nativeDrawings?.view(props.entries[0].id, false) })

// User toggle wins once they interact; we only auto-open on error-state
// transitions (P3 of the design doc).
const isOpen = ref(props.defaultOpen)
watch(isOpen, open => { if (props.entries[0]) nativeDrawings?.view(props.entries[0].id, open) })

const listEl = ref<HTMLElement | null>(null)
let userHasToggled = false
let userHasScrolled = false

watch(() => props.state, (next, prev) => {
  if (next === 'error' && prev !== 'error' && !userHasToggled) {
    isOpen.value = true
  }
})

// Wrap isOpen mutation so we can flag user intent.
watch(isOpen, () => { userHasToggled = true })

// When the block is opened, reset scroll tracking and scroll to bottom.
watch(isOpen, async (open) => {
  if (!open) return
  userHasScrolled = false
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
})

// Auto-scroll to the bottom as new rows arrive, so the latest tool
// stays visible in the capped viewport. Stop tracking once the user
// manually scrolls — then they're in charge of the scroll position.
watch(
  () => props.entries.length,
  async () => {
    if (!isOpen.value || userHasScrolled) return
    await nextTick()
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

function onListScroll(e: Event) {
  const el = e.target as HTMLElement
  // Detect user-initiated scrolls by checking if they're not at the bottom.
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  if (!atBottom) userHasScrolled = true
  else userHasScrolled = false // resume auto-tracking if they scroll back down
}

// Re-compute the label from entries/state on every update so we stay
// honest even if the backend writer lags. The backend-provided `label`
// from props is the source of truth; we only override if it's missing.
const label = computed(() => props.label || computeLabel(props.entries, props.state, props.phase))


// While streaming: last running entry. When done: last entry overall.
const previewEntry = computed(() => {
  if (!props.entries.length) return null
  if (props.state === 'streaming') {
    for (let i = props.entries.length - 1; i >= 0; i--) {
      if (props.entries[i].status === 'running') return props.entries[i]
    }
  }
  return props.entries[props.entries.length - 1]
})

const entries = computed(() => props.entries)
const state = computed(() => props.state)
const artifactRef = computed(() => props.artifactRef)

// Jump to the referenced artifact in the right panel when the link is clicked.
function selectArtifact() {
  if (!props.artifactRef) return
  sendToSurface('threads', { type: 'SELECT_ARTIFACT', artifactId: props.artifactRef.artifactId })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m${secs}s`
}

</script>

<style scoped>
.streaming-dot {
  animation: streaming-pulse 1.2s ease-in-out infinite;
}
@keyframes streaming-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
</style>
