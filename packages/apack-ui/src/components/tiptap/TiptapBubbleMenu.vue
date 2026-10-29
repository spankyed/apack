<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    :options="menuOptions"
    :plugin-key="menuKey"
    :append-to="menuHost"
    :should-show="shouldShow"
    class="bubble-menu flex flex-col bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg"
  >
    <div class="flex items-center">
      <BubbleMenuNodeSelector v-if="hasHeadings" :editor="editor" />
      <div v-if="hasHeadings" class="w-px self-stretch bg-neutral-700" />
      <BubbleMenuToolbar :editor="editor" @toggle-link="linkInput?.show()" />
      <template v-if="hasColors">
        <div class="w-px self-stretch bg-neutral-700" />
        <BubbleMenuColorSelector :editor="editor" />
      </template>
    </div>
    <BubbleMenuLinkInput ref="linkInput" :editor="editor" />
  </BubbleMenu>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import type { Editor } from '@tiptap/vue-3'
import { PluginKey } from '@tiptap/pm/state'
import BubbleMenuNodeSelector from './bubble-menu/BubbleMenuNodeSelector.vue'
import BubbleMenuToolbar from './bubble-menu/BubbleMenuToolbar.vue'
import BubbleMenuColorSelector from './bubble-menu/BubbleMenuColorSelector.vue'
import BubbleMenuLinkInput from './bubble-menu/BubbleMenuLinkInput.vue'

const props = defineProps<{ editor: Editor }>()

const linkInput = ref<InstanceType<typeof BubbleMenuLinkInput>>()

const menuKey = new PluginKey('textBubbleMenu')
const editorElement = props.editor.view.dom
const ownerDocument = editorElement.ownerDocument
const menuOptions = {
  placement: 'top' as const, offset: 8, strategy: 'fixed' as const, inline: true,
  shift: { limiter: { fn: ({ x, y, rects }: { x: number; y: number; rects: { floating: { width: number } } }) => {
    // Resolve at positioning time: EditorContent attaches its DOM asynchronously.
    const boundary = editorElement.closest('form')?.getBoundingClientRect()
    if (!boundary || boundary.width < rects.floating.width + 16) return { x, y }
    return { x: Math.max(boundary.left + 8, Math.min(x, boundary.right - rects.floating.width - 8)), y }
  } } },
}

// A private host preserves the menu's blur boundary while escaping editor scroll clipping.
const menuHost = ownerDocument.createElement('div')
let positionFrame: number | undefined
function onAncestorScroll(event: Event) {
  if (!(event.target instanceof Element) || !event.target.contains(editorElement) || positionFrame !== undefined) return
  positionFrame = requestAnimationFrame(() => {
    positionFrame = undefined
    if (!props.editor.isDestroyed) props.editor.view.dispatch(props.editor.state.tr.setMeta(menuKey, 'updatePosition'))
  })
}

let rightClicked = false

function onContextMenu() { rightClicked = true }
function onMouseDown() { rightClicked = false }

onMounted(() => {
  ownerDocument.body.appendChild(menuHost)
  ownerDocument.addEventListener('scroll', onAncestorScroll, true)
  const el = editorElement
  el.addEventListener('contextmenu', onContextMenu)
  el.addEventListener('mousedown', onMouseDown)
})

onBeforeUnmount(() => {
  ownerDocument.removeEventListener('scroll', onAncestorScroll, true)
  if (positionFrame !== undefined) cancelAnimationFrame(positionFrame)
  menuHost.remove()
  const el = editorElement
  el.removeEventListener('contextmenu', onContextMenu)
  el.removeEventListener('mousedown', onMouseDown)
})

const atomicNodes = ['image', 'subDocumentLink', 'reference']

const hasHeadings = computed(() => {
  return props.editor.extensionManager.extensions.some(ext => ext.name === 'heading')
})

const hasColors = computed(() => {
  return props.editor.extensionManager.extensions.some(ext => ext.name === 'color')
})

function shouldShow(props: Record<string, any>) {
  if (rightClicked) return false
  if (!props.view.hasFocus() && !menuHost.contains(ownerDocument.activeElement)) return false
  if (props.state.selection.empty) return false
  if (props.editor.isEmpty) return false
  return !atomicNodes.some(node => props.editor.isActive(node))
}
</script>
