<template>
  <div ref="viewerElement" :class="compact ? 'flex flex-col' : 'flex'" class="h-full bg-neutral-900" data-onboarding-id="agent-artifacts">
    <!-- Artifact List: horizontal strip (inline) or vertical sidebar (canvas) -->
    <div v-if="!sessionDetailsCollapsed" :class="compact
      ? 'overflow-x-auto border-b border-neutral-800 shrink-0'
      : 'w-64 h-full overflow-y-auto border-r border-neutral-800'"
      class="bg-neutral-900"
      @wheel="scrollArtifactList"
    >
      <ArtifactList
        :artifacts="artifacts"
        :selectedArtifactId="selectedArtifactId"
        :compact="compact"
        @select-artifact="$emit('select-artifact', $event)"
      />
    </div>

    <!-- Artifact Content -->
    <div :class="sessionDetailsCollapsed ? 'p-0.5' : contentPadding" class="flex-1 h-full overflow-auto bg-neutral-900 min-h-0">
      <PopoverRoot v-if="sessionDetailsCollapsed && selectedArtifact" :key="selectedArtifact.id">
        <PopoverTrigger class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-xs text-neutral-300 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-blue-400" aria-label="Open Claude session details">
          <FileText :size="14" class="shrink-0 text-neutral-500" />
          <span class="min-w-0 flex-1 truncate text-left" :title="selectedArtifact.title">{{ selectedArtifact.title }}</span>
          <span class="shrink-0 text-neutral-400">Details ↗</span>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent side="bottom" align="start" :side-offset="6" :collision-padding="12" aria-label="Claude session details" :style="{ maxHeight: 'min(32rem, var(--reka-popover-content-available-height, calc(100vh - 24px)))' }" class="z-50 w-[min(36rem,calc(100vw-24px))] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-neutral-200 shadow-xl">
            <header class="sticky top-0 z-10 mb-3 flex items-center justify-between gap-3 bg-neutral-900">
              <h2 class="text-sm font-medium">Session details</h2>
              <PopoverClose as-child><button type="button" aria-label="Close Claude session details" class="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">Close</button></PopoverClose>
            </header>
            <component :is="getArtifactComponent(selectedArtifact.type)" :artifact="selectedArtifact" />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
      <div v-else-if="!selectedArtifact" class="flex flex-col items-center justify-center h-full gap-3">
        <FileText :size="32" class="text-neutral-700" />
        <p class="text-neutral-600 text-sm">No artifact selected</p>
      </div>
      <component
        v-else
        :is="getArtifactComponent(selectedArtifact.type)"
        :artifact="selectedArtifact"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FileText } from 'lucide-vue-next';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, PopoverClose } from 'reka-ui';
import type { ArtifactItem } from '@apackdev/sdk/artifacts';
import { getArtifactBinding, useArtifactDeclarations } from '@apackdev/sdk/fe';
import ArtifactList from './artifact-list.vue';
import TextArtifact from '#extensions/artifacts/viewers/text-artifact.vue';

const props = defineProps<{
  artifacts: ArtifactItem[];
  selectedArtifactId?: string;
  compact?: boolean;
}>();

defineEmits<{
  'select-artifact': [artifactId: string];
}>();

// Preserve native sidebar scrolling, trackpad horizontal movement and browser zoom.
function scrollArtifactList(event: WheelEvent) {
  if (!props.compact || event.ctrlKey || event.shiftKey || event.deltaX !== 0) return;
  const list = event.currentTarget as HTMLElement;
  const scale = event.deltaMode === 1 ? parseFloat(getComputedStyle(list).lineHeight) || 16
    : event.deltaMode === 2 ? list.clientWidth : 1;
  const next = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + event.deltaY * scale));
  if (next === list.scrollLeft) return;
  event.preventDefault();
  list.scrollLeft = next;
}

const selectedArtifact = computed(() =>
  props.artifacts.find(a => a.id === props.selectedArtifactId)
);

// Small split panes need room for artifact controls as well as their scrollable content.
const viewerElement = ref<HTMLElement | null>(null);
const viewerHeight = ref<number>();
watch(viewerElement, (element, _previous, onCleanup) => {
  if (!element) { viewerHeight.value = undefined; return; }
  const update = () => { viewerHeight.value = element.clientHeight; };
  const observer = new ResizeObserver(update);
  observer.observe(element); update();
  onCleanup(() => observer.disconnect());
}, { flush: 'post' });
// A tiny workspace should offer readable session details rather than a clipped card/sidebar.
// Other artifacts retain their existing navigation and editor lifetime.
const sessionDetailsCollapsed = computed(() => !props.compact && props.artifacts.length === 1 && selectedArtifact.value?.type === 'claude-session' && viewerHeight.value !== undefined && viewerHeight.value < 112);
const contentPadding = computed(() => {
  const height = viewerHeight.value;
  if (height === undefined || height > 192) return 'p-6';
  return height <= 128 ? 'px-4 py-0' : 'px-4 py-2';
});

const declarations = useArtifactDeclarations();

function getArtifactComponent(type: string) {
  declarations.value;
  return getArtifactBinding(type)?.binding.fe?.component || TextArtifact;
}
</script>
