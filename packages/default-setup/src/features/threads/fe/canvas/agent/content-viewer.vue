<template>
  <div ref="viewerElement" :class="compact ? 'flex flex-col' : 'flex'" class="h-full bg-neutral-900" data-onboarding-id="agent-artifacts">
    <!-- Artifact List: horizontal strip (inline) or vertical sidebar (canvas) -->
    <div :class="compact
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
    <div :class="contentPadding" class="flex-1 h-full overflow-auto bg-neutral-900 min-h-0">
      <div v-if="!selectedArtifact" class="flex flex-col items-center justify-center h-full gap-3">
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
