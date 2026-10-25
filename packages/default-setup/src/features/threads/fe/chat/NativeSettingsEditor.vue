<template>
  <section aria-label="Claude Code setting editor" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
      <h3 class="min-w-0 break-words text-sm font-medium text-neutral-200">{{ editor.title || 'Choose a value' }}</h3>
      <button type="button" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('cancel')">Cancel</button>
    </header>
    <div v-if="editor.kind === 'choice'" data-native-settings-editor-body class="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4" role="group" :aria-label="editor.title || 'Available values'">
      <div v-for="option in editor.options" :key="option.value" class="flex items-start gap-2">
      <button type="button" :disabled="pending || editor.disabled || option.disabled" :aria-pressed="editor.value === option.value" class="block min-w-0 flex-1 w-full whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" :class="editor.value === option.value ? 'bg-blue-500/10' : ''" @click="emit('select', option.value)"><span class="block">{{ option.label }}</span><span v-if="option.description" class="mt-1 block text-xs leading-relaxed text-neutral-400">{{ option.description }}</span></button>
        <button v-if="editor.canPreview" type="button" :disabled="pending || editor.disabled || option.disabled" :aria-pressed="editor.previewValue === option.value" :aria-label="`Preview ${option.label}`" class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('preview', option.value)">Preview</button>
      </div>
      <section v-if="editor.preview" aria-label="Native Theme preview" class="rounded-lg border border-white/10 p-3 text-xs"><NativePermissionText :text="editor.preview.text" :ansi="editor.preview.ansi" /></section>
      <button v-if="editor.canToggleSyntax" type="button" :disabled="pending" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('toggle-syntax')">Toggle syntax highlighting</button>
      <p v-if="!editor.options.length" role="status" class="text-xs text-neutral-400">Claude Code has provided no available values.</p>
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
import { ref, watch } from 'vue'
import NativePermissionText from './NativePermissionText.vue'
import type { ClaudeSettingsEditor } from '#features/code/common/native-settings.ts'
const props = defineProps<{ editor: ClaudeSettingsEditor; pending: boolean }>()
const emit = defineEmits<{ select: [value: string]; preview: [value: string]; 'toggle-syntax': []; save: [values: Record<string, string>]; cancel: [] }>()
const drafts = ref<Record<string, string>>({})
watch(() => props.editor.revision, () => { drafts.value = props.editor.kind === 'form' ? Object.fromEntries(props.editor.fields.map(field => [field.key, field.value])) : {} }, { immediate: true })
</script>
