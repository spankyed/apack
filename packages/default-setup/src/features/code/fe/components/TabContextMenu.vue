<template>
  <ContextMenuContent class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg z-50">
    <!-- Rename (terminal only) -->
    <ContextMenuItem
      v-if="isTerminalTab"
      @select="$emit('rename', tab.path)"
      class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
    >
      <Pencil class="w-4 h-4" />
      Rename
    </ContextMenuItem>

    <!-- Pin / Unpin -->
    <ContextMenuItem
      v-if="tab.isPinned"
      @select="$emit('unpin-tab', tab.path)"
      class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
    >
      <Pin class="w-4 h-4" />
      Unpin tab
    </ContextMenuItem>
    <ContextMenuItem
      v-else-if="!groupId"
      @select="$emit('pin-tab', tab.path)"
      class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
    >
      <Pin class="w-4 h-4" />
      Pin tab
    </ContextMenuItem>

    <!-- Remove from group (grouped tabs only) -->
    <ContextMenuItem
      v-if="groupId"
      @select="$emit('remove-tab-from-group', tab.path)"
      class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
    >
      <FolderMinus class="w-4 h-4" />
      Remove from group
    </ContextMenuItem>

    <!-- Add to Group (ungrouped / pinned tabs only) -->
    <template v-if="!groupId">
      <ContextMenuSub v-if="tabGroups.length > 0">
        <ContextMenuSubTrigger class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none">
          <FolderPlus class="w-4 h-4" />
          Add to Group
          <ChevronRight class="w-3 h-3 ml-auto" />
        </ContextMenuSubTrigger>
        <ContextMenuPortal>
          <ContextMenuSubContent class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50">
            <ContextMenuItem
              v-for="group in tabGroups"
              :key="group.id"
              @select="$emit('add-tab-to-group', tab.path, group.id)"
              class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
            >
              <div
                class="w-3 h-3 rounded-full"
                :style="{ backgroundColor: `var(--color-${group.color})` }"
              />
              <span>{{ group.name }}</span>
            </ContextMenuItem>
            <ContextMenuSeparator class="h-px bg-neutral-700" />
            <ContextMenuItem
              @select="$emit('create-group', tab.path)"
              class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
            >
              <FolderPlus class="w-4 h-4" />
              New Group
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuPortal>
      </ContextMenuSub>

      <ContextMenuItem
        v-else
        @select="$emit('create-group', tab.path)"
        class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      >
        <FolderPlus class="w-4 h-4" />
        Add to New Group
      </ContextMenuItem>
    </template>

    <!-- File operations -->
    <template v-if="showFileOperations">
      <ContextMenuSeparator class="h-px bg-neutral-700" />

      <ContextMenuItem
        @select="$emit('copy-path', tab.path)"
        class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      >
        <Copy class="w-4 h-4" />
        Copy relative path
      </ContextMenuItem>

      <ContextMenuItem
        @select="$emit('reveal-in-explorer', tab.path)"
        class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      >
        <FolderOpen class="w-4 h-4" />
        Reveal in explorer
      </ContextMenuItem>

      <ContextMenuItem
        @select="showFileHistory"
        class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      >
        <History class="w-4 h-4" />
        File history
      </ContextMenuItem>
    </template>

    <!-- Terminal actions -->
    <template v-if="isTerminalTab">
      <ContextMenuSeparator class="h-px bg-neutral-700" />
      <ContextMenuItem
        @select="$emit('move-to-panel', tab.path)"
        class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      >
        <PanelBottom class="w-4 h-4" />
        Move to Panel
      </ContextMenuItem>
      <ContextMenuItem
        @select="$emit('kill-terminal', tab.path)"
        class="flex items-center gap-2 px-3 py-1.5 text-sm transition-colors cursor-pointer text-red-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      >
        <X class="w-4 h-4" />
        Kill Terminal
      </ContextMenuItem>
    </template>
  </ContextMenuContent>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from 'reka-ui'
import {
  X,
  FolderMinus,
  Copy,
  FolderOpen,
  FolderPlus,
  Pin,
  ChevronRight,
  Pencil,
  PanelBottom,
  History
} from 'lucide-vue-next'
import { useSurface } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import { panelChild } from '#features/code/fe/features/children.ts'
import type { OpenFile, TerminalTab, TabGroup as TabGroupType } from '#features/code/fe/state.ts'
import type { ActionTab } from '#features/code/fe/features/actions/state.ts'
import type { PromptTab } from '#features/code/fe/features/prompts/state.ts'

type TabType = OpenFile | TerminalTab | ActionTab | PromptTab

const codeActor: CodeState = useSurface()

/** The file's history in the Source Control panel's log, from the top of the folder, and the panel shown */
function showFileHistory() {
  const base = codeActor.getSnapshot().context.baseDirectory as string | null
  const path = base && props.tab.path.startsWith(`${base}/`) ? props.tab.path.slice(base.length + 1) : props.tab.path
  panelChild(codeActor, 'commit')?.send({ type: 'commit.SHOW_FILE_HISTORY', path })
  codeActor.send({ type: 'SELECT_PANEL', panel: 'commit' })
}

const props = defineProps<{
  tab: TabType
  tabGroups: TabGroupType[]
  groupId?: string
}>()

defineEmits<{
  'rename': [path: string]
  'pin-tab': [path: string]
  'unpin-tab': [path: string]
  'remove-tab-from-group': [path: string]
  'add-tab-to-group': [path: string, groupId: string]
  'create-group': [tabPath: string]
  'copy-path': [path: string]
  'reveal-in-explorer': [path: string]
  'kill-terminal': [path: string]
  'move-to-panel': [path: string]
}>()

const isTerminalTab = computed(() => 'isTerminal' in props.tab && props.tab.isTerminal === true)

const showFileOperations = computed(() => {
  if (isTerminalTab.value) return false
  if ('isDiff' in props.tab && props.tab.isDiff) return false
  if ('isAction' in props.tab && props.tab.isAction) return false
  if ('isPrompt' in props.tab && props.tab.isPrompt) return false
  return true
})
</script>
