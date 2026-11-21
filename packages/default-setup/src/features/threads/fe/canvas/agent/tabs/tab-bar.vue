<template>
  <div class="min-w-0 w-full flex flex-col flex-shrink-0">
    <!-- Pinned row -->
    <div
      v-if="categorized.pinnedTabs.length > 0 || categorized.pinnedGroups.length > 0"
      ref="pinnedContainer"
      class="tab-container relative flex items-center min-w-full overflow-x-auto overflow-y-visible border-b border-neutral-800"
      data-container="pinned"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @dragleave="handleDragLeave"
      @wheel.prevent="(e: WheelEvent) => (e.currentTarget as HTMLElement).scrollLeft += e.deltaY"
    >
      <!-- Drop indicator for pinned -->
      <div
        v-if="dropPosition && isPinnedContext(dropPosition.context) && dropPosition.index !== null && draggedTab"
        class="absolute top-0 bottom-0 w-0.5 pointer-events-none z-50 transition-opacity bg-blue-500"
        :style="getDropIndicatorStyle()"
      ></div>

      <!-- Pinned groups -->
      <template v-for="{ group, tabs: groupTabs } in categorized.pinnedGroups" :key="group.id">
        <GroupLabel
          :group-id="group.id"
          :name="group.name"
          :color="group.color"
          :is-collapsed="group.isCollapsed"
          :is-pinned="true"
          :is-drag-over="dragOverGroupId === group.id"
          :tab-count="groupTabs.length"
          :auto-edit="group.id === newlyCreatedGroupId"
          @toggle="actor.send({ type: 'TOGGLE_TAB_GROUP_COLLAPSE', groupId: group.id })"
          @rename="(name: string) => actor.send({ type: 'RENAME_TAB_GROUP', groupId: group.id, name })"
          @change-color="(color: string) => actor.send({ type: 'CHANGE_TAB_GROUP_COLOR', groupId: group.id, color: color as TabGroupColor })"
          @ungroup-all="actor.send({ type: 'UNGROUP_ALL_IN_GROUP', groupId: group.id })"
          @close-all="actor.send({ type: 'CLOSE_ALL_IN_GROUP', groupId: group.id })"
          @pin-group="actor.send({ type: 'PIN_TAB_GROUP', groupId: group.id })"
          @unpin-group="actor.send({ type: 'UNPIN_TAB_GROUP', groupId: group.id })"
          @edit-started="newlyCreatedGroupId = null"
          @group-drag-over="(e: DragEvent) => handleGroupDragOver(e, group.id)"
          @group-drag-leave="(e: DragEvent) => handleGroupDragLeave(e, group.id)"
          @group-drop="(e: DragEvent) => handleGroupDrop(e, group.id)"
        />
        <template v-if="!group.isCollapsed">
          <TabItem
            v-for="tab in groupTabs"
            :key="tab.id"
            :tab="tab"
            :isActive="tab.id === activeTabId"
            :isPinned="true"
            :groupId="group.id"
            :tabGroups="tabGroups"
            :isDragging="draggedTab?.id === tab.id"
            @select="selectTab(tab.id)"
            @close="actor.send({ type: 'CLOSE_TAB', tabId: tab.id })"
            @edit-details="actor.send({ type: 'SELECT_THREAD', id: tab.id })"
            @delete-thread="actor.send({ type: 'DELETE_THREAD', threadId: tab.id })"
            @archive-thread="actor.send({ type: 'ARCHIVE_THREAD', threadId: tab.id })"
            @unpin-thread="actor.send({ type: 'UNPIN_THREAD', threadId: tab.id })"
            @pin-thread="actor.send({ type: 'PIN_THREAD', threadId: tab.id })"
            @dragstart="handleDragStart(tab, $event)"
            @dragend="handleDragEnd"
            @add-to-group="(gId: string) => actor.send({ type: 'ADD_TAB_TO_GROUP', tabId: tab.id, groupId: gId })"
            @remove-from-group="actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId: tab.id })"
            @create-group="actor.send({ type: 'CREATE_TAB_GROUP', tabIds: [tab.id] })"
          />
        </template>
      </template>

      <!-- Individual pinned tabs (no group) -->
      <TabItem
        v-for="tab in categorized.pinnedTabs"
        :key="tab.id"
        :tab="tab"
        :isActive="tab.id === activeTabId"
        :isPinned="true"
        :tabGroups="tabGroups"
        :isDragging="draggedTab?.id === tab.id"
        @select="selectTab(tab.id)"
        @close="actor.send({ type: 'CLOSE_TAB', tabId: tab.id })"
        @edit-details="actor.send({ type: 'SELECT_THREAD', id: tab.id })"
        @delete-thread="actor.send({ type: 'DELETE_THREAD', threadId: tab.id })"
        @archive-thread="actor.send({ type: 'ARCHIVE_THREAD', threadId: tab.id })"
        @unpin-thread="actor.send({ type: 'UNPIN_THREAD', threadId: tab.id })"
        @pin-thread="actor.send({ type: 'PIN_THREAD', threadId: tab.id })"
        @dragstart="handleDragStart(tab, $event)"
        @dragend="handleDragEnd"
        @add-to-group="(gId: string) => actor.send({ type: 'ADD_TAB_TO_GROUP', tabId: tab.id, groupId: gId })"
        @remove-from-group="actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId: tab.id })"
        @create-group="actor.send({ type: 'CREATE_TAB_GROUP', tabIds: [tab.id] })"
      />
    </div>

    <!-- Main/unpinned row -->
    <div
      ref="mainContainer"
      class="tab-container relative flex items-center min-w-full overflow-x-auto overflow-y-visible"
      data-container="main"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @dragleave="handleDragLeave"
      @wheel.prevent="(e: WheelEvent) => (e.currentTarget as HTMLElement).scrollLeft += e.deltaY"
    >
      <!-- Drop indicator for main -->
      <div
        v-if="dropPosition && !isPinnedContext(dropPosition.context) && dropPosition.index !== null && draggedTab"
        class="absolute top-0 bottom-0 w-0.5 pointer-events-none z-50 transition-opacity bg-blue-500"
        :style="getDropIndicatorStyle()"
      ></div>

      <!-- Sorted unpinned groups -->
      <template v-for="[groupId, groupTabs] in sortedUnpinnedGroups" :key="groupId">
        <GroupLabel
          :group-id="groupId"
          :name="getGroup(groupId)!.name"
          :color="getGroup(groupId)!.color"
          :is-collapsed="getGroup(groupId)!.isCollapsed"
          :is-pinned="false"
          :is-drag-over="dragOverGroupId === groupId"
          :tab-count="groupTabs.length"
          :auto-edit="groupId === newlyCreatedGroupId"
          @toggle="actor.send({ type: 'TOGGLE_TAB_GROUP_COLLAPSE', groupId })"
          @rename="(name: string) => actor.send({ type: 'RENAME_TAB_GROUP', groupId, name })"
          @change-color="(color: string) => actor.send({ type: 'CHANGE_TAB_GROUP_COLOR', groupId, color: color as TabGroupColor })"
          @ungroup-all="actor.send({ type: 'UNGROUP_ALL_IN_GROUP', groupId })"
          @close-all="actor.send({ type: 'CLOSE_ALL_IN_GROUP', groupId })"
          @pin-group="actor.send({ type: 'PIN_TAB_GROUP', groupId })"
          @unpin-group="actor.send({ type: 'UNPIN_TAB_GROUP', groupId })"
          @edit-started="newlyCreatedGroupId = null"
          @group-drag-over="(e: DragEvent) => handleGroupDragOver(e, groupId)"
          @group-drag-leave="(e: DragEvent) => handleGroupDragLeave(e, groupId)"
          @group-drop="(e: DragEvent) => handleGroupDrop(e, groupId)"
        />
        <template v-if="!getGroup(groupId)!.isCollapsed">
          <TabItem
            v-for="tab in groupTabs"
            :key="tab.id"
            :tab="tab"
            :isActive="tab.id === activeTabId"
            :isPinned="false"
            :groupId="groupId"
            :tabGroups="tabGroups"
            :isDragging="draggedTab?.id === tab.id"
            @select="selectTab(tab.id)"
            @close="actor.send({ type: 'CLOSE_TAB', tabId: tab.id })"
            @edit-details="actor.send({ type: 'SELECT_THREAD', id: tab.id })"
            @delete-thread="actor.send({ type: 'DELETE_THREAD', threadId: tab.id })"
            @archive-thread="actor.send({ type: 'ARCHIVE_THREAD', threadId: tab.id })"
            @unpin-thread="actor.send({ type: 'UNPIN_THREAD', threadId: tab.id })"
            @pin-thread="actor.send({ type: 'PIN_THREAD', threadId: tab.id })"
            @dragstart="handleDragStart(tab, $event)"
            @dragend="handleDragEnd"
            @add-to-group="(gId: string) => actor.send({ type: 'ADD_TAB_TO_GROUP', tabId: tab.id, groupId: gId })"
            @remove-from-group="actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId: tab.id })"
            @create-group="actor.send({ type: 'CREATE_TAB_GROUP', tabIds: [tab.id] })"
          />
        </template>
      </template>

      <!-- Ungrouped tabs -->
      <TabItem
        v-for="tab in categorized.ungroupedTabs"
        :key="tab.id"
        :tab="tab"
        :isActive="tab.id === activeTabId"
        :isPinned="false"
        :tabGroups="tabGroups"
        :isDragging="draggedTab?.id === tab.id"
        @select="selectTab(tab.id)"
        @close="actor.send({ type: 'CLOSE_TAB', tabId: tab.id })"
        @edit-details="actor.send({ type: 'SELECT_THREAD', id: tab.id })"
        @delete-thread="actor.send({ type: 'DELETE_THREAD', threadId: tab.id })"
        @archive-thread="actor.send({ type: 'ARCHIVE_THREAD', threadId: tab.id })"
        @unpin-thread="actor.send({ type: 'UNPIN_THREAD', threadId: tab.id })"
        @pin-thread="actor.send({ type: 'PIN_THREAD', threadId: tab.id })"
        @dragstart="handleDragStart(tab, $event)"
        @dragend="handleDragEnd"
        @add-to-group="(gId: string) => actor.send({ type: 'ADD_TAB_TO_GROUP', tabId: tab.id, groupId: gId })"
        @remove-from-group="actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId: tab.id })"
        @create-group="actor.send({ type: 'CREATE_TAB_GROUP', tabIds: [tab.id] })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed, ref, watch, nextTick } from 'vue';
