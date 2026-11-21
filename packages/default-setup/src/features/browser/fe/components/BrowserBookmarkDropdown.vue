<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-40" @click="emit('close')" />

  <!-- Dropdown -->
  <div class="absolute right-0 top-full mt-1 z-50 w-80 max-h-96 overflow-y-auto bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1">
    <div v-if="bookmarks.length === 0" class="px-3 py-4 text-xs text-neutral-500 text-center">
      No bookmarks yet
    </div>
    <div
      v-for="bookmark in bookmarks"
      :key="bookmark.url"
      class="flex items-center gap-2 px-3 py-2 hover:bg-neutral-700 transition-colors cursor-pointer group"
      @click="emit('navigate', bookmark.url)"
    >
      <img
        v-if="bookmark.favicon && !failedFavicons.has(bookmark.url)"
        :src="bookmark.favicon"
        class="w-4 h-4 shrink-0"
        @error="failedFavicons.add(bookmark.url)"
      />
      <div v-else class="w-4 h-4 shrink-0 rounded-sm bg-neutral-700" />
      <div class="flex-1 min-w-0">
        <div class="text-xs text-neutral-200 truncate">{{ bookmark.title || bookmark.url }}</div>
        <div class="text-[10px] text-neutral-500 truncate">{{ bookmark.url }}</div>
      </div>
      <button
        class="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-600 opacity-0 group-hover:opacity-100 transition-all shrink-0"
        title="Remove bookmark"
        @click.stop="emit('remove', bookmark.url)"
      >
        <X :size="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { X } from 'lucide-vue-next';
import type { Bookmark } from '../state.ts';

defineProps<{
  bookmarks: readonly Bookmark[];
}>();

const emit = defineEmits<{
  navigate: [url: string];
  remove: [url: string];
  close: [];
}>();

const failedFavicons = reactive(new Set<string>());
</script>
