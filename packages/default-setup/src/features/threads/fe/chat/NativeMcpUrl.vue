<template>
  <section data-testid="native-mcp-url" aria-label="MCP browser input" class="native-mcp-url">
    <div class="body">
      <h3>{{ url.title }}</h3>
      <p class="message">{{ url.message }}</p>
      <code class="url">{{ url.url }}</code>
      <p v-if="url.phase === 'waiting'" role="status">Waiting for the server to confirm completion…</p>
      <p v-for="warning in url.warnings" :key="warning" class="warning">{{ warning }}</p>
      <p v-if="operation?.status === 'error'" role="alert">{{ operation.problem }}</p>
    </div>
    <footer>
      <button v-for="choice in url.choices.filter(choice => choice.operation !== 'cancel')" :key="choice.operation" type="button" :disabled="pending || !url.ready" :class="{ primary: choice.operation === 'accept' || choice.operation === 'continue' }" @click="decide(choice.operation)">{{ choice.label }}</button>
      <button type="button" :disabled="pending || !url.ready" @click="decide('cancel')">Cancel</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ClaudeNativeMcpUrl, ClaudeNativeMcpUrlOperation } from '#features/code/common/native-mcp-url.ts'
const props = defineProps<{ url: ClaudeNativeMcpUrl; operation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string } }>()
const emit = defineEmits<{ operate: [operation: ClaudeNativeMcpUrlOperation] }>()
const pending = ref(false)
let baseline = 0
function decide(operation: ClaudeNativeMcpUrlOperation['operation']) {
  if (pending.value || props.operation?.status === 'pending' || !props.url.ready) return
  baseline = props.operation?.sequence ?? 0; pending.value = true; emit('operate', { operation })
}
watch(() => [props.operation?.sequence, props.operation?.status] as const, () => {
  if ((props.operation?.sequence ?? 0) > baseline && props.operation?.status !== 'pending') pending.value = false
})
</script>
<style scoped>
.native-mcp-url { display: flex; flex-direction: column; min-height: 12rem; max-height: 45vh; margin: .5rem 1rem; overflow: hidden; border: 1px solid rgb(255 255 255 / .12); border-radius: .8rem; background: #202020; color: #e5e5e5; font-size: .875rem; }
.body { min-height: 4rem; overflow-y: auto; padding: .75rem 1rem; } h3 { font-weight: 600; } .message { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: .25rem; } .url { display: block; white-space: pre-wrap; overflow-wrap: anywhere; margin: .75rem 0; padding: .5rem; border-radius: .35rem; background: #303030; } .warning { color: #fcd34d; } footer { display: flex; flex-wrap: wrap; flex-shrink: 0; gap: .5rem; padding: .65rem 1rem; border-top: 1px solid rgb(255 255 255 / .08); } button { padding: .4rem .75rem; border-radius: .35rem; background: #404040; } button.primary { background: #2563eb; color: white; } button:disabled { opacity: .5; }
</style>