import TabItem from './tab-item.vue';
import GroupLabel from './group-label.vue';
import type { Tab } from '#generated/types.ts';
import type { ThreadTabGroup, TabGroupColor } from './types.ts';
import { categorizeThreadTabs } from './tab-utils.ts';
import { useTabDragDrop } from './useTabDragDrop.ts';
import { type ThreadsState } from '#features/threads/fe/state.ts';

const actor: ThreadsState = useSurface();

const props = defineProps<{
  tabs: readonly Tab[];
  activeTabId: string;
  tabGroups: readonly ThreadTabGroup[];
}>();

function selectTab(tabId: string) {
  actor.send({ type: 'SELECT_TAB', tabId });
  actor.send({ type: 'OPEN_THREAD_CHAT', threadId: tabId });
}

const pinnedContainer = ref<HTMLElement | null>(null);
const mainContainer = ref<HTMLElement | null>(null);
const newlyCreatedGroupId = ref<string | null>(null);

// Detect newly created groups by watching for new IDs
watch(() => props.tabGroups, (newGroups, oldGroups) => {
  if (!oldGroups) return;
  const oldIds = new Set(oldGroups.map(g => g.id));
  const added = newGroups.find(g => !oldIds.has(g.id));
  if (added) {
    newlyCreatedGroupId.value = added.id;
  }
});

