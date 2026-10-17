<template>
  <div v-if="statusLine || hasContent || nativeUi?.status === 'error'"
    class="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-black/[0.10] px-5 py-3 text-xs text-neutral-400" :class="{ 'min-h-28': hasContent, 'border-b border-white/[0.06]': hasContent || nativeUi?.status === 'error' }" data-testid="composer-session-strip" @keydown="handleStripKey" @keydown.esc="returnToComposer">
    <div v-if="statusLine" class="flex shrink-0 min-w-0 items-center pr-5">
      <button type="button" class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-neutral-300 focus-visible:outline focus-visible:outline-blue-400"
        :title="cwd" @click="emit('click')"><FolderOpen v-if="cwd" :size="12" class="shrink-0" aria-hidden="true" /><span class="min-w-0 whitespace-pre-wrap break-words">{{ displayPath }}</span></button>
    </div>
    <div v-if="nativeUi?.status === 'live' && hasContent" ref="nativeSite" @focusin="reportFocusIn" @focusout="reportFocusOut" @compositionstart="composing = true" @compositionend="composing = false" @keydown="handleSiteKey" class="native-extension-surface max-h-56 min-h-0 min-w-0 overflow-y-auto text-[13px] leading-5 outline-none" tabindex="0" @focus="focusNativeUi" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave" :class="{ 'mt-2.5': statusLine }">
      <NativeUiNode :node="nativeUi.tree" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" />
    </div>
    <p v-else-if="nativeUi?.status === 'error'" class="text-neutral-500" :title="nativeUi.message" role="status">Claude controls unavailable</p>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, onBeforeUnmount, ref, watch } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import type { ClaudeUiMountState, ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
import type { ClaudeUiFocusEvent, ClaudeUiFocusReply } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeUiNode from './NativeUiNode.vue'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
import { createClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
const hover = createClaudeHoverSurface()
provide(claudeHoverSurface, hover)
onBeforeUnmount(() => hover.dispose())
const props = defineProps<{ statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState; nativeFocus?: ClaudeUiFocusReply }>()
const displayPath = computed(() => {
  if (!props.cwd || props.statusLine !== props.cwd) return props.statusLine
  const segments = props.cwd.split(/[\\/]/).filter(Boolean)
  return segments.length > 2 ? `…/${segments.at(-1)}` : props.statusLine
})
const emit = defineEmits<{ click: []; 'return-focus': []; press: [actionId: string, href?: string]; field: [event: ClaudeUiFieldEvent]; 'focus-report': [event: ClaudeUiFocusEvent] }>()
const nativeSite = ref<HTMLElement | null>(null)
let focusRevision = 0
let applyingFocus = false
let autoEntering = false
let held = false
const composing = ref(false)
function reportFocusIn(event: FocusEvent) {
  const site = nativeSite.value
  if (applyingFocus || !site || event.target !== document.activeElement) return
  held = true
  const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-native-focus-id]') : null
  emit('focus-report', { revision: ++focusRevision, isHeld: true, focusId: element?.dataset.nativeFocusId ?? null, by: autoEntering ? 'auto' : 'person' })
}
function reportFocusOut(event: FocusEvent) {
  if (nativeSite.value?.contains(event.relatedTarget as Node | null)) return
  if (!held) return
  held = false
  emit('focus-report', { revision: ++focusRevision, isHeld: false, by: 'person' })
}
watch(() => props.nativeFocus, reply => {
  const site = nativeSite.value
  if (!reply || reply.revision !== focusRevision || composing.value || !held || !site || !site.contains(document.activeElement) || !document.hasFocus()) return
  const target = reply.focusId === null ? site : [...site.querySelectorAll<HTMLElement>('[data-native-focus-id]')].find(element => element.dataset.nativeFocusId === reply.focusId)
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (element.hidden || element.hasAttribute('inert') || style.display === 'none' || style.visibility === 'hidden') return
    if (element === site) break
  }
  applyingFocus = true
  try {
    target.focus({ preventScroll: true })
    // Reveal the control in its own site without scrolling the surrounding conversation.
    if (target !== site) {
      const bounds = site.getBoundingClientRect(), control = target.getBoundingClientRect()
      if (control.top < bounds.top || control.height > bounds.height) site.scrollTop += control.top - bounds.top
      else if (control.bottom > bounds.bottom) site.scrollTop += control.bottom - bounds.bottom
    }
  } finally { applyingFocus = false }
})
watch(() => props.nativeUi?.status, status => {
  if (status !== 'live' && status !== 'rendering' && held) {
    held = false
    emit('focus-report', { revision: ++focusRevision, isHeld: false, by: 'person' })
  }
})
function handleStripKey(event: KeyboardEvent) {
  // Tab belongs to the native site's DOM focus order, not the composer's phase shortcut.
  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation()
}
function handleSiteKey(event: KeyboardEvent) { pressClaudeUiHotkey(event, nativeSite.value) }
function returnToComposer(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return
  event.preventDefault(); event.stopPropagation(); emit('return-focus')
}
defineExpose({ pressComposerHotkey: (event: KeyboardEvent) => pressClaudeUiHotkey(event, nativeSite.value, true) })
function focusNativeUi(event: FocusEvent) {
  if (applyingFocus) return
  // Native autofocus chooses the first field when the person enters this site, never on redraw.
  const site = event.currentTarget as HTMLElement
  autoEntering = true
  try { site.querySelector<HTMLElement>('[data-native-autofocus="true"]')?.focus() } finally { autoEntering = false }
}
function visible(node: ClaudeUiNode): boolean {
  if (node.kind === 'box' || node.kind === 'link') return node.children.some(visible)
  if (node.kind === 'text') return !!node.text.trim() || !!node.children?.some(visible)
  return node.kind !== 'unsupported' || node.component !== 'engine'
}
const hasContent = computed(() => props.nativeUi?.status === 'live' && visible(props.nativeUi.tree))
</script>
