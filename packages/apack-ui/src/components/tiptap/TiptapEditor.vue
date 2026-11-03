<template>
  <div
    class="tiptap-wrapper"
    :class="[`tiptap-${mode}`, `tiptap-${mode}-${variant}`, $attrs.class]"
    @mousedown="onWrapperMouseDown"
    @click="onWrapperClick"
  >
    <template v-if="editor">
      <template v-if="cfg.blockMenu && showGutter">
        <TiptapBlockMenu :editor="editor" />
        <TiptapImageBubbleMenu :editor="editor" @view-image="(src: string) => emit('imageClick', src)" />
      </template>
      <TiptapBubbleMenu v-if="cfg.textBubbleMenu" :editor="editor" />
    </template>
    <p v-if="problem" role="status">{{ problem }}</p>
    <editor-content v-else :editor="editor" :class="editorClass" />
    <template v-if="editor">
      <CommandSuggestionPopup v-if="cfg.commandSuggestion" :editor="editor" :variant="variant" />
      <ContributedEditorPopups :editor="editor" :groups="groups" :generation="generation" :variant="variant" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { Selection } from '@tiptap/pm/state'
import { createExtensions, type TiptapMode, type TiptapVariant } from './extensions.ts'
import { getEditorConfig } from './editor-config.ts'
import { useContributedEditor } from './internal/use-contributed-editor.ts'
import ContributedEditorPopups from './internal/ContributedEditorPopups.vue'
import TiptapBlockMenu from './TiptapBlockMenu.vue'
import CommandSuggestionPopup from './CommandSuggestionPopup.vue'
import { commandSuggestionKey } from './extensions/command-suggestion.ts'
import TiptapBubbleMenu from './TiptapBubbleMenu.vue'
import TiptapImageBubbleMenu from './TiptapImageBubbleMenu.vue'
import { createImageHandlers } from './composables/createImageHandlers.ts'
import { createEditorClickHandler, createViewerClickHandler } from './composables/createEditorClickHandler.ts'
import { useSubDocumentTracking } from './composables/useSubDocumentTracking.ts'
import { createKeyboardHandler } from './composables/createEditorKeyboard.ts'

const props = withDefaults(defineProps<{
  mode: TiptapMode
  variant?: TiptapVariant
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  editorClass?: string
  entityId?: string
  disableImages?: boolean
  showGutter?: boolean
  inHistoryMode?: boolean
  pauseAvailable?: boolean
  /** Override navigation for links in the Markdown viewer. */
  openViewerLink?: (href: string) => void
}>(), {
  variant: 'full',
  modelValue: '',
  placeholder: '',
  disabled: false,
  editorClass: '',
  entityId: undefined,
  disableImages: false,
  showGutter: false,
  inHistoryMode: false,
  pauseAvailable: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'submit'): void
  (e: 'noteLinkClick', noteId: string): void
  (e: 'subDocumentLinkDeleted', noteId: string): void
  (e: 'subDocumentLinkRestored', noteId: string): void
  (e: 'focusTitle'): void
  (e: 'history-prev'): void
  (e: 'history-next'): void
  (e: 'clearInput'): void
  (e: 'pause'): void
  (e: 'open-revert-menu'): void
  (e: 'imageClick', src: string): void
}>()

defineOptions({ inheritAttrs: false })

const cfg = getEditorConfig(props.mode, props.variant)

// `click` fires on the lowest common ancestor of the mousedown and mouseup
// targets. Pressing inside the editor content and releasing on a sibling
// like the block-menu `+` or drag handle would otherwise fire this handler
// on the wrapper and scroll to the bottom. Only honor clicks whose gesture
// both started and ended on the wrapper itself.
let wrapperPressed = false
function onWrapperMouseDown(event: MouseEvent) {
  wrapperPressed = event.target === event.currentTarget
}
function onWrapperClick(event: MouseEvent) {
  const pressed = wrapperPressed
  wrapperPressed = false
  if (!pressed || event.target !== event.currentTarget) return
  if (!cfg.editable || !editor.value) return
  editor.value.chain().focus('end').run()
}

const { suppressNodeDeletionEvents, onTransaction: subDocOnTransaction } = useSubDocumentTracking({
  subDocumentLinkDeleted: (id) => emit('subDocumentLinkDeleted', id),
  subDocumentLinkRestored: (id) => emit('subDocumentLinkRestored', id),
})

const lastResetMarkdown = ref<string | null>(null)
// Track values we've emitted to recognize echoes from parent (debounced round-trip)
const emittedValues = new Set<string>()

function getMarkdown(): string {
  return (editor.value!.storage as any).markdown.getMarkdown()
}