watch(() => props.activeTabId, () => {
  nextTick(() => {
    const el = pinnedContainer.value?.querySelector(`[data-tab-id="${props.activeTabId}"]`)
      || mainContainer.value?.querySelector(`[data-tab-id="${props.activeTabId}"]`);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
});

const categorized = computed(() => categorizeThreadTabs(props.tabs, props.tabGroups));

const pinnedTabsComputed = computed(() => categorized.value.pinnedTabs);
const ungroupedTabsComputed = computed(() => categorized.value.ungroupedTabs);

const sortedUnpinnedGroups = computed(() => {
  const groups = props.tabGroups.filter(g => !g.isPinned).sort((a, b) => a.order - b.order);
  return groups.map(g => [g.id, categorized.value.groupedTabs.get(g.id) || []] as [string, Tab[]]);
});

function getGroup(groupId: string): ThreadTabGroup | undefined {
  return props.tabGroups.find(g => g.id === groupId);
}

function getTabsForGroup(groupId: string): Tab[] {
  return categorized.value.groupedTabs.get(groupId) || [];
}

function isPinnedContext(context: string): boolean {
  if (context === 'pinned') return true;
  const group = props.tabGroups.find(g => g.id === context);
  return group?.isPinned || false;
}

const {
  draggedTab,
  dropPosition,
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleDragEnd,
  handleDragLeave,
  getDropIndicatorStyle,
} = useTabDragDrop({
  tabs: computed(() => props.tabs),
  pinnedTabs: pinnedTabsComputed,
  ungroupedTabs: ungroupedTabsComputed,
  getTabsForGroup,
  tabGroups: computed(() => props.tabGroups),
  pinnedContainer,
  mainContainer,
  onPinTab: (tabId) => actor.send({ type: 'PIN_THREAD', threadId: tabId }),
  onUnpinTab: (tabId) => actor.send({ type: 'UNPIN_THREAD', threadId: tabId }),
  onPinTabAt: (tabId, targetTabId, side) => actor.send({ type: 'PIN_TAB_AT', tabId, targetTabId, side }),
  onUnpinTabAt: (tabId, targetTabId, side) => actor.send({ type: 'UNPIN_TAB_AT', tabId, targetTabId, side }),
  onAddToGroup: (tabId, groupId) => actor.send({ type: 'ADD_TAB_TO_GROUP', tabId, groupId }),
  onAddToGroupAt: (tabId, groupId, targetTabId, side) => actor.send({ type: 'ADD_TAB_TO_GROUP_AT', tabId, groupId, targetTabId, side }),
  onRemoveFromGroup: (tabId) => actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId }),
  onReorder: (from, to) => actor.send({ type: 'REORDER_TABS', fromIndex: from, toIndex: to }),
});

