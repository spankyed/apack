<template>
  <TiptapEditor v-if="unsupported" mode="viewer" variant="chat" :model-value="modelValue"
    :open-viewer-link="openViewerLink" @image-click="emit('imageClick', $event)" />
  <div v-else class="tiptap-wrapper tiptap-viewer tiptap-viewer-chat" @click="onClick" @copy="onCopy">
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
import { copyChatSelection } from './internal/chat-copy.ts'
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
const stop = textEditorExtensionsRegistry.onChanged(() => {
  const next = textEditorExtensionsRegistry.getAll()
  const effective = (values: TextEditorExtensionsBinding[]) => values.filter(group => group.binding.readOnly !== false)
  const before = effective(groups.value)
  const after = effective(next)
  const unchanged = before.length === after.length && before.every((group, index) => {
    const other = after[index]!
    const left = group.binding.readOnly
    const right = other.binding.readOnly
    return group.packId === other.packId && group.groupId === other.groupId && (left === right
      || (left && right && left.decorate === right.decorate && left.transformMarkdown === right.transformMarkdown))
  })
  if (!unchanged) groups.value = next
})
watch(groups, values => { unsupported.value = values.some(group => group.binding.readOnly === undefined) }, { immediate: true, flush: 'sync' })
watch([() => props.modelValue, groups, content], () => {
  release()
  if (unsupported.value || !content.value) return
  try {
    const adapters: ReadOnlyTextRenderer[] = groups.value.flatMap(group => group.binding.readOnly ? [group.binding.readOnly] : [])
    const rendered = renderChat(parser, props.modelValue, adapters)
    content.value.replaceChildren(rendered.root)
    dispose = rendered.dispose
    problem.value = false
  } catch (error) {
    content.value?.replaceChildren()
    problem.value = true
    logger.error('Read-only message rendering failed', { error })
  }
}, { flush: 'post', immediate: true })
function onCopy(event: ClipboardEvent) {
  const root = content.value?.firstElementChild
  if (root instanceof HTMLElement) copyChatSelection(event, root, textEditorExtensionsRegistry.getAll())
}
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
