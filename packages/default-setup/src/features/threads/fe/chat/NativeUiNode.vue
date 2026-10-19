<template>
  <div v-if="node.kind === 'box'" :ref="hoverElement" class="min-w-0 native-box" :data-native-scroll-id="node.scrollId" :style="boxStyle" :data-native-border-dim="boxPaint?.borderDimColor === true ? 'true' : undefined" :data-native-plugin="node.plugin">
    <NativeUiNode v-for="(child, index) in node.children" :key="child.kind === 'input' || child.kind === 'select' ? child.actionId : index" :node="child" :scope-enabled="childScopeEnabled(index)" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" ><template #engine><slot name="engine" /></template></NativeUiNode>
  </div>
  <NativeUiClient v-else-if="node.kind === 'client'" :key="node.id" :node="node"><NativeUiNode v-for="(child,index) in node.children" :key="index" :node="child" @press="(id,href)=>emit('press',id,href)" @field="emit('field',$event)" /></NativeUiClient>
  <NativeUiSvg v-else-if="node.kind === 'svg'" :node="node" />
  <NativeUiDocument v-else-if="node.kind === 'markdown' || node.kind === 'code'" :node="node" @press="(actionId, href) => emit('press', actionId, href)" />
  <NativeUiField v-else-if="node.kind === 'input' || node.kind === 'select'" :key="node.actionId" :node="node" @field="emit('field', $event)" />
  <span v-else-if="node.kind === 'text'" :ref="hoverElement" class="whitespace-pre-wrap break-words" :class="textClasses" :style="textPaint" :dir="node.style?.dir ?? 'auto'" :data-native-plugin="node.plugin">{{ node.text }}<NativeUiNode v-for="(child, index) in node.children" :key="index" :node="child" :scope-enabled="childScopeEnabled(index)" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" ><template #engine><slot name="engine" /></template></NativeUiNode></span>
  <component :is="node.href ? 'a' : 'span'" v-else-if="node.kind === 'link'" :href="node.href" :data-native-plugin="node.plugin" :style="{ color: claudeUiColor(node.color) }" :class="node.href ? 'underline focus-visible:outline focus-visible:outline-current' : undefined" @click.prevent="node.href && openLink(node.href)">
    <NativeUiNode v-for="(child, index) in node.children" :key="index" :node="child" :scope-enabled="childScopeEnabled(index)" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" ><template #engine><slot name="engine" /></template></NativeUiNode>
  </component>
  <button v-else-if="node.kind === 'button'" :aria-expanded="node.expanded" :ref="hoverElement" :style="buttonPaint" type="button" :disabled="!node.actionId" :data-native-plugin="node.plugin"
    :aria-label="node.label" :aria-keyshortcuts="node.hotkey" :data-native-focus-id="node.focusId" :data-native-scroll-id="node.focusId" :data-native-hotkey="node.actionId ? node.hotkey : undefined" :data-native-autofocus="node.autoFocus === true && !!node.actionId ? 'true' : undefined"
    :data-native-role="node.role"
    class="inline-flex min-h-8 max-w-full self-start items-center justify-center gap-1.5 whitespace-normal break-words rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-40"
    :class="[node.variant === 'primary' ? 'border-blue-400/20 bg-blue-400/[0.12] text-blue-200 hover:border-blue-400/30 hover:bg-blue-400/20' : 'border-transparent bg-transparent text-neutral-400 hover:border-white/[0.06] hover:bg-white/[0.05] hover:text-neutral-100',
      buttonTextStyle.dimColor && 'opacity-60 hover:opacity-100 focus:opacity-100', node.role === 'dismiss' && 'ml-auto']"
    @click="node.actionId && emit('press', node.actionId)">
    <span v-if="node.role === 'dismiss'" aria-hidden="true">×</span>
    <template v-else-if="node.children?.length"><NativeUiNode v-for="(child, index) in node.children" :key="index" :node="child" :scope-enabled="childScopeEnabled(index)" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" ><template #engine><slot name="engine" /></template></NativeUiNode></template>
    <template v-else>{{ node.label }}</template>
    <kbd v-if="node.hotkey" :style="{ color: claudeUiColor(node.hotkeyColor) }" aria-hidden="true" class="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded border border-current/15 px-1 font-mono text-[10px] leading-none opacity-60">{{ node.hotkey.toUpperCase() }}</kbd>
  </button>
  <slot v-else-if="node.component === 'engine'" name="engine" />
  <span v-else class="text-neutral-500" :data-native-plugin="node.plugin">Unsupported Claude component: {{ node.component }}</span>
</template>

