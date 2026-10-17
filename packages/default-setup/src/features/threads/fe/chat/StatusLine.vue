<template>
  <div v-if="statusLine || hasContent || nativeUi?.status === 'error'"
    class="min-w-0 px-4 py-3 text-xs text-neutral-400" :class="{ 'border-b border-white/[0.06]': hasContent || nativeUi?.status === 'error' }" data-testid="composer-session-strip" @keydown.esc.stop.prevent="emit('return-focus')">
    <div v-if="statusLine" class="flex min-w-0 items-center pr-5">
      <button type="button" class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-neutral-300 focus-visible:outline focus-visible:outline-blue-400"
        :title="cwd" @click="emit('click')"><FolderOpen v-if="cwd" :size="12" class="shrink-0" aria-hidden="true" /><span class="min-w-0 whitespace-pre-wrap break-words">{{ displayPath }}</span></button>
    </div>
    <div v-if="nativeUi?.status === 'live' && hasContent" class="native-extension-surface max-h-56 min-w-0 overflow-y-auto text-[13px] leading-5 outline-none" tabindex="0" @focus="focusNativeUi" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave" :class="{ 'mt-3': statusLine }">
      <NativeUiNode :node="nativeUi.tree" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" />
    </div>
    <p v-else-if="nativeUi?.status === 'error'" class="text-neutral-500" :title="nativeUi.message" role="status">Claude controls unavailable</p>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, onBeforeUnmount } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import type { ClaudeUiMountState, ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
import NativeUiNode from './NativeUiNode.vue'
import { createClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
const hover = createClaudeHoverSurface()
provide(claudeHoverSurface, hover)
onBeforeUnmount(() => hover.dispose())
const props = defineProps<{ statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState }>()
const displayPath = computed(() => {
  if (!props.cwd || props.statusLine !== props.cwd) return props.statusLine
  const segments = props.cwd.split(/[\\/]/).filter(Boolean)
  return segments.length > 2 ? `…/${segments.at(-1)}` : props.statusLine
})
const emit = defineEmits<{ click: []; 'return-focus': []; press: [actionId: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
function focusNativeUi(event: FocusEvent) {
  // Native autofocus chooses the first field when the person enters this site, never on redraw.
  const site = event.currentTarget as HTMLElement
  site.querySelector<HTMLElement>('[data-native-autofocus="true"]')?.focus()
}
function visible(node: ClaudeUiNode): boolean {
  if (node.kind === 'box' || node.kind === 'link') return node.children.some(visible)
  if (node.kind === 'text') return !!node.text.trim() || !!node.children?.some(visible)
  return node.kind !== 'unsupported' || node.component !== 'engine'
}
const hasContent = computed(() => props.nativeUi?.status === 'live' && visible(props.nativeUi.tree))
</script>
