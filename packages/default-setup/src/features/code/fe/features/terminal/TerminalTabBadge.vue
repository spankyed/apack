<!--
  A terminal's badge on its tab: what its program has said that is not on its screen, and that its shell
  keeps running when the app quits. Read from the terminal as the list has it now — a tab holds the
  terminal as it was when the tab was made.
-->
<template>
  <TerminalActivityBadge :activity="activity" :kept="kept" />
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'
import { useSelector } from '@xstate/vue'
import { type CodeState } from '#features/code/fe/state.ts'
import { panelChild } from '../children.ts'
import TerminalActivityBadge from './TerminalActivityBadge.vue'

const props = defineProps<{ terminalId: string }>()

const codeActor: CodeState = useSurface()
const terminalActor = panelChild(codeActor, 'terminal')!
const activity = useSelector(terminalActor, (state) => state.context.activity[props.terminalId])
const kept = useSelector(terminalActor, (state) =>
  state.context.terminals.find(terminal => terminal.id === props.terminalId)?.kept === true)
</script>
