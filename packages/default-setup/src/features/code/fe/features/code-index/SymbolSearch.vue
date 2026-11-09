<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="p-4 border-b border-neutral-800 bg-neutral-800/50">
      <div v-if="status?.enabled" class="flex items-stretch overflow-hidden border rounded bg-neutral-900 border-neutral-700 focus-within:border-blue-500">
        <input
          v-model="text"
          type="text"
          placeholder="Find a symbol by name"
          class="flex-1 px-3 py-1.5 text-sm bg-transparent border-none outline-none text-neutral-100 placeholder-neutral-500"
        />
      </div>
      <div class="flex items-center justify-between gap-2" :class="status?.enabled && 'mt-2'">
        <span class="text-xs text-neutral-400 min-w-0 truncate" data-testid="code-index-status">{{ statusLine }}</span>
        <button
          class="shrink-0 px-2 py-1 text-xs rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-700/50"
          @click="toggle"
        >
          {{ status?.enabled ? 'Turn off' : 'Index this directory' }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto py-0.5">
      <div
        v-for="symbol in results"
        :key="symbol.id"
        class="px-3 py-[5px] cursor-pointer hover:bg-neutral-800/60"
        @click="open(symbol.id)"
      >
        <div class="flex items-baseline gap-2">
          <span class="text-[13px] font-medium truncate text-neutral-200">{{ symbol.name }}</span>
          <span class="shrink-0 text-[11px] text-neutral-500">{{ symbol.kind }}</span>
          <span v-if="symbol.test" class="shrink-0 text-[11px] text-neutral-500">test</span>
        </div>
        <div class="font-mono text-[12px] truncate text-neutral-400">{{ symbol.signature }}</div>
        <div class="text-[11px] truncate text-neutral-500">{{ symbol.path }}</div>
      </div>
      <EmptyState
        v-if="status?.enabled && text.trim() && results.length === 0"
        :icon="Braces"
        title="No symbols found"
        subtitle="Try a different name"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'
import { computed, ref } from 'vue'
import { useSelector } from '@xstate/vue'
import { Braces } from 'lucide-vue-next'
import { useView } from '#generated/fe.ts'
import type { CodeState } from '#features/code/fe/state.ts'
import EmptyState from '#features/code/fe/features/EmptyState.vue'

const RESULT_LIMIT = 50

const codeActor: CodeState = useSurface()
const baseDirectory = useSelector(codeActor, (state) => state.context.baseDirectory)

const text = ref('')
const statusView = useView('code', 'indexStatus', () => (baseDirectory.value ? { root: baseDirectory.value } : null))
const symbolsView = useView('code', 'symbols', () =>
  baseDirectory.value && text.value.trim() ? { root: baseDirectory.value, text: text.value, limit: RESULT_LIMIT } : null)

const status = computed(() => statusView.data)
const results = computed(() => (text.value.trim() ? symbolsView.data ?? [] : []))

const SKIP_LABELS = { 'too-large': 'too large', 'not-utf8': 'not UTF-8', 'parse-error': 'not parsable' } as const

const statusLine = computed(() => {
  const progress = status.value?.progress
  if (!status.value?.enabled) return progress?.state === 'removing' ? 'Removing the index…' : 'Off: symbols aren\'t indexed here'
  if (!progress) return 'Starting…'
  if (progress.state === 'not-git') return 'Not a git repository, so nothing is indexed'
  if (progress.state === 'error') return `Failed: ${progress.error ?? 'unknown error'}`
  const skipped = Object.entries(progress.skipped)
    .map(([reason, count]) => `${count} ${SKIP_LABELS[reason as keyof typeof SKIP_LABELS]}`)
    .join(', ')
  if (progress.state === 'syncing') return `Indexing, ${progress.pending} files to go`
  return `${progress.symbols} symbols in ${progress.files} files${skipped ? `, ${skipped} left out` : ''}`
})

// Through the surface, whose own send is what names it as the one to answer; it routes these to its `codeIndex` child
const toggle = () => codeActor.send({ type: 'codeIndex.TOGGLE', enabled: !status.value?.enabled })
const open = (symbol: string) => codeActor.send({ type: 'codeIndex.OPEN_SYMBOL', symbol })
</script>
