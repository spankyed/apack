<template>
  <div>
    <div v-if="rows" class="space-y-1 font-mono text-xs leading-5">
      <div v-for="(row,index) in rows" :key="index" data-native-theme-row class="flex min-w-0 gap-2">
        <span aria-hidden="true" class="shrink-0 text-neutral-400">{{ row.kind === ' ' ? ' ' : row.kind }}</span>
        <code class="min-w-0 whitespace-pre-wrap break-words"><span v-for="(span,part) in row.spans" :key="part" :style="span.style">{{ span.text }}</span></code>
      </div>
    </div>
    <p v-else role="alert">Claude Code's painted sample could not be matched to its source lines.</p>
    <p v-if="preview.caption" class="mt-2 break-words text-neutral-400">{{ preview.caption }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { projectClaudeThemePreview } from './native-theme-preview.ts'
const props=defineProps<{preview:{text:string;ansi?:string;lines:string[];caption:string}}>()
const rows=computed(()=>projectClaudeThemePreview(props.preview.lines,props.preview.ansi??props.preview.text))
</script>
