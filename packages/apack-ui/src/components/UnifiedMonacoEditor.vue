<script lang="ts">
// The filter lives in its own module so the app can install it before its own error listener, which it
// must: see monaco-error-filters.ts. Calling it here too covers a host that never did.
import { installMonacoErrorFilters } from './monaco-error-filters.ts'
</script>

<template>
  <p v-if="monacoProblem" role="status">The editor could not be loaded: {{ monacoProblem }}</p>
  <div v-else-if="monacoRuntime" class="w-full h-full unified-monaco-editor">
    <!-- Diff Editor Mode -->
    <VueMonacoDiffEditor
      v-if="mode === 'diff'"
      :key="filePath"
      :theme="theme"
      :original="diffOriginal || ''"
      :modified="diffModified || modelValue"
      :language="resolvedLanguage"
      :options="{ ignoreTrimWhitespace: false, ...resolvedOptions, ...diffOptions }"
      @mount="handleDiffMount"
      class="h-full"
    />
    
    <!-- Standard Editor Mode -->
    <VueMonacoEditor
      v-else
      :theme="theme"
      :value="currentValue"
      :language="resolvedLanguage"
      :options="resolvedOptions"
      @mount="handleMount"
      @update:value="handleUpdate"
      class="h-full"
    />
  </div>
</template>

<script setup lang="ts">
import { useDslDeclarations } from '@apackdev/sdk/fe'
import { computed, ref, watch, shallowRef, onBeforeUnmount, onUnmounted } from 'vue'
import { VueMonacoEditor, VueMonacoDiffEditor } from '@guolao/vue-monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import {
  editorPresets,
  getLanguageFromPath,
  getDslTypeFromPath,
  getEditorPresetForFile,
  useMonacoRuntime,
  initializeMonaco,
  setupMonacoForFile,
  createEditorActions,
  updateDslParamsType,
  clearDslParamsType,
  type InitializeMonacoOptions,
  type EditorAction
} from './monaco-config.ts'

// Props interface
export interface UnifiedMonacoEditorProps {
  // Core props
  modelValue: string
  language?: string
  theme?: string
  
  // Mode control
  mode?: 'simple' | 'multi-file' | 'diff'
  
  // File-specific props
  filePath?: string
  
  // DSL control
  dslType?: 'database' | 'action' | 'prompt'
  functionBody?: boolean
  
  // Editor options
  preset?: 'default' | 'readonly' | 'minimal' | 'dsl' | 'codeEditor' | 'auto'
  readOnly?: boolean
  placeholder?: string
  options?: editor.IStandaloneEditorConstructionOptions
  
  // Diff mode props
  diffOriginal?: string
  diffModified?: string
  diffOptions?: Record<string, any>
  
  // Dynamic DSL params for autocomplete
  dslParams?: Record<string, { type: string }>

  // Features
  actions?: EditorAction[]
  executeKeybinding?: { key: string; modifiers: string[] }
  
  // Multi-file mode
  preserveViewState?: boolean
}

const { monaco: monacoRuntime, problem: monacoProblem } = useMonacoRuntime()

