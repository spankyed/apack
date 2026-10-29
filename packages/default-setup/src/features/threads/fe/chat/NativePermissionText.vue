<template>
  <span class="native-permission-text"><template v-for="(span, index) in spans" :key="index"><a v-if="span.href" :href="span.href" :style="span.style" @click.prevent="open($event, span.href)" @auxclick.prevent="open($event, span.href)">{{ span.text }}</a><span v-else :style="span.style">{{ span.text }}</span></template></span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { openLink } from '@apackdev/sdk/fe'
import { parseClaudeDocument } from '#extensions/blocks/display/native-status-text.ts'
const props = defineProps<{ text: string; ansi?: string }>()
const spans = computed(() => props.ansi === undefined ? [{ text: props.text, style: {} }] : parseClaudeDocument(props.ansi))
function open(event: MouseEvent, href: string) {
  if (event.button === 0 || event.button === 1) openLink(href)
}
</script>
<style scoped>
.native-permission-text { white-space: pre-wrap; overflow-wrap: anywhere; font-family: monospace; }
a { color: inherit; text-decoration: underline; cursor: pointer; }
a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
