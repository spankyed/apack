<template>
  <label class="flex min-w-0 flex-col gap-1" :data-native-plugin="node.plugin">
    <span v-if="node.label">{{ node.label }}</span>
    <select v-if="node.kind === 'select'" :data-native-autofocus="node.autoFocus" :value="draft" :aria-label="node.label || 'Claude selection'"
      class="min-w-0 rounded border border-neutral-600 bg-neutral-900 px-2 py-1" @change="pick">
      <option v-for="option in node.options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <textarea v-else :data-native-autofocus="node.autoFocus" :value="draft" :rows="node.rows" :placeholder="node.placeholder"
      :aria-label="node.label || 'Claude input'" maxlength="16384"
      class="min-w-0 resize-y rounded border border-neutral-600 bg-neutral-900 px-2 py-1"
      @input="change" @keydown="keydown" />
  </label>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'input' | 'select' }> }>()
const emit = defineEmits<{ field: [event: ClaudeUiFieldEvent] }>()
const draft = ref(props.node.value)
let edited = false
// Keep locally typed text across stale native echoes; acknowledge when native catches up.
watch(() => props.node.value, value => {
  if (value === draft.value) edited = false
  else if (!edited) draft.value = value
})
function change(event: Event) {
  draft.value = (event.target as HTMLTextAreaElement).value
  edited = true
  emit('field', { actionId: props.node.actionId, kind: 'change', value: draft.value })
}
function pick(event: Event) {
  draft.value = (event.target as HTMLSelectElement).value
  edited = true
  emit('field', { actionId: props.node.actionId, kind: 'select', value: draft.value })
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  // The outer message composer must never treat field Enter as message submission.
  event.stopPropagation()
  if (event.shiftKey && props.node.kind === 'input' && props.node.rows > 1) return
  event.preventDefault()
  emit('field', { actionId: props.node.actionId, kind: 'submit', value: draft.value })
}
</script>
