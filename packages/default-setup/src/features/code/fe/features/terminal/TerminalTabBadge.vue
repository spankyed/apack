<!--
  A terminal's badge on its tab: what its program has said that is not on its screen, and that its shell
  keeps running when the app quits. Read from the terminal as the list has it now — a tab holds the
  terminal as it was when the tab was made.
-->
<template>
  <TerminalActivityBadge :activity="activity" :kept="kept" :status="status" />
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'
import { computed } from 'vue'
import { type CodeState } from '#features/code/fe/state.ts'
import { panelChild } from '../children.ts'
import TerminalActivityBadge from './TerminalActivityBadge.vue'
import { statusToShow } from './status.ts'

const props = defineProps<{ terminalId: string }>()

const codeActor: CodeState = useSurface()
const terminalActor = panelChild(codeActor, 'terminal')!
const { state: terminals } = useState(terminalActor)
const activity = computed(() => terminals.value.data.activity[props.terminalId])
const status = computed(() =>
  statusToShow(terminals.value.data.terminals.find(terminal => terminal.id === props.terminalId)?.statuses))
const kept = computed(() =>
  terminals.value.data.terminals.find(terminal => terminal.id === props.terminalId)?.kept === true)
</script>
