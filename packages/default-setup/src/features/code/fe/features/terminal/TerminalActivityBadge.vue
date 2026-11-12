<!--
  What a terminal's program has said that is not on its screen, beside its name: that it rang or asked for
  the person to be told, how far along it says it is, and that its shell keeps running when the app quits.
-->
<template>
  <span v-if="kept" class="flex-shrink-0 text-neutral-500" title="Keeps running when the app quits" data-terminal-kept>
    <Pin class="h-2.5 w-2.5" />
  </span>
  <span
    v-if="activity?.progress"
    class="flex-shrink-0 text-[10px] tabular-nums"
    :class="activity.progress.state === 'error' ? 'text-red-400' : activity.progress.state === 'paused' ? 'text-amber-400' : 'text-blue-400'"
    :title="progressTitle"
    data-terminal-progress
  >{{ activity.progress.percent === null ? '…' : `${activity.progress.percent}%` }}</span>
  <span
    v-if="activity?.notification || activity?.bell"
    class="h-1.5 w-1.5 flex-shrink-0 rounded-full"
    :class="activity.notification ? 'bg-blue-400' : 'bg-amber-400'"
    :title="activity.notification ? [activity.notification.title, activity.notification.body].filter(Boolean).join(' — ') : 'Rang the bell'"
    data-terminal-attention
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Pin } from 'lucide-vue-next'
import type { TerminalActivity } from '#features/code/fe/features/terminal/state.ts'

const props = defineProps<{ activity: TerminalActivity | undefined; kept: boolean }>()

const progressTitle = computed(() => {
  const progress = props.activity?.progress
  if (!progress) return ''
  const said = progress.state === 'error' ? 'Reports an error' : progress.state === 'paused' ? 'Paused' : 'Working'
  return progress.percent === null ? said : `${said}, ${progress.percent}% done`
})
</script>
