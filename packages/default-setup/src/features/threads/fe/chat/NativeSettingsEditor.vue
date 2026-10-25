<template>
  <section aria-label="Claude Code setting editor" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
      <h3 class="min-w-0 break-words text-sm font-medium text-neutral-200">{{ editor.title || 'Choose a value' }}</h3>
      <button type="button" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('cancel')">{{ editor.kind === 'group' ? 'Close' : 'Cancel' }}</button>
    </header>
    <div v-if="editor.kind === 'choice'" data-native-settings-editor-body class="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4" role="group" :aria-label="editor.title || 'Available values'">
      <p v-if="editor.model" class="whitespace-pre-wrap break-words text-xs text-neutral-400">{{ editor.model.description }}</p>
      <div v-for="option in editor.options" :key="option.value" class="flex items-start gap-2">
      <button type="button" :disabled="pending || editor.disabled || option.disabled" :aria-pressed="editor.value === option.value" class="block min-w-0 flex-1 w-full whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" :class="editor.value === option.value ? 'bg-blue-500/10' : ''" @click="emit('select', option.value)"><span class="block">{{ option.label }}</span><span v-if="option.description" class="mt-1 block text-xs leading-relaxed text-neutral-400"><NativePermissionText :text="option.description" :ansi="option.descriptionAnsi" /></span></button>
        <button v-if="editor.model" type="button" :disabled="pending || editor.disabled || option.disabled" :aria-pressed="editor.model.focusValue === option.value" :aria-label="`Details for ${option.label}`" class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" :class="editor.model.focusValue === option.value ? 'bg-blue-500/10' : ''" @click="showModelDetails(option.value)">Details</button>
        <button v-if="editor.canPreview" type="button" :disabled="pending || editor.disabled || option.disabled" :aria-pressed="editor.previewValue === option.value" :aria-label="`Preview ${option.label}`" class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('preview', option.value)">Preview</button>
      </div>
      <section v-if="editor.model" ref="modelDetails" aria-label="Native Model details" :data-native-model-draft-effort="editor.model.draftEffort" tabindex="0" @keydown.left.prevent="adjustModelEffort('left')" @keydown.right.prevent="adjustModelEffort('right')" class="space-y-3 rounded-lg border border-white/10 p-3 text-xs text-neutral-300">
        <p class="font-medium">{{ modelLabel }}</p>
        <p class="whitespace-pre-wrap break-words">{{ editor.model.effortText }}</p>
        <div v-if="editor.model.canAdjustEffort" class="flex flex-wrap gap-2"><button type="button" :disabled="pending" class="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40" @click="adjustModelEffort('left')">Decrease effort</button><button type="button" :disabled="pending" class="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40" @click="adjustModelEffort('right')">Increase effort</button></div>
        <p v-if="editor.model.fastModeNotice" class="whitespace-pre-wrap break-words text-neutral-400">{{ editor.model.fastModeNotice }}</p>
      </section>
      <section v-if="editor.preview" aria-label="Native Theme preview" class="rounded-lg border border-white/10 p-3 text-xs"><NativeThemePreview :preview="editor.preview" /></section>
      <button v-if="editor.canToggleSyntax" type="button" :disabled="pending" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('toggle-syntax')">Toggle syntax highlighting</button>
      <p v-if="!editor.options.length" role="status" class="text-xs text-neutral-400">Claude Code has provided no available values.</p>
    </div>
    <div v-else-if="editor.kind === 'group'" data-native-settings-editor-body class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      <p v-if="editor.description" class="whitespace-pre-wrap break-words text-xs text-neutral-400">{{ editor.description }}</p>
      <label v-for="row in editor.rows" :key="row.key" :data-native-settings-group-row="row.key" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3 text-sm text-neutral-200">
        <span class="min-w-0 flex-1 break-words">{{ row.label }}</span>
        <input v-if="row.kind === 'boolean'" type="checkbox" :checked="row.value === true" :disabled="pending || editor.disabled || row.disabled" @change="emit('set-group', row.key, ($event.target as HTMLInputElement).checked)" />
        <select v-else :value="row.value" :disabled="pending || editor.disabled || row.disabled" class="max-w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm" @change="emit('set-group', row.key, ($event.target as HTMLSelectElement).value)">
          <option v-for="option in row.options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
        </select>
      </label>
      <p v-if="!editor.rows.length" role="status" class="text-xs text-neutral-400">Claude Code has provided no available controls.</p>
    </div>
    <form v-else data-native-settings-editor-body class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" @submit.prevent="emit('save', { ...drafts })">
      <p v-if="editor.description" class="whitespace-pre-wrap break-words text-xs text-neutral-400">{{ editor.description }}</p>
      <label v-for="field in editor.fields" :key="field.key" class="block text-xs text-neutral-300">
        <span class="mb-2 block break-words">{{ field.label }}</span>
        <input v-model="drafts[field.key]" :disabled="pending" maxlength="16384" class="w-full min-w-0 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" />
      </label>
      <button type="submit" :disabled="pending" class="rounded-lg bg-blue-600 px-4 py-2 text-xs text-white disabled:opacity-40">{{ editor.submitLabel }}</button>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import NativeThemePreview from './NativeThemePreview.vue'
import NativePermissionText from './NativePermissionText.vue'
import type { ClaudeSettingsEditor } from '#features/code/common/native-settings.ts'
const props = defineProps<{ editor: ClaudeSettingsEditor; pending: boolean }>()
const emit = defineEmits<{ 'set-group': [key: string, value: boolean | string]; select: [value: string]; preview: [value: string]; 'focus-model': [value: string]; 'adjust-effort': [direction: 'left' | 'right']; 'toggle-syntax': []; save: [values: Record<string, string>]; cancel: [] }>()
const drafts = ref<Record<string, string>>({})
const modelDetails = ref<HTMLElement>()
const modelLabel = computed(() => { const editor=props.editor; if(editor.kind!=='choice')return; const focus=editor.model?.focusValue; return editor.options.find(option=>option.value===focus)?.label })
function showModelDetails(value: string) { emit('focus-model', value); void nextTick(() => { modelDetails.value?.scrollIntoView?.({ block: 'nearest' }); modelDetails.value?.focus({ preventScroll: true }) }) }
function adjustModelEffort(direction: 'left' | 'right') { if(!props.pending && props.editor.kind==='choice' && props.editor.model?.canAdjustEffort)emit('adjust-effort', direction) }
watch(() => props.editor.revision, () => { drafts.value = props.editor.kind === 'form' ? Object.fromEntries(props.editor.fields.map(field => [field.key, field.value])) : {} }, { immediate: true })
</script>