function selectStart(e: { state: import('@tiptap/pm/state').EditorState, view: import('@tiptap/pm/view').EditorView }) {
  const { tr } = e.state
  tr.setSelection(Selection.atStart(e.state.doc))
  e.view.dispatch(tr)
}

// Set content without recording in undo history so note switches can't be undone.
//
// Do NOT call `markdown.parser.parse(content)` here and pass the HTML result
// to setContent. The tiptap-markdown Markdown extension already overrides
// `setContent` to call `parser.parse` internally
// (see node_modules/tiptap-markdown/src/Markdown.js:22-39). A manual pre-parse
// produces an HTML string, which the override then parses as markdown a
// second time — and with `markdownHtml: false` on the chat viewer, markdown-it
// escapes HTML tags into literal text, so the user sees raw `<p>`, `<code>`,
// `<h2>` characters in their streaming bubble. Pass the markdown string
// straight through and let the override handle the single parse.
function resetContent(content: string, resetSelection = false) {
  if (!editor.value) { resetDocument(); return }
  suppressNodeDeletionEvents.value = true
  editor.value.chain().setMeta('addToHistory', false).setContent(content).run()
  if (resetSelection) selectStart(editor.value)
  lastResetMarkdown.value = getMarkdown()
  suppressNodeDeletionEvents.value = false
}

// Build editorProps from composables
const imageHandlers = cfg.editorInteractions
  ? createImageHandlers(() => editor.value, () => props.entityId, () => props.disableImages || !props.entityId)
  : {}

const clickHandler = cfg.editorInteractions
  ? { handleClick: createEditorClickHandler({ noteLinkClick: (id) => emit('noteLinkClick', id), imageClick: (src) => emit('imageClick', src) }) }
  : cfg.viewerImageClick
    ? { handleDOMEvents: { click: createViewerClickHandler({ imageClick: (src) => emit('imageClick', src), openLink: props.openViewerLink }) } }
    : {}

const handleKeyDown = createKeyboardHandler({
  cfg,
  getEditor: () => editor.value,
  getInHistoryMode: () => props.inHistoryMode,
  getPauseAvailable: () => props.pauseAvailable,
  // A suggestion holds Escape, whoever owns it: the editor's own built-ins answer for their keys, and each
  // contributed group answers for its own through the predicate it declares. Without the first half Escape
  // reaches the chat's handler while the command popup is open, and pauses the turn instead of closing it.
  isSuggestionActive: view => commandSuggestionKey.getState(view.state)?.active === true
    || groups.value.some(group => group.binding.isSuggestionActive?.(view.state)),
  emit: {
    submit: () => emit('submit'),
    focusTitle: () => emit('focusTitle'),
    historyPrev: () => emit('history-prev'),
    historyNext: () => emit('history-next'),
    clearInput: () => emit('clearInput'),
    pause: () => emit('pause'),
    openRevertMenu: () => emit('open-revert-menu'),
  },
})

const { editor, groups, generation, problem, resetDocument } = useContributedEditor(bindings => ({
  extensions: createExtensions({
    mode: props.mode,
    variant: props.variant,
    placeholder: props.placeholder,
    injectedExtensions: bindings.flatMap(group => Object.values(group.binding.extensions ?? {})),
  }),
  content: props.modelValue,
  editable: cfg.editable && !props.disabled,
  editorProps: {
    handleKeyDown,
    ...clickHandler,
    ...imageHandlers,
  },
  onCreate: ({ editor: e }) => {
    selectStart(e)
  },
  onUpdate: () => {
    if (suppressNodeDeletionEvents.value) return
    const md = getMarkdown()
    if (lastResetMarkdown.value !== null && md === lastResetMarkdown.value) return
    lastResetMarkdown.value = null
    emittedValues.add(md)
    emit('update:modelValue', md)
  },
  ...(cfg.subDocumentTracking && { onTransaction: subDocOnTransaction }),
}))

// Sync modelValue changes from parent into the editor.
// In viewer mode the editor is read-only — skip the getMarkdown() round-trip
// comparison which can silently skip legitimate updates when the serializer
// normalizes whitespace differently from the source markdown.
watch(() => props.modelValue, (newVal) => {
  if (emittedValues.delete(newVal)) return
  if (!editor.value) { resetDocument(); return }
  if (!cfg.editable) { resetContent(newVal); return }
  if (newVal !== getMarkdown()) resetContent(newVal)
})

// Force-reset editor content on entity switch to prevent stale content display
watch(() => props.entityId, () => {
  emittedValues.clear()
  resetContent(props.modelValue, true)
})

watch(() => props.disabled, (disabled) => {
  if (editor.value) editor.value.setEditable(!disabled && cfg.editable)
})

defineExpose({ editor })
</script>

<style>
@import "./tiptap-theme.css";
</style>
