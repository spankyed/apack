<template>
  <div v-if="tabs.length > 0 || tabGroups.length > 0" class="flex flex-col flex-shrink-0">
    <!-- Pinned tabs row -->
    <div
      v-if="pinnedTabs.length > 0 || pinnedGroups.length > 0"
      ref="pinnedContainer"
      class="tab-container relative flex items-center min-h-[2.5rem] overflow-x-auto overflow-y-visible bg-neutral-900 border-b border-neutral-800"
      data-container="pinned"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @dragleave="handleDragLeave"
    >
      <!-- Drop indicator for pinned -->
      <div
        v-if="dropPosition && isPinnedContext(dropPosition.context) && dropPosition.index !== null && draggedTab"
        class="absolute top-0 bottom-0 w-0.5 pointer-events-none z-50 transition-opacity bg-blue-500"
        :style="getDropIndicatorStyle()"
      ></div>

      <!-- Pinned groups -->
      <template v-for="{ group, tabs: groupTabs } in pinnedGroups" :key="group.id">
        <!-- Group label -->
        <GroupLabel
          :group-id="group.id"
          :name="group.name"
          :color="group.color"
          :is-collapsed="group.isCollapsed"
          :is-pinned="true"
          :is-drag-over="dragOverGroupId === group.id"
          :tab-count="groupTabs.length"
          @toggle="$emit('toggle-group-collapse', group.id)"
          @rename="(name: string) => $emit('rename-group', group.id, name)"
          @change-color="(color: string) => $emit('change-group-color', group.id, color)"
          @ungroup-all="$emit('ungroup-all', group.id)"
          @close-all="$emit('close-all-in-group', group.id)"
          @delete="$emit('delete-group', group.id)"
          @pin-group="$emit('pin-group', group.id)"
          @unpin-group="$emit('unpin-group', group.id)"
          @group-drag-over="(e: DragEvent) => handleGroupDragOver(e, group.id)"
          @group-drag-leave="(e: DragEvent) => handleGroupDragLeave(e, group.id)"
          @group-drop="(e: DragEvent) => handleGroupDrop(e, group.id)"
        />

        <!-- Tabs in this pinned group (when expanded) -->
        <template v-if="!group.isCollapsed">
          <ContextMenuRoot v-for="tab in groupTabs" :key="tab.path">
            <ContextMenuTrigger as-child>
              <div
                class="relative flex items-center min-h-[2.5rem] border-r tab-item group border-neutral-800"
                :class="[
                  draggedTab?.path === tab.path ? 'opacity-50' : ''
                ]"
                :style="{
                  borderTop: activeTabPath === tab.path ? `2px solid var(--color-${group.color})` : 'none',
                  borderBottom: `2px solid var(--color-${group.color})`,
                  backgroundColor: activeTabPath === tab.path
                    ? `color-mix(in srgb, var(--color-${group.color}) 20%, rgb(28, 28, 30))`
                    : `color-mix(in srgb, var(--color-${group.color}) 10%, transparent)`
                }"
                :data-path="tab.path"
                :data-group-id="group.id"
                draggable="true"
                @dragstart="handleDragStart(tab, $event)"
                @dragend="handleDragEnd"
                @dblclick="tab.isPreview && $emit('promote-preview', tab.path)"
              >
                <button
                  @click.stop="$emit('close', tab.path)"
                  class="flex items-center justify-center w-5 h-5 mx-1.5 transition-all rounded-sm opacity-0 group-hover:opacity-100 hover:bg-neutral-700"
                >
                  <X class="w-3 h-3" />
                </button>
                <button
                  @click="$emit('select', tab.path)"
                  :title="tab.path"
                  class="flex items-center gap-2 py-2 pr-3 text-sm transition-colors"
                  :class="activeTabPath === tab.path ? 'text-neutral-100' : 'text-neutral-400'"
                >
                  <component :is="getTabIcon(tab)" class="flex-shrink-0 w-4 h-4" />
                  <input
                    v-if="renamingTabPath === tab.path"
                    ref="renameInput"
                    v-model="renameValue"
                    @blur="finishTabRename"
                    @keydown.enter.prevent="finishTabRename"
                    @keydown.esc.prevent="cancelTabRename"
                    @click.stop
                    class="w-24 px-1 text-sm bg-neutral-800 border border-blue-500 rounded outline-none text-neutral-100"
                  />
                  <span v-else class="max-w-[150px] truncate" :class="tab.isPreview ? 'italic' : ''">{{ getTabLabel(tab) }}</span>
                  <TerminalTabBadge v-if="isTerminal(tab)" :terminal-id="(tab as TerminalTab).terminalInfo.id" />
                  <span v-if="!isTerminal(tab) && !tab.isDiff && tab.pendingSaveConflict" class="w-2 h-2 bg-orange-500 rounded-full"></span>
                  <span v-else-if="!isTerminal(tab) && !tab.isDiff && tab.modified" class="w-2 h-2 bg-blue-500 rounded-full"></span>
                </button>
              </div>
            </ContextMenuTrigger>

            <ContextMenuPortal>
              <TabContextMenu
                :tab="tab"
                :tab-groups="tabGroups"
                :group-id="group.id"
                @rename="startTabRename(tab)"
                @pin-tab="pinTab(tab)"
                @unpin-tab="unpinTab(tab)"
                @remove-tab-from-group="$emit('remove-tab-from-group', $event)"
                @add-tab-to-group="$emit('add-tab-to-group', $event[0] ?? $event, $event[1])"
                @create-group="createNewGroupWithTab(tab)"
                @copy-path="copyRelativePath(tab)"
                @reveal-in-explorer="revealInExplorer(tab)"
                @kill-terminal="$emit('kill-terminal', $event)"
                @move-to-panel="$emit('move-to-panel', $event)"
              />
            </ContextMenuPortal>
          </ContextMenuRoot>
        </template>
      </template>

      <!-- Individual pinned tabs -->
      <ContextMenuRoot v-for="tab in pinnedTabs" :key="tab.path">
        <ContextMenuTrigger as-child>
          <div
            class="relative flex items-center min-h-[2.5rem] border-r tab-item group border-neutral-800"
            :class="[
              activeTabPath === tab.path ? 'bg-neutral-850' : 'bg-neutral-900 hover:bg-neutral-800',
              draggedTab?.path === tab.path ? 'opacity-50' : ''
            ]"
            :style="{
              borderTop: activeTabPath === tab.path ? '2px solid rgb(59, 130, 246)' : 'none'
            }"
            :data-path="tab.path"
            :data-context="'pinned'"
            draggable="true"
            @dragstart="handleDragStart(tab, $event)"
            @dragend="handleDragEnd"
            @dblclick="tab.isPreview && $emit('promote-preview', tab.path)"
          >
            <button
              @click="$emit('select', tab.path)"
              :title="tab.path"
              class="flex items-center gap-2 py-2 px-3 text-sm transition-colors"
              :class="activeTabPath === tab.path ? 'text-neutral-100' : 'text-neutral-400'"
            >
              <component :is="getTabIcon(tab)" class="flex-shrink-0 w-4 h-4" />
              <input
                v-if="renamingTabPath === tab.path"
                ref="renameInput"
                v-model="renameValue"
                @blur="finishTabRename"
                @keydown.enter.prevent="finishTabRename"
                @keydown.esc.prevent="cancelTabRename"
                @click.stop
                class="w-24 px-1 text-sm bg-neutral-800 border border-blue-500 rounded outline-none text-neutral-100"
              />
              <span v-else class="max-w-[150px] truncate" :class="tab.isPreview ? 'italic' : ''">{{ getTabLabel(tab) }}</span>
              <Pin
                v-if="tab.isPinned"
                class="w-3 h-3 ml-1 text-neutral-400 cursor-pointer hover:text-neutral-200 transition-colors"
                @click.stop="unpinTab(tab)"
                title="Click to unpin"
              />
              <span v-if="!isTerminal(tab) && !tab.isDiff && tab.pendingSaveConflict" class="w-2 h-2 bg-orange-500 rounded-full"></span>
              <span v-else-if="!isTerminal(tab) && !tab.isDiff && tab.modified" class="w-2 h-2 bg-blue-500 rounded-full"></span>
            </button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuPortal>
          <TabContextMenu
            :tab="tab"
            :tab-groups="tabGroups"
            @rename="startTabRename(tab)"
            @pin-tab="pinTab(tab)"
            @unpin-tab="unpinTab(tab)"
            @remove-tab-from-group="$emit('remove-tab-from-group', $event)"
            @add-tab-to-group="$emit('add-tab-to-group', $event[0] ?? $event, $event[1])"
            @create-group="createNewGroupWithTab(tab)"
            @copy-path="copyRelativePath(tab)"
            @reveal-in-explorer="revealInExplorer(tab)"
            @kill-terminal="$emit('kill-terminal', $event)"
            @move-to-panel="$emit('move-to-panel', $event)"
          />
        </ContextMenuPortal>
      </ContextMenuRoot>
    </div>

    <!-- Main tabs row (groups + ungrouped) -->
    <div
      ref="mainContainer"
      class="tab-container relative flex items-center min-h-[2.5rem] overflow-x-auto overflow-y-visible bg-neutral-900 border-b border-neutral-800"
      data-container="main"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @dragleave="handleDragLeave"
    >
      <!-- Drop indicator for main -->
      <div
        v-if="dropPosition && !isPinnedContext(dropPosition.context) && dropPosition.index !== null && draggedTab"
        class="absolute top-0 bottom-0 w-0.5 pointer-events-none z-50 transition-opacity"
        :style="getDropIndicatorStyle()"
      ></div>

    <!-- Groups inline (label + expanded tabs) -->
    <template v-for="group in sortedGroups" :key="group.id">
      <!-- Group label -->
      <GroupLabel
        :group-id="group.id"
        :name="group.name"
        :color="group.color"
        :is-collapsed="group.isCollapsed"
        :is-pinned="group.isPinned || false"
        :is-drag-over="dragOverGroupId === group.id"
        :tab-count="getTabsForGroup(group.id).length"
        @toggle="$emit('toggle-group-collapse', group.id)"
        @rename="(name: string) => $emit('rename-group', group.id, name)"
        @change-color="(color: string) => $emit('change-group-color', group.id, color)"
        @ungroup-all="$emit('ungroup-all', group.id)"
        @close-all="$emit('close-all-in-group', group.id)"
        @delete="$emit('delete-group', group.id)"
        @pin-group="$emit('pin-group', group.id)"
        @unpin-group="$emit('unpin-group', group.id)"
        @group-drag-over="(e: DragEvent) => handleGroupDragOver(e, group.id)"
        @group-drag-leave="(e: DragEvent) => handleGroupDragLeave(e, group.id)"
        @group-drop="(e: DragEvent) => handleGroupDrop(e, group.id)"
      />

      <!-- Tabs in this group (when expanded) -->
      <template v-if="!group.isCollapsed">
        <ContextMenuRoot v-for="tab in getTabsForGroup(group.id)" :key="tab.path">
          <ContextMenuTrigger as-child>
            <div
              class="relative flex items-center min-h-[2.5rem] border-r tab-item group border-neutral-800"
              :class="[
                draggedTab?.path === tab.path ? 'opacity-50' : ''
              ]"
              :style="{
                borderTop: activeTabPath === tab.path ? `2px solid var(--color-${group.color})` : 'none',
                borderBottom: `2px solid var(--color-${group.color})`,
                backgroundColor: activeTabPath === tab.path
                  ? `color-mix(in srgb, var(--color-${group.color}) 20%, rgb(28, 28, 30))`
                  : `color-mix(in srgb, var(--color-${group.color}) 10%, transparent)`
              }"
              :data-path="tab.path"
              :data-group-id="group.id"
              draggable="true"
              @dragstart="handleDragStart(tab, $event)"
              @dragend="handleDragEnd"
              @dblclick="tab.isPreview && $emit('promote-preview', tab.path)"
            >
              <button
                @click.stop="$emit('close', tab.path)"
                class="flex items-center justify-center w-5 h-5 mx-1.5 transition-all rounded-sm opacity-0 group-hover:opacity-100 hover:bg-neutral-700"
              >
                <X class="w-3 h-3" />
              </button>
              <button
                @click="$emit('select', tab.path)"
                :title="tab.path"
                class="flex items-center gap-2 py-2 pr-3 text-sm transition-colors"
                :class="activeTabPath === tab.path ? 'text-neutral-100' : 'text-neutral-400'"
              >
                <component :is="getTabIcon(tab)" class="flex-shrink-0 w-4 h-4" />
                <span class="max-w-[150px] truncate" :class="tab.isPreview ? 'italic' : ''">{{ getTabLabel(tab) }}</span>
                <span v-if="!isTerminal(tab) && !tab.isDiff && tab.pendingSaveConflict" class="w-2 h-2 bg-orange-500 rounded-full"></span>
                <span v-else-if="!isTerminal(tab) && !tab.isDiff && tab.modified" class="w-2 h-2 bg-blue-500 rounded-full"></span>
              </button>
            </div>
          </ContextMenuTrigger>

          <ContextMenuPortal>
            <TabContextMenu
              :tab="tab"
              :tab-groups="tabGroups"
              :group-id="group.id"
              @rename="startTabRename(tab)"
              @pin-tab="pinTab(tab)"
              @unpin-tab="unpinTab(tab)"
              @remove-tab-from-group="$emit('remove-tab-from-group', $event)"
              @add-tab-to-group="$emit('add-tab-to-group', $event[0] ?? $event, $event[1])"
              @create-group="createNewGroupWithTab(tab)"
              @copy-path="copyRelativePath(tab)"
              @reveal-in-explorer="revealInExplorer(tab)"
              @kill-terminal="$emit('kill-terminal', $event)"
              @move-to-panel="$emit('move-to-panel', $event)"
            />
          </ContextMenuPortal>
        </ContextMenuRoot>
      </template>
    </template>

    <!-- Ungrouped tabs inline -->
    <ContextMenuRoot v-for="tab in ungroupedTabs" :key="tab.path">
      <ContextMenuTrigger as-child>
        <div
          class="relative flex items-center min-h-[2.5rem] border-r tab-item group border-neutral-800"
          :class="[
            activeTabPath === tab.path ? 'bg-neutral-850' : 'bg-neutral-900 hover:bg-neutral-800',
            draggedTab?.path === tab.path ? 'opacity-50' : ''
          ]"
          :style="{
            borderTop: activeTabPath === tab.path ? '2px solid rgb(59, 130, 246)' : 'none'
          }"
          :data-path="tab.path"
          :data-context="'ungrouped'"
          draggable="true"
          @dragstart="handleDragStart(tab, $event)"
          @dragend="handleDragEnd"
          @dblclick="tab.isPreview && $emit('promote-preview', tab.path)"
        >
          <button
            @click.stop="$emit('close', tab.path)"
            class="flex items-center justify-center w-5 h-5 mx-1.5 transition-all rounded-sm opacity-0 group-hover:opacity-100 hover:bg-neutral-700"
          >
            <X class="w-3 h-3" />
          </button>
          <button
            @click="$emit('select', tab.path)"
            :title="tab.path"
            class="flex items-center gap-2 py-2 pr-3 text-sm transition-colors"
            :class="activeTabPath === tab.path ? 'text-neutral-100' : 'text-neutral-400'"
          >
            <component :is="getTabIcon(tab)" class="flex-shrink-0 w-4 h-4" />
            <input
              v-if="renamingTabPath === tab.path"
              ref="renameInput"
              v-model="renameValue"
              @blur="finishTabRename"
              @keydown.enter.prevent="finishTabRename"
              @keydown.esc.prevent="cancelTabRename"
              @click.stop
              class="w-24 px-1 text-sm bg-neutral-800 border border-blue-500 rounded outline-none text-neutral-100"
            />
            <span v-else class="max-w-[150px] truncate" :class="tab.isPreview ? 'italic' : ''">{{ getTabLabel(tab) }}</span>
            <span v-if="!isTerminal(tab) && !tab.isDiff && tab.pendingSaveConflict" class="w-2 h-2 bg-orange-500 rounded-full"></span>
            <span v-else-if="!isTerminal(tab) && !tab.isDiff && tab.modified" class="w-2 h-2 bg-blue-500 rounded-full"></span>
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuPortal>
          <TabContextMenu
            :tab="tab"
            :tab-groups="tabGroups"
            @rename="startTabRename(tab)"
            @pin-tab="pinTab(tab)"
            @unpin-tab="unpinTab(tab)"
            @remove-tab-from-group="$emit('remove-tab-from-group', $event)"
            @add-tab-to-group="$emit('add-tab-to-group', $event[0] ?? $event, $event[1])"
            @create-group="createNewGroupWithTab(tab)"
            @copy-path="copyRelativePath(tab)"
            @reveal-in-explorer="revealInExplorer(tab)"
            @kill-terminal="$emit('kill-terminal', $event)"
            @move-to-panel="$emit('move-to-panel', $event)"
          />
      </ContextMenuPortal>
    </ContextMenuRoot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  X,
  GitCompare,
  Terminal,
  Play,
  Sparkle,
  Pin,
} from 'lucide-vue-next'
import type { OpenFile, TerminalTab, TabGroup as TabGroupType } from '#features/code/fe/state.ts'
import type { ActionTab } from '#features/code/fe/features/actions/state.ts'
import type { PromptTab } from '#features/code/fe/features/prompts/state.ts'
import { groupTabs } from '../utils/tab-management.ts'
import { getFileIcon } from '../utils/file-icons.ts'
import GroupLabel from '../components/GroupLabel.vue'
import TabContextMenu from '../components/TabContextMenu.vue'
import TerminalTabBadge from '../features/terminal/TerminalTabBadge.vue'
import { useTabDragDrop } from '../composables/useTabDragDrop.ts'
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
} from 'reka-ui'

