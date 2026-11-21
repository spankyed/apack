<template>
  <div
    class="absolute left-0 right-0 top-full mt-0.5 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg z-50 overflow-hidden"
    @mousedown.prevent
  >
    <div
      v-for="(suggestion, index) in suggestions"
      :key="suggestion.url"
      class="flex items-center gap-3 px-3 py-2 cursor-pointer text-sm transition-colors"
      :class="index === selectedIndex ? 'bg-neutral-700' : 'hover:bg-neutral-700/50'"
      @click="$emit('select', index)"
      @mouseenter="$emit('hover', index)"
    >
      <img
        v-if="suggestion.favicon && !failedFavicons.has(suggestion.url)"
        :src="suggestion.favicon"
        class="w-4 h-4 flex-shrink-0"
        @error="failedFavicons.add(suggestion.url)"
      />
      <div v-else class="w-4 h-4 flex-shrink-0 rounded bg-neutral-600" />

      <div class="flex-1 min-w-0">
        <div class="text-neutral-200 truncate text-xs">{{ suggestion.title || formatUrl(suggestion.url) }}</div>
        <div v-if="suggestion.title" class="text-neutral-500 text-xs truncate">{{ formatUrl(suggestion.url) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import type { AutocompleteSuggestion } from '../state.ts';
import { displayUrl as formatUrl } from '../history.ts';

const failedFavicons = reactive(new Set<string>());

defineProps<{
  suggestions: readonly AutocompleteSuggestion[];
  selectedIndex: number;
}>();

defineEmits<{
  select: [index: number];
  hover: [index: number];
}>();
</script>
