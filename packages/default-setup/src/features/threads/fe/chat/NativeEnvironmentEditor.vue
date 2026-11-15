<template>
  <section ref="root" role="dialog" aria-label="Auto mode environment" aria-modal="false" tabindex="-1" data-native-command-panel class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900" @keydown.esc.stop.prevent="cancel">
    <header class="shrink-0 border-b border-white/10 px-4 py-3">
      <p v-if="ownerLabel" class="mb-1 text-xs text-neutral-400">{{ ownerLabel }}</p>
      <h2 class="text-sm font-medium text-neutral-100">Auto mode environment</h2>
      <p class="mt-1 text-xs leading-relaxed text-neutral-400">Describe this machine and project. Claude Code validates and saves the document.</p>
    </header>
    <label class="flex min-h-0 flex-1 flex-col gap-2 p-4 text-xs text-neutral-400">Environment document
      <textarea :key="editor.id" :data-native-environment-editor="editor.id" v-model="draft" :disabled="busy" spellcheck="false" class="min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-mono text-sm leading-relaxed text-neutral-200 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-60" @input.capture="guard" @compositionstart.capture="composition($event,true)" @compositionend.capture="composition($event,false)" @keydown.capture="keydown" />
    </label>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
      <p v-if="problem" role="alert" class="w-full whitespace-pre-wrap break-words text-xs text-amber-200">{{ problem }}</p>
      <span role="status" class="text-xs text-neutral-500">{{ busy ? 'Returning to Claude Code…' : 'Ctrl/⌘+Enter to save' }}</span>
      <div class="flex gap-2"><button type="button" :disabled="busy" class="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="cancel">Cancel</button><button type="button" :disabled="busy || composing" class="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="save">Save environment</button></div>
    </footer>
  </section>
</template>
<script setup lang="ts">
import {computed, nextTick, onMounted, onBeforeUnmount, ref, watch} from 'vue'
import type {ClaudePermissionsSnapshot} from '#features/code/common/native-permissions.ts'
import type {ClaudeSettingsRequest, ClaudeSettingsView} from '#features/code/common/native-settings.ts'
import {CLAUDE_NATIVE_EDITOR_MAX_BYTES} from '#features/code/common/native-editor.ts'
const props = defineProps<{editor: NonNullable<ClaudePermissionsSnapshot['editor']>; state?: ClaudeSettingsView; ownerLabel?: string}>()
const emit = defineEmits<{operate: [request: ClaudeSettingsRequest]}>()
let disposed = false
onBeforeUnmount(() => {disposed = true})
const root = ref<HTMLElement>(), draft = ref(props.editor.value), composing = ref(false), submitted = ref(false), localProblem = ref('')
const busy = computed(() => submitted.value || props.editor.closing || props.state?.status === 'pending')
const problem = computed(() => props.state?.problem || localProblem.value)
watch(() => props.editor.id, () => {draft.value = props.editor.value; submitted.value = false; composing.value = false; localProblem.value = ''})
watch(() => props.state?.status, status => {if (status === 'error') submitted.value = false})
function send(command: {action: 'externalSave'; id: string; value: string} | {action: 'externalCancel'; id: string}) {
  if (disposed || busy.value) return
  localProblem.value = ''; submitted.value = true
  emit('operate', {requestId: crypto.randomUUID(), action: {kind: 'permissions', revision: props.editor.revision, command}})
}
function save() {
  if (composing.value) return
  if (new TextEncoder().encode(draft.value).length > CLAUDE_NATIVE_EDITOR_MAX_BYTES) {localProblem.value = 'This document is larger than 8 MiB. Shorten it before saving.'; return}
  send({action: 'externalSave', id: props.editor.id, value: draft.value})
}
function cancel() {if (!composing.value) send({action: 'externalCancel', id: props.editor.id})}
function guard(event: Event) {
  if (disposed || !root.value?.contains(event.target as Node) || (event.target as HTMLElement).dataset.nativeEnvironmentEditor !== props.editor.id) {event.stopImmediatePropagation(); return false}
  return true
}
function composition(event: CompositionEvent, value: boolean) {if (guard(event)) composing.value = value}
function keydown(event: KeyboardEvent) {
  if (!guard(event)) return
  if (event.isComposing || composing.value) {if (event.key === 'Escape') event.stopPropagation(); return}
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); event.stopPropagation(); save()}
}
onMounted(async () => {await nextTick(); if (document.hasFocus() && (document.activeElement === document.body || document.activeElement?.closest('[data-native-command-panel]'))) root.value?.querySelector('textarea')?.focus({preventScroll: true})})
</script>
