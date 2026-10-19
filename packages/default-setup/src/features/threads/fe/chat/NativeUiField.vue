<template>
  <label class="native-field flex min-w-0 flex-col gap-1.5" :style="fieldTheme" :data-native-plugin="node.plugin" :data-native-scroll-id="node.focusId">
    <span v-if="node.label" class="native-field-label text-[11px] leading-4 tracking-wide">{{ node.label }}</span>
    <select v-if="node.kind === 'select'" :data-native-focus-id="node.focusId" :data-native-autofocus="node.autoFocus" :value="draft" :aria-label="node.label || 'Claude selection'"
      class="h-9 min-w-0 max-w-full rounded-lg border border-current bg-transparent px-2.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" @change="pick">
      <option v-for="option in node.options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <textarea v-else :data-native-focus-id="node.focusId" :data-native-autofocus="node.autoFocus" :value="draft" :rows="node.rows" :placeholder="node.placeholder"
      :aria-label="node.label || 'Claude input'" maxlength="16384"
      class="min-w-0 max-w-full resize-y rounded-lg border border-current bg-transparent px-3 py-2 text-[13px] leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      @input="change" @compositionstart="compositionStart" @compositionend="compositionEnd" @keydown="keydown" @focus="focused = true" @blur="focused = false" />
    <span v-if="node.kind === 'input'" :style="{ visibility: focused ? 'visible' : 'hidden' }" :aria-hidden="!focused" class="native-field-hint text-[10px]">Enter: {{ node.submitLabel }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { claudeUiColor } from './native-ui-paint.ts'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'input' | 'select' }> }>()
const emit = defineEmits<{ field: [event: ClaudeUiFieldEvent] }>()
const fieldTheme = computed<CSSProperties>(() => ({
  '--native-field-text': claudeUiColor(props.node.theme?.text ?? 'text'),
  '--native-field-inverse': claudeUiColor(props.node.theme?.inverseText ?? 'inverseText'),
}))
const draft = ref(props.node.value)
let revision = props.node.revision
let nativeValue = props.node.value
let lastChangeValue = props.node.value
let composing = false
let replacement: string | undefined
const focused = ref(false)
watch(() => [props.node.value, props.node.revision, props.node.kind === 'select' ? props.node.options.map(option => option.value).join('\u0000') : ''] as const, ([value, completed]) => {
  if (value !== nativeValue || (props.node.kind === 'select' && !props.node.options.some(option => option.value === draft.value))) replacement = value
  nativeValue = value
  if (!composing && completed >= revision && replacement !== undefined) {
    draft.value = replacement
    lastChangeValue = replacement
    replacement = undefined
  }
})
function send(kind: ClaudeUiFieldEvent['kind']) {
  emit('field', { actionId: props.node.actionId, revision: ++revision, kind, value: draft.value })
}
function change(event: Event) {
  draft.value = (event.target as HTMLTextAreaElement).value
  if (!composing && !('isComposing' in event && event.isComposing === true) && draft.value !== lastChangeValue) { lastChangeValue = draft.value; send('change') }
}
function compositionStart() { composing = true }
function compositionEnd(event: CompositionEvent) {
  composing = false
  change(event)
  if (props.node.revision >= revision && replacement !== undefined) { draft.value = replacement; lastChangeValue = replacement; replacement = undefined }
}
function pick(event: Event) {
  draft.value = (event.target as HTMLSelectElement).value
  send('select')
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || composing) return
  // The outer message composer must never treat field Enter as message submission.
  event.stopPropagation()
  if (event.shiftKey && props.node.kind === 'input' && props.node.rows > 1) return
  event.preventDefault()
  send('submit')
}
</script>

<style scoped>
.native-field { color: var(--native-field-text); }
.native-field-label { font-weight: 400; }
.native-field:focus-within .native-field-label { font-weight: 600; }
.native-field textarea, .native-field select { color: inherit; }
.native-field textarea::placeholder { color: currentColor; opacity: 0.5; }
.native-field-hint { opacity: 0.5; }
.native-field option { color: var(--native-field-text); background-color: var(--native-field-inverse); }
.native-field option:checked { color: var(--native-field-inverse); background-color: var(--native-field-text); }
</style>
