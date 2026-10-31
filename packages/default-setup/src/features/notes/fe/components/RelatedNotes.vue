<template>
  <div v-if="notes.length" class="flex flex-wrap items-center gap-1.5 px-5 pb-2 text-xs">
    <span class="text-neutral-500">Related</span>
    <button
      v-for="note in notes"
      :key="note.id"
      class="flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300 transition-colors hover:bg-neutral-700"
      :title="note.title || 'Untitled'"
      @click="emit('open', note.id)"
    >
      <span v-if="note.icon" class="leading-none">{{ note.icon }}</span>
      <span class="max-w-40 truncate">{{ note.title || 'Untitled' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// The notes most related to the open one by the links between notes (the `related` view), most related first
import type { NoteSummary } from '#generated/types.ts'

defineProps<{ notes: NoteSummary[] }>()
const emit = defineEmits<{ open: [noteId: string] }>()
</script>
