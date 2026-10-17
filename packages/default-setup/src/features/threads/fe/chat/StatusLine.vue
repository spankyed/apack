<template>
  <div v-if="statusLine || hasContent || nativeUi?.status === 'error'"
    class="min-w-0 border-b border-neutral-700 px-3 py-2 text-xs text-neutral-400" data-testid="composer-session-strip" @keydown.esc.stop.prevent="emit('return-focus')">
    <div v-if="statusLine" class="flex min-w-0 justify-end">
      <button type="button" class="min-w-0 max-w-full whitespace-normal break-words text-right hover:text-neutral-200 focus-visible:outline focus-visible:outline-blue-400"
        :title="cwd" @click="emit('click')">{{ statusLine }}</button>
    </div>
    <div v-if="nativeUi?.status === 'live' && hasContent" class="max-h-48 overflow-y-auto min-w-0" tabindex="0" @focus="focusNativeUi" :class="{ 'mt-1.5': statusLine }">
      <NativeUiNode :node="nativeUi.tree" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" />
    </div>
    <p v-else-if="nativeUi?.status === 'error'" class="text-neutral-500" :title="nativeUi.message" role="status">Claude controls unavailable</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeUiMountState, ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
import NativeUiNode from './NativeUiNode.vue'
const props = defineProps<{ statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState }>()
const emit = defineEmits<{ click: []; 'return-focus': []; press: [actionId: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
function focusNativeUi(event: FocusEvent) {
  // Native autofocus chooses the first field when the person enters this site, never on redraw.
  const site = event.currentTarget as HTMLElement
  site.querySelector<HTMLElement>('[data-native-autofocus="true"]')?.focus()
}
function visible(node: ClaudeUiNode): boolean {
  if (node.kind === 'box') return node.children.some(visible)
  if (node.kind === 'text') return !!node.text.trim()
  return node.kind !== 'unsupported' || node.component !== 'engine'
}
const hasContent = computed(() => props.nativeUi?.status === 'live' && visible(props.nativeUi.tree))
</script>
