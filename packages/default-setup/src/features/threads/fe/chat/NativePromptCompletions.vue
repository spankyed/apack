<template>
  <Teleport to="body">
  <div v-if="visible" ref="root" role="group" aria-label="Claude suggestions" class="z-50 overflow-y-auto rounded-lg border border-white/10 bg-neutral-900 shadow-xl" :style="floatingStyles" @keydown="navigate">
    <button v-for="(row, index) in rows" :key="row.offerId + ':' + index" type="button" class="block w-full px-4 py-2 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline focus-visible:outline-blue-400" @mousedown.prevent @click="emit('select', index, row.offerId)">
      <span class="break-words">{{ row.label ?? row.text }}</span>
      <span v-if="row.description" class="mt-0.5 block break-words text-xs text-neutral-400">{{ row.description }}</span>
    </button>
  </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue'
import type { Editor } from '@tiptap/core'
import { commandSuggestionKey } from '@apackdev/ui/components/tiptap/extensions/command-suggestion'
import { referenceSuggestionKey } from '#extensions/tiptap/reference-suggestion.ts'
import type { ClaudePromptCompletionRow } from '#generated/types.ts'
const props = defineProps<{ editor?: Editor; rows: (ClaudePromptCompletionRow & { offerId: string })[]; disabled?: boolean }>()
const emit = defineEmits<{ select: [index: number, offerId: string]; dismiss: [] }>()
const root = ref<HTMLElement>(), hostPopup = ref(false)
const visible = computed(() => !props.disabled && !hostPopup.value && props.rows.length > 0)
const anchor = computed(() => props.editor && !props.editor.isDestroyed ? props.editor.view.dom : undefined)
const { floatingStyles } = useFloating(anchor, root, {
  open: visible,
  strategy: 'fixed',
  placement: 'top-start',
  whileElementsMounted: autoUpdate,
  middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply({ availableWidth, availableHeight, rects, elements }) {
    Object.assign(elements.floating.style, { width: `${Math.max(0, Math.min(rects.reference.width, availableWidth))}px`, maxHeight: `${Math.max(0, Math.min(160, availableHeight))}px` })
  } })],
})
function navigate(event: KeyboardEvent) {
  const editor = props.editor
  if (!visible.value || !editor || editor.isDestroyed || event.defaultPrevented || event.isComposing || editor.view.composing) return
  const fromEditor = editor.view.dom.contains(event.target as Node)
  // A portalled row returns Tab to the editor's normal document order.
  if (!fromEditor && event.key === 'Tab') { event.stopPropagation(); emit('dismiss'); editor.view.focus(); return }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); emit('dismiss'); editor.view.focus(); return
  }
  if (!(fromEditor ? ['ArrowUp', 'ArrowDown'] : ['ArrowUp', 'ArrowDown', 'Home', 'End']).includes(event.key)) return
  const buttons = Array.from(root.value?.querySelectorAll('button') ?? [])
  if (!buttons.length) return
  const current = buttons.indexOf(editor.view.dom.ownerDocument.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : current < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  event.preventDefault(); event.stopImmediatePropagation(); buttons[next]!.focus(); buttons[next]!.scrollIntoView({ block: 'nearest' })
}
watch(() => props.editor, (editor, _prior, cleanup) => {
  if (!editor || editor.isDestroyed) { hostPopup.value = false; return }
  const update = () => { const command = commandSuggestionKey.getState(editor.state); hostPopup.value = !!(command?.active && !command.selectedCommand) || referenceSuggestionKey.getState(editor.state)?.active === true }
  const dom = editor.view.dom
  update(); editor.on('transaction', update); dom.addEventListener('keydown', navigate, true)
  cleanup(() => { editor.off('transaction', update); dom.removeEventListener('keydown', navigate, true) })
}, { immediate: true, flush: 'post' })
watch([() => props.rows[0]?.offerId, () => props.editor], ([, editor], [, previousEditor]) => {
  if (!props.disabled && !hostPopup.value && editor && editor === previousEditor && !editor.isDestroyed && root.value?.contains(editor.view.dom.ownerDocument.activeElement) && !editor.view.dom.ownerDocument.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) editor.view.focus()
}, { flush: 'pre' })
</script>
