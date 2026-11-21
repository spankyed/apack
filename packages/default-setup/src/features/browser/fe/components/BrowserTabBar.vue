<template>
  <div class="flex items-center gap-0.5 px-2 py-1.5 bg-neutral-950 border-b border-neutral-800 overflow-x-auto min-h-[36px]">
    <template v-for="item in sortedItems" :key="item.type === 'group' ? `g-${item.group.id}` : `t-${item.tab.id}`">
      <!-- Group label -->
      <BrowserGroupLabel
        v-if="item.type === 'group'"
        :name="item.group.name"
        :color="item.group.color"
        :isCollapsed="item.group.isCollapsed"
        :groupId="item.group.id"
        @toggle="$emit('toggle-group-collapse', item.group.id)"
        @rename="$emit('rename-group', { groupId: item.group.id, name: $event })"
        @change-color="$emit('change-group-color', { groupId: item.group.id, color: $event })"
        @ungroup-all="$emit('delete-group', { groupId: item.group.id, closeTabs: false })"
        @close-all="$emit('delete-group', { groupId: item.group.id, closeTabs: true })"
      />
      <!-- Tab (grouped or ungrouped) -->
      <template v-else>
        <ContextMenuRoot>
          <ContextMenuTrigger as-child>
            <div
              class="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs max-w-[200px] min-w-[80px] cursor-pointer transition-colors group"
              :class="item.tab.id === activeTabId
                ? 'bg-neutral-800 text-neutral-100'
                : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'"
              :style="item.tab.groupId ? { borderBottom: `2px solid var(--color-${getGroupColor(item.tab.groupId)})` } : {}"
              @click="$emit('select', item.tab.id)"
              @mousedown.middle.prevent="$emit('close', item.tab.id)"
            >
              <button
                class="flex-shrink-0 p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-200"
                @click.stop="$emit('close', item.tab.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <div v-if="item.tab.isLoading" class="w-3.5 h-3.5 flex-shrink-0 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin" />
              <img
                v-else-if="item.tab.favicon && !failedFavicons.has(item.tab.id)"
                :src="item.tab.favicon"
                class="w-3.5 h-3.5 flex-shrink-0"
                @error="failedFavicons.add(item.tab.id)"
              />
              <div v-else class="w-3.5 h-3.5 flex-shrink-0 rounded-sm bg-neutral-700" />
              <span class="truncate flex-1">{{ item.tab.title || 'New Tab' }}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuPortal>
            <ContextMenuContent class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50">
              <ContextMenuItem :class="MENU_ITEM_CLASS" @select="$emit('duplicate', item.tab.id)">
                <Copy :size="14" />
                Duplicate Tab
              </ContextMenuItem>
              <ContextMenuSeparator class="h-px my-1 bg-neutral-700" />

              <!-- Group actions -->
              <template v-if="item.tab.groupId">
                <ContextMenuItem :class="MENU_ITEM_CLASS" @select="$emit('remove-from-group', item.tab.id)">
                  <FolderMinus :size="14" />
                  Remove from Group
                </ContextMenuItem>
              </template>
              <template v-else-if="tabGroups.length > 0">
                <ContextMenuSub>
                  <ContextMenuSubTrigger :class="MENU_ITEM_CLASS">
                    <FolderPlus :size="14" />
                    Add to Group
                    <ChevronRight class="w-3 h-3 ml-auto" />
                  </ContextMenuSubTrigger>
                  <ContextMenuPortal>
                    <ContextMenuSubContent class="min-w-[140px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50">
                      <ContextMenuItem
                        v-for="g in tabGroups"
                        :key="g.id"
                        :class="MENU_ITEM_CLASS"
                        @select="$emit('add-to-group', { tabId: item.tab.id, groupId: g.id })"
                      >
                        <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: `var(--color-${g.color})` }" />
                        {{ g.name }}
                      </ContextMenuItem>
                      <ContextMenuSeparator class="h-px my-1 bg-neutral-700" />
                      <ContextMenuItem :class="MENU_ITEM_CLASS" @select="$emit('create-group', { tabIds: [item.tab.id] })">
                        <Plus :size="14" />
                        New Group
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuPortal>
                </ContextMenuSub>
              </template>
              <template v-else>
                <ContextMenuItem :class="MENU_ITEM_CLASS" @select="$emit('create-group', { tabIds: [item.tab.id] })">
                  <FolderPlus :size="14" />
                  Add to New Group
                </ContextMenuItem>
              </template>

              <ContextMenuSeparator class="h-px my-1 bg-neutral-700" />
              <ContextMenuItem :class="MENU_ITEM_CLASS" @select="$emit('toggle-mute', item.tab.id)">
                <VolumeX v-if="!item.tab.isMuted" :size="14" />
                <Volume2 v-else :size="14" />
                {{ item.tab.isMuted ? 'Unmute Tab' : 'Mute Tab' }}
              </ContextMenuItem>
              <ContextMenuSeparator class="h-px my-1 bg-neutral-700" />
              <ContextMenuItem :class="MENU_ITEM_CLASS" @select="$emit('close', item.tab.id)">
                <X :size="14" />
                Close Tab
              </ContextMenuItem>
              <ContextMenuItem
                :disabled="tabs.length <= 1"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default data-[disabled]:hover:bg-transparent"
                @select="$emit('close-others', item.tab.id)"
              >
                <XCircle :size="14" />
                Close Other Tabs
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuPortal>
        </ContextMenuRoot>
      </template>
    </template>

    <!-- New tab button -->
    <button
      class="flex items-center justify-center w-6 h-6 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors flex-shrink-0"
      @click="$emit('create')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { Copy, VolumeX, Volume2, X, XCircle, FolderPlus, FolderMinus, Plus, ChevronRight } from 'lucide-vue-next';
