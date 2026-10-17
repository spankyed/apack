<template>
  <div v-if="node.kind === 'box'" class="min-w-0 native-box" :style="boxStyle" :data-native-plugin="node.plugin">
    <NativeUiNode v-for="(child, index) in node.children" :key="child.kind === 'input' || child.kind === 'select' ? child.actionId : index" :node="child" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" />
  </div>
  <NativeUiSvg v-else-if="node.kind === 'svg'" :node="node" />
  <NativeUiDocument v-else-if="node.kind === 'markdown' || node.kind === 'code'" :node="node" @press="(actionId, href) => emit('press', actionId, href)" />
  <NativeUiField v-else-if="node.kind === 'input' || node.kind === 'select'" :key="node.actionId" :node="node" @field="emit('field', $event)" />
  <span v-else-if="node.kind === 'text'" class="whitespace-pre-wrap break-words" :class="textClasses" :dir="node.style?.dir ?? 'auto'" :data-native-plugin="node.plugin">{{ node.text }}<NativeUiNode v-for="(child, index) in node.children" :key="index" :node="child" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" /></span>
  <component :is="node.href ? 'a' : 'span'" v-else-if="node.kind === 'link'" :href="node.href" :data-native-plugin="node.plugin" :class="node.href ? 'underline text-blue-400 focus-visible:outline focus-visible:outline-blue-400' : undefined" @click.prevent="node.href && openLink(node.href)">
    <NativeUiNode v-for="(child, index) in node.children" :key="index" :node="child" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" />
  </component>
  <button v-else-if="node.kind === 'button'" type="button" :disabled="!node.actionId" :data-native-plugin="node.plugin"
    :aria-label="node.label" :data-native-autofocus="node.autoFocus === true && !!node.actionId ? 'true' : undefined"
    :data-native-role="node.role"
    class="self-start max-w-full whitespace-normal break-words rounded border px-2 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
    :class="[node.variant === 'primary' ? 'border-blue-400 bg-blue-600 text-white hover:bg-blue-500' : 'border-neutral-600 text-neutral-200 hover:bg-neutral-700',
      node.dimColor && 'opacity-60 hover:opacity-100 focus:opacity-100', node.role === 'dismiss' && 'ml-auto']"
    @click="node.actionId && emit('press', node.actionId)">
    <span v-if="node.role === 'dismiss'" aria-hidden="true">×</span>
    <template v-else-if="node.children?.length"><NativeUiNode v-for="(child, index) in node.children" :key="index" :node="child" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" /></template>
    <template v-else>{{ node.label }}</template>
  </button>
  <span v-else-if="node.component !== 'engine'" class="text-neutral-500" :data-native-plugin="node.plugin">Unsupported Claude component: {{ node.component }}</span>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import { openLink } from '@apackdev/sdk/fe'
import NativeUiSvg from './NativeUiSvg.vue'
import NativeUiDocument from './NativeUiDocument.vue'
import NativeUiField from './NativeUiField.vue'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
const props = defineProps<{ node: ClaudeUiNode }>()
const boxStyle = computed<CSSProperties>(() => {
  if (props.node.kind !== 'box') return {}
  const layout = props.node.layout ?? {}
  const result: CSSProperties = { display: 'flex', flexDirection: 'column', position: 'relative' }
  const scale = { xs: 0.25, sm: 0.5, md: 1, lg: 1.5, xl: 2 }
  for (const [name, value] of Object.entries(layout)) {
    const horizontal = /(?:Width|width|Left|left|Right|right|columnGap|X)$/.test(name)
    const unit = horizontal ? 'ch' : 'lh'
    const numeric = typeof value === 'number'
    const spacing = /^(?:gap|columnGap|rowGap|margin|padding)/.test(name)
    const converted = spacing ? numeric ? ['gap', 'margin', 'padding'].includes(name) ? `${value}lh ${value}ch` : `${value}${unit}` : `${scale[value as keyof typeof scale]}rem`
      : ['flexGrow', 'flexShrink'].includes(name) ? value
      : numeric ? `${value}${unit}` : value
    if (name.endsWith('X') || name.endsWith('Y')) {
      const base = name.slice(0, -1)
      Object.assign(result, name.endsWith('X') ? { [`${base}Left`]: converted, [`${base}Right`]: converted } : { [`${base}Top`]: converted, [`${base}Bottom`]: converted })
    } else Object.assign(result, { [name]: converted })
  }
  return result
})
const textClasses = computed(() => {
  if (props.node.kind !== 'text') return []
  const style = props.node.style ?? {}
  return [style.size && textSizes[style.size], style.weight ? textWeights[style.weight] : style.bold ? 'font-semibold' : undefined,
    { italic: style.italic, underline: style.underline, 'line-through': style.strikethrough, 'font-mono': style.mono, 'tabular-nums': style.tabular, 'opacity-60': style.dimColor }]
})
const emit = defineEmits<{ press: [actionId: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
</script>

<script lang="ts">
const textSizes = { caption: 'text-[10px]', footnote: 'text-xs', body: 'text-sm', heading: 'text-base', title: 'text-lg' }
const textWeights = { regular: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' }
</script>
