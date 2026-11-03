<template>
  <div class="py-1">
    <div class="px-3 py-1 text-[11px] font-medium text-neutral-400">{{ title }}</div>
    <div
      v-for="symbol in symbols"
      :key="`${symbol.id}#${symbol.edge ?? ''}`"
      class="px-3 py-[3px] cursor-pointer hover:bg-neutral-800/60"
      @click="$emit('select', symbol.id)"
    >
      <div class="flex items-baseline gap-2">
        <span class="text-[13px] truncate text-neutral-200">{{ symbol.name }}</span>
        <span class="shrink-0 text-[11px] text-neutral-500">{{ symbol.kind }}</span>
        <span v-if="symbol.sites && symbol.sites > 1" class="shrink-0 text-[11px] text-neutral-500">×{{ symbol.sites }}</span>
        <span v-if="symbol.test" class="shrink-0 text-[11px] text-neutral-500">test</span>
      </div>
      <div class="text-[11px] truncate text-neutral-500">{{ symbol.path }}</div>
    </div>
    <div v-if="symbols.length === 0" class="px-3 text-xs text-neutral-500">{{ emptyText }}</div>
    <div v-if="note" class="px-3 mt-1 text-[11px] text-neutral-500" data-testid="code-index-coverage">{{ note }}</div>
  </div>
</template>

<script setup lang="ts">
export interface ListedSymbol {
  id: string
  name: string
  kind: string
  path: string
  test: boolean
  edge?: string
  sites?: number
}

defineProps<{ title: string; symbols: readonly ListedSymbol[]; emptyText: string; note?: string }>()
defineEmits<{ select: [id: string] }>()
</script>
