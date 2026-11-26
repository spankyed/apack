<template>
  <div :class="compact ? 'flex flex-col' : 'flex'" class="h-full bg-neutral-900" data-onboarding-id="agent-artifacts">
    <!-- Artifact List: horizontal strip (inline) or vertical sidebar (canvas) -->
    <div :class="compact
      ? 'overflow-x-auto border-b border-neutral-800 shrink-0'
      : 'w-64 h-full overflow-y-auto border-r border-neutral-800'"
      class="bg-neutral-900"
      @wheel.prevent="compact && (($event.currentTarget as HTMLElement).scrollLeft += $event.deltaY)"
    >
      <ArtifactList
        :artifacts="artifacts"
        :selectedArtifactId="selectedArtifactId"
        :compact="compact"
        @select-artifact="$emit('select-artifact', $event)"
      />
    </div>

    <!-- Artifact Content -->
    <div class="flex-1 h-full p-6 overflow-auto bg-neutral-900 min-h-0">
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
import { computed } from 'vue';
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

const selectedArtifact = computed(() =>
  props.artifacts.find(a => a.id === props.selectedArtifactId)
);

const declarations = useArtifactDeclarations();

function getArtifactComponent(type: string) {
  void declarations.value;
  return getArtifactBinding(type)?.binding.fe?.component || TextArtifact;
}
</script>
