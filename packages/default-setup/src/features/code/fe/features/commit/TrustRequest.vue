<template>
  <!-- A repository's own configuration and hooks can name programs for git to run. Until it is trusted, git is
       not run in it, and this says what it would have run -->
  <div class="p-3 border-b border-yellow-800 bg-yellow-900/10" data-testid="trust-request">
    <p class="text-sm text-yellow-500">
      <ShieldAlert class="inline w-4 h-4 mr-1" />
      This repository has {{ what }} that make git run programs. Git has not been run here.
    </p>
    <ul class="mt-2 space-y-1 text-xs text-neutral-300">
      <li v-for="ask in request.asks.slice(0, shown)" :key="ask.kind === 'hook' ? `hook ${ask.name}` : `${ask.file} ${ask.key}`" class="truncate" :title="ask.file">
        <template v-if="ask.kind === 'hook'">
          <span class="text-neutral-500">hook</span> <code>{{ ask.name }}</code>
        </template>
        <template v-else>
          <span class="text-neutral-500">setting</span> <code>{{ ask.key }}</code> = <code>{{ ask.value }}</code>
        </template>
      </li>
      <li v-if="request.asks.length > shown" class="text-neutral-500">and {{ request.asks.length - shown }} more</li>
    </ul>
    <p class="mt-2 text-xs text-neutral-500">
      Trust it only if you know where it came from. Trusting it lets git run these here, as it does in a terminal.
    </p>
    <button
      class="px-2 py-1 mt-2 text-xs rounded text-neutral-100 bg-neutral-800 hover:bg-neutral-700"
      data-testid="trust-repository"
      @click="emit('trust')"
    >
      Trust this repository
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'
import type { TrustRequest } from '#features/code/be/types.ts'

const props = defineProps<{ request: TrustRequest }>()
const emit = defineEmits<{ trust: [] }>()

/** The most of what it would run that is listed: the rest is counted */
const shown = 8
const what = computed(() => {
  const settings = props.request.asks.some(ask => ask.kind === 'setting')
  const hooks = props.request.asks.some(ask => ask.kind === 'hook')
  return settings && hooks ? 'settings and hooks' : hooks ? 'hooks' : 'settings'
})
</script>
