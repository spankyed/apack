<template>
  <ContextMenuPortal>
    <ContextMenuContent
      class="bg-neutral-800 border border-neutral-700 rounded-md p-1 min-w-[160px] shadow-[0_10px_38px_-10px_rgba(0,0,0,0.75),0_10px_20px_-15px_rgba(0,0,0,0.4)] z-50"
      :side-offset="2"
    >
      <slot name="before" :item-class="itemClass" />

      <ContextMenuItem :class="itemClass" @select="$emit('rename')">
        <Pencil :size="14" class="text-neutral-400" />
        Rename
      </ContextMenuItem>

      <ContextMenuItem :class="itemClass" @select="handleCopyId">
        <Copy :size="14" class="text-neutral-400" />
        Copy Id
      </ContextMenuItem>

      <ContextMenuSeparator class="h-px bg-neutral-700 my-1" />

      <!-- Group management -->
      <template v-if="tabGroups">
        <template v-if="groupId">
          <ContextMenuItem :class="itemClass" @select="$emit('remove-from-group')">
            <FolderMinus :size="14" class="text-neutral-400" />
            Remove from Group
          </ContextMenuItem>
        </template>
        <template v-else>
          <ContextMenuSub v-if="tabGroups.length > 0">
            <ContextMenuSubTrigger :class="itemClass">
              <FolderPlus :size="14" class="text-neutral-400" />
              Add to Group
              <ChevronRight :size="12" class="ml-auto text-neutral-500" />
            </ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent class="min-w-[140px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50">
                <ContextMenuItem
                  v-for="group in tabGroups"
                  :key="group.id"
                  :class="itemClass"
                  @select="$emit('add-to-group', group.id)"
                >
                  <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: `var(--color-${group.color})` }" />
                  {{ group.name }}
                </ContextMenuItem>
                <ContextMenuSeparator class="h-px bg-neutral-700 my-1" />
                <ContextMenuItem :class="itemClass" @select="$emit('create-group')">
                  <FolderPlus :size="14" class="text-blue-400" />
                  New Group
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <ContextMenuItem v-else :class="itemClass" @select="$emit('create-group')">
            <FolderPlus :size="14" class="text-blue-400" />
            New Group
          </ContextMenuItem>
        </template>
        <ContextMenuSeparator class="h-px bg-neutral-700 my-1" />
      </template>

      <ContextMenuItem v-if="isPinned" :class="itemClass" @select="$emit('unpin')">
        <Pin :size="14" class="text-neutral-400" />
        Unpin
      </ContextMenuItem>
      <ContextMenuItem v-else :class="itemClass" @select="$emit('pin')">
        <Pin :size="14" class="text-neutral-400" />
        Pin
      </ContextMenuItem>
      <ContextMenuItem v-if="isArchived" :class="itemClass" @select="$emit('unarchive')">
        <ArchiveRestore :size="14" class="text-amber-400" />
        Unarchive
      </ContextMenuItem>
      <ContextMenuItem v-else-if="!isPinned" :class="itemClass" @select="$emit('archive')">
        <Archive :size="14" class="text-amber-400" />
        Archive
      </ContextMenuItem>

      <ContextMenuSeparator class="h-px bg-neutral-700 my-1" />
      <ContextMenuItem
        class="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer text-red-400 hover:bg-neutral-700 transition-colors outline-none"
        @select="$emit('delete')"
      >
        <Trash2 :size="14" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenuPortal>
</template>

<script setup lang="ts">
import { Archive, ArchiveRestore, ChevronRight, Copy, FolderMinus, FolderPlus, Pencil, Pin, Trash2 } from 'lucide-vue-next';
import {
  ContextMenuPortal, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from 'reka-ui';
import type { ThreadTabGroup } from '#features/threads/fe/canvas/agent/tabs/types.ts';

const props = defineProps<{
  isPinned: boolean;
  isArchived: boolean;
  copyText: string;
  groupId?: string;
  tabGroups?: readonly ThreadTabGroup[];
}>();

defineEmits<{
  rename: [];
  pin: [];
  unpin: [];
  archive: [];
  unarchive: [];
  delete: [];
  'add-to-group': [groupId: string];
  'remove-from-group': [];
  'create-group': [];
}>();

const itemClass = 'flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer text-neutral-50 hover:bg-neutral-700 transition-colors outline-none';

function handleCopyId() {
  navigator.clipboard.writeText(props.copyText);
}
</script>