// Props
const props = defineProps<{
  tabs: (OpenFile | TerminalTab | ActionTab | PromptTab)[]
  activeTabPath: string | null
  baseDirectory?: string
  tabGroups: TabGroupType[]
}>()

// Emits
const emit = defineEmits<{
  select: [path: string]
  close: [path: string]
  reorder: [fromIndex: number, toIndex: number]
  'reveal-in-explorer': [path: string]
  'pin-tab': [path: string]
  'unpin-tab': [path: string]
  'pin-tab-at': [path: string, targetPath: string, side: 'left' | 'right']
  'unpin-tab-at': [path: string, targetPath: string, side: 'left' | 'right']
  'create-group': [name: string, tabPaths: string[]]
  'rename-group': [groupId: string, name: string]
  'change-group-color': [groupId: string, color: string]
  'delete-group': [groupId: string]
  'toggle-group-collapse': [groupId: string]
  'add-tab-to-group': [tabPath: string, groupId: string]
  'remove-tab-from-group': [path: string]
  'ungroup-all': [groupId: string]
  'close-all-in-group': [groupId: string]
  'pin-group': [groupId: string]
  'unpin-group': [groupId: string]
  'rename-terminal': [path: string, customTitle: string]
  'kill-terminal': [path: string]
  'move-to-panel': [path: string]
  'promote-preview': [path: string]
}>()