const props = withDefaults(defineProps<UnifiedMonacoEditorProps>(), {
  theme: 'vs-dark',
  mode: 'simple',
  preset: 'auto',
  readOnly: false,
  functionBody: false,
  preserveViewState: true
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'change': [value: string]
  'execute': []
  'mount': [editor: editor.IStandaloneCodeEditor]
  'cursorChange': [position: { line: number; col: number }]
  'fileReady': []
}>()

installMonacoErrorFilters()

// State
const editorInstance = shallowRef<editor.IStandaloneCodeEditor>()
const diffEditorInstance = shallowRef<editor.IStandaloneDiffEditor>()
const currentValue = ref(props.modelValue)
const models = new Map<string, editor.ITextModel>()
const viewStates = new Map<string, editor.ICodeEditorViewState | null>()
let pendingScrollLine: number | null = null
let diffUpdateDisposable: { dispose: () => void } | null = null
// Per-editor-instance disposables. Captures every IDisposable returned by
// monaco listener-attach calls (cursor/content/action/etc). Cleared on mode
// change (which destroys the underlying editor) and on component unmount.
// Without this, listeners pile up on Monaco's global emitters and trip the
// internal listener-leak tracker after ~250 accumulated subscribers.
let editorDisposables: IDisposable[] = []

const disposeEditorDisposables = () => {
  for (const d of editorDisposables) {
    try { d.dispose() } catch { /* ignore */ }
  }
  editorDisposables = []
}

let releaseDslLibraries = () => {}
const dslDeclarations = useDslDeclarations()
const configureFile = (filePath = props.filePath || '') => {
  releaseDslLibraries(); releaseDslLibraries = () => {}
  const monaco = monacoRuntime.value
  if (!monaco || !editorInstance.value) return
  const dslType = props.dslType ?? getDslTypeFromPath(filePath) ?? undefined
  const isDsl = props.functionBody || dslType !== undefined
  releaseDslLibraries = setupMonacoForFile(monaco, { filePath, dslType,
    language: props.language || (props.dslType ? 'typescript' : getLanguageFromPath(filePath)), isDsl,
    enableTypeChecking: isDsl, enableSuggestions: isDsl })
}

// Computed properties
const resolvedLanguage = computed(() => {
  if (props.language) return props.language
  if (props.dslType) return 'typescript'
  if (props.filePath) { dslDeclarations.value; return getLanguageFromPath(props.filePath) }
  return 'typescript'
})

const resolvedDslType = computed(() => {
  if (props.dslType) return props.dslType
  if (props.filePath) { dslDeclarations.value; return getDslTypeFromPath(props.filePath) }
  return null
})

const isDslMode = computed(() => {
  return props.functionBody || resolvedDslType.value !== null
})

const resolvedPreset = computed(() => {
  if (props.preset === 'auto') {
    if (props.readOnly) return 'readonly'
    if (isDslMode.value) return 'dsl'
    if (props.filePath) return getEditorPresetForFile(props.filePath, props.readOnly)
    return 'default'
  }
  return props.preset
})

const resolvedOptions = computed<editor.IStandaloneEditorConstructionOptions>(() => {
  const presetOptions = editorPresets[resolvedPreset.value]
  
  return {
    ...presetOptions,
    ...props.options,
    readOnly: props.readOnly,
    theme: props.theme
  }
})

// Methods for multi-file mode
const switchToFile = (filePath: string, content: string) => {
  if (!editorInstance.value || props.mode !== 'multi-file') return
  
  const monaco = monacoRuntime.value
  if (!monaco) return
  
  configureFile(filePath)

  // Save current view state
  const currentModel = editorInstance.value.getModel()
  if (currentModel && !currentModel.isDisposed() && props.preserveViewState) {
    const uri = currentModel.uri.toString()
    viewStates.set(uri, editorInstance.value.saveViewState())
  }
  
  // Get or create model for the file
  let model = models.get(filePath)
  // Model may have been disposed by the library on component unmount
  if (model && model.isDisposed()) {
    models.delete(filePath)
    model = undefined
  }
  if (!model) {
    const uri = monaco.Uri.file(filePath)
    // Check Monaco's global registry first — a model with this URI may still exist
    // from a previous component instance that didn't fully clean up
    model = monaco.editor.getModel(uri) ?? undefined
    if (model) {
      if (model.getValue() !== content) {
        model.setValue(content)
      }
    } else {
      model = monaco.editor.createModel(content, resolvedLanguage.value, uri)
    }
    if (!model) return
    models.set(filePath, model)
    
    // Listen for changes (track disposable so it's cleaned up with the editor)
    editorDisposables.push(model.onDidChangeContent(() => {
      const value = model!.getValue()
      currentValue.value = value
      emit('update:modelValue', value)
      emit('change', value)
    }))
  } else if (model.getValue() !== content) {
    model.setValue(content)
  }
  
  // Switch to the model (skip if already active to avoid canceling pending operations)
  if (editorInstance.value.getModel() !== model) {
    editorInstance.value.setModel(model)
  }
  
  // Restore view state (skip when transitioning from diff — pendingScrollLine takes priority)
  if (props.preserveViewState && model && pendingScrollLine === null) {
    const uri = model.uri.toString()
    const savedState = viewStates.get(uri)
    if (savedState) {
      try {
        editorInstance.value.restoreViewState(savedState)
      } catch {
        viewStates.delete(uri)
      }
    }
  }

  // Apply scroll position carried over from diff editor
  if (pendingScrollLine !== null) {
    editorInstance.value.revealLineInCenter(pendingScrollLine)
    pendingScrollLine = null
  }

  currentValue.value = content
  emit('fileReady')
}

// Event handlers
const handleUpdate = (value: string | undefined) => {
  const newValue = value || ''
  currentValue.value = newValue
  emit('update:modelValue', newValue)
  emit('change', newValue)
}

const handleMount = (editor: editor.IStandaloneCodeEditor) => {
  editorInstance.value = editor
  const monaco = monacoRuntime.value
  
  if (!monaco) return
  
  // Initialize Monaco with appropriate settings
  const initOptions: InitializeMonacoOptions = {
    enableTypeChecking: isDslMode.value,
    enableSuggestions: isDslMode.value,
    setupLanguages: true
  }
  initializeMonaco(monaco, initOptions)
  
  configureFile()

  // Add editor actions if requested
  if (props.actions && props.actions.length > 0) {
    const actions = createEditorActions(monaco, props.actions, {
      onExecute: () => emit('execute')
    }, {
      executeKeybinding: props.executeKeybinding
    })
    actions.forEach(action => editorDisposables.push(editor.addAction(action)))
  }

  // Suppress VS Code-only "findInFiles" keybinding that crashes standalone Monaco.
  // Re-dispatch on window so the global hotkey system picks it up
  // (routes to the code surface's search panel via focusSearch).
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F', code: 'KeyF', shiftKey: true,
      ctrlKey: !isMac, metaKey: isMac, bubbles: true
    }))
  })

  // Set placeholder if provided
  if (props.placeholder && !props.modelValue) {
    const model = editor.getModel()
    if (model) {
      model.setValue(props.placeholder)
    }
  }

  // Track cursor position changes
  editorDisposables.push(editor.onDidChangeCursorPosition((e) => {
    emit('cursorChange', {
      line: e.position.lineNumber,
      col: e.position.column,
    })
  }))

  // Handle multi-file mode (must happen before updateDslParamsType so it doesn't overwrite params)
  if (props.mode === 'multi-file' && props.filePath && props.modelValue) {
    switchToFile(props.filePath, props.modelValue)
  }

  // Apply dynamic params type if provided (after switchToFile so it isn't cleared)
  if (props.dslParams) {
    const dslType = props.dslType || resolvedDslType.value
    if (dslType === 'action' || dslType === 'prompt') {
      updateDslParamsType(monaco, dslType, props.dslParams)
    }
  }
  
  // Emit mount event
  emit('mount', editor)
}

