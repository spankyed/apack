<template>
  <p v-if="node.formattingFallback" role="note" class="mb-2 text-xs text-neutral-500">Showing source formatting for this large result.</p>
  <div v-if="node.kind === 'markdown'" :style="documentPaint" class="native-document-themed" :class="{ 'opacity-60': node.dim }" :data-native-plugin="node.plugin" @click.capture="modifiedClick = $event.metaKey || $event.ctrlKey || $event.shiftKey || $event.altKey">
    <div v-if="node.nativeAnsi !== undefined" class="native-markdown-engine font-mono text-xs leading-5" data-native-markdown-ansi><template v-for="(span, index) in nativeSpans" :key="index"><a v-if="span.href" :href="span.href" :style="span.style" @click.prevent="openMarkdownLink(span.href)">{{ span.text }}</a><span v-else :style="span.style">{{ span.text }}</span></template></div>
    <TiptapEditor v-else mode="viewer" variant="chat" :model-value="node.text" :open-viewer-link="openMarkdownLink" />
  </div>
  <pre v-else-if="node.nativeAnsi !== undefined" class="native-code-engine min-w-0 font-mono text-xs leading-5" :style="documentPaint" :data-native-plugin="node.plugin" :data-code-wrap="node.wrap" data-native-code-ansi role="region" :aria-label="node.format === 'diff' ? 'Code diff' : 'Code'"><span v-for="(span, index) in nativeSpans" :key="index" :style="span.style">{{ span.text }}</span></pre>
  <div v-else class="min-w-0" :style="documentPaint" :data-native-plugin="node.plugin" :data-code-wrap="node.wrap">
    <div v-if="diffRows" class="native-diff font-mono text-xs leading-5" :class="{ 'native-diff-truncate': node.wrap === 'truncate-end' }" role="region" aria-label="Code diff">
      <div v-for="(row, index) in diffRows" :key="index" class="native-diff-row" :data-diff-kind="row.kind">
        <template v-if="row.kind !== 'hunk'">
          <span class="native-diff-number" aria-hidden="true">{{ row.oldLine }}</span>
          <span class="native-diff-number" aria-hidden="true">{{ row.newLine }}</span>
          <span class="native-diff-marker">{{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' ' }}</span>
        </template>
        <code class="native-diff-text" :class="{ 'native-diff-header': row.kind === 'hunk' }"><span v-for="(token, part) in diffLines[index]" :key="part" :class="token.classes">{{ token.text }}</span></code>
      </div>
    </div>
    <div v-else class="native-source font-mono text-xs leading-5" :class="{ 'native-source-truncate': node.wrap === 'truncate-end', 'native-source-numbered': sourceStart !== undefined }" role="region" aria-label="Code">
      <div v-for="(line, index) in sourceLines" :key="index" class="native-source-row">
        <span v-if="sourceStart !== undefined" class="native-diff-number" aria-hidden="true">{{ sourceStart + index }}</span>
        <code class="native-source-text"><span v-for="(token, part) in line" :key="part" :class="token.classes">{{ token.text }}</span></code>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { claudeUiColor } from './native-ui-paint.ts'
import { parseClaudeStatus, parseClaudeDocument } from '#extensions/blocks/display/native-status-text.ts'
import { openLink } from '@apackdev/sdk/fe'
import { claudeCodeLines, claudeCodeDiffLines } from './native-code-lines.ts'
import { claudeCodeDiffRows } from './native-code-diff.ts'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { ClaudeUiNode } from '#generated/types.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'markdown' | 'code' }> }>()
const emit = defineEmits<{ press: [actionId: string, href?: string] }>()
const modifiedClick = ref(false)
const documentPaint = computed(() => ({ color: claudeUiColor(props.node.color) }))
const nativeSpans = computed(() => props.node.nativeAnsi === undefined ? [] : props.node.kind === 'markdown' ? parseClaudeDocument(props.node.nativeAnsi) : parseClaudeStatus(props.node.nativeAnsi))
function openMarkdownLink(href: string) {
  if (props.node.kind !== 'markdown' || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return
  try { if (!['https:', 'http:', 'file:'].includes(new URL(href).protocol)) return } catch { return }
  if (!modifiedClick.value && props.node.actionId && (!props.node.pressableLinks || props.node.pressableLinks.includes(href))) emit('press', props.node.actionId, href)
  else openLink(href)
}
const diffRows = computed(() => props.node.kind === 'code' && props.node.format === 'diff' ? claudeCodeDiffRows(props.node.source) : undefined)
const diffLines = computed(() => diffRows.value && props.node.kind === 'code' ? claudeCodeDiffLines(diffRows.value, props.node.language, props.node.path) : [])
const sourceStart = computed(() => props.node.kind === 'code' && props.node.format !== 'diff' ? props.node.startLine : undefined)
const sourceLines = computed(() => props.node.kind === 'code' ? claudeCodeLines(props.node.source,
  props.node.format === 'diff' ? 'plaintext' : props.node.language, props.node.path) : [])

</script>

<style scoped>
.native-markdown-engine { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.native-markdown-engine a { color: inherit; cursor: pointer; }
.native-markdown-engine a:focus-visible { outline: 1px solid currentColor; }
.native-code-engine { margin: 0; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
.native-code-engine[data-code-wrap="truncate-end"] { white-space: pre; overflow: hidden; }
.native-document-themed :deep(.ProseMirror), .native-document-themed :deep(.ProseMirror a), .native-document-themed :deep(.ProseMirror a:hover) { color: inherit; }
.native-source { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; }
.native-source-numbered { grid-template-columns: minmax(2ch, max-content) minmax(0, 1fr); column-gap: 1.5ch; }
.native-source-row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; }
.native-source-text { min-height: 1.25rem; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.native-source-truncate .native-source-text { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
:is(.native-source, .native-diff) :deep(.hljs-keyword), :is(.native-source, .native-diff) :deep(.hljs-selector-tag) { color: #c4b5fd; }
:is(.native-source, .native-diff) :deep(.hljs-string), :is(.native-source, .native-diff) :deep(.hljs-attr) { color: #86efac; }
:is(.native-source, .native-diff) :deep(.hljs-number), :is(.native-source, .native-diff) :deep(.hljs-literal) { color: #fdba74; }
:is(.native-source, .native-diff) :deep(.hljs-comment) { color: #737373; }
:is(.native-source, .native-diff) :deep(.hljs-title), :is(.native-source, .native-diff) :deep(.hljs-built_in) { color: #93c5fd; }
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