// Categorize tabs using utility function - must be reactive!
const categorizedTabs = computed(() =>
  groupTabs(props.tabs, props.tabGroups)
)

const pinnedTabs = computed(() => categorizedTabs.value.pinnedTabs)
const pinnedGroups = computed(() => categorizedTabs.value.pinnedGroups || [])
const groupedTabs = computed(() => categorizedTabs.value.groupedTabs)
const ungroupedTabs = computed(() => categorizedTabs.value.ungroupedTabs)

// Sorted groups by order (unpinned groups only)
const sortedGroups = computed(() =>
  [...props.tabGroups].filter(g => !g.isPinned).sort((a, b) => a.order - b.order)
)

// Get tabs for a specific group - reactive function (checks both pinned and unpinned groups)
const getTabsForGroup = (groupId: string) => {
  // Check unpinned groups first
  const unpinnedGroupTabs = groupedTabs.value.get(groupId)
  if (unpinnedGroupTabs) return unpinnedGroupTabs

  // Check pinned groups
  const pinnedGroup = pinnedGroups.value.find(pg => pg.group.id === groupId)
  return pinnedGroup?.tabs || []
}

// Helper to check if context is in pinned row (individual pinned or pinned group)
const isPinnedContext = (context: string) => {
  if (context === 'pinned') return true
  // Check if context is a pinned group ID
  const group = props.tabGroups.find(g => g.id === context)
  return group?.isPinned || false
}

