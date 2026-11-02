<template>
  <p v-if="problem || contentProblem" role="status">{{ problem || contentProblem }}</p>
  <EditorContent v-show="!problem && !contentProblem" :editor="editor" class="conversation-viewer" />
  <ContributedEditorPopups v-if="editor && !contentProblem" :editor="editor" :groups="groups"
    :generation="generation" variant="chat" />
</template>

<script setup lang="ts">
import { defineComponent, h, nextTick, onMounted, shallowRef, watch, type Component } from 'vue'
import { Node, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import { EditorContent, NodeViewContent, NodeViewWrapper, VueNodeViewRenderer, nodeViewProps } from '@tiptap/vue-3'
import { createLogger } from '@apackdev/sdk/logger'
import { createExtensions, conversationMessageNodeName } from './extensions.ts'
import { createViewerClickHandler } from './composables/createEditorClickHandler.ts'
import { useContributedEditor } from './internal/use-contributed-editor.ts'
import ContributedEditorPopups from './internal/ContributedEditorPopups.vue'
import { createConversationDocument, type ConversationMessage } from './internal/conversation-document.ts'

const props = defineProps<{
  messages: readonly ConversationMessage[]
  openViewerLink?: (href: string) => void
}>()
const slots = defineSlots<{ default(props: { id: string; content: Component }): unknown }>()
const emit = defineEmits<{
  (event: 'imageClick', src: string): void
  (event: 'rendered'): void
}>()
const contentProblem = shallowRef<string>()
const logger = createLogger('conversation-viewer')
let mountedEditor: Editor | undefined
let renderRevision = 0

const MessageContent = defineComponent({
  setup: () => () => h('div', { class: 'tiptap-wrapper tiptap-viewer tiptap-viewer-chat' }, [
    h(NodeViewContent, { class: 'tiptap-body' }),
  ]),
})
const MessageView = defineComponent({
  props: nodeViewProps,
  setup(nodeProps) {
    onMounted(() => { mountedEditor = nodeProps.editor; void notifyRendered() })
    return () => h(NodeViewWrapper, { class: 'conversation-message' }, {
      default: () => slots.default({ id: nodeProps.node.attrs.id, content: MessageContent }),
    })
  },
})

const Message = Node.create({
  name: conversationMessageNodeName,
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-conversation-message]' }],
  renderHTML: ({ node }) => ['div', { 'data-conversation-message': node.attrs.id }, 0],
  addNodeView: () => VueNodeViewRenderer(MessageView, {
    update({ oldNode, newNode, updateProps }) {
      if (oldNode.attrs.id !== newNode.attrs.id) return false
      updateProps()
      return true
    },
  }),
  addStorage: () => ({ markdown: {
    serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
      state.renderContent(node)
      state.closeBlock(node)
    },
  } }),
})

const { editor, groups, generation, problem } = useContributedEditor(groups => ({
  editable: false,
  content: '',
  extensions: [
    ...createExtensions({ mode: 'viewer', variant: 'chat',
      injectedExtensions: groups.flatMap(group => Object.values(group.binding.extensions ?? {})) }),
    Message,
  ],
  editorProps: { handleDOMEvents: { click: createViewerClickHandler({
    imageClick: src => emit('imageClick', src), openLink: props.openViewerLink,
  }) } },
}))

async function notifyRendered() {
  const attempt = ++renderRevision
  const current = editor.value
  await nextTick()
  if (attempt === renderRevision && current && current === editor.value
    && current.view.dom.isConnected && !contentProblem.value) emit('rendered')
}

watch(editor, (value, _previous, onCleanup) => {
  if (!value) return
  const update = createConversationDocument(value, Message.name)
  const stop = watch(() => props.messages.map(({ id, text }) => ({ id, text })), messages => {
    try {
      update(messages)
      contentProblem.value = undefined
      if (mountedEditor === value) void notifyRendered()
    }
    catch (error) {
      contentProblem.value = 'The conversation could not be displayed.'
      logger.error('Conversation content failed', { error })
    }
  }, { immediate: true, flush: 'post' })
  onCleanup(() => { renderRevision++; mountedEditor = undefined; stop() })
})
</script>

<style>
@import './tiptap-theme.css';

/* Paragraph spacing belongs to message bodies, not the conversation's structural nodes. */
.conversation-viewer > .ProseMirror > .conversation-message { margin: 0; }
.conversation-viewer > .ProseMirror { outline: none; display: flex; flex-direction: column; gap: 0.25rem; }
</style>
