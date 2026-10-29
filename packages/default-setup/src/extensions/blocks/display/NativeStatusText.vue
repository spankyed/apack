<template><span class="whitespace-pre-wrap [overflow-wrap:anywhere] font-mono"><span v-for="(span, index) in spans" :key="index" :style="span.style">{{ span.text }}</span></span></template>
<script setup lang="ts">
import { computed } from 'vue'
import { parseClaudeStatus } from './native-status-text.ts'
const props = defineProps<{ text: string }>()
const spans = computed(() => parseClaudeStatus(props.text))
</script>
