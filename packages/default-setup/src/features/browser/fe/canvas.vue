<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <BrowserTabBar
      :tabs="browser.data.tabs"
      :activeTabId="browser.data.activeTabId"
      :tabGroups="browser.data.tabGroups"
      @select="send({ type: 'TAB.SELECT', tabId: $event })"
      @close="send({ type: 'TAB.CLOSE', tabId: $event })"
      @create="send({ type: 'TAB.CREATE' })"
      @duplicate="send({ type: 'TAB.DUPLICATE', tabId: $event })"
      @close-others="send({ type: 'TAB.CLOSE_OTHERS', tabId: $event })"
      @toggle-mute="send({ type: 'TAB.TOGGLE_MUTE', tabId: $event })"
      @create-group="send({ type: 'GROUP.CREATE', ...$event })"
      @rename-group="send({ type: 'GROUP.RENAME', ...$event })"
      @change-group-color="send({ type: 'GROUP.CHANGE_COLOR', ...$event })"
      @delete-group="send({ type: 'GROUP.DELETE', ...$event })"
      @toggle-group-collapse="send({ type: 'GROUP.TOGGLE_COLLAPSE', groupId: $event })"
      @add-to-group="send({ type: 'TAB.ADD_TO_GROUP', ...$event })"
      @remove-from-group="send({ type: 'TAB.REMOVE_FROM_GROUP', tabId: $event })"
    />
    <BrowserNavBar
      ref="navBar"
      :addressBarValue="browser.data.addressBarValue"
      :canGoBack="activeTab?.canGoBack ?? false"
      :canGoForward="activeTab?.canGoForward ?? false"
      :isLoading="activeTab?.isLoading ?? false"
      :suggestions="browser.data.suggestions"
      :selectedSuggestionIndex="browser.data.selectedSuggestionIndex"
      :inlineCompletion="browser.data.inlineCompletion"
      :isBookmarked="isBookmarked"
      :bookmarks="browser.data.bookmarks"
      @toggle-bookmark="send({ type: 'BOOKMARK.TOGGLE' })"
      @bookmark-navigate="send({ type: 'BOOKMARK.NAVIGATE', url: $event })"
      @bookmark-remove="send({ type: 'BOOKMARK.REMOVE', url: $event })"
      @back="send({ type: 'NAV.BACK' })"
      @forward="send({ type: 'NAV.FORWARD' })"
      @reload="send({ type: 'NAV.RELOAD' })"
      @stop="send({ type: 'NAV.STOP' })"
      @navigate="send({ type: 'NAV.GO', url: $event })"
      @update:addressBarValue="send({ type: 'ADDRESS_BAR.UPDATE', value: $event })"
      @focus="send({ type: 'ADDRESS_BAR.FOCUS' })"
      @blur="send({ type: 'ADDRESS_BAR.BLUR' })"
      @toggle-devtools="toggleDevTools"
      @open-in-new-tab="send({ type: 'TAB.CREATE', url: $event })"
      @autocomplete:select="send({ type: 'AUTOCOMPLETE.SELECT', index: $event })"
      @autocomplete:dismiss="send({ type: 'AUTOCOMPLETE.DISMISS' })"
      @autocomplete:accept-inline="send({ type: 'AUTOCOMPLETE.ACCEPT_INLINE' })"
    />

    <BrowserBookmarkBar
      v-if="browser.data.bookmarks.length > 0 && showBookmarksBar"
      :bookmarks="browser.data.bookmarks"
      @navigate="send({ type: 'BOOKMARK.NAVIGATE', url: $event })"
      @remove="send({ type: 'BOOKMARK.REMOVE', url: $event })"
    />

    <!-- Content placeholder: WebContentsView is overlaid here by the main process -->
    <div
      ref="contentArea"
      class="flex-1 bg-neutral-950 overflow-hidden"
    >
      <div v-if="browser.data.tabs.length === 0" class="flex flex-col items-center justify-center h-full text-neutral-500">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mb-4 text-neutral-600"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <p class="text-sm">Click + to open a new tab</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { isAnyMenuOpen, useState } from '@apackdev/sdk/fe';
