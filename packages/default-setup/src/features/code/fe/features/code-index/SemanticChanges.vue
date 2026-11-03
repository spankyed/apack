<template>
  <div class="p-3" data-testid="semantic-changes">
    <div class="flex items-center gap-1 mb-1 px-2 cursor-pointer" @click="expanded = !expanded">
      <component :is="expanded ? ChevronDown : ChevronRight" class="w-3 h-3 text-neutral-400" />
      <span class="text-xs font-medium text-neutral-400">STAGED BY DEFINITION</span>
    </div>
    <template v-if="expanded">
      <div v-if="error" class="px-2 text-xs text-red-400">{{ error }}</div>
      <div v-else-if="diff && diff.changes.length === 0" class="px-2 text-xs text-neutral-500">No definition changed</div>
      <div
        v-for="change in diff?.changes ?? []"
        :key="`${change.path}#${change.name}#${change.change}`"
        class="flex items-baseline gap-2 px-2 py-[2px]"
        :title="change.signature"
      >
        <span class="w-16 shrink-0 text-[11px]" :class="CHANGE_COLORS[change.change]">{{ change.change }}</span>
        <span class="font-mono text-[12px] truncate text-neutral-200">{{ change.name }}</span>
        <span class="ml-auto shrink text-[11px] truncate text-neutral-500">{{ change.path }}</span>
      </div>
      <div v-if="diff?.unread.length" class="px-2 mt-1 text-[11px] text-neutral-500">
        {{ diff.unread.length }} other {{ diff.unread.length === 1 ? 'file' : 'files' }} not read: {{ diff.unread.join(', ') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'
import { ref, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { CodeState } from '#features/code/fe/state.ts'
import { codeChild } from '../children.ts'

/** Each refresh of the git status is a new list, which is what says the staged change may have moved */
const props = defineProps<{ stagedFiles: readonly unknown[] }>()

const CHANGE_COLORS = {
  added: 'text-green-400', removed: 'text-red-400', signature: 'text-yellow-400', body: 'text-neutral-400',
} as const

const codeActor: CodeState = useSurface()
const indexActor = codeChild(codeActor, 'codeIndex')!
const diff = useSelector(indexActor, (state) => state.context.diff)
const error = useSelector(indexActor, (state) => state.context.diffError)
const expanded = ref(false)

watch([expanded, () => props.stagedFiles], ([open]) => {
  // Through the surface, whose own send is what names it as the one to answer; it routes this to its `codeIndex` child
  if (open) codeActor.send({ type: 'codeIndex.LOAD_STAGED_DIFF' })
})
</script>