// Container refs
const pinnedContainer = ref<HTMLElement | null>(null)
const mainContainer = ref<HTMLElement | null>(null)

// Auto-scroll to active tab when it changes
watch(() => props.activeTabPath, (path) => {
  if (!path) return
  const selector = `[data-path="${CSS.escape(path)}"]`
  const el = pinnedContainer.value?.querySelector(selector) ?? mainContainer.value?.querySelector(selector)
  el?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
}, { flush: 'post' })

// Drag and drop
const {
  draggedTab,
  dropPosition,
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleDragEnd,
  handleDragLeave,
  getDropIndicatorStyle
} = useTabDragDrop({
  tabs: computed(() => props.tabs),
  pinnedTabs,
  ungroupedTabs,
  getTabsForGroup,
  tabGroups: computed(() => props.tabGroups),
  pinnedContainer,
  mainContainer,
  onPinTab: (path: string) => emit('pin-tab', path),
  onUnpinTab: (path: string) => emit('unpin-tab', path),
  onPinTabAt: (path: string, targetPath: string, side: 'left' | 'right') => emit('pin-tab-at', path, targetPath, side),
  onUnpinTabAt: (path: string, targetPath: string, side: 'left' | 'right') => emit('unpin-tab-at', path, targetPath, side),
  onAddToGroup: (path: string, groupId: string) => emit('add-tab-to-group', path, groupId),
  onRemoveFromGroup: (path: string) => emit('remove-tab-from-group', path),
  onReorder: (fromIndex: number, toIndex: number) => emit('reorder', fromIndex, toIndex)
})

