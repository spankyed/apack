<template>
  <label ref="field" class="native-field flex min-w-0 flex-col gap-1.5" :style="fieldTheme" :data-native-plugin="node.plugin" :data-native-scroll-id="node.focusId">
    <span v-if="node.label || node.kind === 'input'" class="flex min-w-0 items-baseline justify-between gap-3">
      <span v-if="node.label" class="native-field-label min-w-0 text-[11px] leading-4 tracking-wide">{{ node.label }}</span>
      <span v-if="node.kind === 'input'" :style="{ visibility: focused ? 'visible' : 'hidden' }" :aria-hidden="!focused" class="native-field-hint shrink-0 whitespace-nowrap text-[10px]">Enter: {{ node.submitLabel }}</span>
    </span>
    <select v-if="node.kind === 'select'" :data-native-focus-id="node.focusId" :data-native-autofocus="node.autoFocus" :value="selectValue" :aria-label="node.label || 'Claude selection'"
      class="h-9 min-w-0 max-w-full rounded-lg border border-current bg-transparent px-2.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" @change="pick">
      <option v-if="!selectHasValue" :value="unselectedValue" disabled hidden>none</option>
      <option v-for="option in node.options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <textarea v-else ref="textarea" :data-native-focus-id="node.focusId" :data-native-autofocus="node.autoFocus" :value="draft" :rows="visibleRows" :style="{ maxHeight: maximumHeight + 'px' }" :placeholder="node.placeholder"
      :aria-label="node.label || 'Claude input'" :maxlength="nativeInputLimit" :aria-invalid="problem ? 'true' : undefined" :aria-describedby="problem ? 'native-field-problem-' + node.actionId : undefined"
      class="min-w-0 max-w-full resize-y rounded-lg border border-current bg-transparent px-3 py-2 text-[13px] leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      @input="change" @compositionstart="compositionStart" @compositionend="compositionEnd" @keydown="keydown" @focus="focused = true" @blur="focused = false" />
    <span v-if="problem" :id="'native-field-problem-' + node.actionId" role="alert" class="text-xs text-red-300">{{ problem }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { CSSProperties } from 'vue'
import { claudeUiColor } from './native-ui-paint.ts'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'input' | 'select' }> }>()
const emit = defineEmits<{ field: [event: ClaudeUiFieldEvent] }>()
const fieldTheme = computed<CSSProperties>(() => ({
  '--native-field-text': claudeUiColor(props.node.theme?.text ?? 'text'),
  '--native-field-inverse': claudeUiColor(props.node.theme?.inverseText ?? 'inverseText'),
}))
const field = ref<HTMLElement>(), textarea = ref<HTMLTextAreaElement>()
const maximumHeight = ref(Math.max(20, globalThis.innerHeight || 20))
const visibleRows = ref(props.node.kind === 'input' ? Math.min(props.node.rows, Math.max(1, Math.floor(maximumHeight.value / 20))) : 1)
let sizeObserver: ResizeObserver | undefined, sizeFrame: number | undefined
function measureRows() {
  const control = textarea.value, root = field.value
  if (!control || !root || props.node.kind !== 'input') return
  const style = getComputedStyle(control), line = parseFloat(style.lineHeight) || 20
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  const viewport = globalThis.innerHeight || line + padding
  const previousRows = control.rows, previousMaxHeight = control.style.maxHeight
  const scrollPositions: [HTMLElement, number][] = [[control, control.scrollTop]]
  for (let parent = root.parentElement; parent; parent = parent.parentElement) scrollPositions.push([parent, parent.scrollTop])
  let available = viewport, chrome = 0
  try {
    // Measure the requested size before fitting it. Measuring only the already-fitted site
    // makes an intrinsically sized flex surface keep its compact one-row height forever.
    control.rows = Math.min(props.node.rows, Math.max(1, Math.floor((viewport - padding) / line)))
    control.style.maxHeight = viewport + 'px'
    const site = control.closest('[data-native-scroll-content]')?.parentElement
    if (site?.clientHeight) { const paint = getComputedStyle(site); available = Math.min(available, site.clientHeight - (parseFloat(paint.paddingTop) || 0) - (parseFloat(paint.paddingBottom) || 0)) }
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY) && parent.clientHeight) available = Math.min(available, parent.clientHeight)
    }
    chrome = Math.max(0, root.getBoundingClientRect().height - control.getBoundingClientRect().height)
  } finally {
    control.rows = previousRows
    control.style.maxHeight = previousMaxHeight
    for (const [element, top] of scrollPositions) element.scrollTop = top
  }
  maximumHeight.value = Math.max(line + padding, available - chrome)
  visibleRows.value = Math.min(props.node.rows, Math.max(1, Math.floor((maximumHeight.value - padding) / line)))
}
function scheduleRows() {
  if (sizeFrame !== undefined) cancelAnimationFrame(sizeFrame)
  sizeFrame = requestAnimationFrame(() => { sizeFrame = undefined; measureRows() })
}
onMounted(() => {
  sizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleRows)
  if (field.value) sizeObserver?.observe(field.value)
  const site = field.value?.closest('[data-native-scroll-content]')?.parentElement
  if (site) sizeObserver?.observe(site)
  window.addEventListener('resize', scheduleRows)
  measureRows()
})
watch(() => [props.node.kind, props.node.kind === 'input' ? props.node.rows : 1], scheduleRows, { flush: 'post' })
onBeforeUnmount(() => { sizeObserver?.disconnect(); window.removeEventListener('resize', scheduleRows); if (sizeFrame !== undefined) cancelAnimationFrame(sizeFrame) })
// Frozen native ui_input bound; a drawn value may be longer than its callback permits.
const nativeInputLimit = 16384
const problem = ref<string>()
const draft = ref(props.node.value)
const selectHasValue = computed(() => props.node.kind === 'select' && props.node.options.some(option => option.value === draft.value))
const unselectedValue = computed(() => {
  let value = '__native_unselected__'
  if (props.node.kind === 'select') while (props.node.options.some(option => option.value === value)) value += '_'
  return value
})
const selectValue = computed(() => selectHasValue.value ? draft.value : unselectedValue.value)
let revision = props.node.revision
let nativeValue = props.node.value
let lastChangeValue = props.node.value
let composing = false
let replacement: { value: string | undefined } | undefined
const focused = ref(false)
watch(() => [props.node.value, props.node.revision, props.node.kind === 'select' ? props.node.options.map(option => option.value).join('\u0000') : ''] as const, ([value, completed]) => {
  if (value !== nativeValue || (props.node.kind === 'select' && !props.node.options.some(option => option.value === draft.value))) replacement = { value }
  nativeValue = value
  if (!composing && completed >= revision && replacement !== undefined) {
    draft.value = replacement.value
    lastChangeValue = replacement
    replacement = undefined
    problem.value = undefined
  }
})
function send(kind: ClaudeUiFieldEvent['kind']) {
  if (typeof draft.value !== 'string') return
  ++revision
  if (draft.value.length > nativeInputLimit) { problem.value = 'Shorten this field to 16,384 characters before sending it to Claude.'; return }
  problem.value = undefined
  emit('field', { actionId: props.node.actionId, revision, kind, value: draft.value })
}
function change(event: Event) {
  draft.value = (event.target as HTMLTextAreaElement).value
  if (!composing && !('isComposing' in event && event.isComposing === true) && draft.value !== lastChangeValue) { lastChangeValue = draft.value; send('change') }
}
function compositionStart() { composing = true }
function compositionEnd(event: CompositionEvent) {
  composing = false
  change(event)
  if (props.node.revision >= revision && replacement !== undefined) { draft.value = replacement.value; lastChangeValue = replacement; replacement = undefined; problem.value = undefined }
}
function pick(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (props.node.kind !== 'select' || !props.node.options.some(option => option.value === value)) return
  draft.value = value
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