const handleDiffMount = (diffEditor: editor.IStandaloneDiffEditor) => {
  diffEditorInstance.value = diffEditor
  const monaco = monacoRuntime.value
  if (!monaco) return

  // Initialize Monaco
  initializeMonaco(monaco, {
    enableTypeChecking: false,
    enableSuggestions: false
  })

  // Force diff-specific options on the diff editor and both sub-editors.
  // Monaco's createDiffEditor receives options via the library, but sub-editor
  // options (lineNumbers, glyphMargin, etc.) need explicit propagation.
  if (props.diffOptions) {
    diffEditor.updateOptions(props.diffOptions)
    const editorOpts = { ...props.diffOptions }
    diffEditor.getOriginalEditor().updateOptions(editorOpts)
    diffEditor.getModifiedEditor().updateOptions(editorOpts)
  }

  const modifiedEditor = diffEditor.getModifiedEditor()
  editorDisposables.push(modifiedEditor.onDidChangeModelContent(() => {
    if (!props.readOnly) {
      const value = modifiedEditor.getValue()
      currentValue.value = value
      emit('update:modelValue', value)
      emit('change', value)
    }
  }))

  // Auto-scroll to first change when diff is computed
  diffUpdateDisposable?.dispose()
  diffUpdateDisposable = diffEditor.onDidUpdateDiff(() => {
    try {
      const changes = diffEditor.getLineChanges()
      if (changes && changes.length > 0) {
        const firstChange = changes[0]
        const line = firstChange.modifiedStartLineNumber
        const modifiedModel = modifiedEditor.getModel()
        if (modifiedModel && !modifiedModel.isDisposed() && line <= modifiedModel.getLineCount()) {
          modifiedEditor.revealLineInCenter(line)
        }
      }
    } catch {
      // Diff result may reference stale line numbers if model changed mid-computation
    }
    diffUpdateDisposable?.dispose()
    diffUpdateDisposable = null
  })
}

