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
import { findFormattingMenuPosition } from './internal/formatting-menu-position.ts'

const props = defineProps<{ editor: Editor; containWithinEditor?: boolean }>()

const linkInput = ref<InstanceType<typeof BubbleMenuLinkInput>>()

const menuKey = new PluginKey('textBubbleMenu')
const editorElement = props.editor.view.dom
const ownerDocument = editorElement.ownerDocument
const menuOptions = {
  placement: 'top' as const, offset: 8, strategy: 'fixed' as const, inline: true,
  // Chat status and controls surround the draft; keep formatting inside its visible scroll area.
  flip: props.containWithinEditor ? () => {
    const boundary: HTMLElement[] = [editorElement]
    for (let parent = editorElement.parentElement; parent && parent !== ownerDocument.body; parent = parent.parentElement) {
      const style = ownerDocument.defaultView!.getComputedStyle(parent)
      if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) boundary.push(parent)
    }
    return { boundary, padding: 4 }
  } : {},
  shift: { limiter: { fn: ({ x, y, rects }: { x: number; y: number; rects: { floating: { width: number; height: number } } }) => {
    // Resolve at positioning time: EditorContent attaches its DOM asynchronously.
    const form = editorElement.closest('form'), boundary = form?.getBoundingClientRect()
    if (!form || !boundary || boundary.width < rects.floating.width + 16) return { x, y }
    const clamped = { x: Math.max(boundary.left + 8, Math.min(x, boundary.right - rects.floating.width - 8)), y }
    if (!props.containWithinEditor) return clamped
    // Text, including status and keyboard hints, is an obstacle even when it has no control.
    const obstacles: DOMRect[] = [], walker = ownerDocument.createTreeWalker(form, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || !(node.parentElement instanceof HTMLElement) || ownerDocument.defaultView!.getComputedStyle(node.parentElement).visibility === 'hidden') continue
      const range = ownerDocument.createRange(); range.selectNodeContents(node)
      obstacles.push(...[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0))
      if (obstacles.length > 1024) return clamped
    }
    for (const control of form.querySelectorAll('button,input,textarea,select')) {
      const rect = control.getBoundingClientRect()
      if (rect.width && rect.height) obstacles.push(rect)
    }
    const viewport = { x: Math.max(0, boundary.x), y: Math.max(0, boundary.y), width: Math.min(ownerDocument.documentElement.clientWidth, boundary.right) - Math.max(0, boundary.x), height: Math.min(ownerDocument.documentElement.clientHeight, boundary.bottom) - Math.max(0, boundary.y) }
    return findFormattingMenuPosition(clamped, rects.floating, viewport, obstacles) ?? clamped
  } } },
}

// A private host preserves the menu's blur boundary while escaping editor scroll clipping.
const menuHost = ownerDocument.createElement('div')
let positionFrame: number | undefined
let composerObserver: MutationObserver | undefined
function requestPositionUpdate() {
  if (positionFrame !== undefined) return
  positionFrame = requestAnimationFrame(() => {
    positionFrame = undefined
    if (!props.editor.isDestroyed) props.editor.view.dispatch(props.editor.state.tr.setMeta(menuKey, 'updatePosition'))
  })
}

function onAncestorScroll(event: Event) {
  if (event.target instanceof Element && event.target.contains(editorElement)) requestPositionUpdate()
}

// Reading should not leave formatting controls covering the selected text.
// The menu's normal selection updates make it available again for the next edit.
function onReadingWheel(event: WheelEvent) {
  const target = event.target
  if (!(target instanceof Element) || props.editor.isDestroyed) return
  if (!editorElement.contains(target) && !target.contains(editorElement)) return
  props.editor.view.dispatch(props.editor.state.tr.setMeta(menuKey, 'hide'))
}

let rightClicked = false

function onContextMenu() { rightClicked = true }
function onMouseDown() { rightClicked = false }

onMounted(() => {
  ownerDocument.body.appendChild(menuHost)
  const form = props.containWithinEditor ? editorElement.closest('form') : null
  if (form) {
    composerObserver = new MutationObserver(requestPositionUpdate)
    composerObserver.observe(form, { childList: true, subtree: true, characterData: true })
  }
  ownerDocument.addEventListener('scroll', onAncestorScroll, true)
  ownerDocument.addEventListener('wheel', onReadingWheel, { capture: true, passive: true })
  const el = editorElement
  el.addEventListener('contextmenu', onContextMenu)
  el.addEventListener('mousedown', onMouseDown)
})

onBeforeUnmount(() => {
  composerObserver?.disconnect()
  ownerDocument.removeEventListener('scroll', onAncestorScroll, true)
  ownerDocument.removeEventListener('wheel', onReadingWheel, true)
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