// Group drag-over state
const dragOverGroupId = ref<string | null>(null);

function handleGroupDragOver(event: DragEvent, groupId: string) {
  if (!draggedTab.value) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
  dragOverGroupId.value = groupId;

  // Auto-expand collapsed group when dragging over it
  const group = getGroup(groupId);
  if (group?.isCollapsed) {
    actor.send({ type: 'TOGGLE_TAB_GROUP_COLLAPSE', groupId });
  }

  // Set drop position to sentinel for empty group drop
  const groupTabs = getTabsForGroup(groupId);
  if (groupTabs.length === 0) {
    dropPosition.value = { index: -1, side: 'left', context: groupId };
  }
}

function handleGroupDragLeave(_event: DragEvent, groupId: string) {
  if (dragOverGroupId.value === groupId) {
    dragOverGroupId.value = null;
  }
}

function handleGroupDrop(event: DragEvent, groupId: string) {
  if (!draggedTab.value) return;
  event.preventDefault();
  dragOverGroupId.value = null;

  const sourceTab = props.tabs.find(t => t.id === draggedTab.value!.id);
  if (!sourceTab) return;

  // Add to group
  if (sourceTab.groupId !== groupId) {
    if (sourceTab.groupId) {
      actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId: sourceTab.id });
    }
    actor.send({ type: 'ADD_TAB_TO_GROUP', tabId: sourceTab.id, groupId });
  }

  handleDragEnd();
}
</script>

<style>
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

/* Keep tab rows horizontally scrollable without exposing a scrollbar. */
.tab-container {
  scrollbar-width: none;
}
.tab-container::-webkit-scrollbar {
  display: none;
}
</style>