// Track which group is being dragged over
const dragOverGroupId = ref<string | null>(null)

// Group drag-over handling for auto-expand
const handleGroupDragOver = (event: DragEvent, groupId: string) => {
  const group = props.tabGroups.find(g => g.id === groupId)

  // Set drag over state for visual feedback
  dragOverGroupId.value = groupId

  // Only handle collapsed groups - let normal logic handle expanded groups
  if (!group || !group.isCollapsed) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  // Now we know it's collapsed - prevent default and stop propagation
  event.preventDefault()
  event.stopPropagation()

  // Expand immediately (no timer)
  emit('toggle-group-collapse', groupId)
}

const handleGroupDragLeave = (event: DragEvent, groupId: string) => {
  // Check if we're truly leaving the group label
  const relatedTarget = event.relatedTarget as HTMLElement
  if (relatedTarget && relatedTarget.closest('.group-label')?.getAttribute('data-group-id') === groupId) {
    return
  }

  if (dragOverGroupId.value === groupId) {
    dragOverGroupId.value = null
  }
}

// Group drop handling
const handleGroupDrop = (event: DragEvent, groupId: string) => {
  if (!draggedTab.value) return

  event.preventDefault()
  event.stopPropagation()

  const sourceTab = props.tabs.find(t => t.path === draggedTab.value!.path)
  if (!sourceTab) return

  // Get source context
  const sourceContext = sourceTab.isPinned && sourceTab.groupId
    ? sourceTab.groupId
    : sourceTab.isPinned
      ? 'pinned'
      : sourceTab.groupId || 'ungrouped'

  // Add tab to this group
  if (sourceContext !== groupId) {
    // Moving from different context - handle context change
    if (sourceContext === 'pinned') {
      // From individual pinned
      emit('unpin-tab', sourceTab.path)
      emit('add-tab-to-group', sourceTab.path, groupId)
    } else if (sourceTab.isPinned) {
      // From pinned group - unpin and change groups
      emit('unpin-tab', sourceTab.path)
      emit('add-tab-to-group', sourceTab.path, groupId)
    } else {
      // From ungrouped or different group
      if (sourceContext !== 'ungrouped') {
        emit('remove-tab-from-group', sourceTab.path)
      }
      emit('add-tab-to-group', sourceTab.path, groupId)
    }
  }

  // Reset drag state
  draggedTab.value = null
  dropPosition.value = { index: null, side: 'left', context: 'pinned' }
  dragOverGroupId.value = null
}

