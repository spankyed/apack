<template>
<Teleport to="body">
  <div
    v-if="stateConfig && pos && isAnchorVisible"
    class="flex items-center gap-2 text-sm text-neutral-300 max-w-[80%] pointer-events-none"
    :class="$style['status-indicator']"
    :style="positionStyle"
  >
    <!-- dot + glow -->
    <span class="relative inline-block">
      <!-- solid dot -->
      <span
        :class="[
          'block h-3 w-3 rounded-full transition-colors duration-300 ease-in-out',
          isAnimated ? 'mosaic-dot' : ''
        ]"
        :style="!isAnimated ? { backgroundColor: stateConfig.color } : undefined"
      />
      <!-- glow -->
      <span
        :class="[
          'absolute inset-0 rounded-full scale-[2] transition-colors duration-300 ease-in-out',
          isAnimated ? 'mosaic-glow' : 'blur-[1px] opacity-40'
        ]"
        :style="!isAnimated ? { backgroundColor: stateConfig.color } : undefined"
      />
    </span>
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
    pos.value = { top: r.top - 6.4, left: r.left - 6.4 }
  },
  () => { pos.value = null },
)
</script>

<style lang="scss" module>
.status-indicator {
  // Positioning lives on the element's inline :style — fixed to the input
  // card's top-left via the anchor prop so the dot renders outside the chat
  // area's overflow-clipped tree.
}
</style>
