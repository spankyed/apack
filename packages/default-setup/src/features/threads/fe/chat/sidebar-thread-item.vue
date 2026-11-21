<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div
        class="flex items-center gap-2 pl-3 pr-3 py-1.5 cursor-pointer transition-colors group"
        :class="isActive ? 'bg-blue-500/15 text-white' : 'hover:bg-neutral-800 text-neutral-300 hover:text-white'"
        @click="emit('select')"
      >
        <span class="shrink-0 relative inline-block w-1.5 h-1.5">
          <span class="block w-full h-full rounded-full transition-colors" :class="isBusy ? 'mosaic-dot' : ''" :style="!isBusy ? { backgroundColor: dotColor || '#525252' } : undefined" />
          <span v-if="isBusy" class="absolute inset-0 rounded-full scale-[2] mosaic-glow" />
        </span>
        <span class="flex-1 min-w-0 truncate text-sm">{{ thread.topic || 'Untitled' }}</span>
        <Pin v-if="isPinned" :size="10" class="shrink-0 text-blue-400/60" />
      </div>
    </ContextMenuTrigger>
    <ThreadContextMenu
      :is-pinned="isPinned" :is-archived="false" :copy-text="thread.shortCode || thread.id"
      :group-id="groupId" :tab-groups="tabGroups"
      @rename="emit('rename')" @pin="emit('pin')" @unpin="emit('unpin')"
      @archive="emit('archive')" @delete="emit('delete')"
      @add-to-group="(gId: string) => emit('add-to-group', gId)"
      @remove-from-group="emit('remove-from-group')"
      @create-group="emit('create-group')"
    />
  </ContextMenuRoot>
</template>

<script setup lang="ts">
import { Pin } from 'lucide-vue-next'
import { ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import ThreadContextMenu from '#features/threads/fe/canvas/components/thread-context-menu.vue'
import type { ThreadListItem } from '#features/threads/fe/state.ts'
import type { ThreadTabGroup } from '#features/threads/fe/canvas/agent/tabs/types.ts'

defineProps<{
  thread: ThreadListItem
  isActive: boolean
  isPinned: boolean
  dotColor: string | undefined
  isBusy: boolean
  groupId: string | undefined
  tabGroups: readonly ThreadTabGroup[]
}>()

const emit = defineEmits<{
  select: []
  rename: []
  pin: []
  unpin: []
  archive: []
  delete: []
  'add-to-group': [groupId: string]
  'remove-from-group': []
  'create-group': []
}>()
</script>
