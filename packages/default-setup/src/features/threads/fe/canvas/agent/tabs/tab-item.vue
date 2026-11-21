<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div
        draggable="true"
        class="tab-item relative flex items-center px-4 h-[30px] text-sm transition-colors cursor-pointer group border-r border-neutral-800 max-w-[200px]"
        :class="[
          isActive
            ? groupId
              ? 'text-white'
              : 'bg-neutral-850 text-white border-t border-blue-500'
            : groupId
              ? 'text-neutral-400 hover:text-neutral-200 hover:brightness-110'
              : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-850 hover:text-neutral-200',
          isDragging && 'opacity-50'
        ]"
        :style="groupColorStyle"
        :title="tab.label"
        :data-tab-id="tab.id"
        :data-group-id="groupId"
        :data-context="!groupId ? (isPinned ? 'pinned' : 'ungrouped') : undefined"
        @click="$emit('select')"
        @dragstart="$emit('dragstart', $event)"
        @dragend="$emit('dragend', $event)"
      >
        <!-- Dot / Close button swap container -->
        <span class="relative flex items-center justify-center w-[22px] h-[22px] mr-1 shrink-0">
          <!-- State dot (default, hides on hover) -->
          <span class="transition-opacity relative inline-block w-1.5 h-1.5" :class="{ 'group-hover:opacity-0': !isPinned }">
            <span
              class="block w-full h-full rounded-full transition-colors"
              :class="isThreadBusy(tab.id) ? 'mosaic-dot' : ''"
              :style="!isThreadBusy(tab.id) ? { backgroundColor: getThreadDotColor(tab.id) || '#525252' } : undefined"
            />
            <span
              v-if="isThreadBusy(tab.id)"
              class="absolute inset-0 rounded-full scale-[2]"
              :class="'mosaic-glow'"
            />
          </span>
          <!-- Close X (hidden, shows on hover) -->
          <button
            v-if="!isPinned"
            class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-neutral-700"
            @click.stop="$emit('close')"
          >
            <X :size="14" />
          </button>
        </span>
        <input
          v-if="isRenaming"
          ref="renameInput"
          v-model="renamingName"
          class="truncate text-sm bg-neutral-800 border border-blue-500 rounded px-1 py-0 outline-none w-full min-w-[120px]"
          @keydown.enter="confirmRename"
          @keydown.escape="cancelRename"
          @blur="confirmRename"
          @click.stop
        />
        <span v-else class="truncate">{{ tab.label }}</span>
        <Pin
          :size="12"
          class="shrink-0 ml-1.5 cursor-pointer transition-opacity"
          :class="isPinned
            ? 'text-blue-400 hover:text-blue-300'
            : 'text-neutral-500 hover:text-neutral-300 opacity-0 group-hover:opacity-100'"
          @click.stop="isPinned ? $emit('unpin-thread') : $emit('pin-thread')"
        />
      </div>
    </ContextMenuTrigger>

    <ThreadContextMenu
      :is-pinned="isPinned"
      :is-archived="false"
      :copy-text="tab.id"
      :group-id="groupId"
      :tab-groups="tabGroups"
      @rename="handleRename"
      @pin="$emit('pin-thread')"
      @unpin="$emit('unpin-thread')"
      @archive="$emit('archive-thread')"
      @delete="$emit('delete-thread')"
      @add-to-group="(gId: string) => $emit('add-to-group', gId)"
      @remove-from-group="$emit('remove-from-group')"
      @create-group="$emit('create-group')"
    >
      <template #before="{ itemClass }">
        <ContextMenuItem v-if="!isPinned" :class="itemClass" @select="$emit('close')">
          <X :size="14" class="text-neutral-400" />
          Close Tab
        </ContextMenuItem>
        <ContextMenuItem :class="itemClass" @select="$emit('edit-details')">
          <SquarePen :size="14" class="text-blue-400" />
          Edit Details
        </ContextMenuItem>

        <ContextMenuSeparator class="h-px bg-neutral-700 my-1" />
      </template>
    </ThreadContextMenu>
  </ContextMenuRoot>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, computed } from 'vue';
import { X, SquarePen, Pin } from 'lucide-vue-next';
import {
  ContextMenuRoot, ContextMenuTrigger, ContextMenuItem,
  ContextMenuSeparator,
} from 'reka-ui';
import ThreadContextMenu from '#features/threads/fe/canvas/components/thread-context-menu.vue';
import type { Tab } from '#generated/types.ts';
import type { ThreadTabGroup } from './types.ts';
import type { ThreadsState } from '#features/threads/fe/state.ts';

const props = defineProps<{
  tab: Tab;
  isActive: boolean;
  isPinned: boolean;
  groupId?: string;
  tabGroups: readonly ThreadTabGroup[];
  isDragging?: boolean;
}>();

defineEmits<{
  select: [];
  close: [];
  'edit-details': [];
  'delete-thread': [];
  'unpin-thread': [];
  'pin-thread': [];
  'archive-thread': [];
  'dragstart': [event: DragEvent];
  'dragend': [event: DragEvent];
  'add-to-group': [groupId: string];
  'remove-from-group': [];
  'create-group': [];
}>();

const threadsActor: ThreadsState = useSurface();
const { state: threads, send } = useState(threadsActor);

function getThreadStateConfig(threadId: string) {
  const override = threads.value.data.chatStateOverrides[threadId];
  const activeStateId = (override && override.expiresAt > Date.now())
    ? override.id
    : (threads.value.data.chatStates[threadId] || 'idle');
  return threads.value.data.settings?.chatStates?.find(c => c.id === activeStateId);
}

function getThreadDotColor(threadId: string): string | undefined {
  return getThreadStateConfig(threadId)?.color;
}

function isThreadBusy(threadId: string): boolean {
  return getThreadStateConfig(threadId)?.busy ?? false;
}

const groupColorStyle = computed(() => {
  if (!props.groupId) return {}
  const group = props.tabGroups.find(g => g.id === props.groupId)
  if (!group) return {}
  return {
    borderTop: props.isActive ? `2px solid var(--color-${group.color})` : 'none',
    borderBottom: `2px solid var(--color-${group.color})`,
    backgroundColor: props.isActive
      ? `color-mix(in srgb, var(--color-${group.color}) 20%, rgb(28, 28, 30))`
      : `color-mix(in srgb, var(--color-${group.color}) 10%, transparent)`
  }
})

const isRenaming = ref(false)
const renamingName = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

function handleRename() {
  isRenaming.value = true
  renamingName.value = props.tab.label || ''
  setTimeout(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function confirmRename() {
  if (!isRenaming.value) return
  const trimmed = renamingName.value.trim()
  if (trimmed) {
    send({ type: 'RENAME_THREAD', threadId: props.tab.id, topic: trimmed });
  }
  isRenaming.value = false
  renamingName.value = ''
}

function cancelRename() {
  isRenaming.value = false
  renamingName.value = ''
}
</script>
