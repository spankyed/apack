<template>
<Teleport to="body">
  <div
    v-if="stateConfig && pos && isAnchorVisible"
    role="status"
    :title="`Conversation status: ${stateConfig.label}`"
    class="flex items-center gap-2 text-sm text-neutral-300 max-w-[80%] pointer-events-auto"
    :class="$style['status-indicator']"
    :style="positionStyle"
  >
    <span class="sr-only">Conversation status: {{ stateConfig.label }}</span>
    <span aria-hidden="true" class="block h-1.5 w-1.5 rounded-full transition-colors duration-300"
      :class="isAnimated ? 'mosaic-dot' : undefined" :style="!isAnimated ? { backgroundColor: stateConfig.color } : undefined" />
  </div>
</Teleport>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { computed, ref } from 'vue'
import { type ThreadsState } from '#features/threads/fe/state.ts';
import { useAnchorTracking } from './composables/useAnchorTracking.ts'

const props = defineProps<{
  anchor?: HTMLElement | null
}>()

const actor: ThreadsState = useSurface();
const { state: threads } = useState(actor);

const chatState = computed(() => threads.value.data.chatStates[threads.value.data.currentThread?.id ?? ''] || 'idle');

const stateConfig = computed(() => {
  const configs = threads.value.data.settings?.chatStates;
  const threadId = threads.value.data.currentThread?.id ?? '';
  const override = threads.value.data.chatStateOverrides[threadId];
  const activeId = (override && override.expiresAt > Date.now()) ? override.id : chatState.value;
  return configs?.find(c => c.id === activeId);
});

const isAnimated = computed(() => stateConfig.value?.busy ?? false);

const pos = ref<{ top: number; left: number } | null>(null)

const positionStyle = computed(() => pos.value && ({
  position: 'fixed' as const,
  top: `${pos.value.top}px`,
  left: `${pos.value.left}px`,
  zIndex: 40,
}))

const { isVisible: isAnchorVisible } = useAnchorTracking(
  () => props.anchor,
  (el) => {
    const r = el.getBoundingClientRect()
    pos.value = { top: r.top + 19, left: r.right - 20 }
  },
  () => { pos.value = null },
)
</script>

<style lang="scss" module>
.status-indicator {
  // Positioning lives on the element's inline :style — fixed to the input
  // card's trailing context row via the anchor prop.
}
</style>
