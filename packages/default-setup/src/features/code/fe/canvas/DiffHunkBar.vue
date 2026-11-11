<template>
  <!-- The pieces of a file's change, one at a time: where each is, and staging it or taking it back by itself -->
  <div class="flex items-center gap-2 px-3 py-1 text-xs border-b border-neutral-800 bg-neutral-900 text-neutral-400 shrink-0" data-testid="diff-hunks">
    <button type="button" class="p-0.5 rounded hover:bg-neutral-800 disabled:opacity-40" title="Previous change" :disabled="hunks.length < 2" @click="step(-1)">
      <ChevronUp :size="14" />
    </button>
    <button type="button" class="p-0.5 rounded hover:bg-neutral-800 disabled:opacity-40" title="Next change" :disabled="hunks.length < 2" @click="step(1)">
      <ChevronDown :size="14" />
    </button>
    <button type="button" class="hover:text-neutral-200" :title="`Go to ${where}`" @click="emit('reveal', firstChangedLine(hunk))">
      Change {{ current + 1 }} of {{ hunks.length }} · {{ where }}
    </button>
    <span class="flex-1" />
    <span v-if="unsaved" class="text-neutral-500">Save the file to stage its changes one at a time</span>
    <button
      v-else
      type="button"
      class="px-2 py-0.5 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
      data-testid="apply-hunk"
      :disabled="busy"
      @click="emit('apply', hunk)"
    >{{ staged ? 'Unstage this change' : 'Stage this change' }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { DiffHunk } from '#features/code/be/types.ts'
import { firstChangedLine, hunkLines } from '#features/code/fe/utils/diff-hunks.ts'

const props = defineProps<{
  hunks: DiffHunk[]
  /** Whether these are the pieces of what is staged, which are taken back rather than staged */
  staged: boolean
  /** Whether the tab holds edits that are not saved: the pieces are of the file as it was saved */
  unsaved: boolean
  busy: boolean
}>()
const emit = defineEmits<{ reveal: [line: number]; apply: [hunk: DiffHunk] }>()

const current = ref(0)
// A piece staged leaves fewer: the one that took its place is shown, or the last when it was the last
watch(() => props.hunks.length, (count) => { current.value = Math.min(current.value, Math.max(0, count - 1)) })

const hunk = computed(() => props.hunks[current.value]!)
const where = computed(() => hunkLines(hunk.value))

function step(by: number) {
  current.value = (current.value + by + props.hunks.length) % props.hunks.length
  emit('reveal', firstChangedLine(hunk.value))
}
</script>
