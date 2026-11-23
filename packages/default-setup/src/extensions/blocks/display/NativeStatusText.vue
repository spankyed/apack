<template>
  <component :is="as ?? 'span'" class="native-status-text whitespace-pre-wrap font-mono" :class="as === 'pre' ? 'break-words' : '[overflow-wrap:anywhere]'">
    <span v-for="(span, index) in spans" :key="index" :style="span.style">{{ span.text }}</span>
  </component>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { parseClaudeStatus } from './native-status-text.ts'
const props = defineProps<{ text: string; as?: 'pre' }>()
const spans = computed(() => parseClaudeStatus(props.text))
</script>


<style scoped>
/* U+23BF subset of Noto Sans CJK JP, f8d157532fbfaeda587e826d4cd5b21a49186f7c.
   Copyright and SIL OFL 1.1 text are embedded in the font. */
@font-face {
  font-family: 'Apack Terminal Branch';
  src: url('./native-terminal-branch.woff') format('woff');
  font-display: swap;
  unicode-range: U+23BF;
}
.native-status-text {
  font-family: 'Apack Terminal Branch', var(--font-mono, monospace);
}
</style>
