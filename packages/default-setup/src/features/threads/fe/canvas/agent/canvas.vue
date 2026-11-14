<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <template v-if="!inline">
      <ThreadsHeader />
      <!-- Tab Bar -->
      <div class="flex shrink-0 items-center border-b border-neutral-800 bg-neutral-900 overflow-hidden" data-onboarding-id="agent-thread-tabs">
        <TabBar :tabs="tabs" :activeTabId="activeTabId" :tabGroups="tabGroups" />
      </div>
    </template>

    <!-- Content Viewer (includes artifact list) — min-h-0 constrains flex
         child so inner overflow-auto scrolls instead of the outer canvas. -->
    <ContentViewer
      class="flex-1 min-h-0"
      :artifacts="currentTab?.artifacts || []"
      :selectedArtifactId="currentTab?.selectedArtifactId"
      :compact="inline"
      @select-artifact="(artifactId: string) => actor.send({ type: 'SELECT_ARTIFACT', artifactId })"
    />
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed } from 'vue';
import { useSelector } from '@xstate/vue';
import { type ThreadsState } from '#features/threads/fe/state.ts';
import TabBar from '#features/threads/fe/canvas/agent/tabs/tab-bar.vue';
import ContentViewer from '#features/threads/fe/canvas/agent/content-viewer.vue';
import ThreadsHeader from '#features/threads/fe/canvas/components/ThreadsHeader.vue';

defineProps<{
  inline?: boolean;
}>();

const actor: ThreadsState = useSurface();

const tabs = useSelector(actor, (state) => state.context.tabs);
const activeTabId = useSelector(actor, (state) => state.context.activeTabId);
const tabGroups = useSelector(actor, (state) => state.context.tabGroups);

const currentTab = computed(() => tabs.value.find(tab => tab.id === activeTabId.value));
</script>
