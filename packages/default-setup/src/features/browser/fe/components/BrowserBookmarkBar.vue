<template>
  <div data-testid="browser-bookmark-bar" class="flex items-center gap-0.5 px-2 py-1 bg-neutral-900 border-b border-neutral-800 overflow-x-auto scrollbar-hide">
    <ContextMenuRoot v-for="bookmark in bookmarks" :key="bookmark.url">
      <ContextMenuTrigger as-child>
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-neutral-300 hover:bg-neutral-800 transition-colors shrink-0 max-w-[180px]"
          :title="bookmark.url"
          @click="emit('navigate', bookmark.url)"
        >
          <img
            v-if="bookmark.favicon && !failedFavicons.has(bookmark.url)"
            :src="bookmark.favicon"
            class="w-3.5 h-3.5 shrink-0"
            @error="failedFavicons.add(bookmark.url)"
          />
          <div v-else class="w-3.5 h-3.5 shrink-0 rounded-sm bg-neutral-700" />
          <span class="truncate">{{ bookmark.title || bookmark.url }}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50">
          <ContextMenuItem :class="MENU_ITEM_CLASS" @select="emit('remove', bookmark.url)">
            <X :size="14" />
            Remove bookmark
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { X } from 'lucide-vue-next';
import { ContextMenuRoot, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuPortal } from 'reka-ui';
import type { Bookmark } from '../state.ts';

defineProps<{
  bookmarks: readonly Bookmark[];
}>();

const emit = defineEmits<{
  navigate: [url: string];
  remove: [url: string];
}>();

const failedFavicons = reactive(new Set<string>());

const MENU_ITEM_CLASS = 'flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none';
</script>
