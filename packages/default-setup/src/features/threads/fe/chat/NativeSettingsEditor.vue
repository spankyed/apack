<template>
  <section aria-label="Claude Code setting editor" class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 class="min-w-0 break-words text-sm font-medium text-neutral-200">{{ editor.title || 'Choose a value' }}</h3>
      <button type="button" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('cancel')">Cancel</button>
    </header>
    <div v-if="editor.kind === 'choice'" class="space-y-2" role="group" :aria-label="editor.title || 'Available values'">
      <button v-for="option in editor.options" :key="option.value" type="button" :disabled="pending || editor.disabled || option.disabled" :aria-pressed="editor.value === option.value" class="block w-full whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" :class="editor.value === option.value ? 'bg-blue-500/10' : ''" @click="emit('select', option.value)">{{ option.label }}</button>
      <p v-if="!editor.options.length" role="status" class="text-xs text-neutral-400">Claude Code has provided no available values.</p>
    </div>
    <form v-else class="space-y-4" @submit.prevent="emit('save', { ...drafts })">
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
import type { ClaudeSettingsEditor } from '#features/code/common/native-settings.ts'
const props = defineProps<{ editor: ClaudeSettingsEditor; pending: boolean }>()
const emit = defineEmits<{ select: [value: string]; save: [values: Record<string, string>]; cancel: [] }>()
const drafts = ref<Record<string, string>>({})
watch(() => props.editor.revision, () => { drafts.value = props.editor.kind === 'form' ? Object.fromEntries(props.editor.fields.map(field => [field.key, field.value])) : {} }, { immediate: true })
</script>
