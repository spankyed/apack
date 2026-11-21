<template>
  <div v-if="visible" class="shrink-0 bg-neutral-900" :class="$style.wrapper">
    <div class="flex items-center">
      <TabBar class="flex-1 min-w-0" :tabs="threads.data.tabs" :activeTabId="threads.data.activeTabId" :tabGroups="threads.data.tabGroups" />
      <div class="shrink-0 relative flex items-center self-stretch" :class="$style.closeContainer">
        <div class="absolute top-0 bottom-0 right-full w-16 bg-gradient-to-l from-neutral-900 to-transparent pointer-events-none z-10" />
        <button
          type="button"
          class="flex items-center justify-center w-7 h-7 mx-1.5 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/60 transition-colors"
          title="Close tab bar (⌘+click title)"
          @click="$emit('close')"
        >
          <X :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { X } from 'lucide-vue-next';
import type { ThreadsState } from '#features/threads/fe/state.ts';
import TabBar from '#features/threads/fe/canvas/agent/tabs/tab-bar.vue';

defineProps<{
  visible: boolean;
}>();

defineEmits<{
  close: [];
}>();

const actor: ThreadsState = useSurface();

const { state: threads } = useState(actor);
</script>

<style module>
.wrapper {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgb(38, 38, 38);
}

.closeContainer {
  background: rgb(23, 23, 23);
}
</style>