// Watch for file/content changes in multi-file mode
watch(
  () => [props.filePath, props.modelValue],
  ([newPath, newContent]) => {
    if (props.mode === 'multi-file' && newPath && newContent !== undefined && editorInstance.value) {
      currentValue.value = newContent as string
      switchToFile(newPath as string, newContent as string)
    } else if (props.mode === 'simple' && newContent !== currentValue.value) {
      currentValue.value = newContent as string
    }
  }
)

// Watch for mode changes to clean up stale references.
// The template renders VueMonacoDiffEditor in the v-if and VueMonacoEditor
// in the v-else, so the underlying editor is only torn down when we cross
// the diff boundary. simple↔multi-file stays on the same VueMonacoEditor
// instance — tearing down listeners there would silently break event emits
// because handleMount wouldn't fire again.
watch(() => props.mode, (newMode, oldMode) => {
  const oldIsDiff = oldMode === 'diff'
  const newIsDiff = newMode === 'diff'
  const editorTornDown = oldIsDiff !== newIsDiff

  if (oldIsDiff) {
    diffUpdateDisposable?.dispose()
    diffUpdateDisposable = null
    // Capture scroll position from diff's modified editor before destroying
    if (diffEditorInstance.value) {
      try {
        const modifiedEditor = diffEditorInstance.value.getModifiedEditor()
        const visibleRanges = modifiedEditor.getVisibleRanges()
        if (visibleRanges.length > 0) {
          pendingScrollLine = visibleRanges[0].startLineNumber
        }
      } catch {}
    }
    // Detach models before v-if unmounts the library component —
    // prevents library's onUnmounted from disposing models before the editor
    try { diffEditorInstance.value?.setModel(null) } catch {}
    diffEditorInstance.value = undefined
  }

  // The standard editor only tears down when we switch INTO diff mode.
  // multi-file → simple keeps the same VueMonacoEditor instance, so we
  // must not drop the model cache there.
  if (oldMode === 'multi-file' && newIsDiff) {
    // VueMonacoEditor is being destroyed — library disposes our models
    models.clear()
    viewStates.clear()
  }

  if (editorTornDown) {
    // Drop every listener we attached to the outgoing editor. The library
    // disposes the editor itself, but Monaco's listener tracker can trip
    // before that runs, so we dispose explicitly here.
    disposeEditorDisposables()
    releaseDslLibraries(); releaseDslLibraries = () => {}
    editorInstance.value = undefined
  }
})

// Watch for file path changes in diff mode to detach models before Vue re-keys.
// The mode watcher above only handles diff↔non-diff transitions. When switching
// between two diff files the mode stays 'diff', so Vue's :key="filePath" on the
// VueMonacoDiffEditor triggers an unmount/remount. Without detaching here, the
// library's unmount disposes text models before the DiffEditorWidget resets,
// causing "TextModel got disposed before DiffEditorWidget model got reset".
watch(() => props.filePath, (newPath, oldPath) => {
  if (props.mode === 'diff' && newPath !== oldPath && diffEditorInstance.value) {
    // Capture scroll position before destroying (for "open file from diff" navigation)
    try {
      const modifiedEditor = diffEditorInstance.value.getModifiedEditor()
      const visibleRanges = modifiedEditor.getVisibleRanges()
      if (visibleRanges.length > 0) {
        pendingScrollLine = visibleRanges[0].startLineNumber
      }
    } catch {}

    diffUpdateDisposable?.dispose()
    diffUpdateDisposable = null
    try { diffEditorInstance.value.setModel(null) } catch {}
    disposeEditorDisposables()
    diffEditorInstance.value = undefined
  }
}, { flush: 'sync' })

