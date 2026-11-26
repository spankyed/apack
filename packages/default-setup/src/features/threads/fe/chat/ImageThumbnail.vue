<template>
  <div class="relative shrink-0" :class="{ compact }" :title="name">
    <button type="button" :aria-label="`Preview ${name}`"
      class="block rounded-lg outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-400"
      @click.stop="$emit('click')">
      <img :src="src" :alt="name"
        class="thumbnail w-20 h-20 object-contain bg-neutral-950/40 rounded-lg border border-neutral-700/40" />
    </button>
    <div class="caption mt-1 max-w-20 text-[11px] text-neutral-400 truncate text-center px-1.5 py-0.5 pointer-events-none">{{ name?.replace(/\.[^.]+$/, '') }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  src: string
  name: string
  compact?: boolean
}>()

defineEmits<{
  (e: 'click'): void
}>()
</script>

<style scoped>
@media (max-height: 700px) {
  .compact .thumbnail { width: 3rem; height: 3rem; }
  .compact .caption { max-width: 3rem; margin-top: 0; padding-inline: 0; }
}
</style>
