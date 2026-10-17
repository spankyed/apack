<template>
  <div v-if="node.kind === 'markdown'" :class="{ 'opacity-60': node.dim }" :data-native-plugin="node.plugin" @click.capture="modifiedClick = $event.metaKey || $event.ctrlKey || $event.shiftKey || $event.altKey">
    <TiptapEditor mode="viewer" variant="chat" :model-value="node.text" :open-viewer-link="openMarkdownLink" />
  </div>
  <div v-else class="min-w-0" :data-native-plugin="node.plugin" :data-code-wrap="node.wrap">
    <div v-if="node.path" class="break-words text-neutral-500">{{ node.path }}</div>
    <div class="flex min-w-0 gap-2">
      <pre v-if="node.startLine !== undefined" class="select-none text-right text-neutral-500" aria-hidden="true">{{ lineNumbers }}</pre>
      <div class="min-w-0 flex-1 native-code" :class="{ 'native-code-truncate': node.wrap === 'truncate-end' }">
        <TiptapEditor mode="viewer" variant="chat" :model-value="codeMarkdown" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { openLink } from '@apackdev/sdk/fe'
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
const codeMarkdown = computed(() => {
  if (props.node.kind !== 'code') return ''
  const node = props.node
  // A fence longer than any source run keeps vendor text literal, including embedded fences.
  const fence = '`'.repeat([...node.source.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length + 1), 3))
  const hint = node.language ?? node.path?.match(/\.([\w+-]+)$/)?.[1]
  const language = node.format === 'diff' ? 'diff' : /^[\w+-]+$/.test(hint ?? '') ? hint : ''
  return `${fence}${language ?? ''}\n${node.source}\n${fence}`
})
const lineNumbers = computed(() => props.node.kind === 'code' && props.node.startLine !== undefined
  ? props.node.source.split('\n').map((_, index) => props.node.kind === 'code' ? (props.node.startLine ?? 1) + index : '').join('\n') : '')
</script>

<style scoped>
.native-code :deep(pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
.native-code-truncate :deep(pre) { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
</style>