// Terminal tab rename
const renamingTabPath = ref<string | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null)

const startTabRename = async (tab: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  if (!isTerminal(tab)) return
  renamingTabPath.value = tab.path
  renameValue.value = tab.terminalInfo.customTitle || tab.terminalInfo.title
  // Delay focus until after the context menu fully unmounts
  setTimeout(() => {
    const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
    el?.focus()
    el?.select()
  }, 50)
}

const finishTabRename = () => {
  if (renamingTabPath.value && renameValue.value.trim()) {
    emit('rename-terminal', renamingTabPath.value, renameValue.value.trim())
  }
  cancelTabRename()
}

const cancelTabRename = () => {
  renamingTabPath.value = null
  renameValue.value = ''
}

// Helper to check if a file is a terminal
const isTerminal = (file: OpenFile | TerminalTab | ActionTab | PromptTab): file is TerminalTab => {
  return 'isTerminal' in file && file.isTerminal === true
}

// Helper functions
const getFileName = (path: string) => {
  return path.split('/').pop() || path
}

const getTabLabel = (file: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  if (isTerminal(file)) {
    return file.terminalInfo.customTitle || file.terminalInfo.title
  }
  if ('isDiff' in file && file.isDiff && (file as any).gitFile) {
    const fileName = getFileName((file as any).gitFile.path)
    const status = (file as any).gitFile.staged ? 'staged' : 'unstaged'
    return `${fileName} (${status})`
  }
  if ('isAction' in file && file.isAction && 'actionEntity' in file) {
    return (file as any).actionEntity.label
  }
  if ('isPrompt' in file && file.isPrompt && 'promptEntity' in file) {
    return (file as any).promptEntity.label
  }
  return getFileName(file.path)
}

