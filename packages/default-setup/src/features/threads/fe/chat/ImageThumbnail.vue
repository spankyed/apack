<template>
  <div class="relative flex-shrink-0" :title="name">
    <img :src="src" :alt="name"
      class="w-20 h-20 object-contain bg-neutral-950/40 rounded-lg border border-neutral-700/40 cursor-pointer hover:opacity-80 transition-opacity"
      @click="$emit('click')" />
    <div class="mt-1 max-w-20 text-[11px] text-neutral-400 truncate text-center px-1.5 py-0.5 pointer-events-none">{{ name?.replace(/\.[^.]+$/, '') }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  src: string
  name: string
}>()

defineEmits<{
  (e: 'click'): void
}>()
</script>
