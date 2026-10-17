<template>
  <label class="flex min-w-0 flex-col gap-1.5" :data-native-plugin="node.plugin" :data-native-scroll-id="node.focusId">
    <span v-if="node.label" class="text-[11px] font-medium leading-4 tracking-wide text-neutral-500">{{ node.label }}</span>
    <select v-if="node.kind === 'select'" :data-native-focus-id="node.focusId" :data-native-autofocus="node.autoFocus" :value="draft" :aria-label="node.label || 'Claude selection'"
      class="h-9 min-w-0 max-w-full rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 text-[13px] text-neutral-200 transition-colors hover:border-white/15 focus:border-blue-400/50 focus:outline-none focus:ring-2 focus:ring-blue-400/10" @change="pick">
      <option v-for="option in node.options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <textarea v-else :data-native-focus-id="node.focusId" :data-native-autofocus="node.autoFocus" :value="draft" :rows="node.rows" :placeholder="node.placeholder"
      :aria-label="node.label || 'Claude input'" maxlength="16384"
      class="min-w-0 max-w-full resize-y rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[13px] leading-5 text-neutral-200 placeholder:text-neutral-600 transition-colors hover:border-white/15 focus:border-blue-400/50 focus:outline-none focus:ring-2 focus:ring-blue-400/10"
      @input="change" @keydown="keydown" @focus="focused = true" @blur="focused = false" />
    <span v-if="node.kind === 'input'" :style="{ visibility: focused ? 'visible' : 'hidden' }" :aria-hidden="!focused" class="text-[10px] text-neutral-500">Enter: {{ node.submitLabel }}</span>
  </label>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'input' | 'select' }> }>()
const emit = defineEmits<{ field: [event: ClaudeUiFieldEvent] }>()
const draft = ref(props.node.value)
let revision = props.node.revision
let nativeValue = props.node.value
let replacement: string | undefined
const focused = ref(false)
watch(() => [props.node.value, props.node.revision, props.node.kind === 'select' ? props.node.options.map(option => option.value).join('\u0000') : ''] as const, ([value, completed]) => {
  if (value !== nativeValue || (props.node.kind === 'select' && !props.node.options.some(option => option.value === draft.value))) replacement = value
  nativeValue = value
  if (completed >= revision && replacement !== undefined) {
    draft.value = replacement
    replacement = undefined
  }
})
function send(kind: ClaudeUiFieldEvent['kind']) {
  emit('field', { actionId: props.node.actionId, revision: ++revision, kind, value: draft.value })
}
function change(event: Event) {
  draft.value = (event.target as HTMLTextAreaElement).value
  send('change')
}
function pick(event: Event) {
  draft.value = (event.target as HTMLSelectElement).value
  send('select')
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  // The outer message composer must never treat field Enter as message submission.
  event.stopPropagation()
  if (event.shiftKey && props.node.kind === 'input' && props.node.rows > 1) return
  event.preventDefault()
  send('submit')
}
</script>
