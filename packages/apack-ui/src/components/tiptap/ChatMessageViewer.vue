<template>
  <TiptapEditor v-if="unsupported" mode="viewer" variant="chat" :model-value="modelValue"
    :open-viewer-link="openViewerLink" @image-click="emit('imageClick', $event)" />
  <div v-else class="tiptap-wrapper tiptap-viewer tiptap-viewer-chat" @click="onClick">
    <p v-if="problem" role="status">The message could not be displayed.</p>
    <div v-show="!problem" ref="content" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { textEditorExtensionsRegistry, type TextEditorExtensionsBinding, type ReadOnlyTextRenderer } from '@apackdev/sdk/fe'
import { createLogger } from '@apackdev/sdk/logger'
import TiptapEditor from './TiptapEditor.vue'
import { createChatMarkdownParser } from './internal/chat-markdown.ts'
import { renderChat } from './internal/render-chat.ts'
import { createViewerClickHandler } from './composables/createEditorClickHandler.ts'

const props = defineProps<{ modelValue: string; openViewerLink?: (href: string) => void }>()
const emit = defineEmits<{ (event: 'imageClick', src: string): void }>()
const content = ref<HTMLElement>()
const groups = shallowRef<TextEditorExtensionsBinding[]>(textEditorExtensionsRegistry.getAll())
const unsupported = ref(false)
const problem = ref(false)
const parser = createChatMarkdownParser()
const logger = createLogger('chat-viewer')
let dispose: (() => void) | undefined
const stop = textEditorExtensionsRegistry.onChanged(() => { groups.value = textEditorExtensionsRegistry.getAll() })
watch(groups, values => { unsupported.value = values.some(group => group.binding.readOnly === undefined) }, { immediate: true, flush: 'sync' })
watch([() => props.modelValue, groups, content], () => {
  release()
  if (unsupported.value || !content.value) return
  try {
    const adapters = groups.value.flatMap(group => group.binding.readOnly ? [group.binding.readOnly as ReadOnlyTextRenderer] : [])
    const rendered = renderChat(parser, props.modelValue, adapters)
    rendered.root.className = 'ProseMirror'
    rendered.root.contentEditable = 'false'
    rendered.root.style.whiteSpace = 'normal'
    content.value.replaceChildren(rendered.root)
    dispose = rendered.dispose
    problem.value = false
  } catch (error) { problem.value = true; logger.error('Read-only message rendering failed', { error }) }
}, { flush: 'post', immediate: true })
function onClick(event: MouseEvent) {
  createViewerClickHandler({ imageClick: src => emit('imageClick', src), openLink: props.openViewerLink })(undefined, event)
}
function release() {
  try { dispose?.() } catch (error) { logger.error('Read-only message cleanup failed', { error }) }
  dispose = undefined
}
onBeforeUnmount(() => { stop(); release() })
</script>

<style>
@import './tiptap-theme.css';
</style>
