<template>
  <UnifiedMonacoEditor
    ref="unifiedEditorRef"
    :modelValue="modelValue"
    :filePath="filePath"
    :language="language"
    :readOnly="readOnly"
    :theme="theme || 'vs-dark'"
    :mode="diffMode ? 'diff' : 'multi-file'"
    :diffOriginal="originalContent"
    :diffModified="modifiedContent"
    :actions="['insertConsoleLog']"
    :diffOptions="{ wordWrap: 'off' }"
    :dslParams="dslParams"
    preset="auto"
    preserveViewState
    @update:modelValue="$emit('update:modelValue', $event)"
    @change="$emit('change', $event)"
    @mount="onMount"
    @fileReady="$emit('fileReady')"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import UnifiedMonacoEditor from '@apackdev/ui/components/UnifiedMonacoEditor'
import type { editor } from 'monaco-editor'

const props = defineProps<{
  modelValue: string
  filePath?: string
  language?: string
  readOnly?: boolean
  theme?: string
  diffMode?: boolean
  originalContent?: string
  modifiedContent?: string
  dslParams?: Record<string, { type: string }>
  /** Who last changed each line, drawn before it: by line from 1 */
  blame?: { line: number; label: string; title: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'change': [value: string]
  'mount': [editor: editor.IStandaloneCodeEditor]
  'fileReady': []
}>()

const unifiedEditorRef = ref<InstanceType<typeof UnifiedMonacoEditor>>()

/** The blame labels drawn in the editor, replaced whenever what blame says or the editor changes */
let blameDrawn: editor.IEditorDecorationsCollection | undefined
const drawBlame = () => {
  const shown = unifiedEditorRef.value?.getEditor() as editor.IStandaloneCodeEditor | undefined
  blameDrawn?.clear()
  if (!shown || !props.blame?.length || props.diffMode) return
  blameDrawn = shown.createDecorationsCollection(props.blame.map(({ line, label, title }) => ({
    range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
    options: { before: { content: label, inlineClassName: 'blame-label' }, hoverMessage: { value: title } },
  })))
}
watch(() => [props.blame, props.diffMode, props.filePath], drawBlame)
const onMount = (mounted: editor.IStandaloneCodeEditor) => {
  emit('mount', mounted)
  drawBlame()
}

// Expose methods for external use
defineExpose({
  getEditor: () => unifiedEditorRef.value?.getEditor(),
  switchToFile: (filePath: string, content: string) => unifiedEditorRef.value?.switchToFile(filePath, content),
  getValue: () => unifiedEditorRef.value?.getValue(),
  setValue: (value: string) => unifiedEditorRef.value?.setValue(value)
})
</script>

<style>
/* A blame label before each line: who and when, dim, never part of what is edited */
.blame-label {
  color: rgb(115 115 115);
  font-style: italic;
  margin-right: 1.5em;
}
</style>
