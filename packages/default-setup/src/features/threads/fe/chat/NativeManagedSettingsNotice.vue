<template>
  <details data-native-managed-settings class="mx-4 my-2 min-h-0 shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/5 text-xs text-amber-100">
    <summary class="cursor-pointer px-3 py-2">Claude Code reported settings warnings</summary>
    <div class="max-h-40 overflow-y-auto px-3 pb-3">
      <div v-for="(diagnostic,index) in diagnostics" :key="index" class="mt-2 whitespace-pre-wrap break-words">
        <p class="font-mono text-amber-200">{{ diagnostic.file }}</p>
        <p>{{ diagnostic.message }}</p>
        <p v-if="diagnostic.path" class="mt-1 font-mono text-amber-200/70">{{ diagnostic.path }}</p>
      </div>
    </div>
  </details>
</template>
<script setup lang="ts">
import type { ClaudeManagedSettingsDiagnostic } from '#features/code/be/services/claude-code/ui-controls.ts'
defineProps<{diagnostics:ClaudeManagedSettingsDiagnostic[]}>()
</script>