watch([resolvedDslType, resolvedLanguage], () => configureFile())

// Watch for dslParams changes
watch(() => props.dslParams, (newParams) => {
  const monaco = monacoRuntime.value
  if (!monaco || !isDslMode.value) return
  const dslType = props.dslType || (props.filePath ? getDslTypeFromPath(props.filePath) : null)
  if (!dslType || dslType === 'database') return
  if (newParams) {
    updateDslParamsType(monaco, dslType as 'action' | 'prompt', newParams)
  } else {
    clearDslParamsType(monaco)
  }
}, { deep: true })

// Cleanup
onBeforeUnmount(() => {
  releaseDslLibraries()
  diffUpdateDisposable?.dispose()
  diffUpdateDisposable = null
  disposeEditorDisposables()
  // Detach models from editors so library cleanup doesn't clash with our disposal
  try { editorInstance.value?.setModel(null) } catch {}
  try { diffEditorInstance.value?.setModel(null) } catch {}
})

onUnmounted(() => {
  // Clear dynamic params type if in DSL mode
  if (isDslMode.value) {
    const monaco = monacoRuntime.value
    if (monaco) {
      clearDslParamsType(monaco)
    }
  }

  // Library child components have already cleaned up by now
  models.forEach(model => {
    if (!model.isDisposed()) {
      try { model.dispose() } catch {}
    }
  })
  models.clear()
  viewStates.clear()
  editorInstance.value = undefined
  diffEditorInstance.value = undefined
})

// Expose methods for external use
defineExpose({
  getEditor: () => editorInstance.value || diffEditorInstance.value?.getModifiedEditor(),
  switchToFile,
  getValue: () => currentValue.value,
  setValue: (value: string) => {
    if (editorInstance.value) {
      const model = editorInstance.value.getModel()
      if (model) {
        model.setValue(value)
      }
    }
  }
})
</script>

<style scoped>
.unified-monaco-editor {
  min-height: 100px;
}

.unified-monaco-editor :deep(.monaco-editor) {
  border-radius: 0.375rem;
}

/* Ensure Monaco overlay widgets appear above other UI elements */
.unified-monaco-editor :deep(.monaco-editor-overlaymessage),
.unified-monaco-editor :deep(.monaco-hover),
.unified-monaco-editor :deep(.monaco-editor-hover),
.unified-monaco-editor :deep(.monaco-editor .zone-widget),
.unified-monaco-editor :deep(.monaco-editor .monaco-hover-content) {
  z-index: 100 !important;
}

/* Fix for suggest widget cutoff issues */
.unified-monaco-editor :deep(.monaco-editor .suggest-widget) {
  z-index: 1000 !important;
}

/* Ensure proper overflow handling for Monaco containers */
.unified-monaco-editor :deep(.monaco-editor .overflow-guard) {
  overflow: visible !important;
}

/* Ensure suggest details widget is visible */
.unified-monaco-editor :deep(.monaco-editor .suggest-details) {
  z-index: 1001 !important;
}
</style>

<style>
/* Monaco renders button tooltips in a .context-view wrapper (position:fixed,
   z-index:2575) outside the editor DOM tree. The tooltip overlaps the button
   it describes (monaco-editor#5177), blocking clicks. pointer-events:none on
   the entire wrapper lets clicks pass through to the button underneath.
   :has() scopes this to tooltip hovers only — context menus etc. are unaffected. */
.context-view:has(.monaco-hover[role="tooltip"]) {
  pointer-events: none !important;
}
</style>