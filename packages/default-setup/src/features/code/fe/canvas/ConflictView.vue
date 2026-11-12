<template>
  <!-- A conflicted file as its three sides, in place of the markers git wrote into one file -->
  <div class="h-full flex flex-col" data-testid="conflict-view">
    <div class="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-neutral-800 text-neutral-300">
      <span class="flex-1">Both sides changed {{ path }}. Take one side, or edit the file and stage it.</span>
      <button data-testid="take-ours" class="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700" @click="emit('resolve', 'ours')">Take ours</button>
      <button data-testid="take-theirs" class="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700" @click="emit('resolve', 'theirs')">Take theirs</button>
    </div>
    <div class="flex-1 min-h-0 grid grid-cols-3 divide-x divide-neutral-800">
      <div v-for="side in sides" :key="side.label" class="min-h-0 flex flex-col">
        <div class="px-3 py-1 text-[11px] text-neutral-500 border-b border-neutral-800">{{ side.label }}</div>
        <pre v-if="side.content !== null" class="flex-1 overflow-auto p-3 text-xs font-mono text-neutral-300 whitespace-pre">{{ side.content }}</pre>
        <div v-else class="flex-1 p-3 text-xs text-neutral-500">This side deleted the file.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  path: string
  conflict: { base: string | null; ours: string | null; theirs: string | null }
}>()

const emit = defineEmits<{ resolve: [side: 'ours' | 'theirs'] }>()

/** Ours, then what both started from, then theirs: the way a merge reads, left to right */
const sides = computed(() => [
  { label: 'Ours', content: props.conflict.ours },
  { label: 'Both started from', content: props.conflict.base },
  { label: 'Theirs', content: props.conflict.theirs },
])
</script>