import { type BrowserState } from './state.ts';
import BrowserTabBar from './components/BrowserTabBar.vue';
import BrowserNavBar from './components/BrowserNavBar.vue';
import BrowserBookmarkBar from './components/BrowserBookmarkBar.vue';

const { state: browser, send } = useState<BrowserState>();
// This feature's own settings, from its own machine — the app sends them to it (`FEATURE_SETTINGS_UPDATED`)
const showBookmarksBar = computed(() => browser.value.data.settings?.showBookmarksBar ?? true);

const activeTab = computed(() => browser.value.data.tabs.find(t => t.id === browser.value.data.activeTabId) ?? null);
const isBookmarked = computed(() => {
  const tab = activeTab.value;
  if (!tab?.url) return false;
  return browser.value.data.bookmarks.some(b => b.url === tab.url);
});

// Hide browser overlay when any app menu is open (toolbar, canvas header, tab context menu, etc.)
watch(isAnyMenuOpen, (menuOpen) => {
  if (menuOpen) {
    window.electronAPI?.browser.hide();
  } else {
    window.electronAPI?.browser.show();
  }
});

const navBar = ref<InstanceType<typeof BrowserNavBar> | null>(null);
function toggleDevTools() {
  if (browser.value.data.activeTabId !== null) {
    window.electronAPI?.browser.toggleDevTools(browser.value.data.activeTabId);
  }
}

const contentArea = ref<HTMLDivElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let mounted = true;

function handleKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  switch (e.key) {
    case 't':
      e.preventDefault();
      send({ type: 'TAB.CREATE' });
      break;
    case 'w':
      e.preventDefault();
      if (browser.value.data.activeTabId !== null) {
        send({ type: 'TAB.CLOSE', tabId: browser.value.data.activeTabId });
      }
      break;
    case 'l':
      e.preventDefault();
      navBar.value?.focusAddressBar();
      break;
    case 'r':
      e.preventDefault();
      send({ type: 'NAV.RELOAD' });
      break;
    case 'd':
      e.preventDefault();
      send({ type: 'BOOKMARK.TOGGLE' });
      break;
  }
}

function reportBounds() {
  if (!contentArea.value) return;
  const rect = contentArea.value.getBoundingClientRect();
  const zoom = window.electronAPI?.zoom.getZoomFactor() ?? 1;
  window.electronAPI?.browser.setBounds({
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  });
}

let unsubFocusAddressBar: (() => void) | null = null;

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown);

  // Listen for Cmd+L from the WebContentsView (main process forwards it)
  unsubFocusAddressBar = window.electronAPI?.browser.onFocusAddressBar(() => {
    navBar.value?.focusAddressBar();
  }) ?? null;

  // Report bounds first so the overlay appears at the correct position
  reportBounds();
  window.electronAPI?.browser.show();

  // Watch for size changes
  resizeObserver = new ResizeObserver(reportBounds);
  if (contentArea.value) {
    resizeObserver.observe(contentArea.value);
  }

  // Sync existing tabs from main process (e.g. popup-created tabs while on another surface)
  const existingTabs = await window.electronAPI?.browser.getTabs();
  const activeId = await window.electronAPI?.browser.getActiveTab();
  if (!mounted) return;

  if (existingTabs?.length) {
    for (const tab of existingTabs) {
      send({ type: 'IPC.TAB_CREATED', tab });
    }
    if (activeId != null) {
      send({ type: 'IPC.ACTIVE_TAB_CHANGED', tabId: activeId });
      // Load the active tab on first open (lazy tabs don't load until selected)
      window.electronAPI?.browser.loadTab(activeId);
    }
  } else {
    send({ type: 'TAB.CREATE' });
  }
});

onUnmounted(() => {
  mounted = false;
  window.removeEventListener('keydown', handleKeydown);
  unsubFocusAddressBar?.();
  window.electronAPI?.browser.hide();

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>
