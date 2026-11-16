<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-semibold text-white">Settings JSON</h2>
        <span v-if="problems.length" class="text-xs text-red-400">{{ problems.join('; ') }}</span>
        <span v-else-if="saved" class="text-xs text-green-500">Saved</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="discardDraft"
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
        >
          Discard changes
        </button>
        <button
          @click="onSave"
          :disabled="!canSave"
          :class="[
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            !canSave
              ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          ]"
        >
          Save
        </button>
      </div>
    </div>
    <div class="h-[calc(100vh-220px)] border border-neutral-700 rounded-lg overflow-hidden">
      <SimpleMonacoEditor
        :modelValue="jsonText"
        language="json"
        @update:modelValue="onEditorChange"
        @mount="onEditorMount"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { windowSettings, useWindowSettingsSnapshot } from '@/runtime/settings'
import type { SettingsWriteCondition } from '@apackdev/sdk/types'
import { compileSettingsCatalog } from '@apackdev/host/fe'
import type * as Monaco from 'monaco-editor'
import { registerSettingsEditorSchemas } from '@/views/settings/schema'
import { ref, computed, onMounted, onScopeDispose, toRaw, watch } from 'vue'
import { useMonacoRuntime } from '@apackdev/ui/components/monaco-config'
import SimpleMonacoEditor from '@apackdev/ui/components/SimpleMonacoEditor'

const { monaco: monacoRuntime } = useMonacoRuntime()
const snapshot = useWindowSettingsSnapshot()
const settings = computed(() => snapshot.value?.values)
const catalog = computed(() => snapshot.value && toRaw(snapshot.value.catalog))
const validation = computed(() => catalog.value && compileSettingsCatalog(catalog.value))
const saving = ref(false)
let condition: SettingsWriteCondition | undefined
let disposed = false
let editor: Monaco.editor.IStandaloneCodeEditor | undefined
let removeSchemas: (() => void) | undefined
onScopeDispose(() => { disposed = true; removeSchemas?.(); if (savedTimeout) clearTimeout(savedTimeout) })

const jsonText = ref('')
const originalText = ref('')
const problems = ref<string[]>([])
const isDirty = ref(false)
const saved = ref(false)
let savedTimeout: ReturnType<typeof setTimeout> | null = null

const canSave = computed(() => snapshot.value?.status === 'ready' && isDirty.value && problems.value.length === 0 && !saving.value)

function loadSettings() {
  if (!snapshot.value) return
  condition = { runId: snapshot.value.runId, expected: { exists: true, value: JSON.parse(JSON.stringify(snapshot.value.values)) } }
  const text = JSON.stringify(settings.value, null, 2)
  jsonText.value = text
  originalText.value = text
  isDirty.value = false
  problems.value = []
}

onMounted(loadSettings)

watch(settings, () => {
  if (!isDirty.value) loadSettings()
})

watch(monacoRuntime, () => refreshSchemas())

function refreshSchemas() {
  removeSchemas?.()
  removeSchemas = undefined
  const model = editor?.getModel()
  const monaco = monacoRuntime.value
  if (model && monaco && catalog.value) {
    removeSchemas = registerSettingsEditorSchemas(monaco.json.jsonDefaults, catalog.value, model.uri.toString())
  }
}

function onEditorMount(value: Monaco.editor.IStandaloneCodeEditor) {
  editor = value
  refreshSchemas()
}

watch([() => snapshot.value?.runId, () => catalog.value?.revision], () => {
  refreshSchemas()
  if (isDirty.value) problems.value = problemsIn(jsonText.value)
})

/** The same validators as the host; the host also checks the draft's comparison before saving. */
function problemsIn(text: string): string[] {
  try {
    const data: unknown = JSON.parse(text)
    if (!validation.value) return ['Settings are not ready']
    validation.value.validateEffective(data)
    validation.value.validate(data, snapshot.value?.values)
    return []
  } catch (e) {
    return [(e as Error).message]
  }
}

function onEditorChange(value: string) {
  jsonText.value = value
  isDirty.value = value !== originalText.value
  problems.value = problemsIn(value)
}

function discardDraft() {
  loadSettings()
}

async function onSave() {
  if (!canSave.value || !condition) return
  saving.value = true
  const outcome = await windowSettings.replaceAll(JSON.parse(jsonText.value), condition)
  if (disposed) return
  saving.value = false
  if (outcome.status === 'saved') {
    loadSettings()
    saved.value = true
    if (savedTimeout) clearTimeout(savedTimeout)
    savedTimeout = setTimeout(() => { saved.value = false }, 2000)
  } else problems.value = outcome.problems
}
</script>
