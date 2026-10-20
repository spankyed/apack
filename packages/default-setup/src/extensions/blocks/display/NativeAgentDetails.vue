<template>
  <div>
      <NativeAgentHandback v-if="details.handback" :report="details.handback" />
      <dl v-if="details.metadata" :aria-label="details.workflow ? 'Workflow metadata' : 'Agent details'" class="mb-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-white/10 pb-3 text-[11px]">
        <dt class="text-neutral-500">Status</dt><dd class="m-0 text-neutral-300">{{ details.status === 'killed' ? 'Stopped' : details.status }}</dd>
        <template v-if="details.metadata.model"><dt class="text-neutral-500">Model</dt><dd class="m-0 break-words text-neutral-300 [overflow-wrap:anywhere]">{{ details.metadata.model }}</dd></template>
        <template v-if="details.metadata.effort"><dt class="text-neutral-500">Effort</dt><dd class="m-0 text-neutral-300">{{ details.metadata.effort }}</dd></template>
        <template v-if="details.metadata.elapsedMs !== undefined"><dt class="text-neutral-500">Elapsed at refresh</dt><dd class="m-0 text-neutral-300">{{ Math.floor(details.metadata.elapsedMs / 1000) }}s</dd></template>
        <template v-if="details.metadata.tokenCount !== undefined"><dt class="text-neutral-500">Tokens</dt><dd class="m-0 text-neutral-300">{{ details.metadata.tokenCount.toLocaleString() }}</dd></template>
        <template v-if="details.metadata.toolUseCount !== undefined"><dt class="text-neutral-500">Tools</dt><dd class="m-0 text-neutral-300">{{ details.metadata.toolUseCount.toLocaleString() }}</dd></template>
      </dl>
      <details v-if="details.metadata?.prompt" class="mb-3">
        <summary class="cursor-pointer text-neutral-400">Agent prompt</summary>
        <pre class="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-neutral-300">{{ details.metadata.prompt }}</pre>
        <p v-if="details.metadata.promptTruncated" class="text-neutral-500">Prompt preview shortened.</p>
      </details>
      <div v-if="details.status === 'failed' && details.metadata?.error" role="alert" class="mb-3 whitespace-pre-wrap text-red-300 [overflow-wrap:anywhere]">{{ details.metadata.error }}<p v-if="details.metadata.errorTruncated">Error preview shortened.</p></div>
  </div>
</template>
<script setup lang="ts">
import NativeAgentHandback from './NativeAgentHandback.vue'
import type { ClaudeNativeTaskDetails } from '#features/code/common/native-terminal.ts'
defineProps<{ details: ClaudeNativeTaskDetails }>()
</script>
