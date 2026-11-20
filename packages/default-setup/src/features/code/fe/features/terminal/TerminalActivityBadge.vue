<!--
  What a terminal's program has said that is not on its screen, beside its name: what it says it is doing
  (OSC 7501: working, waiting on the person, finished, failed), that it rang or asked for the person to be
  told, how far along it says it is, and that its shell keeps running when the app quits. A status naming a
  program other than the one in front is drawn faint: anything in a terminal can write one.
-->
<template>
  <span v-if="kept" class="flex-shrink-0 text-neutral-500" title="Keeps running when the app quits" data-terminal-kept>
    <Pin class="h-2.5 w-2.5" />
  </span>
  <span
    v-if="status"
    class="flex flex-shrink-0 items-center text-[10px]"
    :class="[statusClass, status.confirmed === 'mismatched' && 'opacity-40']"
    :title="statusTitle(status, Date.now())"
    data-terminal-status
    :data-terminal-status-state="status.state"
    :data-terminal-status-kind="status.kind ?? undefined"
    :data-terminal-status-confirmed="status.confirmed"
  >
    <LoaderCircle v-if="status.state === 'working'" class="h-2.5 w-2.5 animate-spin" />
    <ShieldQuestion v-else-if="status.state === 'blocked' && status.kind === 'permission'" class="h-3 w-3" />
    <KeyRound v-else-if="status.state === 'blocked' && status.kind === 'auth'" class="h-3 w-3" />
    <CircleHelp v-else-if="status.state === 'blocked'" class="h-3 w-3" />
    <CircleCheck v-else-if="status.state === 'done'" class="h-3 w-3" />
    <CircleAlert v-else-if="status.state === 'error'" class="h-3 w-3" />
    <span v-else class="h-1.5 w-1.5 rounded-full bg-current" />
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
import { CircleAlert, CircleCheck, CircleHelp, KeyRound, LoaderCircle, Pin, ShieldQuestion } from 'lucide-vue-next'
import type { TerminalActivity } from '#features/code/fe/features/terminal/state.ts'
import type { TerminalStatus } from '#features/code/be/types.ts'
import { statusTitle } from '#features/code/fe/features/terminal/status.ts'

const props = defineProps<{
  activity: TerminalActivity | undefined
  kept: boolean
  /** The one record to show of what the terminal's programs say they are doing (`statusToShow`), where there is one */
  status?: TerminalStatus
}>()

const statusClass = computed(() => {
  switch (props.status?.state) {
    case 'blocked': return 'text-amber-400'
    case 'error': return 'text-red-400'
    case 'done': return 'text-green-400'
    case 'working': return 'text-blue-400'
    default: return 'text-neutral-500'
  }
})

const progressTitle = computed(() => {
  const progress = props.activity?.progress
  if (!progress) return ''
  const said = progress.state === 'error' ? 'Reports an error' : progress.state === 'paused' ? 'Paused' : 'Working'
  return progress.percent === null ? said : `${said}, ${progress.percent}% done`
})
</script>