<script setup lang="ts">
import { computed, inject, provide, ref, onBeforeUnmount, onUpdated, type ComponentPublicInstance, type CSSProperties } from 'vue'
import { openLink } from '@apackdev/sdk/fe'
import NativeUiClient from './NativeUiClient.vue'
import NativeUiSvg from './NativeUiSvg.vue'
import { claudeUiBoxPaint, claudeUiColor, claudeUiTextPaint, claudeTextPaint, type ClaudeTextPaint } from './native-ui-paint.ts'
import { claudeHoverSurface, claudeHoverBox } from './native-ui-hover.ts'
import NativeUiDocument from './NativeUiDocument.vue'
import NativeUiField from './NativeUiField.vue'
import type { ClaudeUiTextStyle } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
const props = withDefaults(defineProps<{ node: ClaudeUiNode; scopeEnabled?: boolean }>(), { scopeEnabled: true })
const surface = inject(claudeHoverSurface, undefined)
const parentBox = inject(claudeHoverBox, computed(() => false))
const inheritedPaint = inject(claudeTextPaint, computed<ClaudeTextPaint>(() => ({})))
const underPointer = ref(false)
const hover = computed(() => 'hover' in props.node ? props.node.hover : undefined)
const group = computed(() => hover.value?.group)
const keyedBox = computed(() => props.node.kind === 'box' && props.node.boxKey !== undefined)
const boxHovered = computed(() => keyedBox.value ? props.node.kind === 'box' && typeof props.node.boxKey === 'string' && props.scopeEnabled !== false && underPointer.value : parentBox.value)
provide(claudeHoverBox, boxHovered)
const hot = computed(() => group.value !== undefined ? surface?.groups.value.has(group.value) === true : boxHovered.value)
const overrides = computed(() => hot.value ? hover.value : undefined)
let unregister: (() => void) | undefined
let registeredElement: Element | undefined
function hoverElement(value: Element | ComponentPublicInstance | null) {
  if (value === registeredElement) return
  unregister?.(); unregister = undefined; registeredElement = value instanceof HTMLElement ? value : undefined
  if (registeredElement instanceof HTMLElement && surface) unregister = surface.register({ element: registeredElement, underPointer, group })
}
onBeforeUnmount(() => unregister?.())
onUpdated(() => surface?.refresh())
function childScopeEnabled(index: number): boolean {
  const node = props.node
  if (!('children' in node) || !node.children) return true
  const child = node.children[index]
  return child?.kind !== 'box' || child.boxKey === undefined || node.children.findIndex(sibling => sibling.kind === 'box' && sibling.boxKey === child.boxKey) === index
}
const boxPaint = computed(() => props.node.kind === 'box' ? { ...props.node.paint, ...overrides.value?.paint } : undefined)
const textStyle = computed<ClaudeUiTextStyle>(() => props.node.kind === 'text' ? { ...props.node.style, ...overrides.value?.text } : {})
const buttonTextStyle = computed<ClaudeUiTextStyle>(() => props.node.kind === 'button' ? { color: props.node.color, dimColor: props.node.dimColor, ...overrides.value?.text } : {})
const logicalPaint = computed<ClaudeTextPaint>(() => {
  const base = props.node.kind === 'button' ? {} : inheritedPaint.value
  const style: ClaudeTextPaint = props.node.kind === 'text' ? textStyle.value : props.node.kind === 'button' ? buttonTextStyle.value : {}
  const next = { ...base }
  for (const name of ['color', 'backgroundColor', 'inverse'] as const) if (style[name] !== undefined) Object.assign(next, { [name]: style[name] })
  if (boxPaint.value?.backgroundColor !== undefined) next.backgroundColor = boxPaint.value.backgroundColor
  if (next.inverse === false && base.inverse === true) { next.color ??= 'text'; next.backgroundColor ??= 'inverseText' }
  return next
})
provide(claudeTextPaint, logicalPaint)
const buttonPaint = computed<CSSProperties>(() => ({ ...claudeUiTextPaint(props.node.kind === 'button' ? logicalPaint.value : {}),
  ...(overrides.value?.text?.bold !== undefined ? { fontWeight: overrides.value.text.bold ? 600 : 400 } : {}),
  ...(overrides.value?.text?.italic !== undefined ? { fontStyle: overrides.value.text.italic ? 'italic' : 'normal' } : {}),
  ...(overrides.value?.text?.underline !== undefined || overrides.value?.text?.strikethrough !== undefined ? { textDecorationLine: [overrides.value.text.underline && 'underline', overrides.value.text.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none' } : {}) }))
const boxStyle = computed<CSSProperties>(() => {
  if (props.node.kind !== 'box') return {}
  const layout = { ...props.node.layout, ...overrides.value?.layout }
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
  const paint = claudeUiBoxPaint(boxPaint.value)
  if (overrides.value?.paint?.borderStyle !== undefined) {
    const base = claudeUiBoxPaint(props.node.paint)
    // A hover restyles the existing border and must never move the Box or its siblings.
    for (const name of ['borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'] as const) paint[name] = base[name] ?? base.borderWidth
  }
  return { ...result, ...paint }
})
const textPaint = computed<CSSProperties>(() => ({ ...claudeUiTextPaint(logicalPaint.value), ...(overrides.value?.text?.bold !== undefined ? { fontWeight: overrides.value.text.bold ? 600 : 400 } : {}) }))
const textClasses = computed(() => {
  if (props.node.kind !== 'text') return []
  const style = textStyle.value
  return [style.size && textSizes[style.size], style.weight ? textWeights[style.weight] : style.bold ? 'font-semibold' : undefined,
    { italic: style.italic, underline: style.underline, 'line-through': style.strikethrough, 'font-mono': style.mono, 'tabular-nums': style.tabular, 'opacity-60': style.dimColor }]
})
const emit = defineEmits<{ press: [actionId: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
</script>

<script lang="ts">
const textSizes = { caption: 'text-[11px]', footnote: 'text-xs', body: 'text-[13px]', heading: 'text-sm', title: 'text-base' }
const textWeights = { regular: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' }
</script>

<style scoped>
.native-box { border-color: var(--native-border-color, currentColor); }
.native-box[data-native-border-dim="true"] { border-color: color-mix(in srgb, var(--native-border-color, currentColor) 60%, transparent); }
</style>
