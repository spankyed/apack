<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        :side-offset="4"
        align="start"
        class="w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50 overflow-hidden"
      >
        <!-- Status section -->
        <div v-if="statuses.length > 0" class="px-3 pt-3 pb-2">
          <span class="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Status</span>
          <div class="flex flex-wrap gap-1.5 mt-2">
            <button
              v-for="status in statuses"
              :key="status.label"
              type="button"
              class="px-2.5 py-1 text-xs rounded-full border transition-colors"
              :class="selectedStatuses.includes(status.label)
                ? 'border-transparent text-white'
                : 'border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600'"
              :style="selectedStatuses.includes(status.label)
                ? { backgroundColor: status.color }
                : { backgroundColor: status.color + '20' }"
              @click="toggleStatus(status.label)"
            >
              {{ status.label }}
            </button>
          </div>
        </div>

        <!-- Chat State section -->
        <div v-if="chatStateConfigs.length > 0" class="px-3 pt-2 pb-2" :class="statuses.length > 0 ? 'border-t border-neutral-800' : 'pt-3'">
          <span class="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Chat State</span>
          <div class="flex flex-wrap gap-1.5 mt-2">
            <button
              v-for="config in chatStateConfigs"
              :key="config.id"
              type="button"
              class="px-2.5 py-1 text-xs rounded-full border transition-colors"
              :class="selectedChatStates.includes(config.id)
                ? 'border-transparent text-white'
                : 'border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600'"
              :style="selectedChatStates.includes(config.id)
                ? { backgroundColor: config.color }
                : { backgroundColor: config.color + '20' }"
              @click="toggleChatState(config.id)"
            >
              {{ config.label }}
            </button>
          </div>
        </div>

        <!-- Tags section -->
        <div v-if="tags.length > 0" class="px-3 pt-2 pb-3" :class="statuses.length > 0 || chatStateConfigs.length > 0 ? 'border-t border-neutral-800' : 'pt-3'">
          <span class="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Tags</span>
          <div class="flex flex-wrap gap-1.5 mt-2">
            <button
              v-for="tag in tags"
              :key="tag.name"
              type="button"
              class="px-2.5 py-1 text-xs rounded-full border transition-colors"
              :class="selectedTags.includes(tag.name)
                ? 'border-transparent text-white'
                : 'border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600'"
              :style="selectedTags.includes(tag.name)
                ? { backgroundColor: tag.color || '#525252' }
                : { backgroundColor: (tag.color || '#525252') + '20' }"
              @click="toggleTag(tag.name)"
            >
              {{ tag.name }}
            </button>
          </div>
        </div>

        <!-- Bottom toggles -->
        <div class="border-t border-neutral-800 px-3 pt-2 pb-3 flex flex-col gap-1">
          <button
            type="button"
            class="flex items-center justify-between w-full px-2 py-1.5 rounded-md transition-colors cursor-pointer"
            :class="showRootOnly
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'"
            @click="emit('toggle-root-only')"
          >
            <span class="text-xs">Root threads only</span>
            <Network :size="14" :class="showRootOnly ? 'text-neutral-100' : 'text-neutral-500'" />
          </button>
          <button
            type="button"
            class="flex items-center justify-between w-full px-2 py-1.5 rounded-md transition-colors cursor-pointer"
            :class="showArchived
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'"
            @click="emit('toggle-view-archive')"
          >
            <span class="text-xs">View Archive</span>
            <Archive :size="14" :class="showArchived ? 'text-neutral-100' : 'text-neutral-500'" />
          </button>
        </div>

        <!-- Empty state -->
        <div v-if="statuses.length === 0 && chatStateConfigs.length === 0 && tags.length === 0" class="px-3 py-4 text-sm text-neutral-500 text-center">
          No filter options available
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Archive, Network } from 'lucide-vue-next'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import type { ThreadStatusOption, ThreadTagOption, ChatStateConfig } from '#generated/types.ts'

defineProps<{
  statuses: ThreadStatusOption[]
  tags: readonly ThreadTagOption[]
  chatStateConfigs: ChatStateConfig[]
  selectedStatuses: string[]
  selectedTags: string[]
  selectedChatStates: string[]
  showRootOnly: boolean
  showArchived: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-status', status: string): void
  (e: 'toggle-tag', tag: string): void
  (e: 'toggle-chat-state', chatState: string): void
  (e: 'toggle-root-only'): void
  (e: 'toggle-view-archive'): void
}>()

const open = ref(false)

function toggleStatus(status: string) {
  emit('toggle-status', status)
}

function toggleTag(tag: string) {
  emit('toggle-tag', tag)
}

function toggleChatState(chatState: string) {
  emit('toggle-chat-state', chatState)
}
</script>
