<template>
  <div class="flex flex-col h-full bg-neutral-900" :class="{ 'thread-dashboard': !inline }">
    <template v-if="!inline">
      <ThreadsHeader />
      <!-- Tab Bar -->
      <div class="flex shrink-0 items-center border-b border-neutral-800 bg-neutral-900 overflow-hidden" data-onboarding-id="agent-thread-tabs">
        <TabBar class="dashboard-tabs" :tabs="threads.data.tabs" :activeTabId="threads.data.activeTabId" :tabGroups="threads.data.tabGroups" />
      </div>
    </template>

    <!-- Content Viewer (includes artifact list) — min-h-0 constrains flex
         child so inner overflow-auto scrolls instead of the outer canvas. -->
    <ContentViewer
      class="flex-1 min-h-0"
      :artifacts="currentTab?.artifacts || []"
      :selectedArtifactId="currentTab?.selectedArtifactId"
      :compact="inline"
      @select-artifact="(artifactId: string) => send({ type: 'SELECT_ARTIFACT', artifactId })"
    />
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { computed } from 'vue';
import { type ThreadsState } from '#features/threads/fe/state.ts';
import TabBar from '#features/threads/fe/canvas/agent/tabs/tab-bar.vue';
import ContentViewer from '#features/threads/fe/canvas/agent/content-viewer.vue';
import ThreadsHeader from '#features/threads/fe/canvas/components/ThreadsHeader.vue';

defineProps<{
  inline?: boolean;
}>();

const actor: ThreadsState = useSurface();

const { state: threads, send } = useState(actor);

const currentTab = computed(() => threads.value.data.tabs.find(tab => tab.id === threads.value.data.activeTabId));
</script>

<style scoped>
.thread-dashboard {
  container: thread-dashboard / size;
}

/* Keep both tab groups reachable when the composer leaves the dashboard a short split. */
@container thread-dashboard (max-height: 8rem) {
  .dashboard-tabs {
    flex-direction: row;
  }

  .dashboard-tabs :deep([data-container="pinned"]) {
    flex: 0 1 auto;
    min-width: 0;
    max-width: min(34%, 14rem);
    border-block-end-width: 0;
    border-inline-end-width: 1px;
  }

  .dashboard-tabs :deep([data-container="main"]) {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
