<template>
  <details class="my-3 min-w-0 rounded-lg border border-neutral-700/60 bg-neutral-900/40 px-3 py-2 text-xs" :data-native-diagnostic="diagnostic.id">
    <summary class="cursor-pointer break-words text-neutral-300 marker:text-neutral-500">
      <NativeStatusText :text="summary" />
    </summary>
    <div class="mt-2 min-w-0 whitespace-pre-wrap break-words font-mono text-neutral-300" data-native-diagnostic-detail>
      <NativeStatusText :text="diagnostic.detail" />
    </div>
  </details>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeUiDiagnosticAttachment } from '#features/code/be/services/claude-code/ui-controls.ts'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props=defineProps<{diagnostic:ClaudeUiDiagnosticAttachment}>()
// The app uses a native details disclosure; the terminal shortcut does not apply here.
const summary=computed(()=>props.diagnostic.summary.replace(' (ctrl+o to expand)',''))
</script>
