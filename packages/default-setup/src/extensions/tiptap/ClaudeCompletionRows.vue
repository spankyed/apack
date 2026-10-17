<template>
  <div v-if="offer?.rows.length" class="border-t border-neutral-600" data-native-completion-rows>
    <button v-for="(row, index) in offer.rows" :key="offer.id + ':' + index" type="button"
      class="block w-full px-3 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-700 focus-visible:outline focus-visible:outline-blue-400"
      :class="{ 'is-selected bg-neutral-700': selectedIndex === index }" @mousedown.prevent @click="row.select" @mouseenter="emit('hover', index)">
      <span>{{ row.label ?? row.text }}</span><span v-if="row.description" class="ml-2 text-xs text-neutral-500">{{ row.description }}</span>
    </button>
  </div>
</template>
<script setup lang="ts">
import type { ClaudeCompletionOffer } from './claude-completions.ts'
defineProps<{ offer?: ClaudeCompletionOffer; selectedIndex?: number }>()
const emit = defineEmits<{ hover: [index: number] }>()
</script>