import {
  ContextMenuRoot, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuPortal, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from 'reka-ui';
import type { BrowserTab } from '../state.ts';
import type { TabGroup, TabGroupColor } from '@apackdev/sdk/fe';
import BrowserGroupLabel from './BrowserGroupLabel.vue';
import './group-colors.css';

const MENU_ITEM_CLASS = 'flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none';

const failedFavicons = reactive(new Set<number>());

const props = defineProps<{
  tabs: readonly BrowserTab[];
  activeTabId: number | null;
  tabGroups: readonly TabGroup[];
}>();

defineEmits<{
  select: [tabId: number];
  close: [tabId: number];
  create: [];
  duplicate: [tabId: number];
  'close-others': [tabId: number];
  'toggle-mute': [tabId: number];
  'create-group': [params: { tabIds?: number[] }];
  'rename-group': [params: { groupId: string; name: string }];
  'change-group-color': [params: { groupId: string; color: TabGroupColor }];
  'delete-group': [params: { groupId: string; closeTabs: boolean }];
  'toggle-group-collapse': [groupId: string];
  'add-to-group': [params: { tabId: number; groupId: string }];
  'remove-from-group': [tabId: number];
}>();

// Clear failed state when a tab gets a new favicon URL
const faviconCache = new Map<number, string>();
watch(() => props.tabs, (tabs) => {
  for (const tab of tabs) {
    const prev = faviconCache.get(tab.id);
    if (tab.favicon && tab.favicon !== prev) {
      failedFavicons.delete(tab.id);
    }
    faviconCache.set(tab.id, tab.favicon);
  }
}, { deep: true });

type SortedItem =
  | { type: 'group'; group: TabGroup }
  | { type: 'tab'; tab: BrowserTab };

// Build a flat list: [ungrouped tabs] interspersed with [group label + group tabs]
const sortedItems = computed((): SortedItem[] => {
  const groups = [...props.tabGroups].sort((a, b) => a.order - b.order);
  const groupedTabIds = new Set<number>();
  const items: SortedItem[] = [];

  // Group tabs by groupId
  const tabsByGroup = new Map<string, BrowserTab[]>();
  for (const tab of props.tabs) {
    if (tab.groupId) {
      const list = tabsByGroup.get(tab.groupId) ?? [];
      list.push(tab);
      tabsByGroup.set(tab.groupId, list);
      groupedTabIds.add(tab.id);
    }
  }

  // Ungrouped tabs first
  for (const tab of props.tabs) {
    if (!groupedTabIds.has(tab.id)) {
      items.push({ type: 'tab', tab });
    }
  }

  // Then groups with their tabs
  for (const group of groups) {
    const groupTabs = tabsByGroup.get(group.id) ?? [];
    if (groupTabs.length === 0) continue;
    items.push({ type: 'group', group });
    if (!group.isCollapsed) {
      for (const tab of groupTabs) {
        items.push({ type: 'tab', tab });
      }
    }
  }

  return items;
});

function getGroupColor(groupId: string): string {
  return props.tabGroups.find(g => g.id === groupId)?.color ?? 'gray';
}
</script>
