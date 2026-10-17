<template>
  <div v-if="node.kind === 'markdown'" :class="{ 'opacity-60': node.dim }" :data-native-plugin="node.plugin" @click.capture="modifiedClick = $event.metaKey || $event.ctrlKey || $event.shiftKey || $event.altKey">
    <TiptapEditor mode="viewer" variant="chat" :model-value="node.text" :open-viewer-link="openMarkdownLink" />
  </div>
  <div v-else class="min-w-0" :data-native-plugin="node.plugin" :data-code-wrap="node.wrap">
    <div v-if="diffRows" class="native-diff font-mono text-xs leading-5" :class="{ 'native-diff-truncate': node.wrap === 'truncate-end' }" role="region" aria-label="Code diff">
      <div v-for="(row, index) in diffRows" :key="index" class="native-diff-row" :data-diff-kind="row.kind">
        <template v-if="row.kind !== 'hunk'">
          <span class="native-diff-number" aria-hidden="true">{{ row.oldLine }}</span>
          <span class="native-diff-number" aria-hidden="true">{{ row.newLine }}</span>
          <span class="native-diff-marker">{{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' ' }}</span>
        </template>
        <code class="native-diff-text" :class="{ 'native-diff-header': row.kind === 'hunk' }">{{ row.text || ' ' }}</code>
      </div>
    </div>
    <div v-else class="flex min-w-0 gap-2">
      <pre v-if="node.startLine !== undefined && node.format !== 'diff'" class="select-none text-right text-neutral-500" aria-hidden="true">{{ lineNumbers }}</pre>
      <div class="min-w-0 flex-1 native-code" :class="{ 'native-code-truncate': node.wrap === 'truncate-end' }">
        <TiptapEditor mode="viewer" variant="chat" :model-value="codeMarkdown" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { openLink } from '@apackdev/sdk/fe'
import { claudeCodeDiffRows } from './native-code-diff.ts'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { ClaudeUiNode } from '#generated/types.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'markdown' | 'code' }> }>()
const emit = defineEmits<{ press: [actionId: string, href?: string] }>()
const modifiedClick = ref(false)
function openMarkdownLink(href: string) {
  if (props.node.kind !== 'markdown' || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return
  try { if (!['https:', 'http:', 'file:'].includes(new URL(href).protocol)) return } catch { return }
  if (!modifiedClick.value && props.node.actionId && (!props.node.pressableLinks || props.node.pressableLinks.includes(href))) emit('press', props.node.actionId, href)
  else openLink(href)
}
const diffRows = computed(() => props.node.kind === 'code' && props.node.format === 'diff' ? claudeCodeDiffRows(props.node.source) : undefined)
const codeMarkdown = computed(() => {
  if (props.node.kind !== 'code') return ''
  const node = props.node
  // A fence longer than any source run keeps vendor text literal, including embedded fences.
  const fence = '`'.repeat([...node.source.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length + 1), 3))
  const hint = node.language ?? node.path?.match(/\.([\w+-]+)$/)?.[1]
  const language = node.format === 'diff' ? '' : /^[\w+-]+$/.test(hint ?? '') ? hint : ''
  return `${fence}${language ?? ''}\n${node.source}\n${fence}`
})
const lineNumbers = computed(() => props.node.kind === 'code' && props.node.startLine !== undefined
  ? props.node.source.split('\n').map((_, index) => props.node.kind === 'code' ? (props.node.startLine ?? 1) + index : '').join('\n') : '')
</script>

<style scoped>
.native-code :deep(pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
.native-code-truncate :deep(pre) { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.native-diff { display: grid; grid-template-columns: minmax(2ch, max-content) minmax(2ch, max-content) 1ch minmax(0, 1fr); column-gap: 0.75ch; min-width: 0; overflow: hidden; }
.native-diff-row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; }
.native-diff-number { color: #737373; text-align: right; user-select: none; }
.native-diff-marker { user-select: none; }
.native-diff-text { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.native-diff-header { grid-column: 1 / -1; color: #a3a3a3; padding-block: 0.25rem; }
.native-diff-row[data-diff-kind="add"] { color: #86efac; background: rgb(34 197 94 / 0.08); }
.native-diff-row[data-diff-kind="remove"] { color: #fca5a5; background: rgb(239 68 68 / 0.08); }
.native-diff-truncate .native-diff-text { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
</style>
