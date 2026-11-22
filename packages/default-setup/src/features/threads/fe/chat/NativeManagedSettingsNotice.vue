<template>
  <details ref="notice" data-native-managed-settings class="mx-4 my-2 min-h-0 shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/5 text-xs text-amber-100">
    <summary ref="summary" class="cursor-pointer px-3 py-2">Claude Code reported settings warnings</summary>
    <div class="max-h-40 overflow-y-auto px-3 pb-3">
      <div v-for="(diagnostic,index) in diagnostics" :key="index" class="mt-2 whitespace-pre-wrap break-words">
        <p class="font-mono text-amber-200">{{ diagnostic.file }}</p>
        <p>{{ diagnostic.message }}</p>
        <p v-if="diagnostic.path" class="mt-1 font-mono text-amber-200/70">{{ diagnostic.path }}</p>
      </div>
      <button v-if="canRecheck" ref="recheckButton" type="button" class="mt-3 rounded px-1 py-1 underline hover:text-white focus-visible:outline focus-visible:outline-2 aria-disabled:opacity-50"
        :aria-disabled="recheck?.status === 'pending'" @click="requestRecheck">{{ recheck?.status === 'pending' ? 'Rechecking…' : 'Recheck settings' }}</button>
      <p v-if="recheck?.status === 'error'" role="alert" class="mt-1">{{ recheck.problem }}</p>
    </div>
  </details>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { ClaudeManagedSettingsDiagnostic } from '#features/code/be/services/claude-code/ui-controls.ts'
const props = defineProps<{
  diagnostics: ClaudeManagedSettingsDiagnostic[]
  canRecheck?: boolean
  recheck?: import('../../be/claude-terminal-views.ts').ClaudeTerminalViewSnapshot['policyRecheck']
}>()
const emit = defineEmits<{ recheck: []; 'return-focus': [] }>()
const notice = ref<HTMLDetailsElement | null>(null)
const summary = ref<HTMLElement | null>(null)
const recheckButton = ref<HTMLButtonElement | null>(null)

function requestRecheck() {
  if (props.canRecheck && props.recheck?.status !== 'pending') emit('recheck')
}

watch(() => props.canRecheck, eligible => {
  if (!eligible && recheckButton.value === document.activeElement) summary.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  if (notice.value?.contains(document.activeElement)) emit('return-focus')
})
</script>