const getTabIcon = (file: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  if (isTerminal(file)) return Terminal
  if ('isDiff' in file && file.isDiff) return GitCompare
  if ('isAction' in file && file.isAction) return Play
  if ('isPrompt' in file && file.isPrompt) return Sparkle
  return getFileIcon(getFileExtension(file.path))
}

const getFileExtension = (path: string) => {
  const parts = path.split('.')
  return parts.length > 1 ? parts.pop() : ''
}


// Context menu actions
const copyRelativePath = async (tab: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  try {
    let relativePath = tab.path
    if (props.baseDirectory) {
      const normalizedRoot = props.baseDirectory.replace(/\\/g, '/')
      const normalizedPath = tab.path.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedRoot)) {
        relativePath = normalizedPath.slice(normalizedRoot.length)
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.slice(1)
        }
      }
    }
    await navigator.clipboard.writeText(relativePath)
  } catch (err) {
    console.error('Failed to copy path to clipboard:', err)
  }
}

const revealInExplorer = (tab: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  emit('reveal-in-explorer', tab.path)
}

const pinTab = (tab: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  emit('pin-tab', tab.path)
}

const unpinTab = (tab: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  emit('unpin-tab', tab.path)
}

const createNewGroupWithTab = (tab: OpenFile | TerminalTab | ActionTab | PromptTab) => {
  // Create a new group with this tab
  const groupName = `Group ${props.tabGroups.length + 1}`
  emit('create-group', groupName, [tab.path])
}
</script>

<style>
.bg-neutral-850 {
  background-color: rgb(28, 28, 30);
}

/* Custom CSS variables for tab group colors */
:root {
  --color-blue: rgb(59, 130, 246);
  --color-blue-text: rgb(229, 231, 235);

  --color-purple: rgb(147, 51, 234);
  --color-purple-text: rgb(229, 231, 235);

  --color-pink: rgb(219, 39, 119);
  --color-pink-text: rgb(23, 23, 23);

  --color-red: rgb(239, 68, 68);
  --color-red-text: rgb(23, 23, 23);

  --color-orange: rgb(249, 115, 22);
  --color-orange-text: rgb(23, 23, 23);

  --color-yellow: rgb(202, 138, 4);
  --color-yellow-text: rgb(23, 23, 23);

  --color-green: rgb(34, 197, 94);
  --color-green-text: rgb(23, 23, 23);

  --color-teal: rgb(20, 184, 166);
  --color-teal-text: rgb(23, 23, 23);

  --color-gray: rgb(107, 114, 128);
  --color-gray-text: rgb(229, 231, 235);
}

/* Custom horizontal scrollbar for tab containers */
.tab-container::-webkit-scrollbar {
  height: 6px;
}

.tab-container::-webkit-scrollbar-track {
  background: transparent;
}

.tab-container::-webkit-scrollbar-thumb {
  background: rgb(82, 82, 82);
  border-radius: 3px;
}

.tab-container::-webkit-scrollbar-thumb:hover {
  background: rgb(115, 115, 115);
}

/* Firefox scrollbar styling */
.tab-container {
  scrollbar-width: thin;
  scrollbar-color: rgb(82, 82, 82) transparent;
}
</style>
