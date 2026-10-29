<template>
  <section aria-label="Agent report" :data-native-handback-task="report.taskId" class="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <div class="mb-2 text-xs font-medium text-neutral-200">Agent report</div>
    <p v-if="report.warning" role="alert" class="mb-3 whitespace-pre-wrap rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-xs leading-5 text-amber-200 [overflow-wrap:anywhere]">{{ report.warning }}</p>
    <p class="mb-2 text-[11px] text-neutral-500">From the delegated Agent</p>
    <div class="whitespace-pre-wrap text-xs leading-5 text-neutral-300 [overflow-wrap:anywhere]">{{ report.text }}</div>
  </section>
</template>
<script setup lang="ts">
import type { ClaudeAgentHandback } from '#features/code/common/native-handback.ts'
defineProps<{ report: ClaudeAgentHandback }>()
</script>
