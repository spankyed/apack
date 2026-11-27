<!--
  A terminal's badge on its tab: what its program has said that is not on its screen, and that its shell
  keeps running when the app quits. Read from the terminal as the list has it now — a tab holds the
  terminal as it was when the tab was made.
-->
<template>
  <TerminalActivityBadge :activity="activity" :kept="kept" :status="status" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useState } from '#generated/state-fe.ts'
import TerminalActivityBadge from './TerminalActivityBadge.vue'
import { statusToShow } from './status.ts'

const props = defineProps<{ terminalId: string }>()

const { child } = useState('code')
const { state: terminals } = useState(() => child('terminal'))
const activity = computed(() => terminals.value?.data.activity[props.terminalId])
const status = computed(() =>
  statusToShow(terminals.value?.data.terminals.find(terminal => terminal.id === props.terminalId)?.statuses))
const kept = computed(() =>
  terminals.value?.data.terminals.find(terminal => terminal.id === props.terminalId)?.kept === true)
</script>
